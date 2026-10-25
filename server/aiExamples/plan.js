// Which words get an AI example, and which are held back.
//
// A word is eligible when it has no human example, a core meaning, and that
// core meaning is backed by evidence (one part of speech, WordNet/Tatoeba,
// or a reviewed override). Words whose meaning is only ECDICT's order are
// flagged for meaning review instead: an example would reinforce a meaning
// nobody has checked.
const { hasValidExample } = require("../dictionaryStats");
const { BOOKS } = require("../books");

const fs = require("fs");
const path = require("path");

const SENSITIVE = /(^| )(vulgar|offensive)( |$)/;
// Words held back by a person because their core meaning is uncertain
const HOLDS_FILE = path.join(__dirname, "holds.json");
const HOLDS = new Map(
  (fs.existsSync(HOLDS_FILE) ? JSON.parse(fs.readFileSync(HOLDS_FILE, "utf-8")).words : []).map((h) => [h.word, h.reason])
);

function holdReason(entry, accepted) {
  if (hasValidExample(entry.example)) return "has a human example";
  if (accepted.has(entry.word)) return "already has an accepted AI example";
  if (HOLDS.has(entry.word)) return `held: ${HOLDS.get(entry.word)}`;
  if (!entry.meaning) return "no core meaning";
  if (SENSITIVE.test(entry.labels || "")) return "labelled vulgar/offensive";
  if ((entry.meaningSource || "").startsWith("ecdict-order")) return "core meaning not verified (ECDICT order only)";
  return "";
}

// sets: "zk-missing" (the pilot) or any word book id, e.g. "cet4"
function selectWords(dictionary, acceptedWords, { set = "zk-missing", words = null } = {}) {
  const accepted = new Set(acceptedWords);
  const book = set === "zk-missing" ? "zk" : set;
  if (!BOOKS.some((b) => b.id === book) && set !== "all") throw new Error(`unknown set ${set}`);
  const pool = dictionary.filter((e) => {
    if (words) return words.includes(e.word);
    return set === "all" || e.tags.split(" ").includes(book);
  });
  const eligible = [];
  const held = [];
  for (const e of pool) {
    const reason = holdReason(e, accepted);
    if (!reason) eligible.push(e);
    else if (reason !== "has a human example") held.push({ word: e.word, meaning: e.meaning, reason });
  }
  return { eligible, held };
}

// The frozen input of a job: what was asked, against which meaning
function planItem(e) {
  return {
    word: e.word,
    meaning: e.meaning,
    meaningSource: e.meaningSource,
    level: e.level,
    definition: (e.definition || "").split("\n")[0] || "",
  };
}

module.exports = { selectWords, planItem, holdReason };
