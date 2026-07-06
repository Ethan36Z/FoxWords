// src/SettingsPage.jsx
import { useEffect, useState } from "react";
import { API_BASE } from "./apiBase";

function SettingsPage() {
  const [exampleFirst, setExampleFirst] = useState(true);
  const [dailyGoal, setDailyGoal] = useState(30);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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
          setDailyGoal(Math.max(1, Math.min(50, data.dailyGoal)));
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
    const clampedGoal = Math.max(1, Math.min(50, Number(dailyGoal) || 30));
    const toSave = {
      exampleFirst,
      dailyGoal: clampedGoal,
    };

    try {
      setError(null);
      setDailyGoal(clampedGoal);

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
        <div className="card card--medium card--padded stack settings-card">
          <div>
            <h1 className="title">Settings ⚙️</h1>
          </div>

          <div className="field">
            <label className="label" htmlFor="dailyGoal">
              每日目标单词数
            </label>

            <div className="row settings-row">
              <input
                id="dailyGoal"
                className="input settings-number"
                type="number"
                value={dailyGoal}
                onChange={(e) => {
                  const value = Number(e.target.value);
                  if (Number.isNaN(value)) return;
                  setDailyGoal(Math.max(1, Math.min(50, value)));
                }}
                min={1}
                max={50}
              />

              <span className="text-small">范围 1–50</span>
            </div>
          </div>

          <div className="field settings-switch-row">
            <div>
              <div className="label">先看例句，再看释义</div>
              <div className="text-small">勾选：三段式；取消：直接看释义</div>
            </div>

            <button
              className={`settings-switch ${exampleFirst ? "is-on" : ""}`}
              type="button"
              role="switch"
              aria-checked={exampleFirst}
              aria-label="先看例句，再看释义"
              onClick={() => setExampleFirst((value) => !value)}
            >
              <span />
            </button>
          </div>

          <div className="row settings-actions">
            <button className="btn btn-primary" onClick={handleSave} type="button">
              保存设置
            </button>

            {saved ? <span className="settings-saved">✓ 设置已保存</span> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export default SettingsPage;
