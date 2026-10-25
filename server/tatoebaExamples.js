#!/usr/bin/env node
// Human-sourced example candidates from the official Tatoeba English–Chinese
// export, for words that have no example yet. Read-only: it writes a review
// sheet (same columns as the AI example review, plus source columns) and
// changes nothing else. Nothing is accepted automatically.
//
//   node tatoebaExamples.js --data .dict-src/tatoeba-official --book gk
//        [--out .ai-work/tatoeba] [--sample 100] [--seed 20261025]
//
// --data holds the official exports, decompressed (bunzip2 -k *.bz2):
//   eng_sentences_detailed.tsv, cmn_sentences_detailed.tsv  (per_language/)
//   cmn-eng_links.tsv                                       (per_language/cmn/)
//   user_languages.csv  (optional; marks native speakers)   (exports/user_languages.tar.bz2)
//
// Matching is by word form only. The "match" column says whether the Chinese
// also contains a core gloss ("form+gloss"); that is a hint for the reviewer,
// not proof that the sentence uses the word in the target sense.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { formRegex, checkSentence, checkTranslation, glossKeys, meaningVisible } = require("./aiExamples/validate");
const { selectWords } = require("./aiExamples/plan");
const { readStore } = require("./aiExamples/store");

const LICENSE = "CC BY 2.0 FR";
const COLUMNS = [
  "word", "meaning", "status", "flags", "sentence", "translation", "decision", "sentence_fix", "translation_fix", "note",
  "match", "hard_words", "native", "eng_id", "cmn_id", "eng_author", "cmn_author", "license", "other_candidates",
];
// Topics a teacher would rather not lead with; ranked last and flagged, not removed
const TOPIC = /\b(kill\w*|murder\w*|suicide|die|died|dies|dead|death|gun|guns|shot|war|wars|bomb\w*|drunk|drugs?|sex\w*|naked|prison|politic\w*|government|president|communis\w*|nazis?|hitler|religio\w*|god|jesus|terror\w*|blood\w*)\b/i;
// Tatoeba's stock characters; other capitalised non-words may be real people or places
const STOCK_NAMES = new Set(["tom", "mary", "john", "alice", "jack", "ken", "bill", "bob", "mike", "jim", "ziri", "rima", "sami", "layla", "yanni", "skura", "mennad", "baya", "dan", "linda"]);

// Simplified Chinese = every Han character is in GB2312, the same rule as
// build_dictionary.py (validate.js only flags a few common Traditional ones)
let GB2312 = null;
function isSimplified(text) {
  if (!GB2312) {
    GB2312 = new Set();
    const gbk = new TextDecoder("gbk");
    for (let hi = 0xb0; hi <= 0xf7; hi++) {
      for (let lo = 0xa1; lo <= 0xfe; lo++) GB2312.add(gbk.decode(Uint8Array.from([hi, lo])));
    }
  }
  return [...text].every((c) => !/\p{Script=Han}/u.test(c) || GB2312.has(c));
}
// Levels easier than or equal to each book (dictionary "level" holds the easiest tag)
const EASY_LEVELS = { zk: ["中考"], gk: ["中考", "高考"], cet4: ["中考", "高考", "四级"] };

async function readTsv(file, onRow) {
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: "utf-8" }), crlfDelay: Infinity });
  for await (const line of rl) if (line) onRow(line.split("\t"));
}

