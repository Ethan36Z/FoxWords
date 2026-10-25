// Prompt for Corvus API v1: one JSON object for a batch of words.
// Corvus allows a leading system message, then user turns; json_object
// mode returns one top-level object; output is capped at 1024 tokens.
const PROMPT_VERSION = "example-v2";

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

const SYSTEM = [
  "You write example sentences for Chinese learners of English.",
  "Reply with one JSON object only, no other text.",
].join(" ");

function buildMessages(items) {
  const lines = items.map((it, i) => {
    const parts = [`${i + 1}. word: ${it.word}`, `meaning: ${it.meaning}`];
    if (it.definition) parts.push(`English definition: ${it.definition}`);
    parts.push(`level: ${LEVEL_HINT[it.level] || "intermediate (CEFR B1)"}`);
    return parts.join(" | ");
  });
  const user = [
    "For each word below, write ONE short, natural English example sentence that uses the word",
    "with exactly the given meaning and part of speech, plus a faithful Simplified Chinese translation",
    "that translates the word with that meaning.",
    "",
    "Rules:",
    "- 6 to 14 words, one sentence, everyday situations, other words easier than the target word.",
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

module.exports = { PROMPT_VERSION, MAX_BATCH, maxTokensFor, buildMessages };
