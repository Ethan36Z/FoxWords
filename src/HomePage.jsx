import { useEffect, useState } from "react";
import { API_BASE } from "./apiBase";

const CARDS = [
  {
    to: "/study",
    icon: "📖",
    title: "开始今日学习",
    desc: "按每日目标抽一批单词，认识就过，不认识的会穿插复习。",
    cta: "开始练习 →",
  },
  {
    to: "/notebook",
    icon: "🗂️",
    title: "生词本",
    desc: "查看你标记过的生词，随时删除已经掌握的。",
    cta: "打开生词本 →",
  },
  {
    to: "/patterns",
    icon: "💬",
    title: "句型练习",
    desc: "按场景和难度挑选常用句型，自己造句再对照范例。",
    cta: "浏览句型 →",
  },
  {
    to: "/review",
    icon: "✨",
    title: "故事复习",
    desc: "用最近的生词生成一个小故事，在语境里复习。",
    cta: "生成故事 →",
  },
];

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return "夜深了";
  if (h < 12) return "早上好";
  if (h < 18) return "下午好";
  return "晚上好";
}

function HomePage({ onNavigate }) {
  const [stats, setStats] = useState({ words: null, goal: null, unfamiliar: null });

  useEffect(() => {
    const controller = new AbortController();
    const get = (path) =>
      fetch(`${API_BASE}${path}`, { signal: controller.signal }).then((r) => (r.ok ? r.json() : null));

    Promise.all([get("/api/notebook?limit=1&offset=0"), get("/api/settings"), get("/api/words/stats")])
      .then(([nb, settings, words]) => {
        setStats({
          words: typeof nb?.total === "number" ? nb.total : null,
          goal: typeof settings?.dailyGoal === "number" ? settings.dailyGoal : null,
          unfamiliar: typeof words?.unfamiliar === "number" ? words.unfamiliar : null,
        });
      })
      .catch(() => {});

    return () => controller.abort();
  }, []);

  return (
    <div className="page">
      <div className="container stack">
        <section className="home-hero">
          <div>
            <h2>{greeting()}，小狐狸 🦊</h2>
            <p className="text-muted">今天也来学几个新单词吧。</p>
          </div>

          <div className="home-stats">
            <div className="stat">
              <div className="stat__value">{stats.words ?? "–"}</div>
              <div className="stat__label">生词本单词</div>
            </div>
            <div className="stat">
              <div className="stat__value">{stats.unfamiliar ?? "–"}</div>
              <div className="stat__label">不熟悉词</div>
            </div>
            <div className="stat">
              <div className="stat__value">{stats.goal ?? "–"}</div>
              <div className="stat__label">每日目标</div>
            </div>
          </div>
        </section>

        <div className="home-grid">
          {CARDS.map((c) => (
            <button key={c.to} type="button" className="home-card" onClick={() => onNavigate(c.to)}>
              <span className="home-card__icon" aria-hidden="true">{c.icon}</span>
              <h3>{c.title}</h3>
              <p className="text-muted">{c.desc}</p>
              <span className="home-card-cta">{c.cta}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default HomePage;
