// Tatoeba example candidates: synthetic data only, nothing real is read or written.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { isSimplified, loadTatoeba, buildCandidates, sample, COLUMNS, LICENSE } = require("../tatoebaExamples");

const entry = (word, meaning, extra = {}) => ({
  word, meaning, meaningSource: "single", level: "高考", tags: "gk", labels: "", example: "", exampleZh: "", ...extra,
});
const pair = (engId, en, zh, extra = {}) => ({
  engId: String(engId), cmnId: String(engId + 1000), en, zh, engAuthor: "ann", cmnAuthor: "li", nativeEn: true, nativeZh: true, ...extra,
});

const dictionary = [
  entry("harvest", "n. 收获, 收成"),
  entry("tidy", "a. 整洁的"),
  entry("apple", "n. 苹果", { example: "I ate an apple this morning.", exampleZh: "我今天早上吃了一个苹果。" }),
  entry("metre", "n. 米"), // has an accepted AI example
  entry("whom", "pron. 谁"), // on the hold list
  entry("lonely", "a. 孤独的"),
  entry("quantum", "n. 量子", { level: "考研", tags: "ky" }),
];
const pairs = [
  pair(1, "The farmers are busy with the harvest this week.", "农民们这周忙着收获。"),
  pair(2, "We had a good harvest of apples this year.", "今年我们苹果大丰收。"), // form only (no 收获/收成)
  pair(3, "She keeps her room very tidy every day.", "她每天都把房间收拾得很整洁。"),
  pair(4, "Her desk is always tidy and clean.", "她的書桌總是很整潔。"), // Traditional
  pair(5, "I ate an apple this morning, my friend.", "我今天早上吃了一个苹果。"),
  pair(6, "Our classroom is about ten metres long.", "我们的教室大约十米长。"),
  pair(7, "To whom did you give the book yesterday?", "你昨天把书给了谁？"),
  pair(8, "He felt lonely after his friends moved away.", "朋友们搬走以后，他感到很孤独。"),
  pair(9, "The old man felt lonely in the big empty house.", "老人在空荡荡的大房子里感到孤独。", { nativeZh: false }),
];

test("candidates only for eligible words, existing content is never offered", () => {
  const { rows, eligible, none } = buildCandidates(dictionary, pairs, {
    book: "gk", acceptedWords: ["metre"], existingSentences: new Set(["I ate an apple this morning."]),
  });
  const words = rows.map((r) => r.word);
  assert.deepEqual(words, ["harvest", "lonely", "tidy"]);
  assert.equal(eligible, 3); // harvest, tidy, lonely: apple has an example, metre is accepted, whom is held
  assert.deepEqual(none, []);
  // apple / metre / whom / quantum (not in the book) never appear
  for (const w of ["apple", "metre", "whom", "quantum"]) assert.ok(!words.includes(w), w);
});

test("ranking prefers a visible core meaning; form-only matches are labelled as such", () => {
  const { rows } = buildCandidates(dictionary, pairs, { book: "gk" });
  const harvest = rows.find((r) => r.word === "harvest");
  assert.equal(harvest.sentence, "The farmers are busy with the harvest this week.");
  assert.equal(harvest.match, "form+gloss");
  assert.equal(harvest.status, "needs_review"); // never "accepted" or "candidate"
  assert.equal(harvest.other_candidates, "1");
  const formOnly = buildCandidates([dictionary[0]], [pairs[1]], { book: "gk" }).rows[0];
  assert.equal(formOnly.match, "form");
  assert.match(formOnly.flags, /core meaning not visible/);
});

test("Traditional Chinese is dropped and each sentence is offered once", () => {
  const { rows } = buildCandidates(dictionary, pairs, { book: "gk" });
  assert.equal(rows.find((r) => r.word === "tidy").cmn_id, "1003");
  const sentences = rows.map((r) => r.sentence);
  assert.equal(new Set(sentences).size, sentences.length);
});

test("Simplified check uses GB2312, not a short list of Traditional characters", () => {
  assert.equal(isSimplified("飛機在三千米的高空飛行。"), false);
  assert.equal(isSimplified("多運動有益健康。"), false);
  assert.equal(isSimplified("飞机在三千米的高空飞行，“很快”！"), true);
  // a word whose only pair is Traditional gets no candidate
  const only = buildCandidates([entry("altitude", "n. 高度, 海拔")],
    [pair(30, "The plane flew at an altitude of 3,000 meters.", "飛機在三千米的高空飛行。")], { book: "gk" });
  assert.deepEqual(only.rows, []);
  assert.deepEqual(only.none, ["altitude"]);
});

test("names other than Tatoeba's stock characters are flagged and ranked last", () => {
  const { rows } = buildCandidates([entry("famous", "a. 著名的")], [
    pair(40, "Boris Johnson is a famous British politician.", "鲍里斯·约翰逊是著名的英国政治家。"),
    pair(41, "Tom wants to become a famous singer.", "汤姆想成为一名著名的歌手。"),
  ], { book: "gk" });
  assert.equal(rows[0].sentence, "Tom wants to become a famous singer.");
  assert.equal(rows[0].flags, "");
  const flagged = buildCandidates([entry("famous", "a. 著名的")], [pair(40, "Boris Johnson is a famous British politician.", "鲍里斯·约翰逊是著名的英国政治家。")], { book: "gk" });
  assert.match(flagged.rows[0].flags, /names: Johnson/);
});

test("source ids, authors and license are kept on every row", () => {
  const { rows } = buildCandidates(dictionary, pairs, { book: "gk" });
  for (const r of rows) {
    assert.ok(r.eng_id && r.cmn_id && r.eng_author && r.cmn_author, r.word);
    assert.equal(r.license, LICENSE);
  }
  // the review columns of the AI workflow come first, in the same order
  assert.deepEqual(COLUMNS.slice(0, 10), ["word", "meaning", "status", "flags", "sentence", "translation", "decision", "sentence_fix", "translation_fix", "note"]);
});

test("sample is reproducible", () => {
  const rows = Array.from({ length: 50 }, (_, i) => ({ word: `w${String(i).padStart(2, "0")}` }));
  assert.deepEqual(sample(rows, 10, 7), sample(rows, 10, 7));
  assert.notDeepEqual(sample(rows, 10, 7), sample(rows, 10, 8));
  assert.equal(sample(rows, 10, 7).length, 10);
});

test("loads the official export format", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "foxwords-tatoeba-"));
  try {
    fs.writeFileSync(path.join(dir, "cmn-eng_links.tsv"), "11\t21\n12\t22\n13\t99\n");
    fs.writeFileSync(path.join(dir, "cmn_sentences_detailed.tsv"), "11\tcmn\t他很孤独。\tli\t\\N\t\\N\n12\tcmn\t收获很好。\t\\N\t\\N\t\\N\n13\tcmn\t没有英文。\tli\t\\N\t\\N\n");
    fs.writeFileSync(path.join(dir, "eng_sentences_detailed.tsv"), "21\teng\tHe is lonely.\tann\t\\N\t\\N\n22\teng\tThe harvest was good.\tbob\t\\N\t\\N\n");
    fs.writeFileSync(path.join(dir, "user_languages.csv"), "cmn\t5\tli\t\neng\t3\tann\t\n");
    const got = await loadTatoeba(dir);
    assert.equal(got.length, 2); // 13 has no English side
    assert.deepEqual(got[0], { engId: "21", cmnId: "11", en: "He is lonely.", zh: "他很孤独。", engAuthor: "ann", cmnAuthor: "li", nativeEn: false, nativeZh: true });
    assert.equal(got[1].cmnAuthor, ""); // \N means no owner
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
