"""Choose each word's core meaning from evidence.

ECDICT lists Chinese meanings one part of speech per line, in a fixed order
(often noun first), and within a line the first gloss is sometimes archaic.
The core meaning shown on a flashcard is chosen like this:

1. Part of speech
   - WordNet 3.0 sense-tagged counts (SemCor, via index.sense): how often
     each part of speech of the word was used in annotated text.
   - Tatoeba sentence pairs: how often a gloss that belongs to only one
     part of speech appears in the human Chinese translation of English
     sentences that contain the word.
   Agreement, or one strong signal, decides. WordNet alone (SemCor is
   1960s written English and leans towards verbs) only replaces ECDICT's
   first line when that line's part of speech has under a quarter of the
   tagged uses, and never replaces a first line that is a function word
   (prep., conj., pron., ...), which WordNet does not cover. Without
   evidence the ECDICT order is kept. A curated override can decide with a
   stated reason.
2. Line: within the chosen part of speech (vt./vi.), the line with more
   Tatoeba hits, else the first.
3. Glosses: when Tatoeba confirms some glosses of the line, those are shown
   (most hits first, at most three), after any earlier gloss that could not
   be tested; otherwise the first two in ECDICT order.
   A sentence only counts for a gloss when the gloss is not part of a longer
   gloss of another part of speech in that sentence (cycle: n. 自行车 is not
   counted inside 骑自行车, the verb). A gloss that another part of speech
   uses as is (quiet: n. 安静 / a. 安静的) cannot be tested.

Nothing is translated or generated here: every gloss comes from ECDICT, or
from an override that cites verified sources.
"""

import re
from collections import Counter, defaultdict

POS_RE = re.compile(
    r"^(n|v|vt|vi|a|adj|ad|adv|prep|conj|pron|int|interj|num|art|aux|abbr|pl|pref|suf)\.\s*"
)
GROUP = {"n": "n", "pl": "n", "v": "v", "vt": "v", "vi": "v", "a": "a", "adj": "a",
         "ad": "r", "adv": "r"}
WN_POS = {"1": "n", "2": "v", "3": "a", "4": "r", "5": "a"}
DEF_GROUP = {"n": "n", "v": "v", "a": "a", "s": "a", "r": "r"}
CORE_GLOSSES = 3
FALLBACK_GLOSSES = 2


def load_wordnet_counts(index_sense_path):
    """{lemma: Counter(n=, v=, a=, r=)} of SemCor tag counts."""
    counts = defaultdict(Counter)
    with open(index_sense_path, encoding="utf-8") as f:
        for line in f:
            parts = line.split()
            if len(parts) < 4:
                continue
            key, tag_cnt = parts[0], int(parts[3])
            lemma, rest = key.split("%", 1)
            counts[lemma][WN_POS[rest[0]]] += tag_cnt
    return dict(counts)


def split_line(line):
    """'vt. 喜欢, 愿意（口）' -> ('vt', ['喜欢', '愿意（口）'])"""
    m = POS_RE.match(line)
    label = m.group(1) if m else ""
    body = POS_RE.sub("", line)
    glosses = [g.strip() for g in re.split(r"[,，;；]", body) if g.strip()]
    return label, glosses


def gloss_key(g):
    """Comparable core of a gloss: no notes in brackets, no trailing 的/地."""
    g = re.sub(r"[（(\[][^）)\]]*[）)\]]", "", g).strip()
    return re.sub(r"[的地]$", "", g)


class TatoebaIndex:
    def __init__(self, pairs, word_re):
        self.zh = []
        self.by_token = defaultdict(list)
        for en, zh in pairs:
            i = len(self.zh)
            self.zh.append(zh)
            for tok in set(word_re.findall(en.lower())):
                self.by_token[tok].append(i)

    def sentences(self, forms):
        ids = set()
        for f in forms:
            ids.update(self.by_token.get(f, ()))
        return [self.zh[i] for i in sorted(ids)]


def gloss_hits(lines, zh_sentences):
    """Tatoeba hits per line index and per gloss. A gloss counts towards
    its part of speech only if no other part of speech has the same gloss
    (quiet: n. 安静 / a. 安静的 cannot tell the two apart)."""
    groups = [GROUP.get(label, label or "?") for label, _ in lines]
    keys = [(gi, gloss_key(g)) for gi, (_, glosses) in zip(groups, lines) for g in glosses]

    per_gloss = {}
    per_line = []
    for gi, (_, glosses) in zip(groups, lines):
        line_sentences = set()
        for g in glosses:
            k = gloss_key(g)
            if not k:
                continue
            other = [ok for o, ok in keys if o != gi and ok]
            if k in other or any(ok in k for ok in other):
                continue  # another part of speech shares or is part of this gloss
            longer = [ok for ok in other if k in ok]
            hit = []
            for i, sent in enumerate(zh_sentences):
                for ok in longer:
                    sent = sent.replace(ok, "")
                if k in sent:
                    hit.append(i)
            per_gloss[(gi, g)] = len(hit)
            line_sentences.update(hit)
        per_line.append(len(line_sentences))
    return groups, per_line, per_gloss


