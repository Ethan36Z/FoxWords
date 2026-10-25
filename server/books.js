// Word books. A dictionary row belongs to every book whose id appears in its
// space-separated `tags`, so one word can be in several books. `level` holds
// only the easiest of those tags (see build_dictionary.py).
const BOOKS = [
  { id: "zk", title: "中考", desc: "初中阶段核心词汇" },
  { id: "gk", title: "高考", desc: "高中阶段核心词汇" },
  { id: "cet4", title: "大学英语四级", desc: "CET-4 考试词汇" },
  { id: "cet6", title: "大学英语六级", desc: "CET-6 考试词汇" },
  { id: "ky", title: "考研", desc: "研究生入学考试词汇" },
  { id: "ielts", title: "雅思", desc: "IELTS 考试词汇" },
  { id: "toefl", title: "托福", desc: "TOEFL 考试词汇" },
];

function bookIdsOf(tags) {
  const set = new Set(String(tags || "").split(/\s+/).filter(Boolean));
  return BOOKS.filter((b) => set.has(b.id)).map((b) => b.id);
}

module.exports = { BOOKS, bookIdsOf };
