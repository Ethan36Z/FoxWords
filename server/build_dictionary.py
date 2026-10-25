"""Build server/dictionary.json from ECDICT + Tatoeba.

Sources (not committed, see docs/STARTUP.md for download links):
  - ECDICT  ecdict.csv   https://github.com/skywind3000/ECDICT  (MIT)
      words, IPA phonetics, Chinese + English meanings, exam tags, frequency
  - Tatoeba cmn.txt      https://www.manythings.org/anki/cmn-eng.zip  (CC-BY 2.0 FR)
      human-translated English/Chinese sentence pairs, used as examples

Also used (see docs/DICTIONARY.md):
  - CMUdict cmudict.dict  https://github.com/cmusphinx/cmudict  (BSD-2-Clause)
      General American pronunciation
  - WordNet 3.0 index.sense  https://wordnet.princeton.edu/  (WordNet licence)
      SemCor usage counts per part of speech, for the core meaning

Usage:
  python3 -I build_dictionary.py <ecdict.csv> <cmn.txt | -> [output.json] [max_words]
      [--previous dictionary.json] [--overrides dictionary_overrides.json]
      [--report dictionary.build.json] [--cmudict cmudict.dict] [--wordnet index.sense]

  --previous   keep the example sentence of every word that already had one
               there, so a rebuild does not reshuffle examples learners know.
               With "-" instead of cmn.txt, new words simply get no example.
  --overrides  versioned manual corrections applied after the rules
               (default: dictionary_overrides.json next to this script).
  --report     where to write the build record (sources, counts, changes).

Which words are included (see docs/DICTIONARY.md for the reasoning):
  1. Lemmas with an exam tag (中考 ... 托福), as before.
  2. Lemmas that are frequent or marked as core vocabulary even without an
     exam tag: COCA rank <= FREQ_RANK_LIMIT, Oxford core flag, Collins >= 3
     stars, or BNC rank <= FREQ_RANK_LIMIT with at least one Collins star.
  3. Forms that ECDICT links to another word but that are words in their own
     right (meeting n., interested a., bacteria pl.), under the same
     importance test. Plain plurals, verb forms and regular comparatives of
     an included word stay out.
  Names, abbreviations, filler interjections and new spelling variants of an
  included word are left out. Overrides can add or remove single words.
"""

import csv
import hashlib
import json
import os
import re
import sys
from collections import Counter

# python3 -I leaves the script's own folder off sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import meanings  # noqa: E402
import pronunciation as pron  # noqa: E402

# Exam tags from easiest to hardest, with the label shown in the app
LEVELS = [
    ("zk", "中考"),
    ("gk", "高考"),
    ("cet4", "四级"),
    ("cet6", "六级"),
    ("ky", "考研"),
    ("ielts", "雅思"),
    ("toefl", "托福"),
]
LEVEL_RANK = {tag: i for i, (tag, _) in enumerate(LEVELS)}

FREQ_RANK_LIMIT = 10000
MAX_DEFINITION_LINES = 4
WORD_RE = re.compile(r"[a-z]+(?:'[a-z]+)?")

POS_RE = re.compile(
    r"^(n|v|vt|vi|a|adj|ad|adv|prep|conj|pron|int|interj|num|art|aux|abbr|pl|pref|suf)\.\s*"
)
# "...（amenity的复数）" inside a line, or a line that is only "crow的过去式"
POINTER_PAREN_RE = re.compile(
    r"[（(][^（）()]*的(过去式|过去分词|现在分词|复数|第三人称单数|第三人称|比较级|最高级)[^（）()]*[）)]"
)
POINTER_LINE_RE = re.compile(r"^\S+的(过去式|过去分词|现在分词|复数|第三人称|比较级|最高级)")
# Name entries: "约翰（男子名）", "史密斯（姓）", "[人名] 坎斯". Plain words such
# as 匿名, 姓氏不明 must not match.
NAME_RE = re.compile(r"男子名|女子名|男名|女名|\[(人名|地名)\]|[（(](人名|姓氏|姓|地名)[）)]")
# WordNet letters used in ECDICT definitions -> translation-style label
WORDNET_POS = {"n": "n.", "v": "v.", "a": "a.", "s": "a.", "r": "adv."}
VERB_POS = {"v", "vt", "vi"}