// Returns [{ engId, cmnId, en, zh, engAuthor, cmnAuthor, nativeEn, nativeZh }]
async function loadTatoeba(dir) {
  const file = (n) => path.join(dir, n);
  const links = [];
  await readTsv(file("cmn-eng_links.tsv"), ([cmn, eng]) => links.push([cmn, eng]));
  const wantEng = new Set(links.map((l) => l[1]));
  const cmn = new Map();
  const eng = new Map();
  await readTsv(file("cmn_sentences_detailed.tsv"), (c) => cmn.set(c[0], { text: c[2], author: c[3] === "\\N" ? "" : c[3] }));
  await readTsv(file("eng_sentences_detailed.tsv"), (c) => {
    if (wantEng.has(c[0])) eng.set(c[0], { text: c[2], author: c[3] === "\\N" ? "" : c[3] });
  });
  const native = { cmn: new Set(), eng: new Set() };
  if (fs.existsSync(file("user_languages.csv"))) {
    await readTsv(file("user_languages.csv"), ([lang, level, user]) => {
      if (level === "5" && native[lang]) native[lang].add(user);
    });
  }
  const pairs = [];
  for (const [cmnId, engId] of links) {
    const c = cmn.get(cmnId);
    const e = eng.get(engId);
    if (!c || !e) continue;
    pairs.push({
      engId, cmnId, en: e.text.trim(), zh: c.text.trim(), engAuthor: e.author, cmnAuthor: c.author,
      nativeEn: native.eng.has(e.author), nativeZh: native.cmn.has(c.author),
    });
  }
  return pairs;
}

// word (lowercase) -> level, with simple inflections mapped back to the headword
function levelLookup(dictionary) {
  const level = new Map(dictionary.map((e) => [e.word.toLowerCase(), e.level]));
  return (tok) => {
    for (const t of [tok, tok.replace(/ies$/, "y"), tok.replace(/ied$/, "y"), tok.replace(/(es|s|ed|d|ing)$/, ""), tok.replace(/ing$/, "e")]) {
      if (level.has(t)) return level.get(t);
    }
    return null; // names, numbers, rare words: not counted
  };
}

// Ranked candidates for one word. Hard failures are dropped; everything else
// is ordered so the reviewer sees the most promising pair first.
function rankCandidates(entry, pairs, { levelOf, easyLevels, used }) {
  const re = formRegex(entry.word);
  const keys = glossKeys(entry.meaning);
  const out = [];
  for (const p of pairs) {
    if (!re.test(p.en) || used.has(p.en)) continue;
    const s = checkSentence(p.en, entry.word);
    const t = checkTranslation(p.zh);
    if (s.errors.length || t.errors.length || !isSimplified(p.zh)) continue;
    const words = p.en.split(/\s+/).filter(Boolean).length;
    if (words < 5 || words > 14) continue;
    const toks = (p.en.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) || []).filter((x) => !re.test(` ${x} `));
    const hard = [...new Set(toks.filter((x) => {
      const l = levelOf(x);
      return l !== null && l !== "" && !easyLevels.includes(l);
    }))];
    out.push({
      ...p,
      gloss: keys.length > 0 && meaningVisible(p.zh, keys),
      topic: TOPIC.test(p.en),
      names: p.en.split(/\s+/).slice(1).map((x) => x.replace(/('s|’s)?[^A-Za-z]*$/, "").replace(/^[^A-Za-z]+/, ""))
        .filter((x) => /^[A-Z][a-z]+$/.test(x) && !STOCK_NAMES.has(x.toLowerCase()) && levelOf(x.toLowerCase()) === null),
      hard,
      words,
    });
  }
  out.sort((a, b) =>
    (b.gloss - a.gloss) || ((a.topic + (a.names.length > 0)) - (b.topic + (b.names.length > 0))) || (a.hard.length - b.hard.length) ||
    ((b.nativeZh + b.nativeEn) - (a.nativeZh + a.nativeEn)) ||
    (Math.abs(a.words - 9) - Math.abs(b.words - 9)) || (Number(a.engId) - Number(b.engId)));
  return out;
}

function reviewRow(entry, c, others) {
  const flags = [];
  if (!c.gloss) flags.push("core meaning not visible in translation: check the sense");
  if (c.topic) flags.push("sensitive topic: check suitability");
  if (c.names.length) flags.push(`names: ${c.names.join(" ")} (real people?)`);
  if (c.hard.length) flags.push(`words above ${entry.level || "the"} level: ${c.hard.join(" ")}`);
  return {
    word: entry.word, meaning: entry.meaning, status: "needs_review", flags: flags.join("; "),
    sentence: c.en, translation: c.zh, decision: "", sentence_fix: "", translation_fix: "", note: "",
    match: c.gloss ? "form+gloss" : "form", hard_words: String(c.hard.length),
    native: [c.nativeEn ? "en" : "", c.nativeZh ? "zh" : ""].filter(Boolean).join("+"),
    eng_id: c.engId, cmn_id: c.cmnId, eng_author: c.engAuthor, cmn_author: c.cmnAuthor, license: LICENSE,
    other_candidates: String(others),
  };
}

// One row per eligible word that has at least one usable pair. Existing
// human and accepted AI examples are never candidates, and one English
// sentence is offered for at most one word.
function buildCandidates(dictionary, pairs, { book, acceptedWords = [], existingSentences = new Set() }) {
  const { eligible } = selectWords(dictionary, acceptedWords, { set: book });
  const levelOf = levelLookup(dictionary);
  const easyLevels = EASY_LEVELS[book] || ["中考", "高考"];
  const used = new Set(existingSentences);
  const rows = [];
  const none = [];
  for (const entry of [...eligible].sort((a, b) => a.word.localeCompare(b.word))) {
    const ranked = rankCandidates(entry, pairs, { levelOf, easyLevels, used });
    if (!ranked.length) {
      none.push(entry.word);
      continue;
    }
    used.add(ranked[0].en);
    rows.push(reviewRow(entry, ranked[0], ranked.length - 1));
  }
  return { rows, eligible: eligible.length, none };
}

// Reproducible sample (seeded Fisher–Yates on rows sorted by word)
function sample(rows, n, seed) {
  let s = seed >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const a = [...rows].sort((x, y) => x.word.localeCompare(y.word));
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n).sort((x, y) => x.word.localeCompare(y.word));
}

const clean = (v) => String(v ?? "").replace(/[\t\r\n]+/g, " ").trim();
function writeTsv(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, [COLUMNS.join("\t"), ...rows.map((r) => COLUMNS.map((c) => clean(r[c])).join("\t"))].join("\n") + "\n");
}

