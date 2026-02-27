// src/WordPracticePage.jsx
import { useState, useEffect, useRef, useCallback } from "react";
import { API_BASE } from "./apiBase";

function WordPracticePage() {
  const [dictionary, setDictionary] = useState([]);
  const [index, setIndex] = useState(0);

  const [showMeaning, setShowMeaning] = useState(false);
  const [showExample, setShowExample] = useState(false);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const [notebook, setNotebook] = useState([]);
  const [exampleFirst, setExampleFirst] = useState(true);

  // ===================== 加载设置 =====================
  useEffect(() => {
    async function loadSettings() {
      try {
        const res = await fetch(API_BASE + "/api/settings");
        if (!res.ok) throw new Error("Failed to load settings");
        const data = await res.json().catch(() => ({}));
        if (typeof data.exampleFirst === "boolean") {
          setExampleFirst(data.exampleFirst);
        }
      } catch (err) {
        console.error("Failed to load settings:", err);
      }
    }
    loadSettings();
  }, []);

  // ===================== 加载生词本 =====================
  useEffect(() => {
    async function loadNotebook() {
      try {
        const res = await fetch(
          API_BASE + "/api/notebook?limit=200&offset=0"
        );
        if (!res.ok) throw new Error("Failed to load notebook");
        const data = await res.json().catch(() => ({}));

        const list = Array.isArray(data)
          ? data
          : Array.isArray(data?.items)
          ? data.items
          : [];
        setNotebook(list);
      } catch (err) {
        console.error("Failed to load notebook:", err);
      }
    }
    loadNotebook();
  }, []);

  // ===================== 加载今日单词（支持 refresh） =====================
  const loadTodayWords = useCallback(
    async (refresh = false) => {
      try {
        if (refresh) setRefreshing(true);
        else setLoading(true);

        setError(null);

        const url = refresh
          ? API_BASE + "/api/words/today?refresh=1"
          : API_BASE + "/api/words/today";

        const res = await fetch(url);
        const data = await res.json().catch(() => null);

        if (!res.ok) {
          throw new Error(data?.error || "Failed to load today words");
        }

        const list = Array.isArray(data) ? data : [];
        setDictionary(list);

        setIndex(0);
        setShowMeaning(false);
        setShowExample(false);
      } catch (err) {
        console.error(err);
        setError(err.message || "Failed to load today words");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    []
  );

  // 首次加载
  useEffect(() => {
    loadTodayWords(false);
  }, [loadTodayWords]);

  // ===================== 当前卡片 =====================
  const current = dictionary[index];
  const inNotebook = current
    ? notebook.some((w) => w.word === current.word)
    : false;

  // ===================== 按钮逻辑 =====================
  const handleAddToNotebook = async () => {
    if (!current) return;
    if (inNotebook) return;

    try {
      const res = await fetch(API_BASE + "/api/notebook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(current),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        console.error("Failed to add:", data);
        return;
      }

      setNotebook((prev) => [data, ...prev]);
    } catch (err) {
      console.error("Error adding to notebook:", err);
    }
  };

  const handleDontKnow = () => {
    if (!current) return;

    if (!exampleFirst) {
      if (!showMeaning) {
        setShowMeaning(true);
        setShowExample(false);
      } else {
        handleAddToNotebook();
      }
      return;
    }

    if (!showExample && !showMeaning) {
      setShowExample(true);
      return;
    }
    if (showExample && !showMeaning) {
      setShowMeaning(true);
      return;
    }
    if (showExample && showMeaning) {
      handleAddToNotebook();
      return;
    }
  };

  const handleNext = () => {
    setShowMeaning(false);
    setShowExample(false);
    setIndex((prev) => prev + 1);
  };

  const handleRestart = () => {
    setIndex(0);
    setShowMeaning(false);
    setShowExample(false);
  };

  // ===================== 快捷键 =====================
  const hotkeysRef = useRef({
    next: () => {},
    dontKnow: () => {},
    add: () => {},
    restart: () => {},
  });

  useEffect(() => {
    hotkeysRef.current.next = handleNext;
    hotkeysRef.current.dontKnow = handleDontKnow;
    hotkeysRef.current.add = handleAddToNotebook;
    hotkeysRef.current.restart = handleRestart;
  });

  useEffect(() => {
    const onKeyDown = (e) => {
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      if (e.key === "ArrowRight") {
        e.preventDefault();
        hotkeysRef.current.next();
        return;
      }
      if (e.key === "1") {
        e.preventDefault();
        hotkeysRef.current.dontKnow();
        return;
      }
      if (e.key === "2") {
        e.preventDefault();
        hotkeysRef.current.add();
        return;
      }
      if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        hotkeysRef.current.restart();
        return;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // ===================== 早退 =====================
  if (loading) {
    return <div style={{ padding: 20 }}>Loading words...</div>;
  }

  if (error) {
    return (
      <div style={{ padding: 20, color: "red" }}>
        Load error: {error}
      </div>
    );
  }

  if (dictionary.length === 0) {
    return (
      <div style={{ padding: 20, fontFamily: "sans-serif" }}>
        <h2>All done for today!</h2>
        <p>今天没有需要练习的单词啦，休息一下吧～</p >
        <button onClick={() => loadTodayWords(true)} disabled={refreshing}>
          {refreshing ? "换一批中..." : "再换一批 🔁"}
        </button>
      </div>
    );
  }

  if (!current) {
    return (
      <div style={{ padding: 20, fontFamily: "sans-serif" }}>
        <h2>All done for today!</h2>
        <p>你今天已经把这一批单词都过完啦～</p >

        <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
          <button onClick={handleRestart}>从头再来 ⟳</button>

          <button onClick={() => loadTodayWords(true)} disabled={refreshing}>
            {refreshing ? "换一批中..." : "换一批 🔁"}
          </button>
        </div>
      </div>
    );
  }

  // ===================== UI =====================
  return (
    <div className="page">
      <div className="container stack wp">
        <div className="card card--padded wp-top">
          <div className="row">
            <div className="stack" style={{ gap: 6 }}>
              <h2 className="title">Study 🧠</h2>
              <p className="text-muted">My vocabulary companion.</p >
            </div>
            <div className="spacer" />

            <button
              className="btn btn-secondary"
              onClick={() => loadTodayWords(true)}
              disabled={refreshing}
            >
              {refreshing ? "换一批中..." : "换一批 🔁"}
            </button>
          </div>

          <div className="wp-progress">
            <div
              className="wp-progress-bar"
              style={{
                width: `${
                  dictionary.length
                    ? ((index + 1) / dictionary.length) * 100
                    : 0
                }%`,
              }}
            />
          </div>

          <div className="row wp-meta">
            <span className="text-small">
              {index + 1} / {dictionary.length}
            </span>
            <span className="text-small">
              状态：{inNotebook ? "已标记 ⭐" : "未标记"}
            </span>
          </div>
        </div>

        <div className="card card--padded wp-card">
          <div className="wp-word">
            <div className="wp-word-main">{current.word}</div>
            <div className="wp-badges">
              {!showMeaning && <span className="pill">Recall</span>}
              {showMeaning && <span className="pill">Meaning</span>}
              {showExample && <span className="pill">Example</span>}
            </div>
          </div>

          {!showMeaning && (
            <p className="text-muted">
              还没看释义，先试着回忆一下这个词是什么意思……
            </p >
          )}

          {showExample && current.example && (
            <div className="wp-section">
              <div className="wp-label">Example</div>
              <div className="wp-box">{current.example}</div>
            </div>
          )}

          {showMeaning && (
            <div className="wp-section">
              <div className="wp-grid">
                <div className="wp-k">中文</div>
                <div className="wp-v">{current.translation}</div>

                <div className="wp-k">English</div>
                <div className="wp-v">{current.definition}</div>
              </div>
            </div>
          )}

          <div className="wp-actions">
            <button
              className="btn btn-secondary"
              onClick={handleDontKnow}
              disabled={inNotebook && showExample && showMeaning}
            >
              {!showExample && !showMeaning
                ? "不认识"
                : showExample && !showMeaning
                ? "想不起来"
                : inNotebook
                ? "已在生词本中"
                : "加入生词本"}
            </button>

            {!showMeaning && (
              <button
                className="btn btn-primary"
                onClick={handleAddToNotebook}
                disabled={inNotebook}
              >
                {inNotebook ? "已在生词本中" : "标记为生词 ⭐"}
              </button>
            )}

            <div className="spacer" />

            <button className="btn btn-ghost" onClick={handleRestart}>
              从头再来 ⟳
            </button>
            <button className="btn btn-primary" onClick={handleNext}>
              下一个单词 →
            </button>
          </div>

          <p className="text-small" style={{ marginTop: 10 }}>
            快捷键：1=不认识，2=标记⭐，→=下一个，R=重来
          </p >
        </div>
      </div>
    </div>
  );
}

export default WordPracticePage;