# ---------------------------------------------------------------- text helpers

def strip_controls(text):
    return re.sub(r"[\r\t\x00-\x08\x0b\x0c\x0e-\x1f]", "", text or "")


def split_lines(text):
    """ECDICT stores line breaks as a literal backslash-n."""
    lines = strip_controls(text).replace("\\r", "").replace("\\n", "\n").split("\n")
    return [ln.strip() for ln in lines if ln.strip()]


def pos_of(line):
    m = POS_RE.match(line)
    return m.group(1) if m else ""


def general_lines(text):
    """Lines without a "[医]", "[网络]" ... domain label."""
    return [ln for ln in split_lines(text) if not ln.startswith("[")]


def lexical_lines(text, word):
    """General lines that carry a meaning of their own: drop lines that only
    say "X的过去式" and remove "(X的复数)" notes."""
    out = []
    for ln in general_lines(text):
        body = POS_RE.sub("", ln)
        if POINTER_LINE_RE.match(body) and not body.startswith(word + "的"):
            continue
        cleaned = POINTER_PAREN_RE.sub("", ln).strip()
        if POS_RE.sub("", cleaned).strip():
            out.append(ln)
    return out


def clean_translation(row, word):
    """Every general meaning line (one per part of speech; no line limit, so a
    part of speech is never lost). Lines that only point to another word's
    inflection are dropped. Entries with only domain lines keep those lines
    without the label, with a part of speech when the English definition
    has exactly one."""
    lines = [ln for ln in general_lines(row["translation"])
             if not (POINTER_LINE_RE.match(POS_RE.sub("", ln)) and not POS_RE.sub("", ln).startswith(word + "的"))]
    if lines:
        return "\n".join(lines)
    domain = [re.sub(r"^\[[^\]]+\]\s*", "", ln) for ln in split_lines(row["translation"])]
    domain = [ln for ln in domain if ln]
    if not domain:
        return ""
    wn = {pos_of(ln) or (ln.split(" ", 1)[0].rstrip(".")) for ln in split_lines(row["definition"])}
    wn = {WORDNET_POS[p] for p in wn if p in WORDNET_POS}
    label = (next(iter(wn)) + " ") if len(wn) == 1 else ""
    return "\n".join(label + ln if not pos_of(ln) else ln for ln in domain)


def clean_definition(text):
    lines = [ln for ln in split_lines(text) if not ln.startswith("[")]
    return "\n".join(lines[:MAX_DEFINITION_LINES])


def normalize_ipa(text):
    """Turn ECDICT's ASCII-style phonetics into IPA characters without
    changing the transcription itself:
      ' -> ˈ, , -> ˌ, . -> ˌ (stress), ". " between variants -> "; ",
      : -> ː, ɒ: -> ɔː (ECDICT writes the /ɔː/ vowel as ɒ:),
      Cyrillic/Greek look-alikes -> e and ə,
      known encoding damage: runs of backslashes before ':' were "ə",
      '^' was "ɡ" (and "əj" in the same entries was "əu"), "(?@)" is noise."""
    t = strip_controls(text).strip()
    if not t:
        return ""
    if "^" in t:
        t = t.replace("^", "ɡ").replace("əj", "əu")
    t = re.sub(r"\\+:", "ə:", t)
    t = t.replace("(?@)", "")
    # ", " between two transcriptions separates variants; a leading or
    # attached comma marks secondary stress.
    t = re.sub(r"^,\s*", "ˌ", t)
    t = re.sub(r",\s+", "; ", t)
    t = t.replace("'", "ˈ").replace(",", "ˌ")
    t = re.sub(r"\.\s+", "; ", t)
    t = t.replace(".", "ˌ")
    t = t.replace(":", "ː").replace("ɒː", "ɔː")
    t = t.replace("є", "e").replace("ε", "e").replace("ә", "ə")
    t = re.sub(r"ˌ\s+", "ˌ", t)
    t = re.sub(r"\s*;\s*", "; ", t)
    return re.sub(r"\s{2,}", " ", t).strip(" ;")


