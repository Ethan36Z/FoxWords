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

test("lookup by sentence text, for FoxWords Lens", async () => {
  const { status, body } = await api("POST", "/api/lens/lookup", { sentence: "We made some headway on the stairs." });
  assert.equal(status, 200);
  assert.deepEqual(body.map((w) => [w.word, w.inNotebook, w.tooEasy]), [["headway", true, false], ["stair", false, false]]);
  assert.equal(body[1].level, "中考");
  db.prepare("INSERT INTO word_stats (word, tooEasy) VALUES ('stair', 1)").run();
  const again = await api("POST", "/api/lens/lookup", { sentence: "We made some headway on the stairs." });
  assert.equal(again.body[1].tooEasy, true);
  assert.equal((await api("POST", "/api/lens/lookup", { sentence: "" })).status, 400);
  assert.equal((await api("POST", "/api/lens/lookup", { sentence: "x ".repeat(900) })).status, 200); // an OCR region
  assert.equal((await api("POST", "/api/lens/lookup", { sentence: "x".repeat(2001) })).status, 400);
});

test("non-array bodies are refused; delete removes one sentence", async () => {
  assert.equal((await api("POST", "/api/lens/preview", { entries: [] })).status, 400);
  assert.equal((await api("DELETE", "/api/lens/a2")).status, 200);
  assert.equal((await api("DELETE", "/api/lens/a2")).status, 404);
  assert.equal((await api("GET", "/api/lens")).body.total, 1);
});

test("lookup maps irregular forms and finds lookup-only words", async () => {
  const file = path.join(tmpDir, "lookup.json");
  fs.writeFileSync(file, JSON.stringify({
    version: 1,
    words: [["headway", "ˈhedweɪ", "n. 进展", "n. 进展", "progress"], ["felt", "felt", "n. 毛毯", "n. 毛毯", ""],
      ["children", "", "pl. 孩子", "pl. 孩子", ""]],
    forms: [["made", "make", "pd", 1], ["felt", "feel", "pd", 1], ["children", "child", "s", 1]],
  }));
  db.prepare("INSERT INTO dictionary (word, meaning, translation, level) VALUES ('feel', 'v. 感觉', 'v. 感觉', '中考'), ('child', 'n. 孩子', 'n. 孩子', '中考')").run();
  const { importLookup, importLookupIfChanged } = require("../import_lookup");
  assert.deepEqual(importLookup(file), { words: 3, forms: 3 });
  assert.equal(importLookupIfChanged(file), null); // unchanged file is not reloaded
  const { body } = await api("POST", "/api/lens/lookup", { sentence: "We felt the children made headway, quickly." });
  const by = new Map(body.map((w) => [w.token, w]));
  assert.deepEqual([by.get("felt").word, by.get("felt").form, by.get("felt").also.word], ["feel", "过去式/过去分词", "felt"]);
  assert.equal(by.get("children").word, "child");
  assert.equal(by.get("children").also, null); // "pl. 孩子" only repeats child
  assert.deepEqual([by.get("made").word, by.get("made").form], ["make", "过去式/过去分词"]);
  // headway is in the study dictionary of this test, so it stays a study word
  assert.equal(by.get("headway").inDictionary, true);
  db.prepare("DELETE FROM dictionary WHERE word = 'headway'").run();
  const again = await api("POST", "/api/lens/lookup", { sentence: "Some headway." });
  assert.deepEqual([again.body[0].word, again.body[0].inDictionary, again.body[0].phonetic], ["headway", false, "ˈhedweɪ"]);
  // the notebook shows the phonetic of a lookup-only word
  await api("POST", "/api/notebook", { word: "glimpse", translation: "一瞥" });
  const nb = await api("GET", "/api/notebook?limit=100");
  assert.equal(nb.body.items.find((x) => x.word === "headway").phonetic, "ˈhedweɪ");
});
