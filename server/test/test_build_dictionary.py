"""Unit tests for the dictionary build rules (no ECDICT download needed).

Run inside server/:  npm run test:dict
"""

import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import build_dictionary as b  # noqa: E402


def row(word, translation="", definition="", tag="", exchange="", frq="0", bnc="0",
        collins="", oxford="", phonetic=""):
    return {
        "word": word, "translation": translation, "definition": definition, "tag": tag,
        "exchange": exchange, "frq": frq, "bnc": bnc, "collins": collins, "oxford": oxford,
        "phonetic": phonetic, "pos": "",
    }


class PhoneticTests(unittest.TestCase):
    def test_ascii_marks_become_ipa(self):
        self.assertEqual(b.normalize_ipa("'kɔndʌkt"), "ˈkɔndʌkt")
        self.assertEqual(b.normalize_ipa("lɒ:"), "lɔː")
        self.assertEqual(b.normalize_ipa("smɒ:l"), "smɔːl")
        self.assertEqual(b.normalize_ipa("ə.bri:vi'eiʃən"), "əˌbriːviˈeiʃən")

    def test_lookalike_characters(self):
        self.assertEqual(b.normalize_ipa("єə"), "eə")  # Cyrillic ye
        self.assertEqual(b.normalize_ipa("'tʃaildkεə"), "ˈtʃaildkeə")  # Greek epsilon
        self.assertEqual(b.normalize_ipa("'ænә"), "ˈænə")  # Cyrillic schwa

    def test_encoding_damage(self):
        self.assertEqual(b.normalize_ipa("'sʌnb\\\\:nt"), "ˈsʌnbəːnt")
        self.assertEqual(b.normalize_ipa("i^'zæktli"), "iɡˈzæktli")
        self.assertEqual(b.normalize_ipa("ɔ:təjbaiə'^ræfik(ə)l"), "ɔːtəubaiəˈɡræfik(ə)l")
        self.assertEqual(b.normalize_ipa("saiki'ætrik; (?@) si-"), "saikiˈætrik; si-")

    def test_variant_separators(self):
        self.assertEqual(b.normalize_ipa("'ælɒi. ə'lɒi"), "ˈælɒi; əˈlɒi")
        self.assertEqual(b.normalize_ipa("'kɔndʌkt, -dәkt"), "ˈkɔndʌkt; -dəkt")
        self.assertEqual(b.normalize_ipa(", krɔnә'lɔdʒikәl"), "ˌkrɔnəˈlɔdʒikəl")
        self.assertEqual(b.normalize_ipa(""), "")


class TranslationTests(unittest.TestCase):
    def test_no_part_of_speech_is_cut(self):
        r = row("like", "a. 相似的\\nvt. 喜欢\\nvi. 喜欢\\nn. 爱好\\nprep. 象, 如同\\nadv. 可能\\n[计] 类似")
        self.assertIn("prep. 象, 如同", b.clean_translation(r, "like").split("\n"))
        self.assertNotIn("[计] 类似", b.clean_translation(r, "like"))

    def test_pointer_lines_to_other_words_are_dropped(self):
        r = row("crew", "n. 全体人员\\ncrow的过去式")
        self.assertEqual(b.clean_translation(r, "crew"), "n. 全体人员")

    def test_domain_only_entry_gets_wordnet_part_of_speech(self):
        r = row("internet", "[计] 因特网, 广域网", "n. a computer network")
        self.assertEqual(b.clean_translation(r, "internet"), "n. 因特网, 广域网")

    def test_literal_backslash_r_is_removed(self):
        self.assertEqual(b.split_lines("一个\\r\\nart. x"), ["一个", "art. x"])


