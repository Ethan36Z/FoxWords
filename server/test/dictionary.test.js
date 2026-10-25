// Regression tests for the committed dictionary.json and for upgrading an
// existing database to it. Uses a temporary database; real data is never touched.
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "foxwords-dict-"));
process.env.DB_FILE = path.join(tmpDir, "upgrade.db");
process.env.SETTINGS_FILE = path.join(tmpDir, "no-legacy-settings.json");

const db = require("../db");
const { importDictionary } = require("../import_dictionary");
const { BOOKS } = require("../books");

const DICT_FILE = path.join(__dirname, "..", "dictionary.json");
const dict = JSON.parse(fs.readFileSync(DICT_FILE, "utf-8"));
const byWord = new Map(dict.map((e) => [e.word, e]));
const record = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "dictionary.build.json"), "utf-8"));
const overrides = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "dictionary_overrides.json"), "utf-8"));

after(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("frequent words that the old build dropped are present", () => {
  const recovered = [
    // wrongly treated as inflections
    "number", "building", "meeting", "evening", "feeling", "interested", "beginning", "better", "best",
    "born", "thought", "ground", "according", "including", "abandoned", "advanced", "bacteria",
    // no exam tag in ECDICT
    "quickly", "carefully", "apparently", "investor", "judgment", "yeah", "anonymity", "checklist",
    // short, capitalised, domain-only
    "a", "an", "I", "Monday", "January", "December", "English", "Chinese", "TV", "OK", "Mr", "internet",
    // modern/professional words with a checked ECDICT meaning
    "password", "smartphone", "algorithm", "benchmark",
  ];
  const missing = recovered.filter((w) => !byWord.has(w));
  assert.deepEqual(missing, []);
});

test("excluded words are absent and every override gives a reason", () => {
  for (const o of overrides.exclude) assert.equal(byWord.has(o.word), false, o.word);
  for (const list of ["include", "exclude", "translation_keep_lines", "phonetic"]) {
    for (const o of overrides[list]) assert.ok(o.word && (o.reason || list === "phonetic"), `${list}: ${o.word}`);
  }
  const excluded = new Set(overrides.exclude.map((o) => o.word));
  assert.ok(record.removed.every((w) => excluded.has(w)), `unexpected removals: ${record.removed}`);
  assert.deepEqual(record.problems, []);
  assert.equal(record.words, dict.length);
});

test("no part of speech is cut from a meaning", () => {
  assert.ok(byWord.get("like").translation.split("\n").some((l) => l.startsWith("prep.")));
  assert.ok(byWord.get("still").translation.split("\n").some((l) => l.startsWith("adv.")));
  assert.ok(!byWord.get("crew").translation.includes("crow的过去式"));
  assert.equal(byWord.get("a").translation, "第一个字母 A; 一个; 第一的");
});

test("phonetics use IPA characters only", () => {
  const bad = dict.filter((e) => /[':,.^\\?@єεә]|ɒː/.test(e.phonetic));
  assert.deepEqual(bad.map((e) => `${e.word} ${e.phonetic}`), []);
  assert.equal(byWord.get("air").phonetic, "eə");
  assert.equal(byWord.get("law").phonetic, "lɔː");
  assert.equal(byWord.get("exactly").phonetic, "iɡˈzæktli");
});

test("entries are unique, complete, and levels match their tags", () => {
  assert.equal(byWord.size, dict.length);
  const label = { zk: "中考", gk: "高考", cet4: "四级", cet6: "六级", ky: "考研", ielts: "雅思", toefl: "托福" };
  const order = BOOKS.map((b) => b.id);
  for (const e of dict) {
    assert.ok(e.translation.trim(), `${e.word} has no meaning`);
    const tags = e.tags ? e.tags.split(" ") : [];
    assert.ok(tags.every((t) => order.includes(t)), `${e.word} tags ${e.tags}`);
    const easiest = tags.sort((a, b) => order.indexOf(a) - order.indexOf(b))[0];
    assert.equal(e.level, easiest ? label[easiest] : "", e.word);
  }
  assert.equal(byWord.get("Monday").level, "中考");
});

test("upgrading a database keeps ids, progress and notebook", () => {
  // An "old" dictionary: part of the new one plus a word that is now removed
  const oldFile = path.join(tmpDir, "old.json");
  const old = dict.slice(0, 300).concat([{ ...dict[0], word: "reservior", example: "", exampleZh: "" }]);
  fs.writeFileSync(oldFile, JSON.stringify(old));
  importDictionary(oldFile);

  const ids = new Map(db.prepare("SELECT word, id FROM dictionary").all().map((r) => [r.word, r.id]));
  db.prepare("INSERT INTO word_stats (word, knownCount, unknownCount, lastResult, lastSeenAt) VALUES (?, 1, 2, 'unknown', 'x')").run(dict[5].word);
  db.prepare("INSERT INTO word_stats (word, knownCount, unknownCount, lastResult, lastSeenAt) VALUES ('reservior', 0, 1, 'unknown', 'x')").run();
  db.prepare("INSERT INTO notebook (word, translation, definition, createdAt) VALUES ('reservior', 'n. 水库', '', 'x')").run();
  db.prepare("UPDATE settings SET book = 'cet4', dailyGoal = 33 WHERE id = 1").run();

  const count = importDictionary(DICT_FILE);
  assert.equal(count, dict.length);

  for (const [word, id] of ids) {
    if (word === "reservior") continue;
    assert.equal(db.prepare("SELECT id FROM dictionary WHERE word = ?").get(word).id, id, word);
  }
  assert.equal(db.prepare("SELECT COUNT(*) c FROM dictionary WHERE word = 'reservior'").get().c, 0);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM word_stats").get().c, 2);
  assert.equal(db.prepare("SELECT unknownCount FROM word_stats WHERE word = ?").get(dict[5].word).unknownCount, 2);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM notebook").get().c, 1);
  assert.deepEqual(db.prepare("SELECT book, dailyGoal FROM settings WHERE id = 1").get(), { book: "cet4", dailyGoal: 33 });

  // Stored rows match the file (the importer does not alter them)
  for (const w of ["number", "like", "I", "air", "Monday"]) {
    const row = db.prepare("SELECT phonetic, translation, example, level, tags FROM dictionary WHERE word = ?").get(w);
    const e = byWord.get(w);
    assert.deepEqual(row, { phonetic: e.phonetic, translation: e.translation, example: e.example, level: e.level, tags: e.tags });
  }
});
