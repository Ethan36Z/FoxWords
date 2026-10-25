const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const { createCorvusClient, normalizeBaseUrl } = require("../corvusClient");
const { makeKey, tempDir } = require("./helpers");

const BASE = "https://api-corvus.example.test/v1";

function setup({ maxPerMinute = 4, responses = [], timeoutMs } = {}) {
  const dir = tempDir();
  const key = makeKey();
  const keyFile = path.join(dir, "key");
  fs.writeFileSync(keyFile, key + "\n");

  let clock = 1_000_000;
  const calls = [];
  const logs = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const next = responses.shift();
    if (typeof next === "function") return next(init);
    return next;
  };
  const client = createCorvusClient({
    baseUrl: BASE,
    keyFile,
    maxPerMinute,
    timeoutMs,
    fetchImpl,
    now: () => clock,
    log: (l) => logs.push(l),
  });
  return {
    client,
    key,
    keyFile,
    calls,
    logs,
    advance: (ms) => (clock += ms),
  };
}

function ok(content = "hello", extra = {}) {
  return new Response(
    JSON.stringify({
      id: "x",
      model: "corvus",
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      ...extra,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

function errorResponse(status, code, headers = {}) {
  return new Response(
    JSON.stringify({ error: { message: "x", type: "x", param: null, code } }),
    { status, headers: { "Content-Type": "application/json", ...headers } }
  );
}

const MSG = [{ role: "user", content: "Say hello." }];

test("plain HTTP only to loopback addresses; everything else needs HTTPS", () => {
  const ok = ["http://127.0.0.1:18120/v1", "http://[::1]:18120/v1", "http://127.1:18120/v1", "https://api-corvus.foxluma.com/v1"];
  for (const u of ok) assert.ok(normalizeBaseUrl(u, {}), u);
  const bad = [
    "http://localhost:18120/v1", // name resolution is not trusted
    "http://127.0.0.1.evil.com/v1",
    "http://localhost.evil.com/v1",
    "http://127.0.0.1@evil.com/v1",
    "http://evil.com#@127.0.0.1/v1",
    "http://0.0.0.0:18120/v1",
    "http://10.0.0.5:18120/v1",
    "http://api-corvus.foxluma.com/v1",
    "ftp://127.0.0.1/v1",
    "https://user:pass@api-corvus.foxluma.com/v1",
  ];
  for (const u of bad) assert.equal(normalizeBaseUrl(u, {}), "", u);
  // a proxy could see the key: no plain HTTP then, HTTPS still fine
  assert.equal(normalizeBaseUrl("http://127.0.0.1:18120/v1", { NODE_USE_ENV_PROXY: "1" }), "");
  assert.ok(normalizeBaseUrl("https://api-corvus.foxluma.com/v1", { NODE_USE_ENV_PROXY: "1" }));
});

test("a redirect from the API is never followed", async () => {
  const http = require("http");
  const seen = [];
  const target = http.createServer((req, res) => { seen.push(req.headers.authorization); res.end("{}"); });
  await new Promise((r) => target.listen(0, "127.0.0.1", r));
  const api = http.createServer((req, res) => {
    res.writeHead(307, { Location: `http://127.0.0.1:${target.address().port}/steal` });
    res.end();
  });
  await new Promise((r) => api.listen(0, "127.0.0.1", r));
  const dir = tempDir();
  const keyFile = path.join(dir, "key");
  fs.writeFileSync(keyFile, makeKey());
  const client = createCorvusClient({ baseUrl: `http://127.0.0.1:${api.address().port}/v1`, keyFile, log: () => {} });
  await assert.rejects(client.chat({ messages: MSG }), { code: "ai_unavailable" });
  assert.equal(seen.length, 0);
  await new Promise((r) => api.close(r));
  await new Promise((r) => target.close(r));
});

test("base URL must be https, except loopback", () => {
  assert.equal(normalizeBaseUrl("https://api-corvus.foxluma.com/v1/"), "https://api-corvus.foxluma.com/v1");
  assert.equal(normalizeBaseUrl("http://api-corvus.foxluma.com/v1"), "");
  assert.equal(normalizeBaseUrl("http://127.0.0.1:9999/v1"), "http://127.0.0.1:9999/v1");
  assert.equal(normalizeBaseUrl("https://x.test/v1?key=abc"), "");
  assert.equal(normalizeBaseUrl(""), "");
});

test("not configured: fails with 503 and never calls Corvus", async () => {
  const calls = [];
  const client = createCorvusClient({ baseUrl: BASE, keyFile: "/nonexistent/key", fetchImpl: async () => calls.push(1) });
  assert.equal(client.isConfigured(), false);
  await assert.rejects(client.chat({ messages: MSG }), { status: 503, code: "ai_not_configured" });
  assert.equal(calls.length, 0);
});

test("sends the Corvus v1 request shape with the bearer key", async () => {
  const s = setup({ responses: [ok("  hi  ")] });
  const out = await s.client.chat({ messages: MSG, maxTokens: 160, temperature: 0.5, responseFormat: "json_object" });
  assert.equal(out.content, "  hi  ");
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].url, BASE + "/chat/completions");
  assert.equal(s.calls[0].init.headers.Authorization, "Bearer " + s.key);
  assert.equal(s.calls[0].init.redirect, "error");
  assert.deepEqual(s.calls[0].body, {
    model: "corvus",
    messages: MSG,
    stream: false,
    max_tokens: 160,
    temperature: 0.5,
    response_format: { type: "json_object" },
  });
});

test("max_tokens is clamped to the Corvus limit of 1024", async () => {
  const s = setup({ responses: [ok()] });
  await s.client.chat({ messages: MSG, maxTokens: 5000 });
  assert.equal(s.calls[0].body.max_tokens, 1024);
});

test("only one request in flight; the second is rejected locally", async () => {
  let release;
  const s = setup({ responses: [() => new Promise((r) => (release = () => r(ok())))] });
  const first = s.client.chat({ messages: MSG });
  await assert.rejects(s.client.chat({ messages: MSG }), { status: 429, code: "ai_busy" });
  release();
  await first;
  assert.equal(s.calls.length, 1);
});

test("local per-minute budget, reopened after 60 s", async () => {
  const s = setup({ maxPerMinute: 2, responses: [ok(), ok(), ok()] });
  await s.client.chat({ messages: MSG });
  await s.client.chat({ messages: MSG });
  await assert.rejects(s.client.chat({ messages: MSG }), (err) => {
    assert.equal(err.status, 429);
    assert.equal(err.code, "ai_rate_limited");
    assert.ok(err.retryAfter >= 1 && err.retryAfter <= 60);
    return true;
  });
  assert.equal(s.calls.length, 2);
  s.advance(60_000);
  await s.client.chat({ messages: MSG });
  assert.equal(s.calls.length, 3);
});

test("budget is capped at the Corvus global limit of 6 per minute", async () => {
  const s = setup({ maxPerMinute: 50, responses: Array.from({ length: 7 }, () => ok()) });
  for (let i = 0; i < 6; i++) await s.client.chat({ messages: MSG });
  await assert.rejects(s.client.chat({ messages: MSG }), { code: "ai_rate_limited" });
});

test("Corvus 429 sets a cooldown from Retry-After", async () => {
  const s = setup({ responses: [errorResponse(429, "rate_limit_exceeded", { "Retry-After": "30" }), ok()] });
  await assert.rejects(s.client.chat({ messages: MSG }), { status: 429, retryAfter: 30 });
  s.advance(10_000);
  await assert.rejects(s.client.chat({ messages: MSG }), { status: 429, code: "ai_busy" });
  assert.equal(s.calls.length, 1);
  s.advance(21_000);
  await s.client.chat({ messages: MSG });
  assert.equal(s.calls.length, 2);
});

test("error mapping, no retries", async () => {
  const cases = [
    [errorResponse(401, "invalid_api_key"), 503, "ai_auth_failed"],
    [errorResponse(503, "model_unavailable"), 503, "ai_unavailable"],
    [errorResponse(504, "request_timeout"), 503, "ai_unavailable"],
    [errorResponse(502, "upstream_error"), 503, "ai_unavailable"],
    [errorResponse(502, "invalid_json_output"), 502, "ai_invalid_response"],
    [errorResponse(400, "context_length_exceeded"), 502, "ai_input_too_long"],
    [errorResponse(400, "invalid_request"), 502, "ai_request_rejected"],
    [ok(null), 502, "ai_invalid_response"],
  ];
  for (const [response, status, code] of cases) {
    const s = setup({ responses: [response] });
    await assert.rejects(s.client.chat({ messages: MSG }), { status, code });
    assert.equal(s.calls.length, 1, code);
  }
});

test("network failure and timeout map to 503 without retry", async () => {
  const s1 = setup({ responses: [() => Promise.reject(new TypeError("fetch failed"))] });
  await assert.rejects(s1.client.chat({ messages: MSG }), { status: 503, code: "ai_unavailable" });
  assert.equal(s1.calls.length, 1);

  const s2 = setup({
    timeoutMs: 1000,
    responses: [
      (init) =>
        new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason))),
    ],
  });
  await assert.rejects(s2.client.chat({ messages: MSG }), { status: 503, code: "ai_timeout" });
  assert.equal(s2.calls.length, 1);
});

test("key is re-read on each call (rotation) and never logged", async () => {
  const s = setup({ responses: [ok(), errorResponse(401, "invalid_api_key")] });
  await s.client.chat({ messages: MSG });
  const newKey = makeKey();
  fs.writeFileSync(s.keyFile, newKey);
  await assert.rejects(s.client.chat({ messages: MSG }), { code: "ai_auth_failed" });
  assert.equal(s.calls[1].init.headers.Authorization, "Bearer " + newKey);
  const allLogs = s.logs.join("\n");
  assert.ok(!allLogs.includes(s.key) && !allLogs.includes(newKey));
  assert.match(s.logs[0], /^\[corvus\] feature=ai status=200 ms=\d+$/);
});

test("malformed key file counts as not configured", async () => {
  const s = setup({ responses: [ok()] });
  fs.writeFileSync(s.keyFile, "short");
  await assert.rejects(s.client.chat({ messages: MSG }), { code: "ai_not_configured" });
  assert.equal(s.calls.length, 0);
});
