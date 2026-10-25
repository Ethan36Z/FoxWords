// Prompt for Corvus API v1: one JSON object for a batch of words.
// Corvus allows a leading system message, then user turns; json_object
// mode returns one top-level object; output is capped at 1024 tokens.
const PROMPT_VERSION = "example-v4";

// About 60 tokens per item (sentence, translation, keys) plus overhead.
// Eight items stay well under Corvus' 1024-token output cap.
const MAX_BATCH = 8;
function maxTokensFor(n) {
  return Math.min(1024, 120 + 90 * n);
}

const LEVEL_HINT = {
  中考: "junior high school (CEFR A2)",
  高考: "senior high school (CEFR B1)",
  四级: "CET-4 (CEFR B1)",
  六级: "CET-6 (CEFR B2)",
  考研: "postgraduate entrance exam (CEFR B2)",
  雅思: "IELTS (CEFR B2)",
  托福: "TOEFL (CEFR B2-C1)",
};

// Part of speech in words, from the meaning label ("vi. 点头" -> verb)
const POS_NAMES = {
  n: "noun", pl: "noun (plural)", v: "verb", vt: "verb", vi: "verb", a: "adjective", adj: "adjective",
  ad: "adverb", adv: "adverb", prep: "preposition", pron: "pronoun", conj: "conjunction", num: "number word",
  int: "interjection", interj: "interjection", art: "article", aux: "auxiliary verb", abbr: "abbreviation",
};
function partOfSpeech(meaning) {
  const m = /^([a-z]+)\./.exec(meaning || "");
  return (m && POS_NAMES[m[1]]) || "";
}

const SYSTEM = [
  "You write example sentences for Chinese learners of English.",
  "Reply with one JSON object only, no other text.",
].join(" ");

function buildMessages(items) {
  const lines = items.map((it, i) => {
    const pos = partOfSpeech(it.meaning);
    const parts = [`${i + 1}. word: ${it.word}`];
    if (pos) parts.push(`use as: ${pos}`);
    parts.push(`meaning: ${it.meaning}`);
    // The English definition is not sent: it is ECDICT's first WordNet line
    // and often describes another sense (airline: "a hose that carries air").
    parts.push(`level: ${LEVEL_HINT[it.level] || "intermediate (CEFR B1)"}`);
    return parts.join(" | ");
  });
  const user = [
    "For each word below, write ONE short, natural English example sentence that uses the word",
    "as the given part of speech and in the given meaning (the first sense listed is the one to use).",
    "Then translate the whole sentence into natural, fluent Simplified Chinese, as a good Chinese",
    "English teacher would. Do not copy the dictionary meaning word for word: choose the Chinese",
    "wording that fits this sentence, as long as it keeps the same meaning.",
    "",
    "Rules:",
    "- 6 to 14 words, one complete sentence with some context, everyday situations, other words easier than the target word.",
    "- Use the word as the part of speech given in \"use as\" (e.g. if it says verb, do not use it as a noun).",
    "- Use the word itself or a regular form of it (plural, -s, -ed, -ing).",
    "- No names of real people, no brands, nothing violent, sexual or political.",
    '- If the given meaning is not a common meaning of the word, still write the sentence and set "meaning_ok" to false.',
    "",
    "Words:",
    ...lines,
    "",
    'Reply as: {"items": [{"id": 1, "word": "...", "sentence": "...", "translation": "...", "meaning_ok": true}]}',
    `Return exactly ${items.length} items, ids 1 to ${items.length}, in the same order.`,
  ].join("\n");
  return [
    { role: "system", content: SYSTEM },
    { role: "user", content: user },
  ];
}

module.exports = { PROMPT_VERSION, MAX_BATCH, maxTokensFor, buildMessages, partOfSpeech };
