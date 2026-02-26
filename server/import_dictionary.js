/* eslint-disable no-undef */
/* eslint-env node */

const fs = require("fs");
const path = require("path");
const db = require("./db");

const DICTIONARY_FILE = path.join(__dirname, "dictionary.json");

function main() {
  const raw = fs.readFileSync(DICTIONARY_FILE, "utf-8");
  const arr = JSON.parse(raw);

  if (!Array.isArray(arr)) {
    console.error("dictionary.json is not an array");
    process.exit(1);
  }

  const insert = db.prepare(`
    INSERT OR IGNORE INTO dictionary
    (word, translation, definition, example, level, tags)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction((items) => {
    for (const it of items) {
      const word = (it.word || "").trim();
      if (!word) continue;

      insert.run(
        word,
        (it.translation || "").trim(),
        (it.definition || "").trim(),
        (it.example || "").trim(),
        (it.level || "").trim(),
        (it.tags || "").trim()
      );
    }
  });

  tx(arr);

  const count = db.prepare("SELECT COUNT(*) AS c FROM dictionary").get().c;
  console.log("Import done. dictionary rows =", count);
}

main();