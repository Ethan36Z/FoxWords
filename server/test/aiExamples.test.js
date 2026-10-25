// AI example workflow, fully offline: a scripted fake replaces Corvus.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { CorvusError } = require("../corvusClient");
const { selectWords, planItem } = require("../aiExamples/plan");
const { validateResponse, glossKeys } = require("../aiExamples/validate");
const { buildMessages, maxTokensFor } = require("../aiExamples/prompt");
const { Job } = require("../aiExamples/job");
const { runJob } = require("../aiExamples/runner");
const { exportReview, applyReview, readStore, parseReview } = require("../aiExamples/store");

const dictionary = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "dictionary.json"), "utf-8"));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "foxwords-ai-"));

// A tiny plan with known meanings
const WORDS = {
  apple: { meaning: "n. 苹果", good: ["I eat an apple every morning.", "我每天早上吃一个苹果。"] },
  river: { meaning: "n. 河, 江", good: ["We swam in the river last summer.", "去年夏天我们在河里游泳。"] },
  happy: { meaning: "a. 快乐的, 幸福的", good: ["The children look very happy today.", "孩子们今天看起来很快乐。"] },
  quickly: { meaning: "adv. 很快地", good: ["She finished her homework quickly.", "她很快地完成了作业。"] },
  window: { meaning: "n. 窗户", good: ["Please open the window for me.", "请帮我打开窗户。"] },
  teacher: { meaning: "n. 教师, 老师", good: ["Our teacher is very kind to us.", "我们的老师对我们很好。"] },
};
const planOf = (words) => ({
  items: words.map((w) => ({ word: w, meaning: WORDS[w].meaning, meaningSource: "single", level: "中考", definition: "" })),
});

function answer(words, override = {}) {
  return JSON.stringify({
    items: words.map((w, i) => ({ id: i + 1, word: w, sentence: WORDS[w].good[0], translation: WORDS[w].good[1], meaning_ok: true, ...(override[w] || {}) })),
  });
}

// Fake Corvus: each call is answered by the next step in `script`
function fakeClient(script) {
  const calls = [];
  return {
    calls,
    async chat(req) {
      const words = [...req.messages[1].content.matchAll(/^\d+\. word: (\S+)/gm)].map((m) => m[1]);
      calls.push({ words, req });
      const step = script.length ? script.shift() : "ok";
      if (step instanceof CorvusError) throw step;
      if (typeof step === "function") return step(words);
      return { content: answer(words), finishReason: "stop", model: "corvus", usage: null };
    },
  };
}

const fastClock = () => {
  let t = 1_000_000;
  const sleeps = [];
  return { now: () => t, sleep: async (ms) => { sleeps.push(ms); t += ms; }, sleeps };
};

function newJob(words) {
  return Job.create(path.join(tmp(), "job"), planOf(words));
}

function done(job) {
  return [...job.state(3)].filter(([, s]) => s.status === "done").map(([w]) => w).sort();
}

// ---------------------------------------------------------------- selection

test("pilot selection: 中考 words without examples, unverified meanings held back", () => {
  const { eligible, held } = selectWords(dictionary, [], { set: "zk-missing" });
  assert.equal(eligible.length + held.length, 147);
  assert.equal(eligible.length, 120);
  // 24 meanings that are only ECDICT's order, and 3 words held by hand
  assert.equal(held.filter((h) => h.reason.startsWith("core meaning not verified")).length, 24);
  assert.deepEqual(held.filter((h) => h.reason.startsWith("held:")).map((h) => h.word).sort(), ["cheer", "hotdog", "pop"]);
  assert.ok(eligible.some((e) => e.word === "spell")); // corrected meaning, now eligible
  assert.ok(eligible.every((e) => !e.example && e.meaning && !e.meaningSource.startsWith("ecdict-order")));
  // already accepted words are not generated again
  const again = selectWords(dictionary, [eligible[0].word], { set: "zk-missing" });
  assert.equal(again.eligible.length, eligible.length - 1);
  // vulgar words are never selected
  const v = selectWords(dictionary, [], { set: "all", words: ["shit", "apple"] });
  assert.deepEqual(v.held.map((h) => h.reason), ["labelled vulgar/offensive"]);
  assert.deepEqual(Object.keys(planItem(eligible[0])).sort(), ["definition", "level", "meaning", "meaningSource", "word"]);
});

