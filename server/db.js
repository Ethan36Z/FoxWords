/* eslint-disable */
// server/db.js
const Database = require("better-sqlite3");
const path = require("path");

const db = new Database(path.join(__dirname, "foxwords.db"));
console.log("DB FILE =>", path.join(__dirname, "foxwords.db"));

// build tables (run once, safe to run many times)
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
    dailyGoal INTEGER NOT NULL DEFAULT 10
  );

  INSERT OR IGNORE INTO settings (id, exampleFirst, dailyGoal)
  VALUES (1, 1, 10);

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
`);

try {
  db.exec(`ALTER TABLE notebook ADD COLUMN translation TEXT DEFAULT ''`);
} catch (e) {
  // 如果已经有这列，SQLite 会报错：duplicate column name。忽略即可。
}
module.exports = db;