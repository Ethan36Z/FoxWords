// Import server/dictionary.json into the SQLite dictionary table.
// Run by hand with `npm run import:dict`; the backend also runs it at startup
// whenever dictionary.json has changed since the last import.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const db = require("./db");

const DICTIONARY_FILE = path.join(__dirname, "dictionary.json");

// Older dictionary.json files store line breaks as a literal "\n"
const clean = (v) => String(v || "").replace(/\\n/g, "\n").trim();
// and used the Collins star rating (a bare number) as the "example"
const cleanExample = (v) => (/^\d+$/.test(clean(v)) ? "" : clean(v));

function fileVersion(file) {
  return crypto.createHash("sha1").update(fs.readFileSync(file)).digest("hex");
}

function importDictionary(file = DICTIONARY_FILE) {
  const arr = JSON.parse(fs.readFileSync(file, "utf-8"));
  if (!Array.isArray(arr)) throw new Error("dictionary.json is not an array");

  // Existing words keep their id; words no longer in the file are removed.
  const upsert = db.prepare(`
    INSERT INTO dictionary (word, phonetic, translation, definition, example, exampleZh, level, tags)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(word) DO UPDATE SET
      phonetic = excluded.phonetic,
      translation = excluded.translation,
      definition = excluded.definition,
      example = excluded.example,
      exampleZh = excluded.exampleZh,
      level = excluded.level,
      tags = excluded.tags
  `);

  db.exec("CREATE TEMP TABLE IF NOT EXISTS import_words (word TEXT PRIMARY KEY)");
  const keep = db.prepare("INSERT OR IGNORE INTO import_words (word) VALUES (?)");

  db.transaction((items) => {
    db.exec("DELETE FROM import_words");
    for (const it of items) {
      const word = clean(it.word);
      if (!word) continue;
      keep.run(word);
      upsert.run(
        word,
        clean(it.phonetic),
        clean(it.translation),
        clean(it.definition),
        cleanExample(it.example),
        clean(it.exampleZh),
        clean(it.level),
        clean(it.tags)
      );
    }

    db.exec("DELETE FROM dictionary WHERE word NOT IN (SELECT word FROM import_words)");
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('dictionary_version', ?)").run(
      fileVersion(file)
    );
  })(arr);

  return db.prepare("SELECT COUNT(*) AS c FROM dictionary").get().c;
}

// Import only if dictionary.json differs from what was last imported
function importDictionaryIfChanged(file = DICTIONARY_FILE) {
  if (!fs.existsSync(file)) return null;
  const row = db.prepare("SELECT value FROM meta WHERE key = 'dictionary_version'").get();
  if (row && row.value === fileVersion(file)) return null;
  return importDictionary(file);
}

module.exports = { importDictionary, importDictionaryIfChanged };

if (require.main === module) {
  const count = importDictionary();
  console.log("Import done. dictionary rows =", count);
}