# ---------------------------------------------------------------- word forms

def exchange_parts(row):
    parts = {}
    for p in (row.get("exchange") or "").split("/"):
        if ":" in p:
            k, v = p.split(":", 1)
            parts[k] = v
    return parts


def word_forms(word, row):
    """The word plus its inflections, e.g. "p:went/d:gone/i:going/3:goes"."""
    forms = {word.lower()}
    for kind, value in exchange_parts(row).items():
        # p past, d past participle, i -ing, 3 third person, s plural, r/t comparative
        if kind in ("p", "d", "i", "3", "s", "r", "t") and value.isalpha():
            forms.add(value.lower())
    return forms


def form_info(word, row):
    """(base, types) when ECDICT links this word to another lemma ("0:base"),
    else None. A word with inflections of its own (number -> numbers) is a
    lemma even if it also looks like a form (numb -> number)."""
    parts = exchange_parts(row)
    base = parts.get("0", "")
    if not base or base == word:
        return None
    if any(parts.get(k, word) != word for k in ("p", "d", "i", "3", "s")):
        return None
    return base, parts.get("1", "")


def is_regular_comparative(word, base):
    if not base:
        return False
    stems = {base, base[:-1] if base.endswith("e") else base,
             base[:-1] + "i" if base.endswith("y") else base, base + base[-1]}
    return any(word in (s + "er", s + "est", s + "r", s + "st") for s in stems)


SPELLING_SWAPS = [
    ("our", "or"), ("tre", "ter"), ("isation", "ization"), ("ise", "ize"),
    ("yse", "yze"), ("ogue", "og"), ("ence", "ense"), ("ae", "e"), ("oe", "e"),
    ("ll", "l"), ("mme", "m"),
]


def spelling_variants(word):
    """Candidate British/American spellings (colour/color, skilful/skillful).
    Never at the start of the word; callers also require a shared meaning,
    so look-alikes such as shoe/she are not treated as variants."""
    out = set()
    for a, b in SPELLING_SWAPS:
        for x, y in ((a, b), (b, a)):
            i = word.find(x, 1)
            while i != -1:
                out.add(word[:i] + y + word[i + len(x):])
                i = word.find(x, i + 1)
    out.discard(word)
    return out


# ---------------------------------------------------------------- inclusion

def exam_tags(row):
    return [t for t in (row.get("tag") or "").split() if t in LEVEL_RANK]


def rank(value):
    try:
        n = int(value or 0)
    except ValueError:
        return 0
    return n if n > 0 else 0


def importance(row):
    """Why a word is worth learning, or "" when there is no evidence."""
    if exam_tags(row):
        return "exam"
    if row.get("oxford") == "1" or rank(row.get("collins")) >= 3:
        return "core"
    frq, bnc = rank(row.get("frq")), rank(row.get("bnc"))
    if frq and frq <= FREQ_RANK_LIMIT:
        return "frequency"
    if bnc and bnc <= FREQ_RANK_LIMIT and rank(row.get("collins")) >= 1:
        return "frequency"
    return ""


def old_rule(word, row):
    """The selection used up to Phase 3A, kept so that no word that was
    already in the dictionary can drop out because of the new rules."""
    if not (word.isalpha() and word.islower() and len(word) >= 2):
        return False
    parts = exchange_parts(row)
    lemma = parts.get("0", "")
    if lemma and lemma != word:
        return False
    if not exam_tags(row):
        return False
    return bool(general_lines(row["translation"]))


