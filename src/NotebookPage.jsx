import { useEffect, useState } from "react";
import { API_BASE } from "./apiBase";
import SpeakButton from "./SpeakButton";

function NotebookPage() {
  const PAGE_SIZE = 20;

  const [notebook, setNotebook] = useState([]);
  const [loading, setLoading] = useState(true);

  const [busyId, setBusyId] = useState(null);
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState(null); // id of the row showing details

  // Pagination
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(null); // total count from the backend
  const [loadingMore, setLoadingMore] = useState(false);

  // Accepts either a plain array or { items, total }
  const normalize = (data) => {
    const items = Array.isArray(data)
      ? data
      : Array.isArray(data?.items)
      ? data.items
      : [];
    const t = typeof data?.total === "number" ? data.total : null;
    return { items, total: t };
  };

  // Load (or reload) the first page
  async function loadFirstPage() {
    try {
      setLoading(true);
      setOffset(0);
      setTotal(null);

      const res = await fetch(`${API_BASE}/api/notebook?limit=${PAGE_SIZE}&offset=0`);
      const data = await res.json().catch(() => ({}));

      if (!res.ok) throw new Error(data?.error || "Failed to load notebook");

      const { items, total: t } = normalize(data);
      setNotebook(items);
      setTotal(t);
      setOffset(items.length);
    } catch (e) {
      console.error(e);
      setNotebook([]);
      setTotal(null);
      setOffset(0);
    } finally {
      setLoading(false);
    }
  }

  // Append the next page
  async function loadMore() {
    if (loadingMore) return;
    if (typeof total === "number" && notebook.length >= total) return;

    try {
      setLoadingMore(true);

      const res = await fetch(
        `${API_BASE}/api/notebook?limit=${PAGE_SIZE}&offset=${offset}`
      );
      const data = await res.json().catch(() => ({}));

      if (!res.ok) throw new Error(data?.error || "Failed to load more");

      const { items, total: t } = normalize(data);

      // Append, skipping anything already shown
      setNotebook((prev) => {
        const seen = new Set(prev.map((x) => x.id ?? x.word));
        const merged = [...prev];
        for (const it of items) {
          const key = it.id ?? it.word;
          if (!seen.has(key)) merged.push(it);
        }
        return merged;
      });

      if (typeof t === "number") setTotal(t);
      setOffset((prev) => prev + items.length);
    } catch (e) {
      console.error(e);
      alert(e.message || "Load more failed");
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    loadFirstPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickZh = (w) => (w?.translation || "").trim();

  const handleDelete = async (id) => {
    if (!id || busyId) return;

    const ok = window.confirm("确定删除这个单词吗？");
    if (!ok) return;

    try {
      setBusyId(id);

      const res = await fetch(`${API_BASE}/api/notebook/${id}`, {
        method: "DELETE",
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Delete failed");

      setNotebook((prev) => prev.filter((w) => w.id !== id));

      if (typeof total === "number") setTotal((t) => Math.max(0, t - 1));
    } catch (err) {
      alert(err.message || "Delete failed");
    } finally {
      setBusyId(null);
    }
  };

  const canLoadMore =
    typeof total === "number"
      ? notebook.length < total
      : true;

  const keyword = filter.trim().toLowerCase();
  const shown = keyword
    ? notebook.filter(
        (w) => w.word.toLowerCase().includes(keyword) || (w.translation || "").includes(keyword)
      )
    : notebook;

  return (
    <div className="page">
      <div className="container stack nb-page">
        <div className="row row-between">
          <div className="page-head">
            <h2>生词本</h2>
            <p className="text-muted">
              {typeof total === "number" ? `一共 ${total} 个生词` : "你标记过的所有生词"}
            </p>
          </div>

          <button className="btn btn-secondary btn-sm" onClick={loadFirstPage} disabled={loading}>
            刷新
          </button>
        </div>

        {loading ? (
          <div className="card state-card">
            <div className="spinner" />
            <p className="text-muted">正在加载生词本…</p>
          </div>
        ) : notebook.length === 0 ? (
          <div className="card state-card">
            <div className="state-card__icon">🗂️</div>
            <div className="state-card__title">生词本还是空的</div>
            <p className="text-muted">在“学习”页点星标，或在搜索里遇到不认识的词，就把它加进来吧。</p>
          </div>
        ) : (
          <div className="card nb-list">
            <div className="nb-list__toolbar">
              <input
                className="input"
                placeholder="在生词本里查找（单词或中文）"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </div>

            <ul className="nb-rows">
              {shown.map((w) => {
                const open = expanded === w.id;
                const firstLine = (pickZh(w) || "（暂无释义）").split("\n")[0];
                return (
                  <li key={w.id ?? w.word} className={`nb-row ${open ? "is-open" : ""}`}>
                    <div className="nb-row__main">
                      <button
                        type="button"
                        className="nb-row__toggle"
                        onClick={() => setExpanded(open ? null : w.id)}
                        aria-expanded={open}
                      >
                        <span className="nb-row__word">{w.word}</span>
                        {w.phonetic ? <span className="phonetic">/{w.phonetic}/</span> : null}
                        <span className="nb-row__zh">{firstLine}</span>
                      </button>
                      <SpeakButton text={w.word} size="sm" />
                      <button
                        className="icon-btn icon-btn--sm nb-row__del"
                        onClick={() => handleDelete(w.id)}
                        disabled={!w.id || busyId === w.id}
                        title="删除"
                        aria-label={`删除 ${w.word}`}
                      >
                        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                          <path
                            d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                    </div>
                    {open ? (
                      <div className="nb-row__detail">
                        <div className="nb-zh">{pickZh(w) || "（暂无释义）"}</div>
                        {w.definition ? <div className="nb-en">{w.definition}</div> : null}
                        <div className="text-small">
                          加入于 {new Date(w.createdAt).toLocaleDateString("zh-CN")}
                        </div>
                      </div>
                    ) : null}
                  </li>
                );
              })}
              {shown.length === 0 ? (
                <li className="nb-row nb-row--empty text-muted">没有匹配的生词。</li>
              ) : null}
            </ul>

            <div className="row row-between nb-footer">
              <div className="text-small">
                {typeof total === "number"
                  ? `已显示 ${notebook.length} / ${total}`
                  : `已显示 ${notebook.length}`}
              </div>

              {canLoadMore ? (
                <button className="btn btn-secondary btn-sm" onClick={loadMore} disabled={loadingMore}>
                  {loadingMore ? "加载中…" : "加载更多"}
                </button>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default NotebookPage;
