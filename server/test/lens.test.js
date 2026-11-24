// FoxWords Lens import and "sentences you have seen". Temporary database only.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "foxwords-lens-"));
process.env.DB_FILE = path.join(tmpDir, "test.db");
process.env.SETTINGS_FILE = path.join(tmpDir, "no-legacy-settings.json");

const app = require("../index");
const db = require("../db");
const { importDictionary } = require("../import_dictionary");

let server;
let base;
async function api(method, url, body) {
  const res = await fetch(base + url, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

// The shape FoxWords Lens writes (lens/core.py Library.save / export)
const entry = (id, text, extra = {}) => ({
  id, created: "2026-11-02 20:53:02", version: 1,
  capture: { raw: text, source: "Screen region", kind: "ocr", candidates: [{ text, start: null, end: null, boundary: "Closing punctuation" }], metadata: {} },
  candidate: { text, start: null, end: null, boundary: "Closing punctuation" },
  analysis: { meaning: "我本来想收工，但后来终于有了进展。", expressions: [], caution: "" },
  expression: null, conversation: [], review: {},
  ...extra,
});

before(async () => {
  const words = ["call", "day", "headway", "finally", "make", "study", "stair"];
  const dictFile = path.join(tmpDir, "dictionary.json");
  fs.writeFileSync(dictFile, JSON.stringify(words.map((w) => ({
    word: w, meaning: `n. ${w}-zh`, translation: `n. ${w}-zh`, definition: `${w}-def`, example: "", exampleZh: "", tags: "zk", level: "中考",
  }))));
  importDictionary(dictFile);
  db.prepare("UPDATE settings SET studyMix = 'new', dailyGoal = 20 WHERE id = 1").run();
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const sentence = "I was going to call it a day, but then we finally made some headway.";
const exportFile = [
  entry("a1", sentence, {
    analysis: {
      meaning: "我本来想收工，但后来终于有了进展。",
      expressions: [{ quote: "call it a day", pattern: "call it a day", meaning: "收工", usage: "口语，表示今天到此为止。", example: "Let's call it a day." }],
      caution: "",
    },
  }),
  entry("a2", "She ran up the stairs and studied all night."),
  entry("a3", "  I was going to call it a   day, but then we finally made some headway. "), // same sentence, other id
  { version: 2, id: "x", candidate: { text: "Future format." } },
  entry("", "No id here."),
];

test("preview counts new, duplicate and invalid entries without writing", async () => {
  const { status, body } = await api("POST", "/api/lens/preview", exportFile);
  assert.equal(status, 200);
  assert.equal(body.total, 5);
  assert.equal(body.fresh, 2);
  assert.equal(body.duplicate, 1);
  assert.deepEqual(body.invalid.map((x) => x.error), ["unsupported version 2", "missing id"]);
  assert.equal(body.sample[0].sentence, sentence);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM lens_sentences").get().c, 0);
});

test("import stores the entries once, keeping the original payload", async () => {
  const first = await api("POST", "/api/lens/import", exportFile);
  assert.deepEqual(first.body, { imported: 2, duplicate: 1, invalid: 2 });
  const again = await api("POST", "/api/lens/import", exportFile);
  assert.deepEqual(again.body, { imported: 0, duplicate: 3, invalid: 2 });
  const row = db.prepare("SELECT * FROM lens_sentences WHERE id = 'a1'").get();
  assert.equal(JSON.parse(row.payload).capture.source, "Screen region");
  assert.equal(row.sourceKind, "ocr");
});

test("list returns expressions; search filters", async () => {
  const all = await api("GET", "/api/lens");
  assert.equal(all.body.total, 2);
  const a1 = all.body.items.find((x) => x.id === "a1");
  assert.equal(a1.expressions[0].pattern, "call it a day");
  assert.equal(a1.expressions[0].example, "Let's call it a day.");
  const found = await api("GET", `/api/lens?q=${encodeURIComponent("stairs")}`);
  assert.deepEqual(found.body.items.map((x) => x.id), ["a2"]);
});

test("words in a sentence map to dictionary headwords, with notebook state", async () => {
  await api("POST", "/api/notebook", { word: "headway", translation: "进展", definition: "" });
  const { body } = await api("GET", "/api/lens/a1/words");
  assert.deepEqual(body.map((w) => w.word), ["call", "day", "finally", "headway"]); // irregular "made" is not mapped
  assert.equal(body.find((w) => w.word === "headway").inNotebook, true);
  const a2 = await api("GET", "/api/lens/a2/words");
  assert.deepEqual(a2.body.map((w) => w.word), ["stair", "study"]); // stairs, studied
  assert.equal((await api("GET", "/api/lens/nope/words")).status, 404);
});

test("study cards carry the sentences the learner has seen", async () => {
  const { body } = await api("GET", "/api/words/today?refresh=1");
  const byWord = new Map(body.map((w) => [w.word, w]));
  assert.equal(byWord.get("headway").lensSentences[0].sentence, sentence);
  assert.equal(byWord.get("stair").lensSentences[0].id, "a2");
  assert.equal(byWord.get("day").lensSentences.length, 1);
  assert.equal(byWord.has("study") && byWord.get("study").lensSentences[0].id, "a2");
});

test("non-array bodies are refused; delete removes one sentence", async () => {
  assert.equal((await api("POST", "/api/lens/preview", { entries: [] })).status, 400);
  assert.equal((await api("DELETE", "/api/lens/a2")).status, 200);
  assert.equal((await api("DELETE", "/api/lens/a2")).status, 404);
  assert.equal((await api("GET", "/api/lens")).body.total, 1);
});
