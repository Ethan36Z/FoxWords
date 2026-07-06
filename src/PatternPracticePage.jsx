import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import patterns from "./data/pattern_seed.json";

const PROGRESS_KEY = "foxwords_pattern_progress";

function readProgress() {
  try {
    const value = JSON.parse(localStorage.getItem(PROGRESS_KEY) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function writePatternProgress(patternId, mastered) {
  const progress = readProgress();
  const now = new Date().toISOString();
  const existingIndex = progress.findIndex((item) => item.patternId === patternId);

  if (existingIndex >= 0) {
    const existing = progress[existingIndex];
    progress[existingIndex] = {
      ...existing,
      patternId,
      practiceCount: Number(existing.practiceCount || 0) + 1,
      mastered: mastered ? true : Boolean(existing.mastered),
      lastPracticedAt: now,
    };
  } else {
    progress.push({
      patternId,
      practiceCount: 1,
      mastered: Boolean(mastered),
      lastPracticedAt: now,
    });
  }

  localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
}

function getQueueFromSearch(search) {
  const params = new URLSearchParams(search);
  const id = params.get("id");

  if (id) {
    return patterns.filter((item) => item.id === id);
  }

  const scenario = params.get("scenario");
  const level = params.get("level");
  const frequency = Number(params.get("frequency") || "1");

  return patterns.filter((item) => {
    const matchesScenario = !scenario || item.scenarios.includes(scenario);
    const matchesLevel = !level || item.level === level;
    const matchesFrequency = Number(item.frequency) >= frequency;

    return matchesScenario && matchesLevel && matchesFrequency;
  });
}

function PatternPracticePage() {
  const navigate = useNavigate();
  const location = useLocation();

  const queue = useMemo(() => {
    const ids = Array.isArray(location.state?.patternIds) ? location.state.patternIds : [];
    if (ids.length > 0) {
      const byId = new Map(patterns.map((item) => [item.id, item]));
      return ids.map((id) => byId.get(id)).filter(Boolean);
    }

    return getQueueFromSearch(location.search);
  }, [location.search, location.state]);

  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const [showSample, setShowSample] = useState(false);
  const [practicedCount, setPracticedCount] = useState(0);
  const [masteredCount, setMasteredCount] = useState(0);

  const current = queue[index];
  const isComplete = queue.length > 0 && index >= queue.length;

  const resetCurrent = () => {
    setAnswer("");
    setShowSample(false);
  };

  const restartQueue = () => {
    setIndex(0);
    setPracticedCount(0);
    setMasteredCount(0);
    resetCurrent();
  };

  const moveNext = (mastered) => {
    if (!current) return;
    writePatternProgress(current.id, mastered);
    setPracticedCount((count) => count + 1);
    if (mastered) setMasteredCount((count) => count + 1);
    setIndex((value) => value + 1);
    resetCurrent();
  };

  if (queue.length === 0) {
    return (
      <div className="page">
        <div className="container stack wp">
          <div className="card card--padded wp-card">
            <h2 className="title">No patterns to practice</h2>
            <p className="text-muted">Try changing the Pattern Library filters.</p>
            <div className="wp-actions">
              <button className="btn btn-primary" type="button" onClick={() => navigate("/patterns")}>
                Back to Patterns
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (isComplete) {
    return (
      <div className="page">
        <div className="container stack wp">
          <div className="card card--padded wp-top">
            <div className="row">
              <div className="stack" style={{ gap: 6 }}>
                <h2 className="title">Pattern Practice</h2>
                <p className="text-muted">Session complete.</p>
              </div>
            </div>
            <div className="wp-progress">
              <div className="wp-progress-bar" style={{ width: "100%" }} />
            </div>
          </div>

          <div className="card card--padded wp-card pattern-practice-card">
            <div className="wp-word">
              <div className="wp-word-main">All done</div>
              <div className="wp-badges">
                <span className="pill">{queue.length} patterns</span>
              </div>
            </div>

            <div className="wp-grid pattern-summary-grid">
              <div className="wp-k">Practiced</div>
              <div className="wp-v">{practicedCount}</div>
              <div className="wp-k">Mastered</div>
              <div className="wp-v">{masteredCount}</div>
            </div>

            <div className="wp-actions">
              <button className="btn btn-secondary" type="button" onClick={restartQueue}>
                Practice again
              </button>
              <button className="btn btn-primary" type="button" onClick={() => navigate("/patterns")}>
                Back to Patterns
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const progressWidth = `${((index + 1) / queue.length) * 100}%`;
  const prompt = current.chinesePrompt || current.meaningZh;
  const sampleAnswer = current.sampleAnswers?.[0] || "";

  return (
    <div className="page">
      <div className="container stack wp">
        <div className="card card--padded wp-top">
          <div className="row">
            <div className="stack" style={{ gap: 6 }}>
              <h2 className="title">Pattern Practice</h2>
              <p className="text-muted">Practice one sentence pattern at a time.</p>
            </div>
            <div className="spacer" />
            <button className="btn btn-secondary" type="button" onClick={restartQueue}>
              Practice again
            </button>
          </div>

          <div className="wp-progress">
            <div className="wp-progress-bar" style={{ width: progressWidth }} />
          </div>

          <div className="row wp-meta">
            <span className="text-small">
              {index + 1} / {queue.length}
            </span>
            <span className="text-small">{current.level} · Frequency {current.frequency}/5</span>
          </div>
        </div>

        <div className="card card--padded wp-card pattern-practice-card">
          <div className="wp-word">
            <div className="wp-word-main pattern-prompt">{prompt}</div>
            <div className="wp-badges">
              <span className="pill">Pattern</span>
              {showSample && <span className="pill">Sample</span>}
            </div>
          </div>

          <div className="wp-section">
            <div className="wp-label">Pattern hint</div>
            <div className="wp-box pattern-hint">{current.pattern}</div>
          </div>

          <div className="wp-section">
            <div className="wp-label">Function</div>
            <div className="wp-box">{current.function}</div>
          </div>

          <label className="wp-section pattern-answer-field">
            <span className="wp-label">Your English sentence</span>
            <textarea
              className="input pattern-answer"
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              placeholder="Write your sentence here..."
              rows={5}
            />
          </label>

          {!showSample && (
            <div className="wp-actions">
              <button className="btn btn-primary" type="button" onClick={() => setShowSample(true)}>
                Show sample answer
              </button>
              <div className="spacer" />
              <button className="btn btn-ghost" type="button" onClick={() => navigate("/patterns")}>
                Back to Patterns
              </button>
            </div>
          )}

          {showSample && (
            <>
              <div className="wp-section">
                <div className="wp-label">Sample answer</div>
                <div className="wp-box pattern-sample-answer">{sampleAnswer}</div>
              </div>

              <div className="wp-actions">
                <button className="btn btn-secondary" type="button" onClick={resetCurrent}>
                  Practice again
                </button>
                <button className="btn btn-primary" type="button" onClick={() => moveNext(true)}>
                  Got it
                </button>
                <div className="spacer" />
                <button className="btn btn-ghost" type="button" onClick={() => moveNext(false)}>
                  Next pattern
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default PatternPracticePage;
