// Checks on a model answer before any human sees it.
//
// "invalid"      hard failure (format, wrong word, unsafe): retried
// "needs_review" usable, but a soft check failed: a human must look closely
// "candidate"    every check passed: still reviewed before acceptance
const PROFANITY = /\b(fuck\w*|shit\w*|bitch\w*|bastard\w*|piss\w*|asshole\w*|whore\w*|cunt\w*|dick|nigg\w*)\b/i;
// Common Traditional-only characters (the app uses Simplified Chinese)
const TRADITIONAL = /[們個這來時說對會為過還學國經點東車開門長間現實發見聽讀語話謝們歡]/;

function glossKeys(meaning) {
  const body = String(meaning || "").replace(/^[a-z]+\.\s*/, "");
  return body
    .split(/[,，;；]/)
    .map((g) => g.replace(/[（([][^）)\]]*[）)\]]/g, "").replace(/\.\.\.|…/g, "").trim().replace(/[的地]$/, ""))
    .filter((g) => g.length > 0);
}

// The word or a regular inflection of it (irregular forms go to review)
function formRegex(word) {
  const w = word.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const alts = [w, `${w}s`, `${w}es`, `${w}ed`, `${w}d`, `${w}ing`, `${w}er`, `${w}est`, `${w}'s`];
  if (w.endsWith("y")) alts.push(`${w.slice(0, -1)}ies`, `${w.slice(0, -1)}ied`, `${w.slice(0, -1)}ier`, `${w.slice(0, -1)}iest`);
  if (w.endsWith("e")) alts.push(`${w.slice(0, -1)}ing`);
  if (/[^aeiou][aeiou][bdgklmnprt]$/.test(w)) alts.push(`${w}${w.slice(-1)}ed`, `${w}${w.slice(-1)}ing`, `${w}${w.slice(-1)}er`);
  return new RegExp(`(^|[^a-z])(${alts.join("|")})(?![a-z])`, "i");
}

// The meaning is visible when the translation shares a gloss, or two
// consecutive characters of one (富幽默感的 ~ 幽默).
function meaningVisible(translation, keys) {
  return keys.some((k) => {
    if (translation.includes(k)) return true;
    for (let i = 0; i + 2 <= k.length; i++) if (translation.includes(k.slice(i, i + 2))) return true;
    return false;
  });
}

// Pronouns, prepositions, numbers ... are easy to get subtly wrong
const FUNCTION_POS = /^(pron|prep|conj|art|aux|num|int|interj)\./;

function checkSentence(s, word) {
  const errors = [];
  const words = s.split(/\s+/).filter(Boolean);
  if (words.length < 4 || words.length > 18) errors.push(`length ${words.length} words`);
  if (s.length > 140) errors.push("too long");
  if (!/^[A-Z0-9"'“]/.test(s)) errors.push("does not start with a capital");
  if (!/[.!?]["”']?$/.test(s)) errors.push("does not end like a sentence");
  if (/[.!?]\s+[A-Z]/.test(s.slice(0, -1))) errors.push("more than one sentence");
  if (/[^\x20-\x7E’“”—–]/.test(s)) errors.push("unexpected characters");
  if (PROFANITY.test(s)) errors.push("unsafe word");
  return { errors, hasForm: formRegex(word).test(s) };
}

function checkTranslation(t) {
  const errors = [];
  if (!/[一-鿿]/.test(t)) errors.push("no Chinese");
  if (t.length > 80) errors.push("translation too long");
  if (/[\r\n]/.test(t)) errors.push("translation has line breaks");
  if (/[A-Za-z]{4,}/.test(t)) errors.push("English left in translation");
  return { errors, traditional: TRADITIONAL.test(t) };
}

// content: the raw model text; items: the plan items sent, in order
// existing: Set of example sentences already used in the dictionary
function validateResponse(content, items, { existing = new Set(), finishReason = "stop" } = {}) {
  let data;
  try {
    data = JSON.parse(content);
  } catch {
    const why = finishReason === "length" ? "truncated (output limit)" : "not valid JSON";
    return { batchError: why, results: items.map((it) => ({ word: it.word, status: "invalid", errors: [why] })) };
  }
  const list = data && Array.isArray(data.items) ? data.items : null;
  if (!list) {
    return { batchError: "no items array", results: items.map((it) => ({ word: it.word, status: "invalid", errors: ["no items array"] })) };
  }

  const seen = new Set();
  const results = items.map((it, i) => {
    const got = list.find((x) => x && Number(x.id) === i + 1);
    if (!got) return { word: it.word, status: "invalid", errors: ["missing from the answer"] };
    const errors = [];
    const flags = [];
    if (String(got.word || "").toLowerCase() !== it.word.toLowerCase()) errors.push(`answered for "${got.word}"`);
    const sentence = typeof got.sentence === "string" ? got.sentence.trim() : "";
    const translation = typeof got.translation === "string" ? got.translation.trim() : "";
    if (!sentence) errors.push("no sentence");
    if (!translation) errors.push("no translation");
    if (sentence) {
      const c = checkSentence(sentence, it.word);
      errors.push(...c.errors);
      if (!c.hasForm) flags.push("word form not found (irregular form?)");
      if (sentence.split(/\s+/).filter(Boolean).length < 6) flags.push("short sentence: check it gives enough context");
      if (existing.has(sentence) || seen.has(sentence)) errors.push("duplicate sentence");
      seen.add(sentence);
    }
    if (translation) {
      const c = checkTranslation(translation);
      errors.push(...c.errors);
      if (c.traditional) flags.push("Traditional characters in translation");
      const keys = glossKeys(it.meaning);
      if (keys.length && !meaningVisible(translation, keys)) flags.push("core meaning not visible in translation: check the sense");
    }
    if (FUNCTION_POS.test(it.meaning || "")) flags.push("function word: check grammar and translation closely");
    if (got.meaning_ok === false) flags.push("model says the meaning may not be a common one");
    else if (got.meaning_ok !== true) flags.push("meaning_ok missing");

    const status = errors.length ? "invalid" : flags.length ? "needs_review" : "candidate";
    return { word: it.word, status, errors, flags, sentence, translation };
  });
  const extra = list.length - items.length;
  return { batchError: extra > 0 ? `${extra} extra items ignored` : "", results };
}

module.exports = { validateResponse, glossKeys, formRegex, checkSentence, checkTranslation, meaningVisible };
