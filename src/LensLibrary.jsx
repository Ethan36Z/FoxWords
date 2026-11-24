// Sentences captured with FoxWords Lens, imported from its JSON export
// (Lens → Library → Export). Meaning and expressions are Corvus output from
// Lens; new examples are labelled. Words of a sentence can go to the notebook.
import { useEffect, useRef, useState } from "react";
import { API_BASE } from "./apiBase";
import SpeakButton from "./SpeakButton";
import { sourceLabel } from "./lensLabels";

const day = (s) => (s ? String(s).slice(0, 10) : "");

async function postJson(url, body) {
  const res = await fetch(`${API_BASE}${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `请求失败 (${res.status})`);
  return data;
}

function ImportBox({ onImported }) {
  const fileRef = useRef(null);
  const [entries, setEntries] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const reset = () => {
    setEntries(null);
    setPreview(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const pick = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setMsg("");
    try {
      const data = JSON.parse(await file.text());
      setBusy(true);
      setPreview(await postJson("/api/lens/preview", data));
      setEntries(data);
    } catch (err) {
      reset();
      setMsg(err instanceof SyntaxError ? "这不是有效的 JSON 文件。" : err.message);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    try {
      setBusy(true);
      const r = await postJson("/api/lens/import", entries);
      setMsg(`已导入 ${r.imported} 句${r.duplicate ? `，跳过重复 ${r.duplicate} 句` : ""}${r.invalid ? `，无效 ${r.invalid} 条` : ""}。`);
      reset();
      onImported();
    } catch (err) {
      setMsg(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card card--soft lens-import">
      <div className="row row-between">
        <div>
          <div className="lens-import__title">从 FoxLens 导入</div>
          <div className="text-small">在 FoxLens 里打开 Library，选择 Export，再把 JSON 文件选到这里。</div>
        </div>
        <label className="btn btn-secondary btn-sm">
          选择文件
          <input ref={fileRef} type="file" accept=".json,application/json" onChange={pick} hidden />
        </label>
      </div>

      {preview ? (
        <div className="lens-import__preview">
          <div className="text-small">
            共 {preview.total} 条：新句子 {preview.fresh}，已存在 {preview.duplicate}
            {preview.invalid.length ? `，无法识别 ${preview.invalid.length}` : ""}
          </div>
          {preview.sample.length ? (
            <ul className="lens-import__sample">
              {preview.sample.map((s) => (
                <li key={s.id}>{s.sentence}</li>
              ))}
            </ul>
          ) : null}
          <div className="row">
            <button className="btn btn-primary btn-sm" onClick={confirm} disabled={busy || preview.fresh === 0}>
              {preview.fresh ? `导入 ${preview.fresh} 句` : "没有新句子"}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={reset} disabled={busy}>
              取消
            </button>
          </div>
        </div>
      ) : null}
      {msg ? <div className="text-small lens-import__msg">{msg}</div> : null}
    </div>
  );
}

function SentenceWords({ id }) {
  const [words, setWords] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`${API_BASE}/api/lens/${encodeURIComponent(id)}/words`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("加载失败"))))
      .then(setWords)
      .catch((err) => setError(err.message));
  }, [id]);

  const add = async (w) => {
    try {
      const res = await fetch(`${API_BASE}/api/notebook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ word: w.word, translation: w.translation, definition: w.definition }),
      });
      // 409: already in the notebook, which is fine
      if (res.ok || res.status === 409) {
        setWords((list) => list.map((x) => (x.word === w.word ? { ...x, inNotebook: true } : x)));
      }
    } catch {
      setError("加入生词本失败");
    }
  };

  if (error) return <div className="text-small text-danger">{error}</div>;
  if (!words) return <div className="text-small">正在查词…</div>;
  if (!words.length) return <div className="text-small">这句话里没有词典中的生词。</div>;
  return (
    <div className="lens-words">
      {words.map((w) => (
        <button
          key={w.word}
          type="button"
          className={`chip ${w.inNotebook ? "is-on" : ""}`}
          onClick={() => add(w)}
          disabled={w.inNotebook}
          title={w.meaning || w.translation.split("\n")[0]}
        >
          {w.inNotebook ? "✓ " : "+ "}
          {w.word}
          <span className="lens-words__zh">{(w.meaning || w.translation.split("\n")[0]).replace(/^[a-z]+\.\s*/, "")}</span>
        </button>
      ))}
    </div>
  );
}

