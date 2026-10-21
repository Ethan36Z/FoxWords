import { useEffect, useState } from "react";
import { API_BASE } from "./apiBase";

// Word books = exam vocabularies. Picking one makes new study words come from it.
function BooksPage({ onNavigate }) {
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [switching, setSwitching] = useState(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/books`)
      .then(async (r) => {
        const data = await r.json().catch(() => null);
        if (!r.ok) throw new Error(data?.error || "Failed to load books");
        setBooks(Array.isArray(data) ? data : []);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const choose = async (book) => {
    try {
      setSwitching(book.id);
      const res = await fetch(`${API_BASE}/api/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ book: book.id }),
      });
      if (!res.ok) throw new Error("Failed to switch book");
      onNavigate("/study");
    } catch (err) {
      setError(err.message);
      setSwitching(null);
    }
  };

  return (
    <div className="page">
      <div className="container stack">
        <div className="page-head">
          <h2>词书</h2>
          <p className="text-muted">
            按难度选择一本词书，学习时的新词只从这本书里抽取。不熟悉的词不分词书，都会参与复习。
          </p>
        </div>

        {error ? <p className="error">{error}</p> : null}

        {loading ? (
          <div className="card state-card">
            <div className="spinner" />
            <p className="text-muted">正在加载词书…</p>
          </div>
        ) : (
          <div className="books-grid">
            {books.map((b) => {
              const left = Math.max(0, b.total - b.seen);
              const pct = b.total ? Math.round((b.seen / b.total) * 100) : 0;
              return (
                <button
                  key={b.id || "all"}
                  className={`book-card ${b.selected ? "is-selected" : ""}`}
                  onClick={() => choose(b)}
                  disabled={switching !== null}
                  type="button"
                >
                  <div className="book-card__top">
                    <h3 className="book-card__title">{b.title}</h3>
                    {b.selected ? <span className="pill">当前</span> : null}
                  </div>
                  <p className="book-card__desc">{b.desc}</p>

                  <div className="book-card__bottom">
                    <div className="book-progress">
                      <div className="book-progress__bar" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="book-card__meta text-small">
                      <span>
                        {b.seen} / {b.total} 已学
                      </span>
                      <span>剩 {left} 新词</span>
                    </div>
                    {b.tooEasy > 0 ? (
                      <div className="text-small">其中 {b.tooEasy} 个标为太简单</div>
                    ) : null}
                    <span className="book-card__cta">
                      {switching === b.id ? "切换中…" : b.selected ? "继续学习 →" : "学这本 →"}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default BooksPage;