def candidate(word, row):
    """First pass. Returns (reason, form) for words that may be included."""
    if old_rule(word, row):
        return "existing", None
    if not (word.isalpha() and word.islower() and len(word) >= 2):
        return None
    why = importance(row)
    if not why:
        return None
    lex = lexical_lines(row["translation"], word)
    domain_only = not general_lines(row["translation"])
    if domain_only:
        # Exam tags alone are not enough here: they also mark fragments
        # such as "attent" or names such as "cance".
        if why == "exam" and not (row.get("oxford") == "1" or rank(row.get("collins")) >= 3
                                  or 0 < rank(row.get("frq")) <= FREQ_RANK_LIMIT):
            return None
        if any(NAME_RE.search(ln) for ln in split_lines(row["translation"])):
            return None
    elif not lex:
        return None
    if lex and NAME_RE.search(lex[0]):
        return None
    if not re.search(r"[aeiouy]", word):
        return None  # km, mph, plc
    poses = {pos_of(ln) for ln in lex}
    if lex and poses <= {"abbr"}:
        return None
    if lex and poses <= {"int", "interj"} and not (row.get("oxford") == "1" or rank(row.get("collins")) >= 3):
        return None  # uh, um, hmm
    form = form_info(word, row)
    if form:
        base, types = form
        if set(types) <= set("s3"):
            return why + "+form", ("plural", base)
        if set(types) <= set("rt"):
            if is_regular_comparative(word, base) and not (row.get("oxford") == "1" or rank(row.get("collins")) >= 3):
                return None
            return why + "+form", ("comparative", base)
        if not [ln for ln in lex if pos_of(ln) not in VERB_POS]:
            return None  # only verb meanings: a plain past form or participle
        return why + "+form", ("participle", base)
    return why, None


def select_words(rows, overrides):
    include = {o["word"]: o for o in overrides.get("include", [])}
    exclude = {o["word"]: o for o in overrides.get("exclude", [])}
    picked = {}
    for word, row in rows.items():
        if word in exclude:
            continue
        c = candidate(word, row)
        if word in include:
            c = ("override", None)
        if c:
            picked[word] = c

    def core_or_old(w):
        r = rows[w]
        return picked[w][0] == "existing" or r.get("oxford") == "1" or rank(r.get("collins")) >= 3

    def freq(w):
        return rank(rows[w].get("frq")) or rank(rows[w].get("bnc")) or 10**9

    # Second pass: plurals of an included word, and new spelling variants.
    # Words kept by the old rule or by an override are never removed here.
    for word in sorted(picked):
        reason, form = picked[word]
        if reason in ("existing", "override"):
            continue
        if form and form[0] == "plural" and form[1] in picked and not core_or_old(word):
            del picked[word]
            continue
        for v in spelling_variants(word):
            if v in picked and same_meaning(rows[word], rows[v]) and (
                picked[v][0] in ("existing", "override") or freq(v) <= freq(word)
            ):
                del picked[word]
                break
    return picked


def glosses(row):
    """Chinese glosses of a row: "n. 颜色, 肤色" -> {"颜色", "肤色"}."""
    out = set()
    for ln in split_lines(row["translation"]):
        for g in re.split(r"[,，;；/]", POS_RE.sub("", re.sub(r"^\[[^\]]+\]\s*", "", ln))):
            g = re.sub(r"[（(][^）)]*[）)]", "", g).strip()
            if g:
                out.add(g)
    return out


def same_meaning(row_a, row_b):
    return bool(glosses(row_a) & glosses(row_b))


# ---------------------------------------------------------------- examples

def is_simplified(text):
    """Tatoeba mixes Simplified and Traditional Chinese. Simplified characters
    are (almost) all in GB2312 and most Traditional ones are not."""
    try:
        text.encode("gb2312")
        return True
    except UnicodeEncodeError:
        return False


def load_sentences(path):
    """Return {english_word: [(score, en, zh), ...]} for sentences of a good
    teaching length (5-14 words) that have a Simplified Chinese translation."""
    pairs = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 2:
                continue
            en, zh = parts[0].strip(), parts[1].strip()
            if en not in pairs and is_simplified(zh):
                pairs[en] = zh

    index = {}
    for en, zh in pairs.items():
        tokens = WORD_RE.findall(en.lower())
        if not 5 <= len(tokens) <= 14:
            continue
        # Prefer sentences close to 8 words
        score = abs(len(tokens) - 8)
        for tok in set(tokens):
            index.setdefault(tok, []).append((score, en, zh))
    for items in index.values():
        items.sort(key=lambda x: x[0])
    return index


