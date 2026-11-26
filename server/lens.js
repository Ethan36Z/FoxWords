// FoxWords Lens (foxwords-lens) integration: import its version-1 JSON export
// (Library → Export) into lens_sentences, list the sentences, find the
// dictionary words in a sentence, and attach "sentences you have seen" to
// study cards. Nothing here calls Corvus; the explanations come from Lens.
const { formRegex } = require("./aiExamples/validate");

const MAX_ENTRIES = 5000;
const MAX_SENTENCE = 600;
const str = (v, max = 2000) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// Common function words are not offered as notebook candidates
const STOP = new Set(
  ("a an the and or but if of to in on at by for from with as is am are was were be been being do does did " +
    "have has had i you he she it we they me him her us them my your his its our their this that these those " +
    "not no so than then there here what which who whom whose when where why how all any some can could will " +
    "would shall should may might must just very too also into out up down over about").split(" ")
);

// One export entry -> a row, or an error message
function normalizeEntry(e) {
  if (!e || typeof e !== "object") return { error: "not an object" };
  if (e.version !== 1) return { error: `unsupported version ${e.version}` };
  const id = str(e.id, 200);
  if (!id) return { error: "missing id" };
  const sentence = str(e.candidate && e.candidate.text, MAX_SENTENCE + 1);
  if (!sentence) return { error: "missing sentence" };
  if (sentence.length > MAX_SENTENCE) return { error: "sentence too long" };
  const analysis = e.analysis && typeof e.analysis === "object" ? e.analysis : {};
  const expressions = (Array.isArray(analysis.expressions) ? analysis.expressions : [])
    .filter((x) => x && typeof x === "object")
    .slice(0, 5)
    .map((x) => ({
      quote: str(x.quote, 300), pattern: str(x.pattern, 300), meaning: str(x.meaning, 300),
      usage: str(x.usage, 500), example: str(x.example, 400),
    }))
    .filter((x) => x.pattern || x.quote);
  const capture = e.capture && typeof e.capture === "object" ? e.capture : {};
  return {
    row: {
      id,
      sentence,
      meaning: str(analysis.meaning, 500),
      expressions: JSON.stringify(expressions),
      caution: str(analysis.caution, 500),
      sourceKind: str(capture.kind, 40),
      sourceLabel: str(capture.source, 200),
      capturedAt: str(e.created, 40),
      payload: JSON.stringify(e),
    },
  };
}

const sameText = (s) => s.toLowerCase().replace(/\s+/g, " ").trim();

// Sorts entries into new / duplicate (same id or same sentence) / invalid
function classify(db, list) {
  if (!Array.isArray(list)) throw new Error("the file is not a FoxWords Lens export (expected a JSON array)");
  if (list.length > MAX_ENTRIES) throw new Error(`too many entries (max ${MAX_ENTRIES})`);
  const ids = new Set(db.prepare("SELECT id FROM lens_sentences").all().map((r) => r.id));
  const texts = new Set(db.prepare("SELECT sentence FROM lens_sentences").all().map((r) => sameText(r.sentence)));
  const out = { fresh: [], duplicate: [], invalid: [] };
  list.forEach((e, index) => {
    const { row, error } = normalizeEntry(e);
    if (error) return out.invalid.push({ index, error });
    if (ids.has(row.id) || texts.has(sameText(row.sentence))) return out.duplicate.push(row);
    ids.add(row.id);
    texts.add(sameText(row.sentence));
    out.fresh.push(row);
  });
  return out;
}

const brief = (r) => ({ id: r.id, sentence: r.sentence, meaning: r.meaning, sourceKind: r.sourceKind });

function previewImport(db, list) {
  const c = classify(db, list);
  return { total: list.length, fresh: c.fresh.length, duplicate: c.duplicate.length, invalid: c.invalid, sample: c.fresh.slice(0, 5).map(brief) };
}

function importEntries(db, list) {
  const c = classify(db, list);
  const now = new Date().toISOString();
  const insert = db.prepare(`INSERT INTO lens_sentences
    (id, sentence, meaning, expressions, caution, sourceKind, sourceLabel, capturedAt, importedAt, payload)
    VALUES (@id, @sentence, @meaning, @expressions, @caution, @sourceKind, @sourceLabel, @capturedAt, @importedAt, @payload)`);
  db.transaction((rows) => rows.forEach((r) => insert.run({ ...r, importedAt: now })))(c.fresh);
  return { imported: c.fresh.length, duplicate: c.duplicate.length, invalid: c.invalid.length };
}

function toApi(r) {
  return {
    id: r.id, sentence: r.sentence, meaning: r.meaning, expressions: JSON.parse(r.expressions || "[]"),
    caution: r.caution, sourceKind: r.sourceKind, sourceLabel: r.sourceLabel, capturedAt: r.capturedAt, importedAt: r.importedAt,
  };
}

function listSentences(db, { q = "", limit = 50, offset = 0 } = {}) {
  const like = `%${q}%`;
  const where = q ? "WHERE sentence LIKE ? OR meaning LIKE ?" : "";
  const args = q ? [like, like] : [];
  const total = db.prepare(`SELECT COUNT(*) c FROM lens_sentences ${where}`).get(...args).c;
  const rows = db
    .prepare(`SELECT * FROM lens_sentences ${where} ORDER BY capturedAt DESC, importedAt DESC LIMIT ? OFFSET ?`)
    .all(...args, limit, offset);
  return { total, items: rows.map(toApi) };
}

