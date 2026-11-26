// Load server/lookup.json (build_lookup.py) into lookup_words and word_forms.
// The backend runs it at startup whenever the file has changed. These tables
// hold reference data only; no learner data is touched.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const db = require("./db");

const LOOKUP_FILE = path.join(__dirname, "lookup.json");

const fileVersion = (file) => crypto.createHash("sha1").update(fs.readFileSync(file)).digest("hex");

function importLookup(file = LOOKUP_FILE) {
  const data = JSON.parse(fs.readFileSync(file, "utf-8"));
  if (data.version !== 1 || !Array.isArray(data.words) || !Array.isArray(data.forms)) {
    throw new Error("lookup.json: unsupported format");
  }
  const word = db.prepare("INSERT OR REPLACE INTO lookup_words (word, phonetic, meaning, translation, definition) VALUES (?, ?, ?, ?, ?)");
  const form = db.prepare("INSERT OR REPLACE INTO word_forms (form, lemma, kinds, lemmaFirst) VALUES (?, ?, ?, ?)");
  db.transaction(() => {
    db.exec("DELETE FROM lookup_words; DELETE FROM word_forms;");
    for (const [w, phonetic, meaning, translation, definition] of data.words) {
      word.run(String(w), String(phonetic || ""), String(meaning || ""), String(translation || ""), String(definition || ""));
    }
    for (const [f, lemma, kinds, lemmaFirst] of data.forms) form.run(String(f), String(lemma), String(kinds), lemmaFirst ? 1 : 0);
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('lookup_version', ?)").run(fileVersion(file));
  })();
  return { words: data.words.length, forms: data.forms.length };
}

function importLookupIfChanged(file = LOOKUP_FILE) {
  if (!fs.existsSync(file)) return null;
  const row = db.prepare("SELECT value FROM meta WHERE key = 'lookup_version'").get();
  if (row && row.value === fileVersion(file)) return null;
  return importLookup(file);
}

module.exports = { importLookup, importLookupIfChanged, LOOKUP_FILE };
