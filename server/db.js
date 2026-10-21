// server/db.js
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const dbFile = process.env.DB_FILE || path.join(__dirname, "foxwords.db");
const db = new Database(dbFile);
console.log("DB FILE =>", dbFile);

// Create tables (safe to run on every start)
db.exec(`
  CREATE TABLE IF NOT EXISTS notebook (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word TEXT NOT NULL UNIQUE,
    translation TEXT DEFAULT '',
    definition TEXT DEFAULT '',
    createdAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    exampleFirst INTEGER NOT NULL DEFAULT 1,
    dailyGoal INTEGER NOT NULL DEFAULT 20
  );

  INSERT OR IGNORE INTO settings (id, exampleFirst, dailyGoal)
  VALUES (1, 1, 20);

  CREATE TABLE IF NOT EXISTS dictionary (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word TEXT NOT NULL,
    translation TEXT DEFAULT '',
    definition TEXT DEFAULT '',
    example TEXT DEFAULT '',
    level TEXT DEFAULT '',
    tags TEXT DEFAULT '',
    UNIQUE(word)
  );

  CREATE INDEX IF NOT EXISTS idx_dictionary_word ON dictionary(word);

  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  -- How often the learner answered "认识" / "不认识" for each word.
  -- Keyed by word (not dictionary id) so it survives dictionary re-imports.
  CREATE TABLE IF NOT EXISTS word_stats (
    word TEXT PRIMARY KEY,
    knownCount INTEGER NOT NULL DEFAULT 0,
    unknownCount INTEGER NOT NULL DEFAULT 0,
    lastResult TEXT DEFAULT '',
    lastSeenAt TEXT DEFAULT ''
  );
`);

// Add columns that older databases don't have yet
function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn("notebook", "translation", "TEXT DEFAULT ''");
ensureColumn("dictionary", "phonetic", "TEXT DEFAULT ''");
ensureColumn("dictionary", "exampleZh", "TEXT DEFAULT ''");
// Which words a study batch draws from: 'new' | 'mixed' | 'review'
ensureColumn("settings", "studyMix", "TEXT NOT NULL DEFAULT 'mixed'");
// Word book (exam tag such as 'cet4') new words come from; '' = all words
ensureColumn("settings", "book", "TEXT NOT NULL DEFAULT ''");
// 1 when the learner marked the word "太简单"; it then never shows up again
ensureColumn("word_stats", "tooEasy", "INTEGER NOT NULL DEFAULT 0");

// Settings used to live in settings.json. Import that file once, then the
// settings table is the only source of truth. The old file is left in place.
function importLegacySettings() {
  const done = db.prepare("SELECT value FROM meta WHERE key = 'settings_json_imported'").get();
  if (done) return;

  // Before this change the settings table was never read, so start from the
  // values the app actually used: the JSON file if present, else the defaults.
  const legacyFile = process.env.SETTINGS_FILE || path.join(__dirname, "settings.json");
  let s = {};
  try {
    if (fs.existsSync(legacyFile)) {
      const raw = fs.readFileSync(legacyFile, "utf-8");
      s = raw.trim() ? JSON.parse(raw) : {};
      console.log("Imported settings from", legacyFile);
    }
  } catch (err) {
    console.error("Could not import legacy settings file:", err.message);
  }
  const goal = Number(s.dailyGoal);
  db.prepare("UPDATE settings SET exampleFirst = ?, dailyGoal = ? WHERE id = 1").run(
    s.exampleFirst === false ? 0 : 1,
    Number.isFinite(goal) ? Math.min(500, Math.max(1, Math.round(goal))) : 20
  );

  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('settings_json_imported', ?)").run(
    new Date().toISOString()
  );
}

importLegacySettings();

// One-time data fix for dictionaries imported before the cleanup:
// literal "\n" becomes a real line break, and the Collins star rating that
// was stored as the "example" is removed. Notebook rows copied from the
// dictionary get the same line-break fix.
function cleanDictionaryData() {
  const done = db.prepare("SELECT value FROM meta WHERE key = 'dictionary_text_cleaned'").get();
  if (done) return;

  db.transaction(() => {
    for (const table of ["dictionary", "notebook"]) {
      db.exec(`
        UPDATE ${table} SET
          translation = replace(translation, '\\n', char(10)),
          definition = replace(definition, '\\n', char(10))
        WHERE instr(translation, '\\n') > 0 OR instr(definition, '\\n') > 0
      `);
    }
    db.exec(`UPDATE dictionary SET example = '' WHERE trim(example) GLOB '[0-9]*' AND trim(example) NOT GLOB '*[^0-9]*'`);
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('dictionary_text_cleaned', ?)").run(
      new Date().toISOString()
    );
  })();
}

cleanDictionaryData();

module.exports = db;