test("prompt fits the Corvus v1 contract", () => {
  const items = planOf(["apple", "river"]).items;
  const msgs = buildMessages(items);
  assert.deepEqual(msgs.map((m) => m.role), ["system", "user"]);
  assert.match(msgs[1].content, /1\. word: apple \| use as: noun \| meaning: n\. 苹果/);
  assert.match(msgs[1].content, /Do not copy the dictionary meaning word for word/);
  const verb = buildMessages([{ word: "swing", meaning: "vi. 摇摆", level: "中考", definition: "n. a seat hanging from ropes" }])[1].content;
  assert.match(verb, /use as: verb/);
  assert.doesNotMatch(verb, /seat hanging/); // the English definition may describe another sense
  assert.match(msgs[1].content, /Return exactly 2 items/);
  assert.ok(maxTokensFor(8) <= 1024 && maxTokensFor(1) >= 200);
});

// ---------------------------------------------------------------- validation

test("validation: good answers are candidates", () => {
  const items = planOf(["apple", "river"]).items;
  const r = validateResponse(answer(["apple", "river"]), items);
  assert.deepEqual(r.results.map((x) => x.status), ["candidate", "candidate"]);
});

test("validation: hard failures are invalid", () => {
  const items = planOf(["apple", "river", "happy", "window"]).items;
  const r = validateResponse(
    answer(["apple", "river", "happy", "window"], {
      apple: { word: "pear" },
      river: { sentence: "river" },
      happy: { translation: "The children are happy." },
      window: { sentence: "Open the damn shit window now please." },
    }),
    items
  );
  assert.deepEqual(r.results.map((x) => x.status), ["invalid", "invalid", "invalid", "invalid"]);
  assert.match(r.results[0].errors.join(), /answered for "pear"/);
  assert.match(r.results[2].errors.join(), /no Chinese/);
  assert.match(r.results[3].errors.join(), /unsafe/);
});

test("validation: soft problems need review", () => {
  const items = planOf(["river", "happy", "teacher", "quickly"]).items;
  const r = validateResponse(
    answer(["river", "happy", "teacher", "quickly"], {
      river: { translation: "去年夏天我们在湖里游泳。" }, // meaning not visible
      happy: { meaning_ok: false },
      teacher: { translation: "我們的老師對我們很好。" }, // Traditional characters
      quickly: { sentence: "She did her homework fast and well." }, // word missing
    }),
    items
  );
  assert.deepEqual(r.results.map((x) => x.status), ["needs_review", "needs_review", "needs_review", "needs_review"]);
  assert.match(r.results[0].flags.join(), /core meaning not visible/);
  assert.match(r.results[1].flags.join(), /model says/);
  assert.match(r.results[2].flags.join(), /Traditional/);
  assert.match(r.results[3].flags.join(), /word form not found/);
});

test("validation: truncated JSON, missing items and duplicates", () => {
  const items = planOf(["apple", "river"]).items;
  const cut = answer(["apple", "river"]).slice(0, 60);
  const t = validateResponse(cut, items, { finishReason: "length" });
  assert.equal(t.batchError, "truncated (output limit)");
  assert.ok(t.results.every((x) => x.status === "invalid"));

  const one = JSON.stringify({ items: [JSON.parse(answer(["apple"])).items[0]] });
  const m = validateResponse(one, items);
  assert.deepEqual(m.results.map((x) => x.status), ["candidate", "invalid"]);
  assert.match(m.results[1].errors.join(), /missing/);

  const dup = validateResponse(answer(["apple", "river"], { river: { sentence: WORDS.apple.good[0] } }), items);
  assert.match(dup.results[1].errors.join(), /duplicate|not found/);
  const existing = validateResponse(answer(["apple"]), planOf(["apple"]).items, { existing: new Set([WORDS.apple.good[0]]) });
  assert.match(existing.results[0].errors.join(), /duplicate/);
});

test("gloss keys ignore notes and trailing 的", () => {
  assert.deepEqual(glossKeys("a. 快乐的, 幸福的"), ["快乐", "幸福"]);
  assert.deepEqual(glossKeys("pl. (非正式)copper便士, (美)分"), ["copper便士", "分"]);
});

// ---------------------------------------------------------------- runs

test("run: batches, pacing, and every word done once", async () => {
  const job = newJob(Object.keys(WORDS));
  const client = fakeClient([]);
  const clock = fastClock();
  const s = await runJob({ job, client, batchSize: 4, rpm: 4, ...clock });
  assert.equal(s.requests, 2);
  assert.deepEqual(client.calls.map((c) => c.words.length), [4, 2]);
  assert.deepEqual(done(job), Object.keys(WORDS).sort());
  assert.ok(clock.sleeps.every((ms) => ms === 15000)); // 4 per minute
  const req = client.calls[0].req;
  assert.equal(req.responseFormat, "json_object");
  assert.ok(req.maxTokens <= 1024);
});

