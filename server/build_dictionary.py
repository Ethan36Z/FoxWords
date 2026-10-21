"""Build server/dictionary.json from ECDICT + Tatoeba.

Sources (not committed, see docs/STARTUP.md for download links):
  - ECDICT  ecdict.csv   https://github.com/skywind3000/ECDICT  (MIT)
      words, IPA phonetics, Chinese + English meanings, exam tags, frequency
  - Tatoeba cmn.txt      https://www.manythings.org/anki/cmn-eng.zip  (CC-BY 2.0 FR)
      human-translated English/Chinese sentence pairs, used as examples

Usage:
  python3 -I build_dictionary.py <ecdict.csv> <cmn.txt> [output.json] [max_words]
"""

import csv
import json
import re
import sys

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

MAX_MEANING_LINES = 4
WORD_RE = re.compile(r"[a-z]+(?:'[a-z]+)?")


def clean_lines(text, max_lines):
    """ECDICT stores line breaks as a literal backslash-n. Drop domain and web
    lines such as "[医] ..." or "[网络] ..." and keep the first few real ones."""
    lines = [ln.strip() for ln in text.replace("\\n", "\n").split("\n")]
    lines = [ln for ln in lines if ln and not ln.startswith("[")]
    return "\n".join(lines[:max_lines])


def normalize_ipa(text):
    """ECDICT uses ASCII ' and , for stress and a Cyrillic letter for schwa."""
    return (
        text.strip()
        .replace("'", "ˈ")
        .replace(",", "ˌ")
        .replace("\u04d9", "ə")  # Cyrillic schwa
    )


def word_forms(word, exchange):
    """The word plus its inflections from ECDICT's exchange field,
    e.g. "p:went/d:gone/i:going/3:goes"."""
    forms = {word}
    for part in exchange.split("/"):
        if ":" in part:
            kind, value = part.split(":", 1)
            # p past, d past participle, i -ing, 3 third person, s plural, r/t comparative
            if kind in "pdi3srt" and value.isalpha():
                forms.add(value.lower())
    return forms


def load_words(path):
    words = []
    with open(path, encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            word = (row["word"] or "").strip()
            if not (word.isalpha() and word.islower() and len(word) >= 2):
                continue
            # Skip inflected forms like "filmed" when ECDICT knows the base word
            # ("0:film" in exchange); the base word gets its own entry.
            exchange = row["exchange"] or ""
            lemma = next((p[2:] for p in exchange.split("/") if p.startswith("0:")), "")
            if lemma and lemma != word:
                continue
            tags = (row["tag"] or "").split()
            exam_tags = [t for t in tags if t in LEVEL_RANK]
            if not exam_tags:
                continue
            translation = clean_lines(row["translation"] or "", MAX_MEANING_LINES)
            if not translation:
                continue
            level_tag = min(exam_tags, key=LEVEL_RANK.get)
            frq = int(row["frq"] or 0)
            bnc = int(row["bnc"] or 0)
            words.append(
                {
                    "word": word,
                    "phonetic": normalize_ipa(row["phonetic"] or ""),
                    "translation": translation,
                    "definition": clean_lines(row["definition"] or "", MAX_MEANING_LINES),
                    "level": dict(LEVELS)[level_tag],
                    "tags": " ".join(exam_tags),
                    "_rank": LEVEL_RANK[level_tag],
                    # 0 means unknown frequency; sort those last
                    "_freq": frq or bnc or 10**9,
                    "_forms": word_forms(word, exchange),
                }
            )
    return words


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


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    ecdict_path, tatoeba_path = sys.argv[1], sys.argv[2]
    out_path = sys.argv[3] if len(sys.argv) > 3 else "dictionary.json"
    max_words = int(sys.argv[4]) if len(sys.argv) > 4 else 15000

    words = load_words(ecdict_path)
    # Easier exam level first, then more frequent words first
    words.sort(key=lambda w: (w["_rank"], w["_freq"]))
    words = words[:max_words]

    sentences = load_sentences(tatoeba_path)
    used = {}  # how often a sentence was already chosen, to spread examples out
    with_example = 0
    for w in words:
        candidates = []
        for form in w["_forms"]:
            candidates.extend(sentences.get(form, [])[:20])
        candidates.sort(key=lambda c: (used.get(c[1], 0), c[0]))
        if candidates:
            _, en, zh = candidates[0]
            used[en] = used.get(en, 0) + 1
            w["example"], w["exampleZh"] = en, zh
            with_example += 1
        else:
            w["example"], w["exampleZh"] = "", ""

    out = [{k: v for k, v in w.items() if not k.startswith("_")} for w in words]
    out.sort(key=lambda w: w["word"])
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    levels = {}
    for w in out:
        levels[w["level"]] = levels.get(w["level"], 0) + 1
    print(f"words: {len(out)}  with example: {with_example}  with phonetic: "
          f"{sum(1 for w in out if w['phonetic'])}")
    print("by level:", levels)
    print("wrote", out_path)


if __name__ == "__main__":
    main()
