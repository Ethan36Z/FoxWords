"""General American IPA from the CMU Pronouncing Dictionary.

CMUdict (BSD-2-Clause, Carnegie Mellon University) gives ARPAbet phones with
stress digits on vowels. This module converts them to IPA in the style of
learner dictionaries (Cambridge US): long vowels marked with ː, ɝː/ɚ for
stressed/unstressed r-coloured vowels, stress marks placed before the
syllable (maximal onset), no stress mark on one-syllable words.

Words missing from CMUdict are looked up through:
  - a spelling variant (colourful -> colorful), same pronunciation;
  - a regular suffix (-ness, -less, -ly, -ful) on a CMUdict word;
  - a two-part compound (coffeepot = coffee + pot, both parts at least four
    letters): first part keeps its primary stress, the second gets
    secondary stress. A compound is only accepted when an independent
    transcription (ECDICT) has the same number of syllables and its main
    stress on the first part; splits such as pre+position are rejected.
Each result says which route was used, so derived values can be reviewed.
"""

import re
from collections import defaultdict

CONSONANTS = {
    "B": "b", "CH": "tʃ", "D": "d", "DH": "ð", "F": "f", "G": "ɡ", "HH": "h", "JH": "dʒ",
    "K": "k", "L": "l", "M": "m", "N": "n", "NG": "ŋ", "P": "p", "R": "r", "S": "s",
    "SH": "ʃ", "T": "t", "TH": "θ", "V": "v", "W": "w", "Y": "j", "Z": "z", "ZH": "ʒ",
}
VOWELS = {"AA", "AE", "AH", "AO", "AW", "AY", "EH", "ER", "EY", "IH", "IY", "OW", "OY", "UH", "UW"}

# English syllable onsets (ARPAbet), used to split consonant clusters
ONSETS = {(c,) for c in CONSONANTS if c != "NG"}
ONSETS |= {(a, "R") for a in ("P", "B", "T", "D", "K", "G", "F", "TH", "SH")}
ONSETS |= {(a, "L") for a in ("P", "B", "K", "G", "F", "S")}
ONSETS |= {("S", a) for a in ("P", "T", "K", "M", "N", "W", "F")}
ONSETS |= {(a, "W") for a in ("T", "D", "K", "G", "TH", "S")}
ONSETS |= {(a, "Y") for a in ("P", "B", "K", "G", "M", "F", "V", "HH")}
ONSETS |= {("S", "P", "R"), ("S", "T", "R"), ("S", "K", "R"), ("S", "P", "L"), ("S", "K", "W"),
           ("S", "P", "Y"), ("S", "K", "Y")}


def load_cmudict(path):
    """{word: [[phone, ...], ...]} with variants in file order."""
    out = defaultdict(list)
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.split("#", 1)[0].strip()
            if not line:
                continue
            head, *phones = line.split()
            out[re.sub(r"\(\d+\)$", "", head)].append(phones)
    return dict(out)


def split(phone):
    m = re.match(r"^([A-Z]+)([012]?)$", phone)
    return m.group(1), m.group(2)


def vowel_ipa(base, stress):
    if base == "AH":
        return "ʌ" if stress in ("1", "2") else "ə"
    if base == "ER":
        return "ɝː" if stress in ("1", "2") else "ɚ"
    if base == "IY":
        return "iː" if stress in ("1", "2") else "i"
    if base == "UW":
        return "uː" if stress in ("1", "2") else "u"
    return {"AA": "ɑː", "AE": "æ", "AO": "ɔː", "AW": "aʊ", "AY": "aɪ", "EH": "e", "EY": "eɪ",
            "IH": "ɪ", "OW": "oʊ", "OY": "ɔɪ", "UH": "ʊ"}[base]


def syllables(phones):
    """Split ARPAbet phones into syllables by maximal onset.
    Returns [(stress, [phones])]."""
    parts = [split(p) for p in phones]
    nuclei = [i for i, (b, _) in enumerate(parts) if b in VOWELS]
    if not nuclei:
        return [("", phones)]
    starts = [0]
    for prev, cur in zip(nuclei, nuclei[1:]):
        cluster = tuple(b for b, _ in parts[prev + 1:cur])
        onset = 0
        for k in range(len(cluster), 0, -1):
            if cluster[-k:] in ONSETS:
                onset = k
                break
        starts.append(cur - onset)
    out = []
    for i, s in enumerate(starts):
        e = starts[i + 1] if i + 1 < len(starts) else len(phones)
        out.append((parts[nuclei[i]][1], phones[s:e]))
    return out


