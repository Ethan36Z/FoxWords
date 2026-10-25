// From generation to the flashcard API, offline: the real Corvus client talks
// to a local mock of Corvus API v1; accepted examples are served from the
// database, and dictionary rebuilds are handled.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const { startMockCorvus, completion, startFoxWords, tempDir } = require("./helpers");

let mock;
let fw;
let dir;

before(async () => {
  mock = await startMockCorvus(({ body }) => {
    const words = [...body.messages[1].content.matchAll(/^\d+\. word: (\S+)/gm)].map((m) => m[1]);
    const make = {
      bamboo: ["Pandas like to eat fresh bamboo.", "熊猫喜欢吃新鲜的竹子。"],
      cabbage: ["My mother bought a cabbage at the market.", "我妈妈在市场买了一棵卷心菜。"],
    };
    return completion(JSON.stringify({ items: words.map((w, i) => ({ id: i + 1, word: w, sentence: make[w][0], translation: make[w][1], meaning_ok: true })) }));
  });
  fw = await startFoxWords(mock.url);
  dir = tempDir();
});

after(async () => {
  await fw.close();
  await mock.close();
});

function importDict(entries) {
  const { importDictionary } = require("../import_dictionary");
  const file = path.join(dir, "dict.json");
  fs.writeFileSync(file, JSON.stringify(entries));
  importDictionary(file);
}

const entry = (word, meaning, extra = {}) => ({ word, meaning, translation: meaning, tags: "zk", level: "中考", ...extra });

test("generate with the real client, review, accept, load, serve", async () => {
  const { corvusClientFromEnv } = require("../corvusClient");
  const { Job } = require("../aiExamples/job");
  const { runJob } = require("../aiExamples/runner");
  const { exportReview, applyReview, parseReview } = require("../aiExamples/store");
  const { importAiExamples } = require("../import_ai_examples");

  importDict([entry("bamboo", "n. 竹子"), entry("cabbage", "n. 卷心菜"), entry("apple", "n. 苹果", { example: "I like apples.", exampleZh: "我喜欢苹果。" })]);

  const job = Job.create(path.join(dir, "job"), {
    items: [
      { word: "bamboo", meaning: "n. 竹子", meaningSource: "single", level: "中考", definition: "" },
      { word: "cabbage", meaning: "n. 卷心菜", meaningSource: "single", level: "中考", definition: "" },
    ],
  });
  const s = await runJob({ job, client: corvusClientFromEnv(), batchSize: 2, sleep: async () => {} });
  assert.equal(s.requests, 1);

  // What reached "Corvus" follows the API v1 contract
  const sent = mock.calls[0].body;
  assert.equal(sent.model, "corvus");
  assert.equal(sent.stream, false);
  assert.deepEqual(sent.response_format, { type: "json_object" });
  assert.ok(sent.max_tokens <= 1024);
  assert.deepEqual(sent.messages.map((m) => m.role), ["system", "user"]);
  assert.equal(mock.calls[0].headers.authorization, "Bearer " + fw.key);

  const review = path.join(job.dir, "review.tsv");
  exportReview(job, 3, review);
  const rows = parseReview(review).map((r) => ({ ...r, decision: "accept" }));
  const cols = Object.keys(rows[0]);
  fs.writeFileSync(review, [cols.join("\t"), ...rows.map((r) => cols.map((c) => r[c]).join("\t"))].join("\n"));
  const store = path.join(dir, "ai_examples.json");
  applyReview(job, 3, review, "tester", { storeFile: store });
  // an unreviewed entry in the file is never loaded
  const list = JSON.parse(fs.readFileSync(store, "utf-8"));
  list.push({ word: "apple", sentence: "Unreviewed sentence here.", translation: "未审核。", meaning: "n. 苹果" });
  fs.writeFileSync(store, JSON.stringify(list));
  assert.equal(importAiExamples(store), 2);

  const r = await fw.call("GET", "/api/dictionary?q=ba");
  const bamboo = r.data.find((w) => w.word === "bamboo");
  assert.equal(bamboo.example, ""); // the human example field is untouched
  assert.deepEqual(bamboo.aiExample, { sentence: "Pandas like to eat fresh bamboo.", translation: "熊猫喜欢吃新鲜的竹子。", source: "corvus", model: "corvus", edited: false });
  const apple = (await fw.call("GET", "/api/dictionary?q=apple")).data[0];
  assert.equal(apple.aiExample, undefined);
});

test("dictionary rebuilds: AI examples survive, but are not served when out of date", async () => {
  // rebuild 1: cabbage's core meaning changes; bamboo gains a human example
  importDict([
    entry("bamboo", "n. 竹子", { example: "Bamboo grows very fast.", exampleZh: "竹子长得很快。" }),
    entry("cabbage", "n. 洋白菜"),
  ]);
  const { db } = fw;
  assert.equal(db.prepare("SELECT COUNT(*) c FROM ai_examples").get().c, 2); // the import does not touch them
  const bamboo = (await fw.call("GET", "/api/dictionary?q=bamboo")).data[0];
  assert.equal(bamboo.example, "Bamboo grows very fast.");
  assert.equal(bamboo.aiExample, undefined); // a human example wins
  const cabbage = (await fw.call("GET", "/api/dictionary?q=cabbage")).data[0];
  assert.equal(cabbage.aiExample, undefined); // written for another meaning

  // rebuild 2: the meaning comes back, the example is served again
  importDict([entry("bamboo", "n. 竹子"), entry("cabbage", "n. 卷心菜")]);
  const back = (await fw.call("GET", "/api/dictionary?q=cabbage")).data[0];
  assert.equal(back.aiExample.translation, "我妈妈在市场买了一棵卷心菜。");

  // rebuild 3: the word is removed; its AI example stays stored but is unused
  importDict([entry("bamboo", "n. 竹子")]);
  assert.deepEqual((await fw.call("GET", "/api/dictionary?q=cabbage")).data, []);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM ai_examples WHERE word = 'cabbage'").get().c, 1);
});

test("today's words carry reviewed AI examples, without any AI request", async () => {
  const before = mock.calls.length;
  const r = await fw.call("GET", "/api/words/today?limit=10&refresh=1");
  assert.equal(r.status, 200);
  assert.equal(r.data.find((w) => w.word === "bamboo").aiExample.sentence, "Pandas like to eat fresh bamboo.");
  assert.equal(mock.calls.length, before);
});