def choose(word, translation_lines, wn_counts, zh_sentences, override=None):
    """Returns dict(meaning, line_index, group, source, evidence)."""
    lines = [split_line(ln) for ln in translation_lines]
    groups, per_line, per_gloss = gloss_hits(lines, zh_sentences)
    present = []
    for g in groups:
        if g not in present:
            present.append(g)

    wn = wn_counts.get(word.lower().replace(" ", "_"), Counter())
    wn = {g: wn.get(g, 0) for g in present if g in ("n", "v", "a", "r")}
    wn_total = sum(wn.values())
    tt = Counter()
    for g, n in zip(groups, per_line):
        tt[g] += n
    tt_total = sum(tt.values())
    evidence = {"wordnet": {k: v for k, v in wn.items() if v}, "tatoeba": {k: v for k, v in tt.items() if v}}

    def top(c):
        return max(c, key=lambda k: (c[k], -present.index(k))) if c else None

    # SemCor is small and leans to literary and legal text: ask for 5+ uses
    wn_top = top(wn) if wn_total >= 5 and max(wn.values()) / wn_total >= 0.6 else None
    tt_top = top(tt) if tt_total >= 3 and max(tt.values()) / tt_total >= 0.6 else None
    wn_strong = wn_top and wn_total >= 20 and wn[wn_top] / wn_total >= 0.8
    # Tatoeba overrules WordNet only where WordNet has no tagged use of that
    # part of speech at all (please: adv. 请 has none in SemCor).
    # Not for adjectives: Chinese often drops 的, so 冬天的 also matches the
    # noun use 冬天 (winter).
    tt_strong = (tt_top and tt_top != "a" and tt_total >= 10 and tt[tt_top] / tt_total >= 0.8
                 and not wn.get(tt_top))

    if override and override.get("group"):
        group, source = override["group"], "override"
    elif len(present) == 1:
        group, source = present[0], "single"
    elif wn_top and tt_top:
        if wn_top == tt_top:
            group, source = wn_top, "wordnet+tatoeba"
        elif tt_strong or (not wn_strong and (tt_top not in ("n", "v", "a", "r") or tt_total >= 10)):
            group, source = tt_top, "tatoeba (wordnet disagrees)"
        else:
            group, source = wn_top, "wordnet (tatoeba disagrees)"
    elif wn_top and groups[0] in ("n", "v", "a", "r") and wn.get(groups[0], 0) / wn_total <= 0.25:
        group, source = wn_top, "wordnet"
    elif wn_top and wn_top == groups[0]:
        group, source = wn_top, "wordnet"
    elif tt_top:
        group, source = tt_top, "tatoeba"
    else:
        group, source = groups[0], "ecdict-order"

    # WordNet has no prepositions: its adverb tags for within, inside ...
    # stand for what is mostly prepositional use.
    if group == "r" and "prep" in present and source.startswith("wordnet") and not tt_total:
        group, source = "prep", source + ", preposition preferred"
    candidates = [i for i, g in enumerate(groups) if g == group]
    line_index = max(candidates, key=lambda i: (per_line[i], -i))
    if override and override.get("glosses"):
        # use the line the curated glosses come from (stay: vi. 停留, not vt.)
        holding = [i for i in candidates if override["glosses"][0] in lines[i][1]]
        if holding:
            line_index = holding[0]
    label, glosses = lines[line_index]

    if override and override.get("glosses"):
        chosen = list(override["glosses"])
        source = "override"
    else:
        hits = {g: per_gloss.get((group, g), 0) for g in glosses}
        confirmed = sorted((g for g in glosses if hits[g]), key=lambda g: (-hits[g], glosses.index(g)))
        if confirmed and len(re.sub(r"[（(\[][^）)\]]*[）)\]]", "", confirmed[0]).strip()) == 1 \
                and glosses.index(confirmed[0]) > 0:
            # a one-character gloss (产 in lay: 放置, 产 ...) also matches
            # unrelated words (生产, 产品), so it may not jump ahead
            chosen = glosses[:FALLBACK_GLOSSES]
        elif confirmed:
            # glosses that could not be tested and come before the first
            # confirmed one keep their place (small: a. 小的 ...)
            first = glosses.index(next(g for g in glosses if hits[g]))
            untested = [g for g in glosses[:first] if (group, g) not in per_gloss]
            chosen = (untested + confirmed)[:CORE_GLOSSES]
            source += ", glosses by tatoeba"
        else:
            chosen = glosses[:FALLBACK_GLOSSES]
    if override and override.get("label"):
        label = override["label"]
    meaning = (label + ". " if label else "") + ", ".join(chosen)
    return {"meaning": meaning, "line_index": line_index, "group": group, "source": source, "evidence": evidence}


INSTANCE_RE = re.compile(r"\(\d{3,4}\s*-\s*\d{2,4}\)|\(born \d{4}\)|\(died \d{4}\)|\(\d{4}-\)")


def order_definitions(definition_lines, group, limit=4):
    """English definitions of the core part of speech first (WordNet order
    within a part of speech is kept). Senses that name a specific person
    (dates in brackets: "United States writer (1871-1900)") are dropped."""
    kept = [ln for ln in definition_lines if not INSTANCE_RE.search(ln)]

    def g(ln):
        m = re.match(r"^([a-z]+)\.?\s", ln)
        return DEF_GROUP.get(m.group(1), m.group(1)) if m else ""

    first = [ln for ln in kept if g(ln) == group]
    rest = [ln for ln in kept if g(ln) != group]
    return (first + rest)[:limit]