function SentenceCard({ s, onDelete }) {
  const [showWords, setShowWords] = useState(false);
  return (
    <li className="lens-card">
      <div className="lens-card__head">
        <span className="pill pill--light">{sourceLabel(s.sourceKind)}</span>
        <span className="text-small">{day(s.capturedAt)}</span>
        <div className="spacer" />
        <button className="icon-btn icon-btn--sm" onClick={() => onDelete(s.id)} title="删除这句" aria-label="删除这句">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      <div className="lens-card__sentence">
        <span>{s.sentence}</span>
        <SpeakButton text={s.sentence} label="朗读句子" size="sm" rate={0.85} />
      </div>
      {s.meaning ? <div className="lens-card__meaning">{s.meaning}</div> : null}
      {s.caution ? <div className="text-small lens-card__caution">{s.caution}</div> : null}
      {s.expressions.length ? (
        <ul className="lens-exprs">
          {s.expressions.map((x, i) => (
            <li key={i}>
              <div>
                <b>{x.pattern || x.quote}</b>
                {x.meaning ? <span className="lens-exprs__zh">{x.meaning}</span> : null}
              </div>
              {x.usage ? <div className="text-small">{x.usage}</div> : null}
              {x.example ? (
                <div className="lens-exprs__example">
                  {x.example} <span className="ai-tag">Corvus 新例句</span>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      <button type="button" className="btn btn-ghost btn-sm lens-card__toggle" onClick={() => setShowWords((v) => !v)}>
        {showWords ? "收起" : "句中的词 → 加入生词本"}
      </button>
      {showWords ? <SentenceWords id={s.id} /> : null}
    </li>
  );
}

function LensLibrary() {
  const [items, setItems] = useState(null);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [error, setError] = useState("");

  const load = (query = q) => {
    fetch(`${API_BASE}/api/lens?limit=200&q=${encodeURIComponent(query)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("加载失败"))))
      .then((d) => {
        setItems(d.items);
        setTotal(d.total);
        setError("");
      })
      .catch((err) => setError(err.message));
  };

  useEffect(() => {
    load("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const remove = async (id) => {
    if (!window.confirm("从 FoxWords 删除这句话？（FoxLens 里的原记录不受影响）")) return;
    const res = await fetch(`${API_BASE}/api/lens/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (res.ok) load();
  };

  return (
    <div className="stack">
      <ImportBox onImported={() => load()} />
      {error ? <div className="card state-card text-danger">{error}</div> : null}
      {items === null ? (
        <div className="card state-card">
          <div className="spinner" />
        </div>
      ) : total === 0 && !q ? (
        <div className="card state-card">
          <div className="state-card__icon">🔎</div>
          <div className="state-card__title">还没有导入句子</div>
          <p className="text-muted">用 FoxLens 抓到的英文句子导入后会出现在这里，翻卡时也会提示你在哪里见过这个词。</p>
        </div>
      ) : (
        <div className="card nb-list">
          <div className="nb-list__toolbar">
            <input
              className="input"
              placeholder="在句子里查找（英文或中文）"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                load(e.target.value.trim());
              }}
            />
          </div>
          <ul className="lens-list">
            {items.map((s) => (
              <SentenceCard key={s.id} s={s} onDelete={remove} />
            ))}
            {items.length === 0 ? <li className="nb-row nb-row--empty text-muted">没有匹配的句子。</li> : null}
          </ul>
          <div className="nb-footer text-small">共 {total} 句</div>
        </div>
      )}
    </div>
  );
}

export default LensLibrary;
