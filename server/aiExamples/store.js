// Accepted AI examples live in server/ai_examples.json, committed with the
// code and separate from the rebuildable dictionary. Nothing gets in without
// a human decision recorded in a review file.
//
// Review file (TSV, one row per generated example):
//   word  meaning  status  flags  sentence  translation  decision  sentence_fix  translation_fix  note
// decision: accept | edit (use the *_fix columns) | reject | (empty = undecided)
const fs = require("fs");
const path = require("path");
const { checkSentence, checkTranslation } = require("./validate");

const STORE_FILE = path.join(__dirname, "..", "ai_examples.json");
const COLUMNS = ["word", "meaning", "status", "flags", "sentence", "translation", "decision", "sentence_fix", "translation_fix", "note"];

function readStore(file = STORE_FILE) {
  if (!fs.existsSync(file)) return [];
  const data = JSON.parse(fs.readFileSync(file, "utf-8"));
  if (!Array.isArray(data)) throw new Error(`${file} is not an array`);
  return data;
}

// Write to a temporary file, then rename: a crash never leaves half a file
function writeStore(entries, file = STORE_FILE) {
  const sorted = [...entries].sort((a, b) => a.word.toLowerCase().localeCompare(b.word.toLowerCase()) || a.word.localeCompare(b.word));
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(sorted, null, 1) + "\n");
  fs.renameSync(tmp, file);
}

const clean = (v) => String(v ?? "").replace(/[\t\r\n]+/g, " ").trim();

function exportReview(job, maxAttempts, file) {
  const st = job.state(maxAttempts);
  const rows = [COLUMNS.join("\t")];
  const byWord = new Map(job.plan.items.map((it) => [it.word, it]));
  for (const [word, s] of st) {
    if (s.status !== "done") continue;
    const r = s.result;
    rows.push(
      [word, byWord.get(word).meaning, r.status, (r.flags || []).join("; "), r.sentence, r.translation, "", "", "", ""]
        .map(clean)
        .join("\t")
    );
  }
  fs.writeFileSync(file, rows.join("\n") + "\n");
  return rows.length - 1;
}

function parseReview(file) {
  const [head, ...lines] = fs.readFileSync(file, "utf-8").split("\n").filter((l) => l.trim());
  const cols = head.split("\t");
  if (COLUMNS.some((c) => !cols.includes(c))) throw new Error(`review file must have columns: ${COLUMNS.join(", ")}`);
  return lines.map((l) => {
    const v = l.split("\t");
    return Object.fromEntries(cols.map((c, i) => [c, (v[i] || "").trim()]));
  });
}

// Applies human decisions. Returns { accepted, edited, rejected, skipped, errors }.
// An accepted example is checked again; an existing entry is only replaced
// with `replace` (corrections are explicit).
function applyReview(job, maxAttempts, reviewFile, reviewer, { replace = false, storeFile = STORE_FILE, dictionary = null } = {}) {
  if (!reviewer) throw new Error("a reviewer name is required");
  const st = job.state(maxAttempts);
  const byWord = new Map(job.plan.items.map((it) => [it.word, it]));
  const store = new Map(readStore(storeFile).map((e) => [e.word, e]));
  const dict = dictionary ? new Map(dictionary.map((e) => [e.word, e])) : null;
  const out = { accepted: 0, edited: 0, rejected: 0, skipped: 0, errors: [] };
  const reviewedAt = new Date().toISOString();

  for (const row of parseReview(reviewFile)) {
    const s = st.get(row.word);
    const decision = row.decision.toLowerCase();
    if (!decision) {
      out.skipped += 1;
      continue;
    }
    if (!s || s.status !== "done") {
      out.errors.push(`${row.word}: not a finished item of this job`);
      continue;
    }
    if (decision === "reject") {
      out.rejected += 1;
      continue;
    }
    if (decision !== "accept" && decision !== "edit") {
      out.errors.push(`${row.word}: unknown decision "${row.decision}"`);
      continue;
    }
    const sentence = decision === "edit" && row.sentence_fix ? row.sentence_fix : s.result.sentence;
    const translation = decision === "edit" && row.translation_fix ? row.translation_fix : s.result.translation;
    const problems = [...checkSentence(sentence, row.word).errors, ...checkTranslation(translation).errors];
    if (problems.length) {
      out.errors.push(`${row.word}: ${problems.join(", ")}`);
      continue;
    }
    const item = byWord.get(row.word);
    if (dict && dict.get(row.word)?.meaning !== item.meaning) {
      out.errors.push(`${row.word}: the dictionary meaning changed since generation; regenerate`);
      continue;
    }
    if (store.has(row.word) && !replace) {
      out.errors.push(`${row.word}: already accepted (use --replace to correct it)`);
      continue;
    }
    store.set(row.word, {
      word: row.word,
      sentence,
      translation,
      meaning: item.meaning,
      source: "corvus",
      model: s.result.model || "corvus",
      promptVersion: s.result.promptVersion,
      job: path.basename(job.dir),
      generatedAt: s.result.at,
      edited: decision === "edit",
      reviewer,
      reviewedAt,
      note: row.note || "",
    });
    if (decision === "edit") out.edited += 1;
    else out.accepted += 1;
  }
  writeStore([...store.values()], storeFile);
  return out;
}

module.exports = { STORE_FILE, readStore, writeStore, exportReview, parseReview, applyReview, COLUMNS };
