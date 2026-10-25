// Runs a job against Corvus API v1 through the shared FoxWords client.
//
// - Words never tried go in batches of `batchSize`; retries go one at a time,
//   so one bad word cannot fail its neighbours twice.
// - Pace: at most `rpm` requests per minute (Corvus allows 6 in total).
// - 429: wait for Retry-After; no attempt is counted (nothing was generated).
// - Unavailable/timeout: counted (the outcome is unknown); three in a row
//   pause the run. Auth/config problems stop it at once.
// - The client never retries, so no request is sent twice by accident.
const { CorvusError } = require("../corvusClient");
const { buildMessages, maxTokensFor, MAX_BATCH, PROMPT_VERSION } = require("./prompt");
const { validateResponse } = require("./validate");

const STOP_NOW = new Set(["ai_not_configured", "ai_auth_failed"]);
const WAIT = new Set(["ai_busy", "ai_rate_limited"]);
const UNAVAILABLE = new Set(["ai_unavailable", "ai_timeout"]);

async function runJob({
  job,
  client,
  batchSize = 4,
  maxAttempts = 3,
  rpm = 4,
  maxRequests = Infinity,
  existing = new Set(),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = Date.now,
  shouldStop = () => false,
  log = () => {},
}) {
  if (batchSize < 1 || batchSize > MAX_BATCH) throw new Error(`batch size must be 1-${MAX_BATCH}`);
  job.lock();
  const summary = { requests: 0, stopped: "", items: {} };
  let lastRequest = 0;
  let unavailableInARow = 0;
  try {
    job.append({ type: "run", planHash: job.planHash, batchSize, maxAttempts, rpm, promptVersion: PROMPT_VERSION });
    const byWord = new Map(job.plan.items.map((it) => [it.word, it]));

    while (summary.requests < maxRequests) {
      if (shouldStop()) {
        summary.stopped = "interrupted";
        break;
      }
      const st = job.state(maxAttempts);
      const pending = [...st.entries()].filter(([, s]) => s.status === "pending");
      if (!pending.length) break;
      const fresh = pending.filter(([, s]) => s.attempts === 0).map(([w]) => w);
      // retries: fewest attempts first, so one stubborn word cannot hold up the rest
      const retry = pending.filter(([, s]) => s.attempts > 0).sort((a, b) => a[1].attempts - b[1].attempts);
      const words = fresh.length ? fresh.slice(0, batchSize) : [retry[0][0]];
      const items = words.map((w) => byWord.get(w));

      const wait = lastRequest + 60000 / rpm - now();
      if (wait > 0) await sleep(wait);
      lastRequest = now();
      const id = `r${Date.now().toString(36)}-${summary.requests}`;
      job.append({ type: "request", id, words, batchSize: words.length });
      summary.requests += 1;

      let result;
      try {
        result = await client.chat({
          feature: "ai-example",
          messages: buildMessages(items),
          maxTokens: maxTokensFor(items.length),
          temperature: 0.4,
          responseFormat: "json_object",
        });
      } catch (err) {
        if (!(err instanceof CorvusError)) throw err;
        job.append({ type: "response", request: id, ok: false, code: err.code, status: err.status });
        log(`request ${id} failed: ${err.code}`);
        if (STOP_NOW.has(err.code)) {
          summary.stopped = err.code;
          break;
        }
        if (WAIT.has(err.code)) {
          await sleep((err.retryAfter || 10) * 1000);
          continue;
        }
        if (UNAVAILABLE.has(err.code)) {
          unavailableInARow += 1;
          if (unavailableInARow >= 3) {
            summary.stopped = "Corvus unavailable (3 in a row); run again later to resume";
            break;
          }
          continue;
        }
        // invalid JSON, truncation, rejected request: the words are retried alone
        for (const w of words) job.append({ type: "item", request: id, word: w, status: "invalid", errors: [err.code] });
        continue;
      }
      unavailableInARow = 0;
      const checked = validateResponse(result.content, items, { existing, finishReason: result.finishReason });
      job.append({
        type: "response",
        request: id,
        ok: true,
        model: result.model,
        finishReason: result.finishReason,
        usage: result.usage,
        batchError: checked.batchError,
      });
      for (const r of checked.results) {
        job.append({ type: "item", request: id, model: result.model, promptVersion: PROMPT_VERSION, ...r });
        summary.items[r.status] = (summary.items[r.status] || 0) + 1;
      }
      log(`request ${id}: ${checked.results.map((r) => `${r.word}=${r.status}`).join(" ")}`);
    }
    if (!summary.stopped && summary.requests >= maxRequests) summary.stopped = "request limit reached";
    job.append({ type: "stop", reason: summary.stopped || "finished", requests: summary.requests });
  } finally {
    job.unlock();
  }
  return summary;
}

module.exports = { runJob };
