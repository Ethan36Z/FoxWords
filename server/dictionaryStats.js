// Read-only example-coverage statistics for the FoxWords dictionary.
//
//   node dictionaryStats.js                     # server/dictionary.json
//   node dictionaryStats.js --db ../data/foxwords.db   # an imported database (opened read-only)
//   node dictionaryStats.js --order cet4,cet6,ielts,toefl,ky,gk,zk --json
//
// It never writes anything. Rows are normalised the same way the importer
// does (literal "\n", Collins star ratings stored as examples), so the JSON
// file and an imported database give the same numbers.

const fs = require("fs");
const path = require("path");
const { BOOKS, bookIdsOf } = require("./books");

const clean = (v) => String(v || "").replace(/\\n/g, "\n").trim();
const cleanExample = (v) => (/^\d+$/.test(clean(v)) ? "" : clean(v));

// A usable example is an English sentence of at least three words.
function hasValidExample(example) {
  const words = cleanExample(example).match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) || [];
  return words.length >= 3;
}

// Heuristic: the sentence contains the headword or a form starting with its
// stem (abandon -> abandoned). Irregular forms (go -> went) are not detected,
// so this is reported as a quality signal, not as a validity rule.
function mentionsWord(example, word) {
  const w = String(word || "").toLowerCase();
  if (!w) return false;
  const stem = w.length > 4 ? w.slice(0, w.length - 2) : w;
  const escaped = stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z])${escaped}`, "i").test(cleanExample(example));
}

function loadFromJson(file) {
  const arr = JSON.parse(fs.readFileSync(file, "utf-8"));
  if (!Array.isArray(arr)) throw new Error(`${file} is not an array`);
  return arr
    .map((it) => ({
      word: clean(it.word),
      example: cleanExample(it.example),
      exampleZh: clean(it.exampleZh),
      level: clean(it.level),
      tags: clean(it.tags),
    }))
    .filter((r) => r.word);
}

function loadFromDb(file) {
  const Database = require("better-sqlite3");
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const cols = new Set(db.prepare("PRAGMA table_info(dictionary)").all().map((c) => c.name));
    const zh = cols.has("exampleZh") ? "exampleZh" : "'' AS exampleZh";
    return db
      .prepare(`SELECT word, example, ${zh}, level, tags FROM dictionary`)
      .all()
      .map((r) => ({ ...r, example: cleanExample(r.example), exampleZh: clean(r.exampleZh) }));
  } finally {
    db.close();
  }
}

const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0);

function computeStats(rows, { order = BOOKS.map((b) => b.id) } = {}) {
  const ids = BOOKS.map((b) => b.id);
  const entries = rows.map((r) => ({
    word: r.word,
    books: bookIdsOf(r.tags),
    level: r.level,
    hasExample: hasValidExample(r.example),
    hasZh: Boolean(r.exampleZh),
    mentionsWord: hasValidExample(r.example) && mentionsWord(r.example, r.word),
  }));

  const total = entries.length;
  const withExample = entries.filter((e) => e.hasExample).length;
  const missingAll = new Set(entries.filter((e) => !e.hasExample).map((e) => e.word));

  const members = Object.fromEntries(ids.map((id) => [id, new Set()]));
  const missing = Object.fromEntries(ids.map((id) => [id, new Set()]));
  for (const e of entries) {
    for (const b of e.books) {
      members[b].add(e.word);
      if (!e.hasExample) missing[b].add(e.word);
    }
  }

  const bookCount = new Map(entries.map((e) => [e.word, e.books.length]));
  const books = BOOKS.map((b) => {
    const n = members[b.id].size;
    const miss = missing[b.id].size;
    const only = [...members[b.id]].filter((w) => bookCount.get(w) === 1);
    return {
      id: b.id,
      title: b.title,
      words: n,
      withExample: n - miss,
      missing: miss,
      coverage: pct(n - miss, n),
      onlyInThisBook: only.length,
    };
  });

  // Words grouped by `level` (the easiest book a word belongs to): every word
  // is counted exactly once here.
  const byLevel = {};
  for (const e of entries) {
    const l = (byLevel[e.level || "(none)"] ||= { level: e.level || "(none)", words: 0, withExample: 0 });
    l.words += 1;
    if (e.hasExample) l.withExample += 1;
  }
  const levels = Object.values(byLevel).map((l) => ({
    ...l,
    missing: l.words - l.withExample,
    coverage: pct(l.withExample, l.words),
  }));

  const intersect = (a, b) => [...a].filter((x) => b.has(x)).length;
  const overlap = {};
  const missingOverlap = {};
  for (const a of ids) {
    overlap[a] = {};
    missingOverlap[a] = {};
    for (const b of ids) {
      overlap[a][b] = intersect(members[a], members[b]);
      missingOverlap[a][b] = intersect(missing[a], missing[b]);
    }
  }

  const booksPerWord = {};
  for (const e of entries) booksPerWord[e.books.length] = (booksPerWord[e.books.length] || 0) + 1;

  // Fill books one after another; words already generated for an earlier book
  // are not generated again.
  const done = new Set();
  const cumulative = order.map((id) => {
    const need = [...missing[id]].filter((w) => !done.has(w));
    need.forEach((w) => done.add(w));
    return { id, newGenerations: need.length, cumulative: done.size };
  });

  return {
    total,
    withExample,
    missing: missingAll.size,
    coverage: pct(withExample, total),
    withExampleZh: entries.filter((e) => e.hasExample && e.hasZh).length,
    exampleMentionsWord: entries.filter((e) => e.mentionsWord).length,
    noBook: entries.filter((e) => e.books.length === 0).length,
    books,
    levels,
    booksPerWord,
    overlap,
    missingOverlap,
    order,
    cumulative,
  };
}

// Theoretical request count and time at a given batch size and request rate.
function estimate(count, { batchSize, rpm }) {
  const requests = Math.ceil(count / batchSize);
  return { batchSize, rpm, requests, minutes: Math.round((requests / rpm) * 10) / 10 };
}

function table(headers, rows) {
  const all = [headers, ...rows].map((r) => r.map(String));
  const width = headers.map((_, i) => Math.max(...all.map((r) => [...r[i]].length)));
  const line = (r) => r.map((c, i) => c.padStart(width[i])).join("  ");
  return [line(all[0]), ...all.slice(1).map(line)].join("\n");
}

function printReport(s, source) {
  const out = [];
  out.push(`Source: ${source}`);
  out.push(
    `Words ${s.total} | with valid example ${s.withExample} (${s.coverage}%) | missing ${s.missing}` +
      ` | with Chinese translation ${s.withExampleZh} | example mentions word (heuristic) ${s.exampleMentionsWord}` +
      ` | in no book ${s.noBook}`
  );
  out.push("\nBy book (a word can be in several books):");
  out.push(
    table(
      ["book", "title", "words", "withEx", "missing", "cover%", "onlyHere"],
      s.books.map((b) => [b.id, b.title, b.words, b.withExample, b.missing, b.coverage, b.onlyInThisBook])
    )
  );
  out.push("\nBy level (easiest book; each word once):");
  out.push(table(["level", "words", "withEx", "missing", "cover%"], s.levels.map((l) => [l.level, l.words, l.withExample, l.missing, l.coverage])));
  out.push("\nBooks per word: " + Object.entries(s.booksPerWord).map(([k, v]) => `${k}: ${v}`).join(", "));
  const ids = s.books.map((b) => b.id);
  out.push("\nOverlap (words in both books):");
  out.push(table(["", ...ids], ids.map((a) => [a, ...ids.map((b) => s.overlap[a][b])])));
  out.push("\nOverlap of words MISSING an example:");
  out.push(table(["", ...ids], ids.map((a) => [a, ...ids.map((b) => s.missingOverlap[a][b])])));
  out.push(`\nFill in order ${s.order.join(" > ")}:`);
  out.push(table(["book", "new", "cumulative"], s.cumulative.map((c) => [c.id, c.newGenerations, c.cumulative])));
  return out.join("\n");
}

function parseArgs(argv) {
  const args = { file: path.join(__dirname, "dictionary.json"), db: "", order: "", json: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--db") args.db = argv[++i];
    else if (argv[i] === "--file") args.file = argv[++i];
    else if (argv[i] === "--order") args.order = argv[++i];
    else if (argv[i] === "--json") args.json = true;
  }
  return args;
}

module.exports = { hasValidExample, mentionsWord, computeStats, estimate, loadFromJson, loadFromDb };

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  const rows = args.db ? loadFromDb(args.db) : loadFromJson(args.file);
  const valid = new Set(BOOKS.map((b) => b.id));
  const order = args.order ? args.order.split(",").filter((id) => valid.has(id)) : undefined;
  const stats = computeStats(rows, { order });
  if (args.json) console.log(JSON.stringify(stats, null, 2));
  else console.log(printReport(stats, args.db || args.file));
}
