// M1: /api/story through a local mock of Corvus API v1.

const test = require("node:test");
const assert = require("node:assert/strict");

const { startMockCorvus, completion, startFoxWords } = require("./helpers");

let mock;
let fw;

test.before(async () => {
  mock = await startMockCorvus(() => completion("Once upon a time... *apple*\n\n中文：一个故事。"));
  fw = await startFoxWords(mock.url);
});

test.after(async () => {
  await fw.close();
  await mock.close();
});

test("empty notebook: 400 and Corvus is not called", async () => {
  const r = await fw.call("POST", "/api/story", {});
  assert.equal(r.status, 400);
  assert.equal(mock.calls.length, 0);
});

test("story uses the latest notebook words and keeps the response shape", async () => {
  await fw.call("POST", "/api/notebook", { word: "apple", definition: "a fruit", translation: "苹果" });
  await fw.call("POST", "/api/notebook", { word: "river", definition: "a stream of water", translation: "河" });

  const r = await fw.call("POST", "/api/story", { words: ["ignored"] });
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.data), ["story"]);
  assert.match(r.data.story, /Once upon a time/);

  assert.equal(mock.calls.length, 1);
  const call = mock.calls[0];
  assert.equal(call.url, "/v1/chat/completions");
  assert.equal(call.headers.authorization, "Bearer " + fw.key);
  assert.equal(call.body.model, "corvus");
  assert.equal(call.body.stream, false);
  assert.equal(call.body.max_tokens, 512);
  assert.equal(call.body.messages.length, 1);
  assert.equal(call.body.messages[0].role, "user");
  assert.match(call.body.messages[0].content, /1\. river - a stream of water/);
  assert.match(call.body.messages[0].content, /2\. apple - a fruit/);
  assert.doesNotMatch(call.body.messages[0].content, /ignored/);
});

test("Corvus unavailable: 503 with a message, one call only, rest of the app works", async () => {
  const before = mock.calls.length;
  mock.handler = () => ({ status: 503, body: { error: { code: "model_unavailable" } } });

  const r = await fw.call("POST", "/api/story", {});
  assert.equal(r.status, 503);
  assert.equal(typeof r.data.error, "string");
  assert.equal(r.data.code, "ai_unavailable");
  assert.equal(mock.calls.length, before + 1);

  assert.equal((await fw.call("GET", "/api/notebook")).status, 200);
  assert.equal((await fw.call("GET", "/api/health")).status, 200);
});

test("Corvus 429 is passed on with Retry-After", async () => {
  mock.handler = () => ({
    status: 429,
    headers: { "Retry-After": "12" },
    body: { error: { code: "rate_limit_exceeded" } },
  });
  const r = await fw.call("POST", "/api/story", {});
  assert.equal(r.status, 429);
  assert.equal(r.headers.get("retry-after"), "12");
});

test("the API key never appears in responses or logs", () => {
  assert.ok(fw.logs.length > 0);
  assert.ok(!fw.logs.join("\n").includes(fw.key));
});
