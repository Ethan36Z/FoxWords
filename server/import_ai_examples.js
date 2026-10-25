// Load ai_examples.json (reviewed AI examples) into the ai_examples table.
// The backend runs this at startup whenever the file changed; the table is
// replaced as a whole, so the file is the only source of truth.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const db = require("./db");

const AI_EXAMPLES_FILE = path.join(__dirname, "ai_examples.json");

function importAiExamples(file = AI_EXAMPLES_FILE) {
  const raw = fs.existsSync(file) ? fs.readFileSync(file) : Buffer.from("[]");
  const list = JSON.parse(raw.toString("utf-8"));
  if (!Array.isArray(list)) throw new Error("ai_examples.json is not an array");
  const insert = db.prepare(`
    INSERT INTO ai_examples (word, sentence, translation, meaning, source, model, promptVersion, reviewer, reviewedAt, edited)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  db.transaction(() => {
    db.exec("DELETE FROM ai_examples");
    for (const e of list) {
      if (!e.word || !e.sentence || !e.translation || !e.meaning || !e.reviewer) continue; // unreviewed: never served
      insert.run(e.word, e.sentence, e.translation, e.meaning, e.source || "corvus", e.model || "", e.promptVersion || "",
        e.reviewer, e.reviewedAt || "", e.edited ? 1 : 0);
    }
    const version = crypto.createHash("sha1").update(raw).digest("hex");
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('ai_examples_version', ?)").run(version);
  })();
  return db.prepare("SELECT COUNT(*) AS c FROM ai_examples").get().c;
}

function importAiExamplesIfChanged(file = AI_EXAMPLES_FILE) {
  const raw = fs.existsSync(file) ? fs.readFileSync(file) : Buffer.from("[]");
  const version = crypto.createHash("sha1").update(raw).digest("hex");
  const row = db.prepare("SELECT value FROM meta WHERE key = 'ai_examples_version'").get();
  if (row && row.value === version) return null;
  return importAiExamples(file);
}

module.exports = { importAiExamples, importAiExamplesIfChanged, AI_EXAMPLES_FILE };

if (require.main === module) {
  console.log("AI examples loaded:", importAiExamples());
}
