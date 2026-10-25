#!/usr/bin/env node
// AI example generation, offline and reviewed. Inside server/:
//
//   node aiExamples/cli.js plan   --job pilot-zk [--set zk-missing | --words a,b,c | --eval]
//   node aiExamples/cli.js run    --job pilot-zk --batch 4 [--max-requests 10] --confirm-real-calls
//   node aiExamples/cli.js status --job pilot-zk
//   node aiExamples/cli.js review --job pilot-zk            (writes review.tsv in the job folder)
//   node aiExamples/cli.js accept --job pilot-zk --reviewer NAME [--review file] [--replace]
//
// Jobs live in server/.ai-work/jobs/<job>/ (not committed). Accepted
// examples go to server/ai_examples.json (committed). The app reads that
// file; flashcards never wait for AI.
const fs = require("fs");
const path = require("path");
const { Job } = require("./job");
const { selectWords, planItem } = require("./plan");
const { runJob } = require("./runner");
const { exportReview, applyReview, readStore } = require("./store");
const { corvusClientFromEnv } = require("../corvusClient");
const { PROMPT_VERSION } = require("./prompt");

const SERVER = path.join(__dirname, "..");
const JOBS = path.join(SERVER, ".ai-work", "jobs");
const EVAL_FILE = path.join(__dirname, "eval_set.json");

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) out[key] = true;
      else out[key] = argv[++i];
    } else out._.push(argv[i]);
  }
  return out;
}

const loadDictionary = () => JSON.parse(fs.readFileSync(path.join(SERVER, "dictionary.json"), "utf-8"));
const jobDir = (name) => {
  if (!name || !/^[a-z0-9][a-z0-9_-]*$/i.test(name)) throw new Error("--job NAME is required (letters, digits, - and _)");
  return path.join(JOBS, name);
};

async function main(argv) {
  const a = args(argv);
  const cmd = a._[0];
  const maxAttempts = Number(a["max-attempts"] || 3);

  if (cmd === "plan") {
    const dictionary = loadDictionary();
    const accepted = readStore().map((e) => e.word);
    const words = a.eval
      ? JSON.parse(fs.readFileSync(EVAL_FILE, "utf-8")).items.map((x) => x.word)
      : a.words
        ? String(a.words).split(",")
        : null;
    const { eligible, held } = selectWords(dictionary, accepted, { set: a.set || "zk-missing", words });
    const job = Job.create(jobDir(a.job), {
      createdAt: new Date().toISOString(),
      promptVersion: PROMPT_VERSION,
      set: a.eval ? "eval" : words ? "words" : a.set || "zk-missing",
      items: eligible.map(planItem),
      held,
    });
    console.log(`job ${a.job}: ${job.plan.items.length} words to generate, ${held.length} held back`);
    for (const h of held) console.log(`  held: ${h.word} (${h.reason})`);
    return;
  }

  const job = new Job(jobDir(a.job));

  if (cmd === "status") {
    const st = job.state(maxAttempts);
    const count = {};
    for (const s of st.values()) {
      const k = s.status === "done" ? s.result.status : s.status;
      count[k] = (count[k] || 0) + 1;
    }
    const requests = job.events().filter((e) => e.type === "request").length;
    console.log(JSON.stringify({ words: st.size, requests, ...count }, null, 1));
    return;
  }

  if (cmd === "run") {
    if (!a["confirm-real-calls"]) {
      throw new Error("run sends requests to Corvus API v1; add --confirm-real-calls to do so");
    }
    const client = corvusClientFromEnv();
    if (!client.isConfigured()) throw new Error("Corvus is not configured (CORVUS_API_BASE_URL, CORVUS_API_KEY_FILE)");
    const existing = new Set(loadDictionary().map((e) => e.example).filter(Boolean));
    let stop = false;
    process.on("SIGINT", () => {
      stop = true;
      console.log("stopping after the current request ...");
    });
    const summary = await runJob({
      job,
      client,
      batchSize: Number(a.batch || 4),
      maxAttempts,
      rpm: Math.min(6, Number(a.rpm || process.env.CORVUS_MAX_PER_MINUTE || 4)),
      maxRequests: a["max-requests"] ? Number(a["max-requests"]) : Infinity,
      existing,
      shouldStop: () => stop,
      log: (l) => console.log(l),
    });
    console.log(JSON.stringify(summary, null, 1));
    return;
  }

  if (cmd === "review") {
    const file = path.join(job.dir, "review.tsv");
    const n = exportReview(job, maxAttempts, file);
    console.log(`wrote ${n} rows to ${file}; fill in the decision column (accept | edit | reject)`);
    return;
  }

  if (cmd === "accept") {
    const file = a.review || path.join(job.dir, "review.tsv");
    const out = applyReview(job, maxAttempts, file, a.reviewer, { replace: Boolean(a.replace), dictionary: loadDictionary() });
    job.lock();
    try {
      job.append({ type: "review", reviewer: a.reviewer, file: path.basename(file), ...out });
    } finally {
      job.unlock();
    }
    console.log(JSON.stringify(out, null, 1));
    return;
  }

  throw new Error("usage: cli.js plan|run|status|review|accept --job NAME (see the top of this file)");
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { main };
