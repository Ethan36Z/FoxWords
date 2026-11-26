"""Build server/lookup.json: word forms and a lookup-only word list from ECDICT.

FoxWords Lens looks words up in captured text. The study dictionary
(dictionary.json, about 13,000 words) is a learning list, so Lens also needs:
  - forms: inflections mapped to their lemma (drove -> drive, caught -> catch,
    children -> child), from ECDICT's exchange field, for every lemma in the
    study dictionary or the lookup list;
  - words: common words that are not in the study dictionary, with phonetic
    and meaning, for lookup only. They are never part of the study plan.

Usage:
  python3 -I build_lookup.py <ecdict.csv> [dictionary.json] [lookup.json]

Lookup words: lowercase single words with a meaning of their own (not only
"X的过去式"), not a name or abbreviation, with frequency evidence (a COCA or
BNC rank, a Collins star, the Oxford core flag or an exam tag).

Each form says whether its lemma should be shown first. When the form is
also a word of its own (felt n. 毛毯, ground n. 地面), the more frequent one
(COCA/BNC rank) comes first and the other is shown as "also".
"""

import json
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_dictionary as bd  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
FORM_KINDS = "pdi3srt"  # past, past participle, -ing, 3rd person, plural, -er, -est
MEANING_MAX = 60


def word_rank(row):
    """Smaller is more frequent; 10**9 without any rank."""
    ranks = [r for r in (bd.rank(row.get("frq")), bd.rank(row.get("bnc"))) if r]
    return min(ranks) if ranks else 10 ** 9


def has_evidence(row):
    return bool(bd.rank(row.get("frq")) or bd.rank(row.get("bnc")) or bd.rank(row.get("collins"))
                or row.get("oxford") == "1" or (row.get("tag") or "").strip())


def lookup_entry(word, row):
    """[word, phonetic, meaning, translation, definition] or None."""
    if not (word.isalpha() and word.islower() and len(word) >= 2):
        return None
    if not bd.re.search(r"[aeiouy]", word) or not has_evidence(row):
        return None
    lex = bd.lexical_lines(row["translation"], word)
    if not lex or bd.NAME_RE.search(lex[0]):
        return None
    if {bd.pos_of(ln) for ln in lex} <= {"abbr"}:
        return None
    translation = "\n".join(lex)
    meaning = lex[0] if len(lex[0]) <= MEANING_MAX else lex[0][:MEANING_MAX].rsplit(",", 1)[0]
    return [word, bd.normalize_ipa(row.get("phonetic")), meaning, translation, bd.clean_definition(row.get("definition"))]


def build(ecdict_path, dictionary_path, out_path):
    rows = bd.load_rows(ecdict_path)
    study = {e["word"].lower() for e in json.load(open(dictionary_path, encoding="utf-8"))}

    words = []
    for word, row in rows.items():
        if word in study:
            continue
        e = lookup_entry(word, row)
        if e:
            words.append(e)
    words.sort()
    known = study | {e[0] for e in words}

    kinds = defaultdict(set)
    for lemma in known:
        row = rows.get(lemma)
        if not row:
            continue
        for kind, form in bd.exchange_parts(row).items():
            form = form.lower()
            if kind in FORM_KINDS and form.isalpha() and form != lemma:
                kinds[(form, lemma)].add(kind)

    forms = []
    for (form, lemma), ks in sorted(kinds.items()):
        lemma_first = True
        if form in known and form in rows:  # a word of its own too
            lemma_first = word_rank(rows[lemma]) <= word_rank(rows[form])
        forms.append([form, lemma, "".join(k for k in FORM_KINDS if k in ks), 1 if lemma_first else 0])

    out = {
        "version": 1,
        "source": "ECDICT (MIT), https://github.com/skywind3000/ECDICT",
        "ecdict_sha256": bd.sha256(ecdict_path),
        "fields": {"words": ["word", "phonetic", "meaning", "translation", "definition"],
                   "forms": ["form", "lemma", "kinds", "lemmaFirst"]},
        "words": words,
        "forms": forms,
    }
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    return len(words), len(forms)


def main(argv):
    if not argv:
        print(__doc__)
        return 2
    ecdict = argv[0]
    dictionary = argv[1] if len(argv) > 1 else os.path.join(HERE, "dictionary.json")
    out = argv[2] if len(argv) > 2 else os.path.join(HERE, "lookup.json")
    n_words, n_forms = build(ecdict, dictionary, out)
    print(f"lookup words: {n_words}, forms: {n_forms}, {os.path.getsize(out) // 1024} KB -> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
