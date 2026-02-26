import { useEffect, useState } from "react";

export default function AddBookModal({ open, onClose, onCreate }) {
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");

  // ESC 关闭（保留）
  useEffect(() => {
    if (!open) return;

    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">添加词典</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose} type="button">
            关闭
          </button>
        </div>

        <div className="modal-body">
          <div className="field">
            <label className="label">词典名称</label>
            <input
              className="input"
              placeholder="例如：CET-6 高频词"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </div>

          <div className="field">
            <label className="label">描述（可选）</label>
            <input
              className="input"
              placeholder="例如：适合每天刷 40 个"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
            />
          </div>

          <div className="row" style={{ justifyContent: "flex-end", gap: 10 }}>
            <button className="btn btn-secondary" onClick={onClose} type="button">
              取消
            </button>
            <button
              className="btn btn-primary"
              type="button"
              disabled={!title.trim()}
              onClick={() => {
                onCreate({
                  id: `local_${Date.now()}`,
                  title: title.trim(),
                  desc: desc.trim() || "（暂无描述）",
                  tag: "Custom",
                  to: "/study",
                });
                onClose();
              }}
            >
              保存
            </button>
          </div>

          <div className="hint">提示：现在只是前端临时保存，未来再接数据库 / 上传。</div>
        </div>
      </div>
    </div>
  );
}