test("run: a partial batch failure retries only the failed word, alone", async () => {
  const job = newJob(["apple", "river", "happy"]);
  const client = fakeClient([(w) => ({ content: answer(w, { river: { word: "lake" } }), finishReason: "stop", model: "corvus" })]);
  await runJob({ job, client, batchSize: 3, ...fastClock() });
  assert.deepEqual(client.calls.map((c) => c.words), [["apple", "river", "happy"], ["river"]]);
  assert.deepEqual(done(job), ["apple", "happy", "river"]);
});

test("run: truncation and invalid JSON fall back to single words", async () => {
  const job = newJob(["apple", "river"]);
  const client = fakeClient([
    (w) => ({ content: answer(w).slice(0, 50), finishReason: "length", model: "corvus" }),
    new CorvusError(502, "ai_invalid_response", "bad"),
  ]);
  await runJob({ job, client, batchSize: 2, ...fastClock() });
  assert.deepEqual(client.calls.map((c) => c.words), [["apple", "river"], ["apple"], ["river"], ["apple"]]);
  assert.deepEqual(done(job), ["apple", "river"]);
});

test("run: Corvus busy waits without spending an attempt", async () => {
  const job = newJob(["apple"]);
  const client = fakeClient([new CorvusError(429, "ai_busy", "busy", 30)]);
  const clock = fastClock();
  await runJob({ job, client, batchSize: 1, maxAttempts: 1, ...clock });
  assert.ok(clock.sleeps.includes(30000));
  assert.deepEqual(done(job), ["apple"]); // still had its one attempt
});

test("run: repeated unavailability pauses; the next run resumes without repeats", async () => {
  const words = ["apple", "river", "happy", "quickly"];
  const job = newJob(words);
  const down = () => new CorvusError(503, "ai_unavailable", "down");
  const first = fakeClient(["ok", down(), down(), down()]);
  const s1 = await runJob({ job, client: first, batchSize: 2, maxAttempts: 5, ...fastClock() });
  assert.match(s1.stopped, /unavailable/);
  assert.deepEqual(done(job), ["apple", "river"]);

  const second = fakeClient([]);
  const s2 = await runJob({ job, client: second, batchSize: 2, maxAttempts: 5, ...fastClock() });
  assert.equal(s2.stopped, "");
  assert.deepEqual(second.calls.map((c) => c.words), [["happy"]  , ["quickly"]]);
  assert.deepEqual(done(job), words.sort());
  const accepted = job.events().filter((e) => e.type === "item" && e.status === "candidate").map((e) => e.word);
  assert.equal(accepted.length, new Set(accepted).size); // no word produced twice
});

test("run: interrupted and resumed gives the same result as one run", async () => {
  const words = Object.keys(WORDS);
  const job = newJob(words);
  let n = 0;
  const s1 = await runJob({ job, client: fakeClient([]), batchSize: 2, shouldStop: () => n++ >= 1, ...fastClock() });
  assert.equal(s1.stopped, "interrupted");
  assert.equal(done(job).length, 2);
  await runJob({ job, client: fakeClient([]), batchSize: 2, ...fastClock() });
  assert.deepEqual(done(job), words.sort());
  assert.equal(job.events().filter((e) => e.type === "request").length, 3);
});

test("run: a crash mid-write and a stale lock are recovered", async () => {
  const job = newJob(["apple", "river"]);
  fs.writeFileSync(job.logPath, JSON.stringify({ type: "request", id: "x", words: ["apple"] }) + "\n" + '{"type":"item","word":"app');
  fs.writeFileSync(job.lockPath, "999999"); // pid of a process that no longer exists
  assert.equal(job.state(3).get("apple").attempts, 1); // the cut line is ignored
  await runJob({ job, client: fakeClient([]), batchSize: 2, ...fastClock() });
  assert.deepEqual(done(job), ["apple", "river"]);
  assert.equal(fs.existsSync(job.lockPath), false);
});

test("run: a second run of the same job is refused while one is active", async () => {
  const job = newJob(["apple"]);
  fs.writeFileSync(job.lockPath, String(process.pid));
  await assert.rejects(runJob({ job, client: fakeClient([]), ...fastClock() }), /already running/);
  fs.rmSync(job.lockPath);
});

test("run: attempts are capped and auth problems stop at once", async () => {
  const job = newJob(["apple"]);
  const bad = (w) => ({ content: answer(w, { apple: { word: "pear" } }), finishReason: "stop", model: "corvus" });
  await runJob({ job, client: fakeClient([bad, bad, bad, bad]), batchSize: 1, maxAttempts: 3, ...fastClock() });
  assert.equal(job.state(3).get("apple").status, "failed");

  const job2 = newJob(["river"]);
  const s = await runJob({ job: job2, client: fakeClient([new CorvusError(503, "ai_auth_failed", "no")]), ...fastClock() });
  assert.equal(s.stopped, "ai_auth_failed");
  assert.equal(job2.state(3).get("river").attempts, 0);
});