// Words of a captured text, in text order, once each, at most MAX_WORDS.
// Each token is matched against the study dictionary, then the lookup-only
// list (inDictionary: false, "词表外"). Inflections go to their lemma via
// word_forms (drove -> drive, children -> child); when the token is also a
// word of its own (felt n. 毛毯), the more frequent reading comes first and
// the other is returned as `also`. Regular endings and -ly adverbs are tried
// when word_forms has nothing. tooEasy: marked 太简单 in FoxWords.
const MAX_WORDS = 80;
const FORM_LABEL = { p: "过去式", d: "过去分词", i: "现在分词", 3: "第三人称单数", s: "复数", r: "比较级", t: "最高级" };
const formLabel = (kinds) => (kinds === "pd" || kinds === "dp" ? "过去式/过去分词" : FORM_LABEL[kinds[0]] || "");

const regularTries = (t) => [
  t.replace(/ies$/, "y"), t.replace(/ied$/, "y"), t.replace(/es$/, ""), t.replace(/s$/, ""),
  t.replace(/ed$/, ""), t.replace(/d$/, ""), t.replace(/ing$/, ""), t.replace(/ing$/, "e"),
  t.replace(/([b-df-hj-np-tv-z])\1(ed|ing)$/, "$1"),
].filter((x) => x !== t && x.length > 1);
// happily -> happy, gently -> gentle, basically -> basic, quickly -> quick
const adverbTries = (t) => (/..ly$/.test(t) ? [t.slice(0, -3) + "y", t.slice(0, -2) + "e", t.slice(0, -4), t.slice(0, -2)] : []);

function wordsInSentence(db, sentence) {
  const study = db.prepare("SELECT word, phonetic, level, meaning, translation, definition FROM dictionary WHERE lower(word) = ? LIMIT 1");
  const extra = db.prepare("SELECT word, phonetic, meaning, translation, definition FROM lookup_words WHERE word = ?");
  const forms = db.prepare("SELECT lemma, kinds, lemmaFirst FROM word_forms WHERE form = ?");
  const entry = (w) => {
    const s = study.get(w);
    if (s) return { ...s, inDictionary: true };
    const x = extra.get(w);
    return x ? { ...x, level: "", inDictionary: false } : null;
  };
  const inNotebook = new Set(db.prepare("SELECT word FROM notebook").all().map((r) => r.word));
  const easy = new Set(db.prepare("SELECT word FROM word_stats WHERE tooEasy = 1").all().map((r) => r.word));

  // Readings of one token, best first: [{ e, form }]
  const readings = (t) => {
    const self = entry(t);
    const lemmas = forms.all(t).map((f) => ({ e: entry(f.lemma), form: formLabel(f.kinds), first: f.lemmaFirst })).filter((r) => r.e);
    if (self || lemmas.length) {
      return [...lemmas.filter((r) => r.first), ...(self ? [{ e: self, form: "" }] : []), ...lemmas.filter((r) => !r.first)];
    }
    for (const x of regularTries(t)) if (entry(x)) return [{ e: entry(x), form: "变形" }];
    for (const x of adverbTries(t)) if (entry(x)) return [{ e: entry(x), form: "副词" }];
    return [];
  };

  const seen = new Set();
  const out = [];
  for (const tok of String(sentence).toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) || []) {
    const t = tok.replace(/'s$/, "");
    if (STOP.has(t) || t.length < 2) continue;
    const [main, alt] = readings(t);
    // "children pl. 孩子" only repeats child; keep alternatives with a meaning of their own
    const other = alt && !/^pl\./.test(alt.e.meaning || "") ? alt : null;
    if (!main || seen.has(main.e.word)) continue;
    seen.add(main.e.word);
    const e = main.e;
    out.push({
      token: tok, word: e.word, phonetic: e.phonetic || "", level: e.level || "", meaning: e.meaning || "",
      translation: e.translation || "", definition: e.definition || "", inDictionary: e.inDictionary, form: main.form,
      also: other ? { word: other.e.word, meaning: other.e.meaning || "", form: other.form } : null,
      inNotebook: inNotebook.has(e.word), tooEasy: easy.has(e.word),
    });
    if (out.length >= MAX_WORDS) break;
  }
  return out;
}

// Adds lensSentences (at most two) to study-card rows whose word appears in
// an imported sentence. Read-only.
function withLensSentences(db, rows) {
  const all = db.prepare("SELECT id, sentence, meaning, sourceKind, sourceLabel, capturedAt FROM lens_sentences ORDER BY capturedAt DESC").all();
  if (!all.length) return rows;
  return rows.map((r) => {
    const re = formRegex(r.word);
    const hits = all.filter((s) => re.test(s.sentence)).slice(0, 2);
    return hits.length ? { ...r, lensSentences: hits } : r;
  });
}

module.exports = { normalizeEntry, previewImport, importEntries, listSentences, wordsInSentence, withLensSentences, MAX_ENTRIES };
