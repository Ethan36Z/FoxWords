import csv
import json

CSV_FILE = "ecdict.csv"
JSON_FILE = "dictionary.json"
MAX_WORDS = 2000

# 认为“考试用词”的标签关键字
GOOD_TAGS = ("zk", "中考", "gk", "高考", "cet4", "四级")

def is_good_word(word: str) -> bool:
    """过滤掉 -gamous 这种乱七八糟的形式，只留正常单词"""
    if not word:
        return False
    w = word.strip()
    if len(w) < 3:
        return False
    # 只要纯字母的单词，去掉连字符、空格、带点的
    if not w.isalpha():
        return False
    return True

items = []

with open(CSV_FILE, "r", encoding="utf-8", newline="") as f:
    reader = csv.DictReader(f)
    for row in reader:
        word = (row.get("word") or "").strip().lower()
        translation = (row.get("translation") or "").strip()
        definition = (row.get("definition") or "").strip()
        collins = (row.get("collins") or "").strip()
        tag = (row.get("tag") or "")
        oxford = (row.get("oxford") or "0")

        # 1) 过滤怪词
        if not is_good_word(word):
            continue

        # 2) 必须有中文释义
        if not translation:
            continue

        # 3) 不是“重要词”就跳过：
        #    牛津核心词 或 考试标签里包含 zk/gk/cet4/…
        is_important = (oxford == "1") or any(t in tag for t in GOOD_TAGS)
        if not is_important:
            continue

        # 4) 简单给个例句，占个位
        example = ""
        if collins:
            example = collins.split("\n")[0].strip()

        item = {
            "word": word,
            "translation": translation,
            "definition": definition,
            "example": example,
            "level": "",
            "tags": tag,
        }
        items.append(item)

        if len(items) >= MAX_WORDS:
            break

print("Selected words:", len(items))

with open(JSON_FILE, "w", encoding="utf-8") as f:
    json.dump(items, f, ensure_ascii=False, indent=2)

print("Wrote to", JSON_FILE)