test("a job keeps its plan: same name with a different plan is refused", () => {
  const dir = path.join(tmp(), "job");
  Job.create(dir, planOf(["apple"]));
  Job.create(dir, planOf(["apple"])); // same plan: fine (resume)
  assert.throws(() => Job.create(dir, planOf(["river"])), /different plan/);
});

// ---------------------------------------------------------------- review

test("review and accept: decisions, edits, corrections and stale meanings", async () => {
  const job = newJob(["apple", "river", "happy", "window"]);
  await runJob({ job, client: fakeClient([(w) => ({ content: answer(w, { happy: { meaning_ok: false } }), finishReason: "stop", model: "corvus-qwen" })]), batchSize: 4, ...fastClock() });
  const file = path.join(job.dir, "review.tsv");
  assert.equal(exportReview(job, 3, file), 4);
  const rows = parseReview(file);
  assert.equal(rows.find((r) => r.word === "happy").status, "needs_review");

  const set = (word, decision, extra = {}) => Object.assign(rows.find((r) => r.word === word), { decision, ...extra });
  set("apple", "accept");
  set("river", "edit", { translation_fix: "去年夏天我们在这条河里游泳。" });
  set("happy", "reject");
  set("window", "edit", { sentence_fix: "window" }); // a bad edit is refused
  const cols = Object.keys(rows[0]);
  fs.writeFileSync(file, [cols.join("\t"), ...rows.map((r) => cols.map((c) => r[c]).join("\t"))].join("\n"));

  const store = path.join(tmp(), "ai_examples.json");
  const dict = Object.entries(WORDS).map(([word, w]) => ({ word, meaning: w.meaning }));
  const out = applyReview(job, 3, file, "reviewer-a", { storeFile: store, dictionary: dict });
  assert.deepEqual([out.accepted, out.edited, out.rejected], [1, 1, 1]);
  assert.match(out.errors.join(), /window: .*length/);
  const saved = readStore(store);
  assert.deepEqual(saved.map((e) => e.word), ["apple", "river"]);
  assert.equal(saved[1].translation, "去年夏天我们在这条河里游泳。");
  assert.equal(saved[1].edited, true);
  assert.equal(saved[0].model, "corvus-qwen");
  assert.equal(saved[0].reviewer, "reviewer-a");

  // a correction needs --replace
  const again = applyReview(job, 3, file, "reviewer-b", { storeFile: store, dictionary: dict });
  assert.match(again.errors.join(), /already accepted/);
  const fixed = applyReview(job, 3, file, "reviewer-b", { storeFile: store, dictionary: dict, replace: true });
  assert.equal(fixed.accepted + fixed.edited, 2);
  assert.equal(readStore(store)[0].reviewer, "reviewer-b");

  // the dictionary meaning changed since generation: refuse
  const changed = dict.map((e) => (e.word === "apple" ? { ...e, meaning: "n. 苹果树" } : e));
  const stale = applyReview(job, 3, file, "reviewer-c", { storeFile: store, dictionary: changed, replace: true });
  assert.match(stale.errors.join(), /apple: the dictionary meaning changed/);
});

test("evaluation jobs can never be accepted", async () => {
  const { main } = require("../aiExamples/cli");
  const name = `test-guard-${process.pid}`;
  const dir = path.join(__dirname, "..", ".ai-work", "jobs", name);
  Job.create(dir, { ...planOf(["apple"]), set: "eval-diagnostic", purpose: "evaluation" });
  try {
    await assert.rejects(main(["accept", "--job", name, "--reviewer", "x"]), /evaluation job/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("checks: short sentences and function words are flagged; natural synonyms are not", () => {
  const { meaningVisible } = require("../aiExamples/validate");
  assert.equal(meaningVisible("我的老师非常幽默。", ["富幽默感", "滑稽"]), true); // shares 幽默
  assert.equal(meaningVisible("今天的天气非常适合野餐。", ["奇妙", "稀奇"]), false);
  const items = [
    { word: "nod", meaning: "vi. 点头", level: "中考" },
    { word: "whom", meaning: "pron. 谁", level: "中考" },
  ];
  const content = JSON.stringify({ items: [
    { id: 1, word: "nod", sentence: "He nodded to say yes.", translation: "他点头表示同意。", meaning_ok: true },
    { id: 2, word: "whom", sentence: "The man whom I met yesterday is very nice.", translation: "我昨天遇到的那个人很好。", meaning_ok: true },
  ] });
  const r = validateResponse(content, items);
  assert.deepEqual(r.results.map((x) => x.status), ["needs_review", "needs_review"]);
  assert.match(r.results[0].flags.join(), /short sentence/);
  assert.match(r.results[1].flags.join(), /function word/);
});
