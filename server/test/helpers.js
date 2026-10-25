// Offline test helpers: a temporary FoxWords data dir and a local mock of
// Corvus API v1. Nothing here talks to the real Corvus service.

const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const crypto = require("crypto");

function makeKey() {
  return crypto.randomBytes(32).toString("base64url"); // 43 chars, like token_urlsafe(32)
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "foxwords-test-"));
}

// handler(reqInfo) -> { status, body, headers, delayMs }
async function startMockCorvus(handler) {
  const mock = { calls: [], handler };
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", async () => {
      const info = {
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: raw ? JSON.parse(raw) : null,
      };
      mock.calls.push(info);
      const out = (await mock.handler(info)) || {};
      if (out.delayMs) await new Promise((r) => setTimeout(r, out.delayMs));
      res.writeHead(out.status || 200, { "Content-Type": "application/json", ...(out.headers || {}) });
      res.end(JSON.stringify(out.body ?? {}));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  mock.url = `http://127.0.0.1:${server.address().port}/v1`;
  mock.close = () => new Promise((r) => server.close(r));
  return mock;
}

function completion(content, finishReason = "stop") {
  return {
    status: 200,
    body: {
      id: "chatcmpl-test",
      object: "chat.completion",
      created: 1,
      model: "corvus",
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: finishReason }],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    },
  };
}

// Sets env for a FoxWords backend that points at the mock, then loads it.
async function startFoxWords(mockUrl) {
  const dir = tempDir();
  const key = makeKey();
  const keyFile = path.join(dir, "corvus_api_key");
  fs.writeFileSync(keyFile, key + "\n", { mode: 0o600 });

  process.env.DB_FILE = path.join(dir, "foxwords.db");
  process.env.SETTINGS_FILE = path.join(dir, "settings.json");
  process.env.CORVUS_API_BASE_URL = mockUrl;
  process.env.CORVUS_API_KEY_FILE = keyFile;
  process.env.CORVUS_MAX_PER_MINUTE = "6";
  process.env.CORVUS_TIMEOUT_MS = "5000";

  // Capture all console output so tests can check the key is never logged.
  const logs = [];
  for (const level of ["log", "warn", "error"]) {
    console[level] = (...args) => logs.push(args.map(String).join(" "));
  }

  const app = require("../index");
  const db = require("../db");
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  async function call(method, url, body) {
    const res = await fetch(base + url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => null);
    return { status: res.status, data, headers: res.headers };
  }

  return {
    db,
    key,
    logs,
    call,
    close: () => new Promise((r) => server.close(r)),
  };
}

module.exports = { makeKey, tempDir, startMockCorvus, completion, startFoxWords };
