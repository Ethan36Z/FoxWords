// src/SearchOverlay.jsx

import { useEffect, useMemo, useRef, useState } from "react";
import { API_BASE } from "./apiBase";
import SpeakButton from "./SpeakButton";

function SearchOverlay({ open, onClose }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState([]);
  const [searchedQ, setSearchedQ] = useState(""); // query the current results belong to
  const [picked, setPicked] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  const [adding, setAdding] = useState(false);
  const [addMsg, setAddMsg] = useState(""); // 成功/失败提示
  const [notebookSet, setNotebookSet] = useState(() => new Set()); // 已加入的 word 集合

  const inputRef = useRef(null);

  // Reset state and focus the input each time the overlay opens
  useEffect(() => {
    if (open) {
      setErr(null);
      setPicked(null);
      setAddMsg("");
      setAdding(false);

      // Load the notebook so words already saved show as added
      (async () => {
        try {
          const res = await fetch(`${API_BASE}/api/notebook?limit=200&offset=0`);
          const data = await res.json().catch(() => ({}));

          const list = Array.isArray(data) ? data : Array.isArray(data.items) ? data.items : [];
          const s = new Set(list.map((w) => String(w.word || "").trim()).filter(Boolean));
          setNotebookSet(s);
        } catch {
          setNotebookSet(new Set());
        }
      })();

      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // Esc closes the overlay
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Debounced search; aborts the previous request so late replies can't overwrite newer results
  useEffect(() => {
    if (!open) return;
    const keyword = q.trim();
    if (!keyword) {
      setItems([]);
      setPicked(null);
      setErr(null);
      return;
    }

    const controller = new AbortController();
    const t = setTimeout(async () => {
      try {
        setLoading(true);
        setErr(null);

        const url = `${API_BASE}/api/dictionary?q=${encodeURIComponent(
          keyword
        )}&limit=8&offset=0`;

        const res = await fetch(url, { signal: controller.signal });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || "Search failed");

        const list = Array.isArray(data) ? data : [];
        setItems(list);
        setSearchedQ(keyword);
        setPicked(list[0] || null);
        setAddMsg("");
      } catch (e) {
        if (e.name === "AbortError") return;
        setErr(String(e?.message || e));
        setItems([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);

    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [q, open]);

  const showEmpty = useMemo(
    () => open && !q.trim() && !picked,
    [open, q, picked]
  );

  const handleAddToNotebook = async () => {
    if (!picked || !picked.word) return;

    const w = String(picked.word).trim();
    if (!w) return;

    if (notebookSet.has(w)) {
      setAddMsg("已在生词本中");
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

      setNotebookSet((prev) => {
        const next = new Set(prev);
        next.add(w);
        return next;
      });

      setAddMsg("已加入生词本");
    } catch (e) {
      setAddMsg(`加入失败：${String(e?.message || e)}`);
    } finally {
      setAdding(false);
    }
  };

  // Up/Down moves through results, Enter adds the highlighted word
  const onInputKeyDown = (e) => {
    if (items.length === 0) return;
    const i = items.findIndex((it) => it.word === picked?.word);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      const next = items[(Math.max(i, 0) + step + items.length) % items.length];
      setPicked(next);
      setAddMsg("");
    } else if (e.key === "Enter" && picked) {
      e.preventDefault();
      handleAddToNotebook();
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
          <div className="so-title">查词典</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            关闭 <kbd className="kbd">Esc</kbd>
          </button>
        </div>

        <input
          ref={inputRef}
          className="input so-input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onInputKeyDown}
          placeholder="输入英文单词，例如 apple"
        />

        {showEmpty ? (
          <div className="text-muted so-tip">
            输入单词开始搜索。↑ ↓ 选择，Enter 加入生词本。
          </div>
        ) : null}

        {err ? <div className="text-danger so-tip">{err}</div> : null}

        <div className="so-body">
          <div className="so-list">
            <div className="so-list-title">
              结果 {loading ? "· 搜索中…" : ""}
            </div>

            {items.length === 0 && q.trim() && q.trim() === searchedQ && !loading ? (
              <div className="text-muted so-empty">没有找到这个词。</div>
            ) : (
              items.map((it) => (
                <button
                  key={it.id ?? it.word}
                  className={`so-item ${
                    picked?.word === it.word ? "is-active" : ""
                  }`}
                  onClick={() => {
                    setPicked(it);
                    setAddMsg("");
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
            <div className="so-list-title">详情</div>

            {!picked ? (
              <div className="text-muted so-empty">
                选择左侧的一个结果查看详情。
              </div>
            ) : (
              <div className="card card--soft so-preview-card">
                <div className="so-preview-head">
                  <div className="so-preview-word">{picked.word}</div>
                  {picked.phonetic ? <span className="phonetic">/{picked.phonetic}/</span> : null}
                  <SpeakButton text={picked.word} size="sm" />
                </div>

                <div className="so-preview-row">
                  <div className="so-preview-label">中文</div>
                  <div className="so-preview-value">
                    {(picked.translation || "").trim() || "（暂无）"}
                  </div>
                </div>

                <div className="so-preview-row">
                  <div className="so-preview-label">英文释义</div>
                  <div className="so-preview-value">
                    {(picked.definition || "").trim() || "（暂无）"}
                  </div>
                </div>

                {picked.example ? (
                  <div className="so-preview-row">
                    <div className="so-preview-label">例句</div>
                    <div className="so-preview-value">
                      {picked.example}
                      {picked.exampleZh ? <div className="text-muted">{picked.exampleZh}</div> : null}
                    </div>
                  </div>
                ) : null}

                <div className="so-actions">
                  <button
                    className="btn btn-primary"
                    onClick={handleAddToNotebook}
                    disabled={adding || alreadyInNotebook}
                  >
                    {alreadyInNotebook ? "已在生词本中" : adding ? "加入中…" : "加入生词本"}
                  </button>

                  {addMsg ? (
                    <span className={addMsg.startsWith("加入失败") ? "text-danger" : "text-success"}>
                      {addMsg}
                    </span>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default SearchOverlay;