import { useState } from "react";
import AddBookModal from "./AddBookModal";

function BooksPage({ onNavigate }) {
  const [books, setBooks] = useState([
    {
      id: "default",
      title: "Default Dictionary",
      desc: "从 dictionary 表随机抽取 dailyGoal 个词作为今日练习。",
      tag: "Today",
      to: "/study",
    },
    {
      id: "cet4",
      title: "CET-4 Core",
      desc: "四六级常见核心词汇（示例）。",
      tag: "Exam",
      to: "/study",
    },
  ]);

  const [addOpen, setAddOpen] = useState(false);

  return (
    <div className="page">
      <div className="container stack">
        <div className="page-head">
          <h2>单词书选择 📚</h2>
          <p className="text-muted">选择一个词书开始练习，也可以添加你自己的词典。</p >
        </div>

        <div className="books-grid">
          {books.map((b) => (
            <button
              key={b.id}
              className="book-card"
              onClick={() => onNavigate(b.to)}
              type="button"
            >
              <div className="book-card__top">
                <span className="pill">{b.tag}</span>
              </div>

              <div className="book-card__body">
                <h3 className="book-card__title">{b.title}</h3>
                <p className="book-card__desc">{b.desc}</p >
              </div>

              <div className="book-card__bottom">
                <span className="book-card__cta">进入 →</span>
              </div>
            </button>
          ))}

          <button
            className="book-card book-card--add"
            onClick={() => setAddOpen(true)}
            type="button"
          >
            <div className="book-add">
              <div className="book-add__plus">＋</div>
              <div className="book-add__text">
                <div className="book-add__title">添加词典</div>
                <div className="book-add__desc">先做 UI，未来接数据库 / 上传</div>
              </div>
            </div>
          </button>
        </div>
      </div>

      <AddBookModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreate={(newBook) => setBooks((prev) => [newBook, ...prev])}
      />
    </div>
  );
}

export default BooksPage;