const sha256 = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");

async function main(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i += 2) a[argv[i].replace(/^--/, "")] = argv[i + 1];
  if (!a.data || !a.book) throw new Error("usage: tatoebaExamples.js --data DIR --book gk [--out DIR] [--sample 100] [--seed N]");
  const out = a.out || path.join(__dirname, ".ai-work", "tatoeba");
  const dictionary = JSON.parse(fs.readFileSync(path.join(__dirname, "dictionary.json"), "utf-8"));
  const ai = readStore();
  const existing = new Set([...dictionary.map((e) => e.example).filter(Boolean), ...ai.map((e) => e.sentence)]);
  const pairs = await loadTatoeba(a.data);
  const { rows, eligible, none } = buildCandidates(dictionary, pairs, { book: a.book, acceptedWords: ai.map((e) => e.word), existingSentences: existing });
  const n = Number(a.sample || 100);
  const seed = Number(a.seed || 20261025);
  const picked = sample(rows, n, seed);
  writeTsv(path.join(out, `${a.book}-candidates.tsv`), rows);
  writeTsv(path.join(out, `${a.book}-sample${n}.tsv`), picked);
  const inputs = ["eng_sentences_detailed.tsv", "cmn_sentences_detailed.tsv", "cmn-eng_links.tsv", "user_languages.csv"]
    .filter((f) => fs.existsSync(path.join(a.data, f)))
    .map((f) => ({ file: f, sha256: sha256(path.join(a.data, f)) }));
  const summary = {
    book: a.book, pairs: pairs.length, eligibleWords: eligible, candidates: rows.length, noCandidate: none.length,
    formPlusGloss: rows.filter((r) => r.match === "form+gloss").length, sample: picked.length, seed, inputs,
  };
  fs.writeFileSync(path.join(out, `${a.book}-summary.json`), JSON.stringify({ ...summary, noCandidateWords: none }, null, 1) + "\n");
  console.log(JSON.stringify(summary, null, 1));
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { isSimplified, loadTatoeba, buildCandidates, rankCandidates, levelLookup, sample, COLUMNS, LICENSE };
