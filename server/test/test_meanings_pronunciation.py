"""Unit tests for core-meaning selection and General American IPA.

Run inside server/:  npm run test:dict
"""

import os
import sys
import unittest
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import meanings as m  # noqa: E402
import pronunciation as p  # noqa: E402


class IpaTests(unittest.TestCase):
    def test_vowels_and_stress_placement(self):
        self.assertEqual(p.to_ipa("W AO1 T ER0".split()), "ˈwɔːtɚ")
        self.assertEqual(p.to_ipa("EH1 K S T R AH0".split()), "ˈekstrə")  # onset str-
        self.assertEqual(p.to_ipa("AH0 B R IY2 V IY0 EY1 SH AH0 N".split()), "əˌbriːviˈeɪʃən")
        self.assertEqual(p.to_ipa("S T IH1 L".split()), "stɪl")  # no mark on one syllable
        self.assertEqual(p.to_ipa("HH AE1 P IY0".split()), "ˈhæpi")  # unstressed IY is short
        self.assertEqual(p.to_ipa("CH ER1 CH".split()), "tʃɝːtʃ")

    def test_double_primary_stress_keeps_the_last(self):
        self.assertEqual(p.to_ipa("R IY1 L AH0 Z EY1 SH AH0 N".split()), "ˌriːləˈzeɪʃən")

    def test_variants(self):
        record = ["R IH0 K AO1 R D".split(), "R EH1 K ER0 D".split()]
        self.assertEqual(p.to_ipa(p.choose_variants(record, "v")[0]), "rɪˈkɔːrd")
        self.assertEqual(p.to_ipa(p.choose_variants(record, "n")[0]), "ˈrekɚd")
        law = ["L AO1".split(), "L AA1".split()]  # cot-caught merger only
        self.assertEqual(len(p.choose_variants(law)), 1)
        live = ["L AY1 V".split(), "L IH1 V".split()]  # different vowel: show both
        self.assertEqual(len(p.choose_variants(live)), 2)

    def test_fallback_routes(self):
        cmu = {"color": ["K AH1 L ER0".split()], "colorful": ["K AH1 L ER0 F AH0 L".split()],
               "brisk": ["B R IH1 S K".split()], "tape": ["T EY1 P".split()],
               "worm": ["W ER1 M".split()], "pre": ["P R IY1".split()],
               "position": ["P AH0 Z IH1 SH AH0 N".split()]}
        variants = lambda w: {"colorful"} if w == "colourful" else set()
        self.assertEqual(p.lookup("colourful", cmu, variants), ("ˈkʌlɚfəl", "cmudict-spelling"))
        self.assertEqual(p.lookup("briskness", cmu), ("ˈbrɪsknəs", "cmudict-suffix"))
        # compounds (parts of 4+ letters) need an agreeing transcription and known parts
        self.assertEqual(p.lookup("tapeworm", cmu, check="ˈteipwəːm", parts={"tape", "worm"}),
                         ("ˈteɪpˌwɝːm", "cmudict-compound"))
        self.assertEqual(p.lookup("tapeworm", cmu), ("", ""))
        self.assertEqual(p.lookup("tapeworm", cmu, check="teipˈwəːm", parts={"tape", "worm"}), ("", ""))
        self.assertEqual(p.lookup("preposition", cmu, check="ˌprepəˈziʃən", parts={"pre", "position"}), ("", ""))


def lines(*ls):
    return list(ls)


class MeaningTests(unittest.TestCase):
    def test_wordnet_and_tatoeba_agree(self):
        res = m.choose("still", lines("n. 蒸馏室, 寂静", "a. 静止的", "adv. 仍然, 更"),
                       {"still": Counter(n=2, a=30, r=313)}, ["我仍然爱你。", "他仍然在这里。", "仍然很冷。"])
        self.assertEqual(res["meaning"], "adv. 仍然")
        self.assertEqual(res["line_index"], 2)

    def test_wordnet_alone_needs_a_clear_case(self):
        # first line holds 32% of the tagged uses: keep ECDICT's order
        res = m.choose("issue", lines("n. 问题, 发行", "vi. 发行, 流出"), {"issue": Counter(n=29, v=52)}, [])
        self.assertTrue(res["meaning"].startswith("n."))
        res = m.choose("call", lines("n. 呼叫", "vt. 呼叫, 召集"), {"call": Counter(n=20, v=251)}, [])
        self.assertTrue(res["meaning"].startswith("vt."))
        # tiny counts are not evidence
        res = m.choose("vest", lines("n. 背心", "vt. 授予"), {"vest": Counter(n=1, v=3)}, [])
        self.assertTrue(res["meaning"].startswith("n."))

    def test_function_word_first_line_is_kept(self):
        res = m.choose("on", lines("prep. 在...之上", "adv. 向前"), {"on": Counter(a=6, r=43)}, [])
        self.assertTrue(res["meaning"].startswith("prep."))

    def test_preposition_preferred_over_wordnet_adverb(self):
        res = m.choose("within", lines("adv. 在内部", "n. 内部", "prep. 在...之内"), {"within": Counter(r=6)}, [])
        self.assertEqual(res["meaning"], "prep. 在...之内")

    def test_tatoeba_wins_where_wordnet_has_no_tags(self):
        zh = ["请坐。"] * 12
        res = m.choose("please", lines("vi. 使人满意, 讨好", "adv. 请"), {"please": Counter(v=25)}, zh)
        self.assertEqual(res["meaning"], "adv. 请")

    def test_glosses_confirmed_by_tatoeba(self):
        res = m.choose("husband", lines("n. 丈夫, 管理人, 节俭的人", "vt. 节俭, 使成丈夫"),
                       {"husband": Counter(n=68)}, ["我丈夫在家。", "她丈夫是医生。"])
        self.assertEqual(res["meaning"], "n. 丈夫")

    def test_gloss_inside_another_part_of_speech_is_not_counted(self):
        # 自行车 inside the verb gloss 骑自行车 does not promote it in the noun line
        res = m.choose("cycle", lines("n. 周期, 循环, 自行车", "vi. 骑自行车"),
                       {"cycle": Counter(n=10, v=2)}, ["我骑自行车上班。", "我骑自行车去。"])
        self.assertEqual(res["meaning"], "n. 周期, 循环")

    def test_untested_first_gloss_keeps_its_place(self):
        # 小的 is also a noun gloss here, so it cannot be tested
        res = m.choose("small", lines("a. 小的, 少的", "n. 小的"), {"small": Counter(a=239)}, ["很少的人。"])
        self.assertEqual(res["meaning"], "a. 小的, 少的")

    def test_one_character_gloss_cannot_jump_ahead(self):
        res = m.choose("lay", lines("vt. 放置, 产, 铺设"), {"lay": Counter(v=45)}, ["生产很多。", "这个产品。"])
        self.assertEqual(res["meaning"], "vt. 放置, 产")

    def test_override(self):
        res = m.choose("stay", lines("vt. 制止, 延缓", "vi. 停留, 逗留"), {}, [],
                       {"group": "v", "glosses": ["停留", "逗留"]})
        self.assertEqual(res["meaning"], "vi. 停留, 逗留")
        self.assertEqual(res["line_index"], 1)

    def test_definitions_core_first_and_no_named_people(self):
        defs = ["n. United States writer (1871-1900)", "n. a large long-necked bird", "v. stretch the neck"]
        self.assertEqual(m.order_definitions(defs, "v"), ["v. stretch the neck", "n. a large long-necked bird"])


if __name__ == "__main__":
    unittest.main()
