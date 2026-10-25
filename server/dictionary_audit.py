"""Read-only dictionary audit: frequency coverage and before/after comparison.

Usage:
  python3 -I dictionary_audit.py <ecdict.csv> <dictionary.json> [<older dictionary.json>]

Counting method (used for every coverage number in the docs):
  * Reference list: ECDICT's `frq` column, a word-form frequency rank from the
    Corpus of Contemporary American English (COCA). `bnc` (British National
    Corpus) is reported the same way. A band "top N" is every ECDICT headword
    with 0 < rank <= N. Ranks count word forms, so one band mixes lemmas,
    inflected forms, capitalised words and multi-word entries.
  * Each headword in a band falls into exactly one class:
      lemma      lowercase single word that is not a form of another word
                 (or has inflections of its own, e.g. number)
      form       lowercase single word that ECDICT links to another lemma
                 ("0:base"), e.g. meetings, cheaper, accelerated
      capital    contains an upper-case letter (I, TV, English, Monday)
      other      multi-word, hyphen, apostrophe or digits
  * "Lemma coverage" = lemmas in the band that are in the dictionary.
    "Form reach" = forms whose own entry or whose base lemma is in the
    dictionary (a learner meets them through the base word).
  * Nothing is a word family here: families (abandon, abandonment,
    abandoned ...) would need a separate family list.
"""

import json
import os
import sys
from collections import Counter

# python3 -I leaves the script's own folder off sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_dictionary as b  # noqa: E402

BANDS = (1000, 2000, 3000, 5000, 8000, 10000, 15000, 20000)


def classify(word, row):
    if not word.isalpha():
        return "other"
    if not word.islower():
        return "capital"
    return "form" if b.form_info(word, row) else "lemma"


def coverage(rows, words, key="frq"):
    ranked = sorted((b.rank(r.get(key)), w) for w, r in rows.items() if b.rank(r.get(key)))
    out = []
    for top in BANDS:
        band = [(w, rows[w]) for k, w in ranked if k <= top]
        cls = Counter(classify(w, r) for w, r in band)
        lemmas = [w for w, r in band if classify(w, r) == "lemma"]
        forms = [(w, r) for w, r in band if classify(w, r) == "form"]
        caps = [w for w, r in band if classify(w, r) == "capital"]
        out.append({
            "top": top,
            "headwords": len(band),
            "classes": dict(cls),
            "lemmas_covered": sum(1 for w in lemmas if w in words),
            "lemma_coverage": round(100 * sum(1 for w in lemmas if w in words) / max(1, len(lemmas)), 1),
            "forms_reached": sum(1 for w, r in forms if w in words or b.form_info(w, r)[0] in words),
            "capitals_covered": sum(1 for w in caps if w in words),
            "headwords_in_dictionary": sum(1 for w, r in band if w in words),
        })
    return out


def missing_lemmas(rows, words, top=10000, key="frq"):
    return sorted(
        (b.rank(r.get(key)), w) for w, r in rows.items()
        if 0 < b.rank(r.get(key)) <= top and classify(w, r) == "lemma" and w not in words
    )


def phonetic_change_kind(old, new):
    kinds = set()
    if ":" in old and "ː" in new:
        kinds.add("length mark")
    if "ɒ:" in old:
        kinds.add("ɒ: to ɔː")
    if "є" in old or "ε" in old:
        kinds.add("Cyrillic/Greek e")
    if "." in old:
        kinds.add("dot stress/separator")
    if "\\" in old or "^" in old or "?@" in old:
        kinds.add("encoding damage")
    return kinds or {"other"}


def compare(old_entries, new_entries):
    old = {e["word"]: e for e in old_entries}
    new = {e["word"]: e for e in new_entries}
    common = old.keys() & new.keys()
    res = {
        "old_words": len(old),
        "new_words": len(new),
        "added": len(new.keys() - old.keys()),
        "removed": sorted(old.keys() - new.keys()),
    }
    ph = Counter()
    for w in common:
        if old[w]["phonetic"] != new[w]["phonetic"]:
            for k in phonetic_change_kind(old[w]["phonetic"], new[w]["phonetic"]):
                ph[k] += 1
    res["phonetic_changed"] = sum(1 for w in common if old[w]["phonetic"] != new[w]["phonetic"])
    res["phonetic_change_kinds"] = dict(ph)
    res["phonetic_lost"] = sorted(w for w in common if old[w]["phonetic"] and not new[w]["phonetic"])

    tr = Counter()
    tr_examples = {}
    for w in common:
        o, n = old[w]["translation"].split("\n"), new[w]["translation"].split("\n")
        if o == n:
            continue
        if n[: len(o)] == o:
            kind = "lines added (was cut at 4)"
        elif set(n) < set(o) and all(b.POINTER_LINE_RE.match(b.POS_RE.sub("", ln)) for ln in set(o) - set(n)):
            kind = "pointer line to another word removed"
        else:
            kind = "other"
        tr[kind] += 1
        tr_examples.setdefault(kind, []).append(w)
    res["translation_changes"] = dict(tr)
    res["translation_change_examples"] = {k: v[:15] for k, v in tr_examples.items()}
    res["definition_changed"] = sorted(w for w in common if old[w]["definition"] != new[w]["definition"])
    res["example_changed"] = sorted(
        w for w in common if (old[w]["example"], old[w]["exampleZh"]) != (new[w]["example"], new[w]["exampleZh"])
    )
    res["level_or_tags_changed"] = sorted(
        w for w in common if (old[w]["level"], old[w]["tags"]) != (new[w]["level"], new[w]["tags"])
    )
    return res


def main(argv):
    rows = b.load_rows(argv[0])
    with open(argv[1], encoding="utf-8") as f:
        entries = json.load(f)
    words = {e["word"] for e in entries}
    report = {"dictionary": argv[1], "words": len(words), "frq": coverage(rows, words), "bnc": coverage(rows, words, "bnc")}
    report["frq_top10000_missing_lemmas"] = [w for _, w in missing_lemmas(rows, words)]
    if len(argv) > 2:
        with open(argv[2], encoding="utf-8") as f:
            older = json.load(f)
        report["compare"] = compare(older, entries)
        old_words = {e["word"] for e in older}
        report["frq_before"] = coverage(rows, old_words)
    json.dump(report, sys.stdout, ensure_ascii=False, indent=1)
    print()


if __name__ == "__main__":
    main(sys.argv[1:])
