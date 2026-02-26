// src/SettingsPage.jsx
import { useState, useEffect } from "react";
import { API_BASE } from "./apiBase";

function SettingsPage() {
  const [exampleFirst, setExampleFirst] = useState(true);
  const [dailyGoal, setDailyGoal] = useState(20);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // 组件加载时，从后端读取设置
  useEffect(() => {
    async function loadSettings() {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch(API_BASE + "/api/settings");
        if (!res.ok) {
          throw new Error("Failed to load settings");
        }

        const data = await res.json().catch(() => ({}));

        if (typeof data.exampleFirst === "boolean") {
          setExampleFirst(data.exampleFirst);
        }
        if (typeof data.dailyGoal === "number") {
          setDailyGoal(data.dailyGoal);
        }
      } catch (err) {
        console.error("Failed to load settings:", err);
        setError(err.message || "Failed to load settings");
      } finally {
        setLoading(false);
      }
    }

    loadSettings();
  }, []);

  const handleSave = async () => {
    const toSave = {
      exampleFirst,
      dailyGoal: Number(dailyGoal) || 10,
    };

    try {
      setError(null);

      const res = await fetch(API_BASE + "/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toSave),
      });

      if (!res.ok) {
        throw new Error("Failed to save settings");
      }

      setSaved(true);
      window.setTimeout(() => setSaved(false), 1500);
    } catch (err) {
      console.error("Failed to save settings:", err);
      setError(err.message || "Failed to save settings");
    }
  };

  if (loading) {
    return <div style={{ padding: 20 }}>Loading settings...</div>;
  }

  if (error) {
    return (
      <div style={{ padding: 20, color: "red" }}>
        Failed to load settings: {error}
      </div>
    );
  }

  return (
    <div className="page">
      <div className="container stack">
        <div className="card card--medium card--padded stack">
          <div>
            <h1 className="title">Settings ⚙️</h1>
            <p className="text-muted">调整一下你的 FoxWords 学习偏好。</p >
          </div>

          <div className="field">
            <label className="label">每日目标单词数</label>

            <div className="row settings-row">
              <input
                className="input settings-number"
                type="number"
                value={dailyGoal}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isNaN(v)) return;
                  const clamped = Math.max(1, Math.min(50, v));
                  setDailyGoal(clamped);
                }}
                min={1}
                max={50}
              />

              <span className="text-small">范围 1–50</span>
            </div>

            {dailyGoal === 50 && (
              <p className="hint">最多 50 个词/天（系统硬上限）</p >
            )}
          </div>

          <div className="field">
            <label className="settings-check">
              <input
                type="checkbox"
                checked={exampleFirst}
                onChange={(e) => setExampleFirst(e.target.checked)}
              />
              <span>
                先看例句，再看释义
                <span
                  className="text-small"
                  style={{ display: "block", marginTop: 4 }}
                >
                  勾选：三段式；取消：直接看释义
                </span>
              </span>
            </label>
          </div>

          <div className="row settings-actions">
            <button
              className="btn btn-primary"
              onClick={handleSave}
              type="button"
            >
              保存设置
            </button>

            {saved ? (
              <span className="pill settings-saved">已保存 ✅</span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export default SettingsPage;