def to_ipa(phones, marks=False):
    # CMUdict sometimes marks two primary stresses (realization, uncouth);
    # dictionaries show one, so the earlier ones become secondary.
    ones = [i for i, ph in enumerate(phones) if ph.endswith("1")]
    if len(ones) > 1:
        phones = [ph[:-1] + "2" if i in ones[:-1] else ph for i, ph in enumerate(phones)]
    syl = syllables(phones)
    many = marks or len(syl) > 1
    text = []
    for stress, ph in syl:
        mark = ("ˈ" if stress == "1" else "ˌ" if stress == "2" else "") if many else ""
        seg = []
        for p in ph:
            b, s = split(p)
            seg.append(vowel_ipa(b, s) if b in VOWELS else CONSONANTS[b])
        text.append(mark + "".join(seg))
    return "".join(text)


def stress_pattern(phones):
    """(index of primary-stressed syllable, its vowel) for comparing variants."""
    syl = syllables(phones)
    for i, (stress, ph) in enumerate(syl):
        if stress == "1":
            vowel = next(split(p)[0] for p in ph if split(p)[0] in VOWELS)
            return i, vowel
    return -1, ""


def choose_variants(variants, core_group=""):
    """Pick what to show from CMUdict's variants.
    * Same stress position and stressed vowel: only the first (reduced forms).
    * Different stress position (record, present): by part of speech, verbs
      take the later stress, nouns and adjectives the earlier one.
    * Different stressed vowel (live, lead): show both, first one first."""
    first = variants[0]
    pos0, vow0 = stress_pattern(first)
    # AO/AA differ only by the US cot-caught merger (law: lɔː ~ lɑː)
    same = lambda p: p == (pos0, vow0) or (p[0] == pos0 and {p[1], vow0} == {"AO", "AA"})
    others = [v for v in variants[1:] if not same(stress_pattern(v))]
    if not others:
        return [first]
    shift = [v for v in others if stress_pattern(v)[0] != pos0]
    if shift and core_group in ("v", "n", "a"):
        cands = [first] + shift
        key = lambda v: stress_pattern(v)[0]
        return [max(cands, key=key) if core_group == "v" else min(cands, key=key)]
    vowel = [v for v in others if stress_pattern(v)[0] == pos0]
    return [first] + vowel[:1] if vowel else [first]


SUFFIXES = [("ness", ["N", "AH0", "S"]), ("less", ["L", "AH0", "S"]), ("ful", ["F", "AH0", "L"]),
            ("ly", ["L", "IY0"])]


def vowel_groups(ipa):
    return len(re.findall(r"[aeiouæɑɒɔəɜɝɚɪʊʌ]+ː?", ipa.split(";")[0]))


def lookup(word, cmu, spelling_variants=lambda w: set(), core_group="", check="", parts=None):
    """(ipa, source) for a word, or ("", "") when no reliable route exists.
    `check` is an independent transcription used to accept compounds;
    `parts` limits compound parts to known words (CMUdict also lists names
    and fragments such as "glas" or "subs")."""
    w = word.lower()
    if w in cmu:
        return "; ".join(to_ipa(v) for v in choose_variants(cmu[w], core_group)), "cmudict"
    for v in sorted(spelling_variants(w)):
        if v in cmu:
            return "; ".join(to_ipa(x) for x in choose_variants(cmu[v], core_group)), "cmudict-spelling"
    for suf, phones in SUFFIXES:
        base = w[: -len(suf)]
        if w.endswith(suf) and len(base) >= 3 and not (suf == "ly" and base.endswith("le")):
            for b in (base, base[:-1] + "y" if base.endswith("i") else None):
                if b and b in cmu:
                    return to_ipa(cmu[b][0] + phones), "cmudict-suffix"
    if check:
        for i in range(4, len(w) - 3):
            a, b = w[:i], w[i:]
            if a in cmu and b in cmu and (parts is None or (a in parts and b in parts)) \
                    and len(choose_variants(cmu[a])) == 1 and len(choose_variants(cmu[b])) == 1:
                second = [re.sub(r"1$", "2", p) for p in cmu[b][0]]
                ipa = to_ipa(cmu[a][0], marks=True) + to_ipa(second, marks=True)
                if vowel_groups(ipa) == vowel_groups(check) and primary_stress_syllable(check) in (0, -1):
                    return ipa, "cmudict-compound"
    return "", ""


def primary_stress_syllable(ipa):
    """Index of the syllable carrying ˈ in an IPA string (counting vowel
    groups), used to compare two transcriptions; -1 when unmarked."""
    head = ipa.split(";")[0]
    if "ˈ" not in head:
        return -1
    before = head.split("ˈ", 1)[0]
    return len(re.findall(r"[aeiouæɑɒɔəɜɝɚɪʊʌ]+", before))
