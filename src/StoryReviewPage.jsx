import { useEffect, useMemo, useState } from "react";
import { API_BASE } from "./apiBase";

function StoryReviewPage() {
  const [notebook, setNotebook] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [story, setStory] = useState("");
  const [generating, setGenerating] = useState(false);
  const [storyError, setStoryError] = useState(null);

  // ✅ Copy states
  const [copyStatus, setCopyStatus] = useState("idle"); // idle | copied | error
  const [copyMsg, setCopyMsg] = useState("");

  useEffect(() => {
    async function loadNotebook() {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch(`${API_BASE}/api/notebook?limit=10&offset=0`);
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || "Failed to load notebook");

        const list = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
        setNotebook(list);
      } catch (err) {
        console.error("Failed to load notebook:", err);
        setError(err.message || "Failed to load notebook");
      } finally {
        setLoading(false);
      }
    }

    loadNotebook();
  }, []);

  // ✅ 最新 10 个（后端是 ORDER BY id DESC）
  const latestNotebook = useMemo(() => notebook.slice(0, 10), [notebook]);

  // ✅ 只显示：中文/释义（二选一）
  const pickZh = (w) => {
    const zh = (w?.translation || w?.definition || "").trim();
    return zh;
  };

  const handleGenerateStory = async () => {
    try {
      setGenerating(true);
      setStory("");
      setStoryError(null);
      setCopyStatus("idle");
      setCopyMsg("");

      const words = latestNotebook.map((w) => w.word);

      const res = await fetch(`${API_BASE}/api/story`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ words }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data?.error || "Failed to generate story");
      }

      setStory(data.story || "");
    } catch (err) {
      console.error("Error generating story:", err);
      setStoryError(err.message || "Failed to generate story");
    } finally {
      setGenerating(false);
    }
  };

  const handleCopyStory = async () => {
    const text = String(story || "").trim();
    if (!text) return;

    try {
      setCopyStatus("idle");
      setCopyMsg("");

      // 现代浏览器
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // 旧浏览器 fallback
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.top = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        if (!ok) throw new Error("Copy not supported");
      }

      setCopyStatus("copied");
      setCopyMsg("已复制 ✅");
      window.setTimeout(() => {
        setCopyStatus("idle");
        setCopyMsg("");
      }, 1200);
    } catch (err) {
      console.error("Copy failed:", err);
      setCopyStatus("error");
      setCopyMsg("复制失败（浏览器不支持或权限被拒绝）");
      window.setTimeout(() => {
        setCopyStatus("idle");
        setCopyMsg("");
      }, 1800);
    }
  };

  if (loading) {
    return (
      <div className="page">
        <div className="container">
          <div className="card card--medium card--padded">
            <h2 className="title">Story Review 🦊</h2>
            <p className="text-muted">Loading your notebook...</p >
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page">
        <div className="container">
          <div className="card card--medium card--padded">
            <h2 className="title">Story Review 🦊</h2>
            <p className="text-danger">Failed to load notebook: {error}</p >
          </div>
        </div>
      </div>
    );
  }

  if (!notebook || notebook.length === 0) {
    return (
      <div className="page">
        <div className="container">
          <div className="card card--medium card--padded">
            <h2 className="title">Story Review 🦊</h2>
            <p className="text-muted">你还没有任何生词～先去 Study 页里标记几条吧。</p >
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="container">
        <div className="card card--wide card--padded">
          <div className="stack">
            <div>
              <h2 className="title">Story Review 🦊</h2>
              <p className="text-muted">
                仅使用你最近的 <b>10</b> 个生词生成故事。
              </p >
            </div>

            <div className="card card--soft">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <h3 style={{ margin: 0 }}>Latest 10 words</h3>
                <span className="text-small">word · 中文/释义</span>
              </div>

              <div style={{ marginTop: 12 }} className="nb-grid">
                {latestNotebook.map((item) => (
                  <div className="nb-item" key={item.id ?? item.word}>
                    <div className="nb-word">{item.word}</div>
                    <div className="nb-zh">{pickZh(item) || "（暂无释义）"}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* ✅ 生成 + 复制 */}
            <div className="row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
                <button
                  className="btn btn-primary"
                  onClick={handleGenerateStory}
                  disabled={generating || latestNotebook.length === 0}
                >
                  {generating ? "正在酝酿故事..." : "用这 10 个词生成一个小故事"}
                </button>

                <button
                  className={`btn btn-secondary ${copyStatus === "copied" ? "is-copied" : ""}`}
                  onClick={handleCopyStory}
                  disabled={!story || generating}
                  title={!story ? "先生成故事再复制" : "复制到剪贴板"}
                >
                  {copyStatus === "copied" ? "已复制 ✅" : "复制故事 📋"}
                </button>

                {copyMsg ? <span className="text-small">{copyMsg}</span> : null}
              </div>

              <span className="text-small">tips: 词越多越不稳定，所以这里强制用 10 个 🙂</span>
            </div>

            {storyError ? (
              <p className="text-danger" style={{ margin: 0 }}>
                生成失败：{storyError}
              </p >
            ) : null}

            {story ? (
              <div className="card card--soft" style={{ whiteSpace: "pre-line" }}>
                {story}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export default StoryReviewPage;