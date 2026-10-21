// Backend API tests. Run with: npm test (inside server/)
// Each run uses a fresh temporary database, so your real data is never touched.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "foxwords-test-"));
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
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

before(async () => {
  // Import a small dictionary file through the real importer
  const words = ["apple", "apply", "happy", "banana", "cherry", "grape", "lemon", "mango", "peach", "melon"];
  const dictFile = path.join(tmpDir, "dictionary.json");
  fs.writeFileSync(
    dictFile,
    JSON.stringify(
      words.map((w) => ({
        word: w,
        phonetic: `/${w}/`,
        translation: `${w}-zh\\n${w}-zh2`,
        definition: `${w}-def`,
        example: w === "apple" ? "I like apples." : "3",
        exampleZh: w === "apple" ? "我喜欢苹果。" : "",
        // apple, apply, happy are 中考 + CET-4; the rest only CET-4
        tags: ["apple", "apply", "happy"].includes(w) ? "zk cet4" : "cet4",
      }))
    )
  );
  importDictionary(dictFile);

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

test("health check responds ok", async () => {
  const { status, body } = await api("GET", "/api/health");
  assert.equal(status, 200);
  assert.equal(body.status, "ok");
});

test("notebook: add, list, reject duplicate, delete", async () => {
  const added = await api("POST", "/api/notebook", {
    word: "  apple ",
    translation: "苹果",
    definition: "a fruit",
  });
  assert.equal(added.status, 200);
  assert.equal(added.body.word, "apple");

  const dup = await api("POST", "/api/notebook", { word: "apple" });
  assert.equal(dup.status, 409);

  const list = await api("GET", "/api/notebook?limit=10&offset=0");
  assert.equal(list.status, 200);
  assert.equal(list.body.total, 1);
  assert.equal(list.body.items[0].translation, "苹果");

  const del = await api("DELETE", `/api/notebook/${added.body.id}`);
  assert.equal(del.status, 200);

  const missing = await api("DELETE", `/api/notebook/${added.body.id}`);
  assert.equal(missing.status, 404);
});

test("notebook: word is required", async () => {
  const { status } = await api("POST", "/api/notebook", { word: "   " });
  assert.equal(status, 400);
});

test("dictionary import: cleans text and fake examples", () => {
  const apple = db.prepare("SELECT * FROM dictionary WHERE word = 'apple'").get();
  assert.equal(apple.translation, "apple-zh\napple-zh2");
  assert.equal(apple.phonetic, "/apple/");
  assert.equal(apple.exampleZh, "我喜欢苹果。");
  const banana = db.prepare("SELECT example FROM dictionary WHERE word = 'banana'").get();
  assert.equal(banana.example, "");
});

test("settings: defaults, save, clamp, partial update", async () => {
  const initial = await api("GET", "/api/settings");
  assert.deepEqual(initial.body, { exampleFirst: true, dailyGoal: 20, studyMix: "mixed", book: "" });

  await api("PUT", "/api/settings", { exampleFirst: false, dailyGoal: 9999, studyMix: "review", book: "zk" });
  const saved = await api("GET", "/api/settings");
  assert.deepEqual(saved.body, { exampleFirst: false, dailyGoal: 500, studyMix: "review", book: "zk" });

  // Only changing dailyGoal keeps the rest; unknown values are ignored
  await api("PUT", "/api/settings", { dailyGoal: 5, studyMix: "bogus", book: "klingon" });
  const partial = await api("GET", "/api/settings");
  assert.deepEqual(partial.body, { exampleFirst: false, dailyGoal: 5, studyMix: "review", book: "zk" });

  await api("PUT", "/api/settings", { book: "" });
});

test("dictionary: prefix matches come first", async () => {
  const { status, body } = await api("GET", "/api/dictionary?q=app");
  assert.equal(status, 200);
  assert.deepEqual(
    body.map((r) => r.word),
    ["apple", "apply", "happy"]
  );

  const empty = await api("GET", "/api/dictionary?q=");
  assert.deepEqual(empty.body, []);
});

test("words/today: follows dailyGoal and caches the batch", async () => {
  await api("PUT", "/api/settings", { dailyGoal: 3, studyMix: "new" });

  const first = await api("GET", "/api/words/today");
  assert.equal(first.body.length, 3);

  const again = await api("GET", "/api/words/today");
  assert.deepEqual(again.body, first.body);

  const custom = await api("GET", "/api/words/today?limit=2&refresh=1");
  assert.equal(custom.body.length, 2);
});

test("review: unknown answers make a word unfamiliar until known enough", async () => {
  const bad = await api("POST", "/api/words/review", { word: "apple", result: "maybe" });
  assert.equal(bad.status, 400);

  await api("POST", "/api/words/review", { word: "apple", result: "unknown" });
  let r = await api("POST", "/api/words/review", { word: "apple", result: "unknown" });
  assert.deepEqual(r.body, {
    word: "apple",
    knownCount: 0,
    unknownCount: 2,
    tooEasy: false,
    unfamiliar: true,
  });

  await api("POST", "/api/words/review", { word: "apple", result: "known" });
  r = await api("POST", "/api/words/review", { word: "apple", result: "known" });
  assert.equal(r.body.unfamiliar, false);

  await api("POST", "/api/words/review", { word: "lemon", result: "unknown" });
  await api("POST", "/api/words/review", { word: "melon", result: "known" });

  const stats = await api("GET", "/api/words/stats");
  assert.deepEqual(stats.body, { seen: 3, unfamiliar: 1, tooEasy: 0, dictionary: 10 });
});

test("words/today: study mix picks new, review or both", async () => {
  // Known so far: apple (familiar again), lemon (unfamiliar), melon (familiar)
  await api("PUT", "/api/settings", { studyMix: "review" });
  const review = await api("GET", "/api/words/today?limit=10&refresh=1");
  assert.deepEqual(review.body.map((w) => w.word), ["lemon"]);
  assert.equal(review.body[0].isReview, true);

  await api("PUT", "/api/settings", { studyMix: "new" });
  const fresh = await api("GET", "/api/words/today?limit=10&refresh=1");
  assert.equal(fresh.body.length, 7); // 10 words minus the 3 already seen
  assert.ok(fresh.body.every((w) => !["apple", "lemon", "melon"].includes(w.word)));

  await api("PUT", "/api/settings", { studyMix: "mixed" });
  const mixed = await api("GET", "/api/words/today?limit=4&refresh=1");
  assert.equal(mixed.body.length, 4);
  assert.equal(mixed.body.filter((w) => w.isReview).length, 1);
  assert.equal(mixed.body[3].isReview, true); // spread out, not first
});

test("too easy: removed from today's cached batch too", async () => {
  await api("PUT", "/api/settings", { studyMix: "new", dailyGoal: 3 });
  const first = await api("GET", "/api/words/today?refresh=1");
  const victim = first.body[0].word;
  await api("POST", "/api/words/review", { word: victim, result: "easy" });
  const again = await api("GET", "/api/words/today");
  assert.equal(again.body.length, 2);
  assert.ok(!again.body.some((w) => w.word === victim));
  await api("DELETE", `/api/words/easy/${victim}`);
  db.prepare("DELETE FROM word_stats WHERE word = ?").run(victim);
});

test("too easy: word leaves both new and review pools", async () => {
  // lemon is unfamiliar from the previous test; marking it easy removes it from review
  await api("POST", "/api/words/review", { word: "lemon", result: "easy" });
  await api("PUT", "/api/settings", { studyMix: "review" });
  const review = await api("GET", "/api/words/today?limit=10&refresh=1");
  assert.deepEqual(review.body, []);

  // peach was never seen; marking it easy removes it from new words
  await api("POST", "/api/words/review", { word: "peach", result: "easy" });
  await api("PUT", "/api/settings", { studyMix: "new" });
  const fresh = await api("GET", "/api/words/today?limit=10&refresh=1");
  assert.ok(!fresh.body.some((w) => w.word === "peach" || w.word === "lemon"));

  const stats = await api("GET", "/api/words/stats");
  assert.equal(stats.body.tooEasy, 2);

  // Undo makes lemon unfamiliar again
  await api("DELETE", "/api/words/easy/lemon");
  await api("PUT", "/api/settings", { studyMix: "review" });
  const again = await api("GET", "/api/words/today?limit=10&refresh=1");
  assert.deepEqual(again.body.map((w) => w.word), ["lemon"]);
});

test("books: counts per exam list and new words follow the chosen book", async () => {
  const books = await api("GET", "/api/books");
  const byId = Object.fromEntries(books.body.map((b) => [b.id, b]));
  assert.equal(byId[""].total, 10);
  assert.equal(byId.zk.total, 3);
  assert.equal(byId.cet4.total, 10);
  assert.equal(byId.zk.seen, 1); // apple
  assert.equal(byId[""].selected, true);

  await api("PUT", "/api/settings", { book: "zk", studyMix: "new" });
  const fresh = await api("GET", "/api/words/today?limit=10&refresh=1");
  assert.deepEqual(fresh.body.map((w) => w.word).sort(), ["apply", "happy"]);

  const after = await api("GET", "/api/books");
  assert.equal(after.body.find((b) => b.id === "zk").selected, true);
  await api("PUT", "/api/settings", { book: "" });
});

test("login: demo account works, wrong password fails", async () => {
  const ok = await api("POST", "/api/login", { email: "test@example.com", password: "123456" });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.token);

  const bad = await api("POST", "/api/login", { email: "test@example.com", password: "nope" });
  assert.equal(bad.status, 401);
});

test("story: empty notebook returns 400 without calling the model", async () => {
  db.prepare("DELETE FROM notebook").run();
  const { status, body } = await api("POST", "/api/story", {});
  assert.equal(status, 400);
  assert.equal(body.error, "notebook is empty");
});
