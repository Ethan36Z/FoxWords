// Shared client for Corvus API v1 (OpenAI-style, text-only, non-streaming).
// Every FoxWords AI feature goes through one instance of this client, so the
// limits below apply to all features together:
// - only one request to Corvus at a time (Corvus itself has a single slot);
// - a local per-minute budget, below the Corvus global limit;
// - after a Corvus 429, wait out its Retry-After before calling again;
// - never retry automatically (Corvus has no duplicate protection).
// The API key is read from a file on every call (so rotation needs no
// restart) and is never logged or returned.

const fs = require("fs");

const KEY_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;
const MAX_TOKENS_LIMIT = 1024;

class CorvusError extends Error {
  // status: HTTP status FoxWords should return to its own client.
  constructor(status, code, message, retryAfter) {
    super(message);
    this.name = "CorvusError";
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

function normalizeBaseUrl(raw) {
  const value = String(raw || "").trim().replace(/\/+$/, "");
  if (!value) return "";
  let url;
  try {
    url = new URL(value);
  } catch {
    return "";
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  // The key must never travel over plain HTTP except to a local test server.
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) return "";
  if (url.search || url.hash || url.username || url.password) return "";
  return value;
}

function readKey(keyFile) {
  if (!keyFile) return "";
  try {
    const key = fs.readFileSync(keyFile, "utf-8").trim();
    return KEY_PATTERN.test(key) ? key : "";
  } catch {
    return "";
  }
}

function parseRetryAfter(header, fallback) {
  const n = Number(header);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.ceil(n), 300) : fallback;
}

function createCorvusClient(options = {}) {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const keyFile = options.keyFile || "";
  const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 100000);
  const maxPerMinute = Math.min(6, Math.max(1, Number(options.maxPerMinute) || 4));
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const now = options.now || Date.now;
  const log = options.log || ((line) => console.warn(line));

  let busy = false;
  let cooldownUntil = 0;
  const recent = []; // timestamps (ms) of attempts in the last minute

  function isConfigured() {
    return Boolean(baseUrl && readKey(keyFile));
  }

  function checkCapacity() {
    const t = now();
    while (recent.length && t - recent[0] >= 60000) recent.shift();
    if (busy) {
      throw new CorvusError(429, "ai_busy", "Corvus 正在处理另一个请求，请稍后再试。", 10);
    }
    if (t < cooldownUntil) {
      const wait = Math.ceil((cooldownUntil - t) / 1000);
      throw new CorvusError(429, "ai_busy", `Corvus 正忙，请 ${wait} 秒后再试。`, wait);
    }
    if (recent.length >= maxPerMinute) {
      const wait = Math.max(1, Math.ceil((recent[0] + 60000 - t) / 1000));
      throw new CorvusError(429, "ai_rate_limited", `AI 请求过于频繁，请 ${wait} 秒后再试。`, wait);
    }
  }

  // messages: [{ role, content }] following the Corvus v1 rules (optional
  // leading system messages, then alternating user/assistant ending with user).
  async function chat({ messages, maxTokens = 512, temperature, responseFormat, feature = "ai" }) {
    const key = readKey(keyFile);
    if (!baseUrl || !key) {
      throw new CorvusError(503, "ai_not_configured", "AI 功能未配置。");
    }
    checkCapacity();

    const body = {
      model: "corvus",
      messages,
      stream: false,
      max_tokens: Math.min(MAX_TOKENS_LIMIT, Math.max(1, Math.floor(maxTokens))),
    };
    if (typeof temperature === "number") body.temperature = temperature;
    if (responseFormat) body.response_format = { type: responseFormat };

    busy = true;
    recent.push(now());
    const started = now();
    let status = 0;
    try {
      let res;
      try {
        res = await fetchImpl(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(body),
          redirect: "error",
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        const timedOut = err && (err.name === "TimeoutError" || err.name === "AbortError");
        status = timedOut ? "timeout" : "network";
        throw new CorvusError(
          503,
          timedOut ? "ai_timeout" : "ai_unavailable",
          timedOut ? "Corvus 响应超时，请稍后再试。" : "Corvus 暂时不可用。"
        );
      }

      status = res.status;
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        const upstreamCode = typeof data?.error?.code === "string" ? data.error.code : "";
        if (res.status === 429) {
          const wait = parseRetryAfter(res.headers.get("retry-after"), 10);
          cooldownUntil = Math.max(cooldownUntil, now() + wait * 1000);
          throw new CorvusError(429, "ai_busy", `Corvus 正忙，请 ${wait} 秒后再试。`, wait);
        }
        if (res.status === 401 || res.status === 403) {
          throw new CorvusError(503, "ai_auth_failed", "AI 功能暂时不可用。");
        }
        if (res.status === 400 && upstreamCode === "context_length_exceeded") {
          throw new CorvusError(502, "ai_input_too_long", "AI 请求内容过长。");
        }
        if (res.status === 502 && upstreamCode === "invalid_json_output") {
          throw new CorvusError(502, "ai_invalid_response", "Corvus 返回了无效的结果。");
        }
        if ([400, 404, 413, 415].includes(res.status)) {
          throw new CorvusError(502, "ai_request_rejected", "AI 请求被拒绝。");
        }
        throw new CorvusError(503, "ai_unavailable", "Corvus 暂时不可用。");
      }

      const choice = data?.choices?.[0];
      const content = choice?.message?.content;
      if (typeof content !== "string") {
        throw new CorvusError(502, "ai_invalid_response", "Corvus 返回了无效的结果。");
      }
      return {
        content,
        finishReason: choice.finish_reason || "",
        model: typeof data.model === "string" ? data.model : "corvus",
        usage: data.usage || null,
      };
    } finally {
      busy = false;
      // Status and timing only: never headers, bodies or the key.
      log(`[corvus] feature=${feature} status=${status} ms=${now() - started}`);
    }
  }

  return { chat, isConfigured };
}

function corvusClientFromEnv(env = process.env) {
  return createCorvusClient({
    baseUrl: env.CORVUS_API_BASE_URL,
    keyFile: env.CORVUS_API_KEY_FILE,
    timeoutMs: env.CORVUS_TIMEOUT_MS,
    maxPerMinute: env.CORVUS_MAX_PER_MINUTE,
  });
}

module.exports = { CorvusError, createCorvusClient, corvusClientFromEnv, normalizeBaseUrl };
