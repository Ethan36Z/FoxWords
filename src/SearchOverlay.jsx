// src/SearchOverlay.jsx

import { useEffect, useMemo, useRef, useState } from "react";
import { API_BASE } from "./apiBase";

function SearchOverlay({ open, onClose }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState([]);
  const [picked, setPicked] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  // ✅ 新增：加入生词本状态
  const [adding, setAdding] = useState(false);
  const [addMsg, setAddMsg] = useState(""); // 成功/失败提示
  const [notebookSet, setNotebookSet] = useState(() => new Set()); // 已加入的 word 集合

  const inputRef = useRef(null);

  // 打开时聚焦 + 清空旧状态
  useEffect(() => {
    if (open) {
      setErr(null);
      setPicked(null);
      setAddMsg("");
      setAdding(false);

      // ✅ 打开时同步拉一次 notebook，避免重复加入
      (async () => {
        try {
          const res = await fetch(`${API_BASE}/api/notebook?limit=200&offset=0`);
          const data = await res.json().catch(() => ({}));

          // 兼容：你后端现在返回 {items,total...}
          const list = Array.isArray(data) ? data : Array.isArray(data.items) ? data.items : [];
          const s = new Set(list.map((w) => String(w.word || "").trim()).filter(Boolean));
          setNotebookSet(s);
        } catch {
          // 拉不到也没关系，只是无法提前禁用按钮
          setNotebookSet(new Set());
        }
      })();

      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // 防抖搜索
  useEffect(() => {
    if (!open) return;
    const keyword = q.trim();
    if (!keyword) {
      setItems([]);
      setPicked(null);
      setErr(null);
      return;
    }

    const t = setTimeout(async () => {
      try {
        setLoading(true);
        setErr(null);

        const url = `${API_BASE}/api/dictionary?q=${encodeURIComponent(
          keyword
        )}&limit=8&offset=0`;

        const res = await fetch(url);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || "Search failed");

        setItems(Array.isArray(data) ? data : []);
      } catch (e) {
        setErr(String(e?.message || e));
        setItems([]);
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => clearTimeout(t);
  }, [q, open]);

  const showEmpty = useMemo(
    () => open && !q.trim() && !picked,
    [open, q, picked]
  );

  // ✅ 加入生词本
  const handleAddToNotebook = async () => {
    if (!picked || !picked.word) return;

    const w = String(picked.word).trim();
    if (!w) return;

    // 已经加入过：直接提示
    if (notebookSet.has(w)) {
      setAddMsg("已在生词本中 ✅");
      return;
    }

    try {
      setAdding(true);
      setAddMsg("");

      const payload = {
        word: w,
        translation: (picked.translation || "").trim(),
        definition: (picked.definition || "").trim(),
        example: (picked.example || "").trim(),
      };

      const res = await fetch(`${API_BASE}/api/notebook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const msg = data?.error || `Failed (${res.status})`;
        throw new Error(msg);
      }

      // ✅ 本地更新集合，立刻把按钮变成“已加入”
      setNotebookSet((prev) => {
        const next = new Set(prev);
        next.add(w);
        return next;
      });

      setAddMsg("加入成功 ✅");
    } catch (e) {
      setAddMsg(`加入失败：${String(e?.message || e)}`);
    } finally {
      setAdding(false);
    }
  };

  if (!open) return null;

  const pickedWord = String(picked?.word || "").trim();
  const alreadyInNotebook = pickedWord && notebookSet.has(pickedWord);

  return (
    <div className="so-backdrop" onMouseDown={onClose}>
      <div
        className="so-modal"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="so-header">
          <div className="so-title">Search Dictionary</div>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>
            Close
          </button>
        </div>

        <input
          ref={inputRef}
          className="input so-input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Type a word... (e.g. app)"
        />

        {showEmpty ? (
          <div className="text-muted so-tip">
            输入关键词开始搜索。按 Esc 也可以关闭 🙂
          </div>
        ) : null}

        {err ? <div className="text-danger so-tip">{err}</div> : null}

        <div className="so-body">
          <div className="so-list">
            <div className="so-list-title">
              Results {loading ? "· searching..." : ""}
            </div>

            {items.length === 0 && q.trim() && !loading ? (
              <div className="text-muted so-empty">No results.</div>
            ) : (
              items.map((it) => (
                <button
                  key={it.id ?? it.word}
                  className={`so-item ${
                    picked?.word === it.word ? "is-active" : ""
                  }`}
                  onClick={() => {
                    setPicked(it);
                    setAddMsg(""); // ✅ 换预览时清空提示
                  }}
                >
                  <div className="so-item-word">{it.word}</div>
                  <div className="so-item-zh">
                    {(it.translation || "").trim() || "（暂无中文）"}
                  </div>
                </button>
              ))
            )}
          </div>

          <div className="so-preview">
            <div className="so-list-title">Preview</div>

            {!picked ? (
              <div className="text-muted so-empty">
                Pick one result to preview.
              </div>
            ) : (
              <div className="card card--soft so-preview-card">
                <div className="so-preview-word">{picked.word}</div>

                <div className="so-preview-row">
                  <div className="so-preview-label">中文</div>
                  <div className="so-preview-value">
                    {(picked.translation || "").trim() || "（暂无）"}
                  </div>
                </div>

                <div className="so-preview-row">
                  <div className="so-preview-label">English</div>
                  <div className="so-preview-value">
                    {(picked.definition || "").trim() || "（暂无）"}
                  </div>
                </div>

                {picked.example ? (
                  <div className="so-preview-row">
                    <div className="so-preview-label">Example</div>
                    <div className="so-preview-value">{picked.example}</div>
                  </div>
                ) : null}

                {/* ✅ 新增：加入生词本按钮 */}
                <div className="so-actions">
                  <button
                    className="btn btn-primary"
                    onClick={handleAddToNotebook}
                    disabled={adding || alreadyInNotebook}
                  >
                    {alreadyInNotebook ? "已在生词本中" : adding ? "加入中..." : "加入生词本 ⭐"}
                  </button>

                  {addMsg ? (
                    <span className={addMsg.startsWith("加入失败") ? "text-danger" : "text-muted"}>
                      {addMsg}
                    </span>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="so-footer text-small">
          Tip: 这是“全局浮层”，不会打断 Study 进度。
        </div>
      </div>
    </div>
  );
}

export default SearchOverlay;