# ---------------------------------------------------------------- build

def load_rows(path):
    rows = {}
    with open(path, encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            rows.setdefault((row["word"] or "").strip(), row)
    rows.pop("", None)
    return rows


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def apply_translation_overrides(entries, rows, overrides, problems):
    """Field fixes applied before core meanings are chosen."""
    by_word = {e["word"]: e for e in entries}
    for fix in overrides.get("translation_keep_lines", []):
        e = by_word.get(fix["word"])
        if not e:
            problems.append(f"translation override for missing word {fix['word']}")
            continue
        src = split_lines(rows[fix["word"]]["translation"])
        if src != fix["source_lines"]:
            problems.append(f"translation override for {fix['word']} not applied: source changed")
            continue
        e["translation"] = "\n".join(src[i] for i in fix["keep"])
    for fix in overrides.get("meaning", []):
        e = by_word.get(fix["word"])
        if not e:
            problems.append(f"meaning override for missing word {fix['word']}")
            continue
        if fix.get("translation"):
            if not fix.get("sources"):
                problems.append(f"meaning override for {fix['word']} replaces the translation without sources")
                continue
            e["translation"] = "\n".join(fix["translation"])
    for fix in overrides.get("phonetic", []):
        e = by_word.get(fix["word"])
        if not e:
            problems.append(f"phonetic override for missing word {fix['word']}")
        elif e["phoneticUk"] != fix["from"]:
            # The source changed since the fix was written: review by hand.
            problems.append(f"phonetic override for {fix['word']} not applied: source is {e['phoneticUk']!r}")
        else:
            e["phoneticUk"] = fix["to"]
    for o in overrides.get("include", []):
        if o["word"] not in by_word:
            problems.append(f"include override {o['word']} not in ECDICT")


def meaning_override(fix, translation, problems):
    """An override may only pick glosses that the entry already has, unless
    it cites sources (and then replaced the translation above)."""
    if not fix:
        return None
    if not fix.get("sources"):
        missing = [g for g in fix.get("glosses", []) if g not in translation]
        if missing:
            problems.append(f"meaning override for {fix['word']} uses glosses not in its meanings: {missing}")
            return None
    return fix


def pronunciation_override(fix, cmu, group, problems):
    """Heteronyms whose vowel depends on the part of speech (live v./a.).
    Values must be one of CMUdict's own variants."""
    if not fix:
        return None
    if fix.get("ipa"):
        # A correction of CMUdict itself must say what it is based on
        if not fix.get("sources"):
            problems.append(f"pronunciation override for {fix['word']} has an IPA value but no sources")
            return None
        return fix["ipa"]
    allowed = {pron.to_ipa(v) for v in cmu.get(fix["word"].lower(), [])}
    bad = [v for v in fix["by_group"].values() if v not in allowed]
    if bad:
        problems.append(f"pronunciation override for {fix['word']} not in CMUdict: {bad}")
        return None
    return fix["by_group"].get(group) or next(iter(fix["by_group"].values()))


def load_tatoeba_pairs(path):
    pairs = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            parts = line.rstrip("\n").split("\t")
            if len(parts) >= 2 and is_simplified(parts[1].strip()):
                pairs.append((parts[0].strip(), parts[1].strip()))
    return pairs


def build(ecdict_path, tatoeba_path, out_path, max_words=None, previous_path=None,
          overrides_path=None, report_path=None, cmudict_path=None, wordnet_path=None):
    rows = load_rows(ecdict_path)
    overrides = {}
    if overrides_path and os.path.exists(overrides_path):
        with open(overrides_path, encoding="utf-8") as f:
            overrides = json.load(f)
    picked = select_words(rows, overrides)

    entries = []
    for word, (reason, _form) in picked.items():
        row = rows[word]
        tags = exam_tags(row)
        level_tag = min(tags, key=LEVEL_RANK.get) if tags else ""
        entries.append({
            "word": word,
            "phoneticUk": normalize_ipa(row["phonetic"] or ""),
            "translation": clean_translation(row, word),
            "level": dict(LEVELS).get(level_tag, ""),
            "tags": " ".join(tags),
            "_reason": reason,
            "_rank": LEVEL_RANK.get(level_tag, len(LEVELS)),
            "_freq": rank(row.get("frq")) or rank(row.get("bnc")) or 10**9,
            "_forms": word_forms(word, row),
        })
    entries = [e for e in entries if e["translation"]]
    # Easier exam level first, then more frequent words first
    entries.sort(key=lambda e: (e["_rank"], e["_freq"]))
    if max_words:
        entries = entries[:max_words]

    problems = []
    apply_translation_overrides(entries, rows, overrides, problems)

    use_tatoeba = bool(tatoeba_path and tatoeba_path != "-")
    pairs = load_tatoeba_pairs(tatoeba_path) if use_tatoeba else []
    tatoeba = meanings.TatoebaIndex(pairs, WORD_RE)
    wn_counts = meanings.load_wordnet_counts(wordnet_path) if wordnet_path else {}
    cmu = pron.load_cmudict(cmudict_path) if cmudict_path else {}
    meaning_fixes = {o["word"]: o for o in overrides.get("meaning", [])}
    pron_fixes = {o["word"]: o for o in overrides.get("pronunciation", [])}
    labels = {o["word"]: o for o in overrides.get("labels", [])}

    known = {e["word"].lower() for e in entries}
    for e in entries:
        word, row = e["word"], rows[e["word"]]
        lines = e["translation"].split("\n")
        fix = meaning_override(meaning_fixes.get(word), e["translation"], problems)
        res = meanings.choose(word, lines, wn_counts, tatoeba.sentences(e["_forms"]), fix)
        e["meaning"] = res["meaning"]
        e["meaningSource"] = res["source"]
        e["_group"] = res["group"]
        e["_core_keys"] = {meanings.gloss_key(g) for g in res["meaning"].split(". ", 1)[-1].split(", ")}
        # Core line first; the other lines keep ECDICT order
        i = res["line_index"]
        e["translation"] = "\n".join([lines[i]] + lines[:i] + lines[i + 1:])
        defs = [ln for ln in split_lines(row["definition"] or "") if not ln.startswith("[")]
        e["definition"] = "\n".join(meanings.order_definitions(defs, res["group"], MAX_DEFINITION_LINES))

        ipa = pronunciation_override(pron_fixes.get(word), cmu, res["group"], problems)
        source = "override" if ipa else ""
        if not ipa and cmu:
            ipa, source = pron.lookup(word, cmu, spelling_variants, res["group"], e["phoneticUk"], known)
        if not ipa and e["phoneticUk"]:
            ipa, source = e["phoneticUk"], "ecdict-uk"
        e["phonetic"], e["phoneticSource"] = ipa, source
        e["labels"] = " ".join(labels[word]["labels"]) if word in labels else ""
    for w in labels:
        if w not in {e["word"] for e in entries}:
            problems.append(f"label override for missing word {w}")

    previous = {}
    if previous_path:
        with open(previous_path, encoding="utf-8") as f:
            previous = {e["word"]: e for e in json.load(f)}

    sentences = load_sentences(tatoeba_path) if use_tatoeba else {}
    used = {}  # how often a sentence was already chosen, to spread examples out
    kept = 0
    for e in entries:
        old = previous.get(e["word"])
        if old and old.get("example") and e["_forms"] & set(WORD_RE.findall(old["example"].lower())):
            e["example"], e["exampleZh"] = old["example"], old.get("exampleZh", "")
            used[e["example"]] = used.get(e["example"], 0) + 1
            kept += 1
    for e in entries:
        if e.get("example"):
            continue
        candidates = []
        for form in sorted(e["_forms"]):  # sorted: set order differs between runs
            candidates.extend(sentences.get(form, [])[:20])
        # Prefer a sentence whose translation uses the core meaning; the
        # sentence text breaks ties so every rebuild picks the same one
        candidates.sort(key=lambda c: (not any(k and k in c[2] for k in e["_core_keys"]),
                                       used.get(c[1], 0), c[0], c[1]))
        if candidates:
            _, en, zh = candidates[0]
            used[en] = used.get(en, 0) + 1
            e["example"], e["exampleZh"] = en, zh
        else:
            e["example"], e["exampleZh"] = "", ""

    count = lambda key: dict(sorted(Counter(e[key] for e in entries).items(), key=lambda kv: -kv[1]))
    reasons = count("_reason")
    fields = ["word", "phonetic", "phoneticUk", "meaning", "translation", "definition", "level", "tags",
              "labels", "example", "exampleZh", "meaningSource", "phoneticSource"]
    out = [{k: e[k] for k in fields} for e in entries]
    out.sort(key=lambda w: (w["word"].lower(), w["word"]))
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    record = {
        "sources": {
            "ecdict_sha256": sha256(ecdict_path),
            "tatoeba_sha256": sha256(tatoeba_path) if use_tatoeba else None,
            "cmudict_sha256": sha256(cmudict_path) if cmudict_path else None,
            "wordnet_index_sense_sha256": sha256(wordnet_path) if wordnet_path else None,
            "previous_sha256": sha256(previous_path) if previous_path else None,
        },
        "overrides_version": overrides.get("version"),
        "freq_rank_limit": FREQ_RANK_LIMIT,
        "words": len(out),
        "with_example": sum(1 for w in out if w["example"]),
        "examples_kept_from_previous": kept,
        "with_phonetic": sum(1 for w in out if w["phonetic"]),
        "by_reason": reasons,
        "meaning_source": count("meaningSource"),
        "phonetic_source": count("phoneticSource"),
        "labelled": {w: labels[w]["labels"] for w in sorted(labels) if w in {e["word"] for e in entries}},
        "problems": problems,
    }
    if previous:
        now = {w["word"] for w in out}
        record["added"] = sorted(now - previous.keys(), key=str.lower)
        record["removed"] = sorted(previous.keys() - now, key=str.lower)
    if report_path:
        with open(report_path, "w", encoding="utf-8") as f:
            json.dump(record, f, ensure_ascii=False, indent=1)
            f.write("\n")
    return record


def main(argv):
    flags = {"--previous": None, "--overrides": None, "--report": None, "--cmudict": None, "--wordnet": None}
    positional = []
    i = 0
    while i < len(argv):
        if argv[i] in flags and i + 1 < len(argv):
            flags[argv[i]] = argv[i + 1]
            i += 2
        else:
            positional.append(argv[i])
            i += 1
    if len(positional) < 2:
        print(__doc__)
        sys.exit(1)
    ecdict_path, tatoeba_path = positional[0], positional[1]
    out_path = positional[2] if len(positional) > 2 else "dictionary.json"
    max_words = int(positional[3]) if len(positional) > 3 else None
    overrides_path = flags["--overrides"] or os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                                          "dictionary_overrides.json")
    record = build(ecdict_path, tatoeba_path, out_path, max_words, flags["--previous"],
                   overrides_path, flags["--report"], flags["--cmudict"], flags["--wordnet"])
    print(f"words: {record['words']}  with example: {record['with_example']} "
          f"(kept {record['examples_kept_from_previous']})  with phonetic: {record['with_phonetic']}")
    print("by reason:", record["by_reason"])
    print("meaning source:", record["meaning_source"])
    print("phonetic source:", record["phonetic_source"])
    if "added" in record:
        print(f"added {len(record['added'])}, removed {len(record['removed'])}: {record['removed']}")
    for p in record["problems"]:
        print("PROBLEM:", p)
    print("wrote", out_path)


if __name__ == "__main__":
    main(sys.argv[1:])