class InclusionTests(unittest.TestCase):
    def test_existing_rule_is_kept(self):
        self.assertEqual(b.candidate("apple", row("apple", "n. 苹果", tag="zk")), ("existing", None))

    def test_word_with_own_inflections_is_a_lemma(self):
        # ECDICT also lists "number" as the comparative of "numb"
        r = row("number", "n. 数字", tag="zk", exchange="s:numbers/d:numbered/0:numb/1:r")
        self.assertIsNone(b.form_info("number", r))
        # the old rule dropped it (the bug); the new rule picks it up by its exam tag
        self.assertFalse(b.old_rule("number", r))
        self.assertEqual(b.candidate("number", r), ("exam", None))

    def test_self_listed_forms_do_not_make_a_lemma(self):
        r = row("abandoned", "a. 被抛弃的", exchange="0:abandon/1:dp/p:abandoned/d:abandoned", collins="3")
        self.assertEqual(b.form_info("abandoned", r), ("abandon", "dp"))
        self.assertEqual(b.candidate("abandoned", r), ("core+form", ("participle", "abandon")))

    def test_lexicalised_forms_are_included(self):
        meeting = row("meeting", "n. 会议", exchange="0:meet/1:i", frq="500")
        self.assertEqual(b.candidate("meeting", meeting)[0], "frequency+form")
        interested = row("interested", "a. 感兴趣的", exchange="0:interest/1:pd", oxford="1")
        self.assertEqual(b.candidate("interested", interested)[0], "core+form")

    def test_plain_verb_forms_are_excluded(self):
        r = row("accelerated", "v. 加速（accelerate的过去式）", exchange="0:accelerate/1:pd", frq="900")
        self.assertIsNone(b.candidate("accelerated", r))

    def test_regular_comparatives_need_core_evidence(self):
        cheaper = row("cheaper", "a. 更便宜的", exchange="0:cheap/1:r", frq="800")
        self.assertIsNone(b.candidate("cheaper", cheaper))
        earlier = row("earlier", "adv. 更早地", exchange="0:early/1:r", collins="4")
        self.assertEqual(b.candidate("earlier", earlier)[0], "core+form")

    def test_frequency_without_exam_tag(self):
        self.assertEqual(b.candidate("quickly", row("quickly", "adv. 很快地", collins="4"))[0], "core")
        self.assertEqual(b.candidate("blog", row("blog", "n. 博客", frq="4000"))[0], "frequency")
        self.assertIsNone(b.candidate("rare", row("rare", "a. 罕见", frq="40000")))

    def test_noise_is_excluded(self):
        self.assertIsNone(b.candidate("km", row("km", "千米", frq="3000")))  # no vowel
        self.assertIsNone(b.candidate("uh", row("uh", "int. 呃", frq="900")))  # filler
        self.assertIsNone(b.candidate("ceo", row("ceo", "abbr. 首席执行官", frq="2000")))
        self.assertIsNone(b.candidate("john", row("john", "n. 约翰（男子名）", bnc="100", collins="1")))
        self.assertIsNone(b.candidate("cance", row("cance", "[人名] 坎斯", tag="gk")))
        self.assertIsNone(b.candidate("English", row("English", "n. 英语", tag="zk")))  # capitals need an override

    def test_name_filter_does_not_catch_ordinary_words(self):
        self.assertEqual(b.candidate("anonymity", row("anonymity", "n. 匿名, 姓氏不明", frq="7000"))[0], "frequency")
        self.assertEqual(b.candidate("checklist", row("checklist", "n. 清单, 选举人名单", frq="9000"))[0], "frequency")

    def test_second_pass_plurals_and_spelling_variants(self):
        rows = {
            "investigator": row("investigator", "n. 调查者", frq="3000"),
            "investigators": row("investigators", "n. 调查者", exchange="0:investigator/1:s", frq="4000"),
            "bacteria": row("bacteria", "pl. 细菌", exchange="0:bacterium/1:s", frq="3000", oxford="1"),
            "colour": row("colour", "n. 颜色", tag="zk"),
            "color": row("color", "n. 颜色", frq="900"),
            "she": row("she", "pron. 她", tag="zk"),
            "shoe": row("shoe", "n. 鞋", frq="2000"),
        }
        picked = b.select_words(rows, {})
        self.assertIn("investigator", picked)
        self.assertNotIn("investigators", picked)  # plain plural of an included word
        self.assertIn("bacteria", picked)  # base word not included
        self.assertIn("colour", picked)
        self.assertNotIn("color", picked)  # new variant of an existing word
        self.assertIn("shoe", picked)  # look-alike, different meaning

    def test_overrides_include_and_exclude(self):
        rows = {"English": row("English", "n. 英语", tag="zk"), "reservior": row("reservior", "n. 水库", tag="cet6")}
        picked = b.select_words(rows, {"include": [{"word": "English"}], "exclude": [{"word": "reservior"}]})
        self.assertEqual(set(picked), {"English"})


