// src/WordPracticePage.jsx
import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import { API_BASE } from "./apiBase";
import SpeakButton from "./SpeakButton";
import { speak } from "./speech";

/*
  Card flow
  recall  ── 认识 ──▶ check   ── 下一个 (records "known") ──▶ next word
     │                  └──── 记错了 (records "unknown") ──▶ meaning
     └──── 不认识 (records "unknown") ──▶ example* ── 看释义 ──▶ meaning ── 下一个 ──▶ next word
  * only when "先看例句" is on. Words without an example show a placeholder
    there for now; later the AI assistant will generate one.
  太简单 (any time in recall) records "easy": the word never shows up again.
*/

const MIX_LABEL = { new: "新词", mixed: "穿插复习", review: "不熟悉词" };
const BOOK_LABEL = {
  "": "全部单词",
  zk: "中考",
  gk: "高考",
  cet4: "四级",
  cet6: "六级",
  ky: "考研",
  ielts: "雅思",
  toefl: "托福",
};

async function postReview(word, result) {
  try {
    await fetch(`${API_BASE}/api/words/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ word, result }),
    });
  } catch (err) {
    console.error("Failed to save review:", err);
  }
}

// Wrap the studied word (and simple forms like "apples") in <mark>
function Highlight({ text, word }) {
  if (!text || !word) return text || null;
  const re = new RegExp(`\\b(${word.replace(/[^a-z]/gi, "")}[a-z]*)\\b`, "gi");
  const parts = text.split(re);
  return parts.map((part, i) => (i % 2 === 1 ? <mark key={i}>{part}</mark> : part));
}

function WordPracticePage() {
  const [words, setWords] = useState([]);
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState("recall");
  const [round, setRound] = useState({ known: 0, unknown: 0, easy: 0 });

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const [notebookWords, setNotebookWords] = useState(() => new Set());
  const [settings, setSettings] = useState({ exampleFirst: true, studyMix: "mixed", book: "" });

  // ===================== Load settings + notebook =====================
  useEffect(() => {
    fetch(`${API_BASE}/api/settings`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => data && setSettings((s) => ({ ...s, ...data })))
      .catch((err) => console.error("Failed to load settings:", err));

    fetch(`${API_BASE}/api/notebook?limit=100&offset=0`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const list = Array.isArray(data?.items) ? data.items : [];
        setNotebookWords(new Set(list.map((w) => w.word)));
      })
      .catch((err) => console.error("Failed to load notebook:", err));
  }, []);

  // ===================== Load today's batch =====================
  const loadTodayWords = useCallback(async (refresh = false) => {
    try {
      if (refresh) setRefreshing(true);
      else setLoading(true);
      setError(null);

      const res = await fetch(`${API_BASE}/api/words/today${refresh ? "?refresh=1" : ""}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Failed to load today words");

      setWords(Array.isArray(data) ? data : []);
      setIndex(0);
      setPhase("recall");
      setRound({ known: 0, unknown: 0, easy: 0 });
    } catch (err) {
      console.error(err);
      setError(err.message || "Failed to load today words");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadTodayWords(false);
  }, [loadTodayWords]);

  const current = words[index];
  const inNotebook = current ? notebookWords.has(current.word) : false;

  // ===================== Actions =====================
  const goNext = () => {
    setPhase("recall");
    setIndex((i) => i + 1);
  };

  const markUnknown = () => {
    if (!current) return;
    postReview(current.word, "unknown");
    setRound((r) => ({ ...r, unknown: r.unknown + 1 }));
    setPhase(settings.exampleFirst && phase === "recall" ? "example" : "meaning");
  };

  const markTooEasy = () => {
    if (!current) return;
    postReview(current.word, "easy");
    setRound((r) => ({ ...r, easy: r.easy + 1 }));
    goNext();
  };

  const markKnown = () => setPhase("check");

  const confirmKnown = () => {
    if (!current) return;
    postReview(current.word, "known");
    setRound((r) => ({ ...r, known: r.known + 1 }));
    goNext();
  };

  // Main "continue" action for Space / → / Enter
  const advance = () => {
    if (phase === "recall") goNext(); // skip without answering
    else if (phase === "check") confirmKnown();
    else if (phase === "example") setPhase("meaning");
    else goNext();
  };

  const restart = () => {
    setIndex(0);
    setPhase("recall");
    setRound({ known: 0, unknown: 0, easy: 0 });
  };

  const addToNotebook = async () => {
    if (!current || inNotebook) return;
    try {
      const res = await fetch(`${API_BASE}/api/notebook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          word: current.word,
          translation: current.translation,
          definition: current.definition,
        }),
      });
      // 409 means it was already there, which is fine
      if (res.ok || res.status === 409) {
        setNotebookWords((prev) => new Set(prev).add(current.word));
      }
    } catch (err) {
      console.error("Error adding to notebook:", err);
    }
  };

  // ===================== Keyboard shortcuts =====================
  const keysRef = useRef({});
  useEffect(() => {
    keysRef.current = {
      one: phase === "recall" ? markUnknown : phase === "check" ? markUnknown : null,
      two: phase === "recall" ? markKnown : phase === "check" ? confirmKnown : null,
      three: phase === "recall" ? markTooEasy : null,
      advance,
      star: addToNotebook,
      speak: () => current && speak(current.word),
      restart,
    };
  });

  useEffect(() => {
    const onKeyDown = (e) => {
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (tag === "BUTTON" && (e.key === " " || e.key === "Enter")) return; // let buttons handle these

      const k = keysRef.current;
      const map = {
        1: k.one,
        2: k.two,
        3: k.three,
        ArrowRight: k.advance,
        " ": k.advance,
        Enter: k.advance,
        s: k.star,
        S: k.star,
        p: k.speak,
        P: k.speak,
        r: k.restart,
        R: k.restart,
      };
      const fn = map[e.key];
      if (fn) {
        e.preventDefault();
        fn();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // ===================== Loading / error / finished =====================
  const stateScreen = (content) => (
    <div className="page">
      <div className="container stack wp">
        <div className="card state-card">{content}</div>
      </div>
    </div>
  );

  if (loading) {
    return stateScreen(
      <>
        <div className="spinner" />
        <p className="text-muted">正在准备今天的单词…</p>
      </>
    );
  }

  if (error) {
    return stateScreen(
      <>
        <div className="state-card__title">单词加载失败</div>
        <p className="text-danger">{error}</p>
        <div className="row">
          <button className="btn btn-primary" onClick={() => loadTodayWords(false)}>
            重试
          </button>
        </div>
      </>
    );
  }

  if (words.length === 0) {
    const reviewOnly = settings.studyMix === "review";
    return stateScreen(
      <>
        <div className="state-card__icon">{reviewOnly ? "🌱" : "📭"}</div>
        <div className="state-card__title">{reviewOnly ? "还没有不熟悉的词" : "没有可以学习的新词了"}</div>
        <p className="text-muted">
          {reviewOnly
            ? "学习时点“不认识”的词会记在这里。先去学一些新词吧。"
            : "词典里的词都学过了，可以切换到“不熟悉词”模式复习。"}
        </p>
        <div className="row">
          <Link className="btn btn-secondary" to="/settings">
            修改学习模式
          </Link>
          <button className="btn btn-primary" onClick={() => loadTodayWords(true)} disabled={refreshing}>
            {refreshing ? "加载中…" : "再试一次"}
          </button>
        </div>
      </>
    );
  }

  if (!current) {
    return stateScreen(
      <>
        <div className="state-card__icon">🎉</div>
        <div className="state-card__title">这一批完成啦</div>
        <div className="round-summary">
          <div>
            <div className="round-summary__value round-summary__value--known">{round.known}</div>
            <div className="text-small">认识</div>
          </div>
          <div>
            <div className="round-summary__value round-summary__value--unknown">{round.unknown}</div>
            <div className="text-small">不认识</div>
          </div>
          {round.easy > 0 ? (
            <div>
              <div className="round-summary__value">{round.easy}</div>
              <div className="text-small">太简单</div>
            </div>
          ) : null}
        </div>
        <p className="text-muted">不认识的词会记为“不熟悉”，之后的学习里会穿插出现。</p>
        <div className="row">
          <button className="btn btn-secondary" onClick={restart}>
            从头再来
          </button>
          <button className="btn btn-primary" onClick={() => loadTodayWords(true)} disabled={refreshing}>
            {refreshing ? "换一批中…" : "再来一批"}
          </button>
        </div>
      </>
    );
  }

  // ===================== Card =====================
  // With 先看例句 on, the example block always shows (placeholder if missing)
  const showExample = phase !== "recall" && (settings.exampleFirst || Boolean(current.example));
  const showMeaning = phase === "check" || phase === "meaning";
  const progress = ((index + 1) / words.length) * 100;

  return (
    <div className="page">
      <div className="container stack wp">
        {/* Compact header: title, mode, progress, refresh + restart */}
        <div className="wp-bar">
          <div className="wp-bar__row">
            <span className="wp-bar__title">今日学习</span>
            <span className="pill pill--light">{BOOK_LABEL[settings.book] ?? "全部单词"}</span>
            <span className="pill pill--light">{MIX_LABEL[settings.studyMix] || "新词"}</span>
            <span className="text-small">
              {index + 1} / {words.length}
            </span>
            <div className="spacer" />
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => loadTodayWords(true)}
              disabled={refreshing}
            >
              {refreshing ? "换一批中…" : "换一批"}
            </button>
            <button className="icon-btn" onClick={restart} title="从头再来 (R)" aria-label="从头再来">
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path
                  d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v4h4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
          <div className="wp-progress">
            <div className="wp-progress-bar" style={{ width: `${progress}%` }} />
          </div>
        </div>

        <div className="card wp-card">
          <div className="wp-card__top">
            <div className="wp-badges">
              {current.isReview && <span className="pill pill--warn">不熟悉</span>}
              {current.level && <span className="pill pill--light">{current.level}</span>}
            </div>
            <button
              className={`icon-btn star-btn ${inNotebook ? "is-on" : ""}`}
              onClick={addToNotebook}
              disabled={inNotebook}
              title={inNotebook ? "已在生词本" : "加入生词本 (S)"}
              aria-label={inNotebook ? "已在生词本" : "加入生词本"}
            >
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path
                  d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"
                  fill={inNotebook ? "currentColor" : "none"}
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>

          <div className="wp-word">
            <div className="wp-word-main">{current.word}</div>
            <div className="wp-phonetic">
              {current.phonetic ? <span>/{current.phonetic}/</span> : null}
              <SpeakButton text={current.word} />
            </div>
          </div>

          {phase === "recall" && <p className="wp-prompt">认识这个词吗？</p>}

          {showExample && (
            <div className="wp-section">
              <div className="wp-label">例句</div>
              {current.example ? (
                <div className="wp-box wp-example">
                  <div className="wp-example__en">
                    <span>
                      <Highlight text={current.example} word={current.word} />
                    </span>
                    <SpeakButton text={current.example} label="朗读例句" size="sm" rate={0.85} />
                  </div>
                  {showMeaning && current.exampleZh ? (
                    <div className="wp-example__zh">{current.exampleZh}</div>
                  ) : null}
                </div>
              ) : (
                // TODO: ask the AI assistant to generate an example here once it exists
                <div className="wp-box wp-example wp-example--empty">
                  这个词还没有例句，之后会由 AI 自动生成。
                </div>
              )}
            </div>
          )}

          {showMeaning && (
            <div className="wp-section">
              <div className="wp-grid">
                <div className="wp-k">中文</div>
                <div className="wp-v">{current.translation}</div>
                {current.definition ? (
                  <>
                    <div className="wp-k">英文释义</div>
                    <div className="wp-v wp-v--muted">{current.definition}</div>
                  </>
                ) : null}
              </div>
            </div>
          )}

          <div className="wp-answer">
            {phase === "recall" && (
              <>
                <button className="answer-btn answer-btn--unknown" onClick={markUnknown}>
                  不认识 <kbd className="kbd">1</kbd>
                </button>
                <button className="answer-btn answer-btn--known" onClick={markKnown}>
                  认识 <kbd className="kbd">2</kbd>
                </button>
                <button className="easy-btn wp-answer__full" onClick={markTooEasy}>
                  太简单，以后不再出现 <kbd className="kbd">3</kbd>
                </button>
              </>
            )}

            {phase === "check" && (
              <>
                <button className="btn btn-secondary btn-lg" onClick={markUnknown}>
                  记错了 <kbd className="kbd">1</kbd>
                </button>
                <button className="btn btn-primary btn-lg" onClick={confirmKnown}>
                  下一个 <kbd className="kbd kbd--on-accent">2</kbd>
                </button>
              </>
            )}

            {phase === "example" && (
              <>
                <button className="btn btn-secondary btn-lg" onClick={goNext}>
                  下一个
                </button>
                <button className="btn btn-primary btn-lg" onClick={() => setPhase("meaning")}>
                  看释义 <kbd className="kbd kbd--on-accent">␣</kbd>
                </button>
              </>
            )}

            {phase === "meaning" && (
              <button className="btn btn-primary btn-lg wp-answer__full" onClick={goNext}>
                下一个 <kbd className="kbd kbd--on-accent">␣</kbd>
              </button>
            )}
          </div>

          <div className="text-small wp-hotkeys">
            <span><kbd className="kbd">P</kbd> 发音</span>
            <span><kbd className="kbd">S</kbd> 加入生词本</span>
            <span><kbd className="kbd">→</kbd> 跳过 / 继续</span>
            <span><kbd className="kbd">R</kbd> 从头再来</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default WordPracticePage;
