// Words labelled vulgar/offensive stay in the dictionary but are only
// studied when the learner opts in. Uses a temporary database.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "foxwords-sensitive-"));
process.env.DB_FILE = path.join(tmpDir, "test.db");
process.env.SETTINGS_FILE = path.join(tmpDir, "none.json");

const app = require("../index");
const db = require("../db");
const { importDictionary } = require("../import_dictionary");

let server;
let base;
const api = async (method, url, body) => {
  const res = await fetch(base + url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
};

before(async () => {
  const words = [
    { word: "apple", labels: "" },
    { word: "river", labels: "" },
    { word: "damn", labels: "mild" },
    { word: "ass", labels: "offensive-sense" },
    { word: "shit", labels: "vulgar" },
    { word: "bitch", labels: "vulgar offensive" },
    { word: "negro", labels: "offensive" },
  ].map((w) => ({ ...w, translation: `n. ${w.word}`, tags: "cet4", meaning: `n. ${w.word}` }));
  const file = path.join(tmpDir, "dict.json");
  fs.writeFileSync(file, JSON.stringify(words));
  importDictionary(file);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("new study words skip vulgar and offensive words by default", async () => {
  await api("PUT", "/api/settings", { studyMix: "new", dailyGoal: 50 });
  const { body } = await api("GET", "/api/words/today?refresh=1");
  assert.deepEqual(body.map((w) => w.word).sort(), ["apple", "ass", "damn", "river"]);
  assert.equal(body.find((w) => w.word === "ass").labels, "offensive-sense");
});

test("opting in includes them; search always finds them", async () => {
  await api("PUT", "/api/settings", { includeSensitive: true });
  const { body } = await api("GET", "/api/words/today?refresh=1");
  assert.equal(body.length, 7);
  await api("PUT", "/api/settings", { includeSensitive: false });

  const search = await api("GET", "/api/dictionary?q=shi");
  assert.equal(search.body[0].word, "shit");
  assert.equal(search.body[0].labels, "vulgar");
});
