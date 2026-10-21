// src/SettingsPage.jsx
import { useEffect, useState } from "react";
import { API_BASE } from "./apiBase";
import { effectiveTheme, loadAppearance, saveAppearance, systemPrefersDark } from "./appearance";

const THEME_OPTIONS = [
  { value: "light", label: "白天", icon: "☀️" },
  { value: "dark", label: "黑夜", icon: "🌙" },
  { value: "eye", label: "护眼", icon: "🌿" },
];

const FONT_OPTIONS = [
  { value: "sm", label: "小" },
  { value: "md", label: "标准" },
  { value: "lg", label: "大" },
  { value: "xl", label: "特大" },
];

// Collapsible settings group
function Drawer({ title, desc, defaultOpen = false, children }) {
  return (
    <details className="drawer card" open={defaultOpen}>
      <summary className="drawer__head">
        <div>
          <div className="drawer__title">{title}</div>
          <div className="text-small">{desc}</div>
        </div>
        <svg className="drawer__chevron" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
          <path d="M5 7.5l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <div className="drawer__body">{children}</div>
    </details>
  );
}

// Applied and saved immediately; stored per browser, so each device can differ
function AppearanceSettings() {
  const [a, setA] = useState(loadAppearance);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const onChange = (e) => setSystemDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const update = (patch) => {
    const next = { ...a, ...patch };
    setA(next);
    saveAppearance(next);
  };

  const shown = a.followSystem ? (systemDark ? "dark" : "light") : effectiveTheme(a);

  return (
    <>
      <div className="settings-section settings-section--first">
        <div className="label">字体大小</div>
        <div className="segmented" role="radiogroup" aria-label="字体大小">
          {FONT_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={a.fontSize === o.value}
              className={a.fontSize === o.value ? "is-on" : ""}
              onClick={() => update({ fontSize: o.value })}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-section">
        <div className="label">主题</div>
        <div className="theme-options" role="radiogroup" aria-label="主题">
          {THEME_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={shown === o.value}
              className={`theme-option theme-option--${o.value} ${shown === o.value ? "is-on" : ""}`}
              onClick={() => update({ theme: o.value, followSystem: false })}
            >
              <span className="theme-option__swatch" aria-hidden="true">
                <span />
              </span>
              <span>
                {o.icon} {o.label}
                {a.followSystem && shown === o.value ? <span className="text-small">（系统）</span> : null}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="settings-section settings-switch-row">
        <div>
          <div className="label">白天 / 黑夜跟随系统</div>
          <div className="text-small">打开后按系统设置自动切换白天和黑夜。选择“护眼”会关闭跟随。</div>
        </div>
        <button
          className={`settings-switch ${a.followSystem ? "is-on" : ""}`}
          type="button"
          role="switch"
          aria-checked={a.followSystem}
          aria-label="白天 / 黑夜跟随系统"
          onClick={() =>
            update(
              a.followSystem
                ? { followSystem: false, theme: systemDark ? "dark" : "light" }
                : { followSystem: true }
            )
          }
        >
          <span />
        </button>
      </div>
      <p className="text-small">外观设置会立即生效，只保存在当前浏览器。</p>
    </>
  );
}

const MAX_GOAL = 500;
const GOAL_PRESETS = [20, 50, 100, 200];

const MIX_OPTIONS = [
  { value: "new", label: "纯新词", desc: "只学没见过的新词" },
  { value: "mixed", label: "穿插", desc: "新词为主，约三成是你点过“不认识”的词，均匀穿插" },
  { value: "review", label: "纯不熟悉词", desc: "只复习不熟悉的词，点“不认识”最多的排在前面" },
];

const clampGoal = (v) => Math.max(1, Math.min(MAX_GOAL, Math.round(Number(v) || 20)));

function SettingsPage() {
  const [exampleFirst, setExampleFirst] = useState(true);
  // Kept as text while typing so the field can be cleared; clamped on blur/save
  const [dailyGoal, setDailyGoal] = useState("20");
  const [studyMix, setStudyMix] = useState("mixed");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saveError, setSaveError] = useState(null);

  useEffect(() => {
    async function loadSettings() {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch(API_BASE + "/api/settings");
        if (!res.ok) throw new Error("Failed to load settings");
        const data = await res.json().catch(() => ({}));

        if (typeof data.exampleFirst === "boolean") setExampleFirst(data.exampleFirst);
        if (typeof data.dailyGoal === "number") setDailyGoal(String(clampGoal(data.dailyGoal)));
        if (MIX_OPTIONS.some((o) => o.value === data.studyMix)) setStudyMix(data.studyMix);
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
    const goal = clampGoal(dailyGoal);
    try {
      setSaving(true);
      setSaveError(null);
      setDailyGoal(String(goal));

      const res = await fetch(API_BASE + "/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exampleFirst, dailyGoal: goal, studyMix }),
      });
      if (!res.ok) throw new Error("Failed to save settings");

      setSaved(true);
      window.setTimeout(() => setSaved(false), 1500);
    } catch (err) {
      console.error("Failed to save settings:", err);
      setSaveError(err.message || "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  if (loading || error) {
    return (
      <div className="page">
        <div className="container">
          <div className="card card--medium state-card" style={{ margin: "0 auto" }}>
            {loading ? (
              <>
                <div className="spinner" />
                <p className="text-muted">正在加载设置…</p>
              </>
            ) : (
              <>
                <div className="state-card__title">设置加载失败</div>
                <p className="text-danger">{error}</p>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  const mixIndex = MIX_OPTIONS.findIndex((o) => o.value === studyMix);
  const mix = MIX_OPTIONS[mixIndex];

  return (
    <div className="page">
      <div className="container stack settings-page">
        <h1 className="title">设置</h1>

        <Drawer title="外观" desc="字体大小、白天 / 黑夜 / 护眼模式">
          <AppearanceSettings />
        </Drawer>

        <Drawer title="学习" desc="每日目标、学习内容、例句" defaultOpen>
          <div className="settings-section settings-section--first">
            <label className="label" htmlFor="dailyGoal">
              每日目标单词数
            </label>
            <div className="row settings-row">
              <input
                id="dailyGoal"
                className="input settings-number"
                type="number"
                inputMode="numeric"
                value={dailyGoal}
                onChange={(e) => setDailyGoal(e.target.value)}
                onBlur={() => setDailyGoal(String(clampGoal(dailyGoal)))}
                min={1}
                max={MAX_GOAL}
              />
              {GOAL_PRESETS.map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`chip ${Number(dailyGoal) === n ? "is-on" : ""}`}
                  onClick={() => setDailyGoal(String(n))}
                >
                  {n}
                </button>
              ))}
              <span className="text-small">范围 1–{MAX_GOAL}</span>
            </div>
          </div>

          <div className="settings-section">
            <label className="label" htmlFor="studyMix">
              学习内容
            </label>
            <div className="mix-slider">
              <input
                id="studyMix"
                type="range"
                min={0}
                max={MIX_OPTIONS.length - 1}
                step={1}
                value={mixIndex}
                onChange={(e) => setStudyMix(MIX_OPTIONS[Number(e.target.value)].value)}
                aria-valuetext={mix.label}
                style={{ "--fill": `${(mixIndex / (MIX_OPTIONS.length - 1)) * 100}%` }}
              />
              <div className="mix-slider__labels">
                {MIX_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    className={o.value === studyMix ? "is-on" : ""}
                    onClick={() => setStudyMix(o.value)}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="text-small" style={{ marginTop: 8 }}>
              {mix.desc}。答“不认识”比“认识”多的词算作不熟悉，多认识几次后会自动移出。
            </div>
          </div>

          <div className="settings-section settings-switch-row">
            <div>
              <div className="label">不认识时先看例句，再看释义</div>
              <div className="text-small">打开：先给例句提示，再显示释义；关闭：直接显示释义。暂时没有例句的词会显示提示，之后由 AI 自动生成。</div>
            </div>

            <button
              className={`settings-switch ${exampleFirst ? "is-on" : ""}`}
              type="button"
              role="switch"
              aria-checked={exampleFirst}
              aria-label="不认识时先看例句，再看释义"
              onClick={() => setExampleFirst((value) => !value)}
            >
              <span />
            </button>
          </div>

          <div className="row settings-actions">
            <button className="btn btn-primary" onClick={handleSave} type="button" disabled={saving}>
              {saving ? "保存中…" : "保存设置"}
            </button>

            {saved ? <span className="settings-saved">✓ 设置已保存</span> : null}
            {saveError ? <span className="text-danger">保存失败：{saveError}</span> : null}
          </div>
        </Drawer>
      </div>
    </div>
  );
}

export default SettingsPage;
