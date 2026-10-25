// Read-only dictionary statistics: counts, overlap and fill order.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { computeStats, estimate, hasValidExample, loadFromJson, loadFromDb } = require("../dictionaryStats");

const ROWS = [
  { word: "apple", example: "I like apples.", exampleZh: "我喜欢苹果。", level: "中考", tags: "zk gk cet4" },
  { word: "river", example: "", exampleZh: "", level: "中考", tags: "zk cet4" },
  { word: "abandon", example: "3", exampleZh: "", level: "高考", tags: "gk cet4 toefl" },
  { word: "zeal", example: "", exampleZh: "", level: "托福", tags: "toefl" },
  { word: "quiet", example: "Be quiet please.", exampleZh: "请安静。", level: "四级", tags: "cet4" },
];

test("star ratings, blanks and fragments are not valid examples", () => {
  for (const v of ["", "3", "  4 ", "ok", "two words"]) assert.equal(hasValidExample(v), false, v);
  assert.equal(hasValidExample("I like apples."), true);
});

test("totals, per-book coverage and multi-book membership", () => {
  const s = computeStats(ROWS);
  assert.equal(s.total, 5);
  assert.equal(s.withExample, 2);
  assert.equal(s.missing, 3);
  const cet4 = s.books.find((b) => b.id === "cet4");
  assert.deepEqual([cet4.words, cet4.withExample, cet4.missing], [4, 2, 2]);
  const toefl = s.books.find((b) => b.id === "toefl");
  assert.deepEqual([toefl.words, toefl.missing, toefl.onlyInThisBook], [2, 2, 1]);
  assert.equal(s.overlap.cet4.toefl, 1);
  assert.equal(s.missingOverlap.zk.cet4, 1);
  assert.deepEqual(s.booksPerWord, { 1: 2, 2: 1, 3: 2 });
});

test("filling books in order never counts a word twice", () => {
  const s = computeStats(ROWS, { order: ["cet4", "toefl", "zk"] });
  assert.deepEqual(
    s.cumulative.map((c) => [c.id, c.newGenerations, c.cumulative]),
    [["cet4", 2, 2], ["toefl", 1, 3], ["zk", 0, 3]]
  );
});

test("estimate rounds requests up", () => {
  assert.deepEqual(estimate(17, { batchSize: 8, rpm: 4 }), { batchSize: 8, rpm: 4, requests: 3, minutes: 0.8 });
});

test("JSON file and imported database give the same numbers; the database is not modified", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "foxwords-stats-"));
  const file = path.join(dir, "dictionary.json");
  fs.writeFileSync(file, JSON.stringify(ROWS));
  const dbFile = path.join(dir, "stats.db");

  const Database = require("better-sqlite3");
  const db = new Database(dbFile);
  db.exec("CREATE TABLE dictionary (word TEXT, example TEXT, exampleZh TEXT, level TEXT, tags TEXT)");
  const ins = db.prepare("INSERT INTO dictionary VALUES (?, ?, ?, ?, ?)");
  for (const r of ROWS) ins.run(r.word, r.example, r.exampleZh, r.level, r.tags);
  db.close();
  const before = fs.readFileSync(dbFile);

  assert.deepEqual(computeStats(loadFromDb(dbFile)), computeStats(loadFromJson(file)));
  assert.ok(before.equals(fs.readFileSync(dbFile)));
  fs.rmSync(dir, { recursive: true, force: true });
});
