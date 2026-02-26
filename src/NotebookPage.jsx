import { useEffect, useState } from "react";
import { API_BASE } from "./apiBase";

function NotebookPage() {
  const PAGE_SIZE = 20;

  const [notebook, setNotebook] = useState([]);
  const [loading, setLoading] = useState(true);

  const [busyId, setBusyId] = useState(null);

  // ✅ 分页状态
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(null); // 后端给的总数
  const [loadingMore, setLoadingMore] = useState(false);

  // 兼容分页版 {items,total}
  const normalize = (data) => {
    const items = Array.isArray(data)
      ? data
      : Array.isArray(data?.items)
      ? data.items
      : [];
    const t = typeof data?.total === "number" ? data.total : null;
    return { items, total: t };
  };

  // ✅ 第一次加载（重置）
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

  // ✅ Load more：在当前基础上追加
  async function loadMore() {
    if (loadingMore) return;
    // 如果 total 已知，且已经拉完了，就不拉
    if (typeof total === "number" && notebook.length >= total) return;

    try {
      setLoadingMore(true);

      const res = await fetch(
        `${API_BASE}/api/notebook?limit=${PAGE_SIZE}&offset=${offset}`
      );
      const data = await res.json().catch(() => ({}));

      if (!res.ok) throw new Error(data?.error || "Failed to load more");

      const { items, total: t } = normalize(data);

      // 追加（顺便去重一下，防止重复）
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

      // ✅ 如果 total 已知，删除后也更新 total
      if (typeof total === "number") setTotal((t) => Math.max(0, t - 1));
    } catch (err) {
      alert(err.message || "Delete failed");
    } finally {
      setBusyId(null);
    }
  };

  const canLoadMore =
    // total 不知道时：只要最近一次加载不是 0，就允许继续（但这里我们用 total 更稳）
    typeof total === "number"
      ? notebook.length < total
      : true;

  return (
    <div className="page">
      <div className="container stack">
        <div className="row row-between">
          <h2 className="title">生词本 🗂️</h2>

          <button className="btn btn-secondary btn-sm" onClick={loadFirstPage} disabled={loading}>
            Refresh
          </button>
        </div>

        <div className="card card--wide card--padded">
          {loading ? (
            <p className="text-muted">Loading...</p >
          ) : notebook.length === 0 ? (
            <p className="text-muted">还没有生词，去 Study 里标记几个吧～</p >
          ) : (
            <>
              <div className="nb-grid">
                {notebook.map((w) => (
                  <div className="nb-item" key={w.id ?? w.word}>
                    <button
                      className="nb-del"
                      onClick={() => handleDelete(w.id)}
                      disabled={!w.id || busyId === w.id}
                      title="删除"
                    >
                      {busyId === w.id ? "..." : "×"}
                    </button>

                    <div className="nb-word">{w.word}</div>
                    <div className="nb-zh">{pickZh(w) || "（暂无释义）"}</div>
                  </div>
                ))}
              </div>

              <div className="row row-between nb-footer">
                <div className="text-small">
                  {typeof total === "number"
                    ? `Showing ${notebook.length} / ${total}`
                    : `Showing ${notebook.length}`}
                </div>

                <button
                  className="btn btn-primary"
                  onClick={loadMore}
                  disabled={!canLoadMore || loadingMore}
                >
                  {loadingMore ? "Loading..." : canLoadMore ? "Load more" : "No more"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default NotebookPage;