class BuildTests(unittest.TestCase):
    def test_build_keeps_previous_examples_and_records_changes(self):
        with tempfile.TemporaryDirectory() as d:
            csv_path = os.path.join(d, "ecdict.csv")
            fields = ["word", "phonetic", "definition", "translation", "pos", "collins", "oxford", "tag", "bnc", "frq", "exchange", "detail", "audio"]
            rows = [
                {"word": "apple", "phonetic": "'æpl", "translation": "n. 苹果", "tag": "zk", "exchange": "s:apples"},
                {"word": "river", "phonetic": "'rivə", "translation": "n. 河", "tag": "zk"},
                {"word": "reservior", "phonetic": "", "translation": "n. 水库", "tag": "cet6"},
                {"word": "a", "phonetic": "ei", "translation": "第一个字母 A; 一个\\r\\nart. [计] 累加器", "tag": "zk"},
            ]
            import csv
            with open(csv_path, "w", encoding="utf-8", newline="") as f:
                w = csv.DictWriter(f, fieldnames=fields)
                w.writeheader()
                for r in rows:
                    w.writerow({k: r.get(k, "") for k in fields})
            prev = os.path.join(d, "prev.json")
            with open(prev, "w", encoding="utf-8") as f:
                json.dump([
                    {"word": "apple", "example": "I like apples.", "exampleZh": "我喜欢苹果。"},
                    {"word": "reservior", "example": "", "exampleZh": ""},
                ], f)
            overrides = os.path.join(d, "overrides.json")
            with open(overrides, "w", encoding="utf-8") as f:
                json.dump({
                    "version": 9,
                    "include": [{"word": "a"}],
                    "exclude": [{"word": "reservior"}],
                    "translation_keep_lines": [{"word": "a", "source_lines": ["第一个字母 A; 一个", "art. [计] 累加器"], "keep": [0]}],
                    "phonetic": [{"word": "river", "from": "ˈrivə", "to": "ˈrɪvə"}, {"word": "apple", "from": "stale", "to": "x"}],
                }, f)
            out = os.path.join(d, "out.json")
            rec = b.build(csv_path, "-", out, previous_path=prev, overrides_path=overrides,
                          report_path=os.path.join(d, "rec.json"))
            with open(out, encoding="utf-8") as f:
                data = {e["word"]: e for e in json.load(f)}
            self.assertEqual(set(data), {"a", "apple", "river"})
            self.assertEqual(data["apple"]["example"], "I like apples.")
            self.assertEqual(data["apple"]["phonetic"], "ˈæpl")
            self.assertEqual(data["river"]["phonetic"], "ˈrɪvə")
            self.assertEqual(data["a"]["translation"], "第一个字母 A; 一个")
            self.assertEqual(rec["removed"], ["reservior"])
            self.assertEqual(rec["overrides_version"], 9)
            self.assertEqual(len(rec["problems"]), 1)  # the stale apple phonetic fix is reported, not applied
            self.assertIn("apple", rec["problems"][0])


class ReproducibilityTests(unittest.TestCase):
    def test_same_output_with_different_hash_seeds(self):
        """Python randomises set order per process; the build must not depend on it."""
        import csv
        import hashlib
        import subprocess
        with tempfile.TemporaryDirectory() as d:
            fields = ["word", "phonetic", "definition", "translation", "pos", "collins", "oxford", "tag",
                      "bnc", "frq", "exchange", "detail", "audio"]
            with open(os.path.join(d, "ecdict.csv"), "w", encoding="utf-8", newline="") as f:
                w = csv.DictWriter(f, fieldnames=fields)
                w.writeheader()
                w.writerow({"word": "run", "translation": "vi. 跑\\nn. 跑步", "tag": "zk",
                            "exchange": "p:ran/d:run/i:running/3:runs/s:runs"})
                w.writerow({"word": "walk", "translation": "vi. 走", "tag": "zk", "exchange": "3:walks/i:walking"})
            with open(os.path.join(d, "cmn.txt"), "w", encoding="utf-8") as f:
                # equally good sentences for different forms: a tie to break
                f.write("He runs to school every day.\t他每天跑步去学校。\n")
                f.write("They ran to school every day.\t他们每天跑去学校。\n")
                f.write("I am running to school today.\t我今天跑去学校。\n")
                f.write("She walks to school every day.\t她每天走路去学校。\n")
                f.write("We are walking to school today.\t我们今天走路去学校。\n")
            script = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "build_dictionary.py")
            digests = set()
            for seed in ("1", "2", "3"):
                out = os.path.join(d, f"out{seed}.json")
                subprocess.run([sys.executable, "-I", "-B", script, os.path.join(d, "ecdict.csv"),
                                os.path.join(d, "cmn.txt"), out, "--overrides", os.path.join(d, "none.json")],
                               check=True, capture_output=True, env={"PYTHONHASHSEED": seed})
                with open(out, "rb") as f:
                    digests.add(hashlib.sha256(f.read()).hexdigest())
            self.assertEqual(len(digests), 1)


if __name__ == "__main__":
    unittest.main()
