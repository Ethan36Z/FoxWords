// A generation job: a frozen plan plus an append-only event log.
//
//   <dir>/plan.json   words and meanings asked for (never changed after creation)
//   <dir>/log.jsonl   one JSON event per line, fsync'ed after each write
//   <dir>/lock        present while a run is active (holds the pid)
//
// The state of every word is recomputed from the log, so a run can stop at
// any moment (crash, Ctrl+C, power loss) and the next run continues where it
// left off. A half-written last line is ignored.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const NO_GENERATION = new Set(["ai_busy", "ai_rate_limited", "ai_not_configured", "ai_auth_failed"]);

class Job {
  constructor(dir) {
    this.dir = dir;
    this.planPath = path.join(dir, "plan.json");
    this.logPath = path.join(dir, "log.jsonl");
    this.lockPath = path.join(dir, "lock");
    this.plan = JSON.parse(fs.readFileSync(this.planPath, "utf-8"));
    this.fd = null;
  }

  static create(dir, plan) {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "plan.json");
    const body = JSON.stringify(plan, null, 1) + "\n";
    try {
      fs.writeFileSync(file, body, { flag: "wx" });
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      if (fs.readFileSync(file, "utf-8") !== body) {
        throw new Error(`job ${dir} already exists with a different plan; use a new job name`);
      }
    }
    return new Job(dir);
  }

  get planHash() {
    return crypto.createHash("sha256").update(fs.readFileSync(this.planPath)).digest("hex").slice(0, 16);
  }

  // Only one run per job: a second process would duplicate requests.
  lock() {
    for (let i = 0; i < 2; i++) {
      try {
        const fd = fs.openSync(this.lockPath, "wx");
        fs.writeSync(fd, String(process.pid));
        fs.closeSync(fd);
        this.fd = fs.openSync(this.logPath, "a");
        return;
      } catch (err) {
        if (err.code !== "EEXIST") throw err;
        const pid = Number(fs.readFileSync(this.lockPath, "utf-8")) || 0;
        if (pid && isAlive(pid)) throw new Error(`job is already running (pid ${pid})`);
        fs.rmSync(this.lockPath, { force: true }); // stale lock from a crashed run
      }
    }
    throw new Error("could not lock the job");
  }

  unlock() {
    if (this.fd !== null) fs.closeSync(this.fd);
    this.fd = null;
    fs.rmSync(this.lockPath, { force: true });
  }

  append(event) {
    if (this.fd === null) throw new Error("job is not locked");
    const line = JSON.stringify({ at: new Date().toISOString(), ...event }) + "\n";
    fs.writeSync(this.fd, line);
    fs.fsyncSync(this.fd);
  }

  events() {
    if (!fs.existsSync(this.logPath)) return [];
    const out = [];
    for (const line of fs.readFileSync(this.logPath, "utf-8").split("\n")) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line));
      } catch {
        // a line cut off by a crash: the request it belonged to is retried
      }
    }
    return out;
  }

  // word -> { attempts, status: pending|done|failed, result }
  state(maxAttempts) {
    const st = new Map(this.plan.items.map((it) => [it.word, { attempts: 0, status: "pending", result: null }]));
    const events = this.events();
    const noGeneration = new Set(
      events.filter((e) => e.type === "response" && NO_GENERATION.has(e.code)).map((e) => e.request)
    );
    for (const e of events) {
      if (e.type === "request" && !noGeneration.has(e.id)) {
        for (const w of e.words) if (st.has(w)) st.get(w).attempts += 1;
      }
      if (e.type === "item" && st.has(e.word)) {
        const s = st.get(e.word);
        if (e.status === "candidate" || e.status === "needs_review") {
          s.status = "done";
          s.result = e;
        } else if (s.status !== "done") {
          s.result = e;
        }
      }
    }
    for (const s of st.values()) {
      if (s.status !== "done" && s.attempts >= maxAttempts) s.status = "failed";
    }
    return st;
  }
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

module.exports = { Job };
