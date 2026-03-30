// src/App.jsx
import { useEffect, useState } from "react";
import { Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import { API_BASE } from "./apiBase";

import HomePage from "./HomePage";
import WordPracticePage from "./WordPracticePage";
import SettingsPage from "./SettingsPage";
import LoginPage from "./LoginPage";
import StoryReviewPage from "./StoryReviewPage";

import BooksPage from "./BooksPage";
import NotebookPage from "./NotebookPage";

// ✅ 只保留这一个
import SearchOverlay from "./SearchOverlay";



// ✅ 守门：缺 token 或 email 都算未登录（更合理）
function RequireAuth({ children }) {
  const token = localStorage.getItem("foxwords_token");
  const email = localStorage.getItem("foxwords_email");
  const location = useLocation();

  if (!token || !email) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return children;
}

function App() {

  console.log("🐾 API_BASE at runtime:", API_BASE);

  const [user, setUser] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);

  // ====== Global Search Overlay states ======
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [searchResults, setSearchResults] = useState([]);

  const navigate = useNavigate();
  const location = useLocation();
  const isLogin = location.pathname === "/login";

  // ✅ 启动恢复：只跑一次
  useEffect(() => {
    try {
      const email = localStorage.getItem("foxwords_email");
      const token = localStorage.getItem("foxwords_token");
      if (email && token) setUser({ email, token });
    } catch (e) {
      console.warn("localStorage not available:", e);
    }
  }, []);

  // ✅ 搜索：仅在浮层打开时，debounce 查询字典（避免每个字符都请求）/与Overlay功能重复
  useEffect(() => {
    if (!searchOpen) return;

    const q = String(searchQuery || "").trim();
    if (!q) {
      setSearchResults([]);
      setSearchError(null);
      setSearchLoading(false);
      return;
    }

    const controller = new AbortController();
    const t = setTimeout(async () => {
      try {
        setSearchLoading(true);
        setSearchError(null);

        const url = `${API_BASE}/api/dictionary?q=${encodeURIComponent(q)}&limit=20&offset=0`;
        const res = await fetch(url, { signal: controller.signal });
        const data = await res.json().catch(() => ({}));

        if (!res.ok) throw new Error(data?.error || "Search failed");

        setSearchResults(Array.isArray(data) ? data : []);
      } catch (e) {
        if (e.name !== "AbortError") {
          setSearchError(e.message || "Search failed");
          setSearchResults([]);
        }
      } finally {
        setSearchLoading(false);
      }
    }, 250);

    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [searchOpen, searchQuery]);

  // ✅ 点击加入生词本（给 SearchOverlay 用）
  async function addToNotebookFromSearch(wordObj) {
    const token = localStorage.getItem("foxwords_token") || "";

    const res = await fetch(`${API_BASE}/api/notebook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // 你现在后端不校验这个，但留着更“真实项目”
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        word: wordObj.word,
        translation: wordObj.translation || "",
        definition: wordObj.definition || "",
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || "Add failed");
    return data;
  }

  return (
  <div className="app-shell">
    {!isLogin && (
      <header className="app-header">
        <div className="app-header__inner">
          <div
            className="brand"
            onClick={() => {
              setMenuOpen(false);
              navigate("/");
            }}
            
          >
            FoxWords 🦊
          </div>

          <nav className="nav">
            <button className="btn btn-ghost btn-sm" onClick={() => navigate("/")}>
              Home
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate("/books")}>
              Books
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate("/study")}>
              Study
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate("/notebook")}>
              Notebook
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate("/review")}>
              Story
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate("/settings")}>
              Settings
            </button>
          </nav>

          {/* 右侧：搜索入口 + 头像菜单 */}
          <div className="header-right">
            <input
              className="input header-search"
              placeholder="Search word... (Enter)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => setSearchOpen(true)}
              onKeyDown={(e) => {
                if (e.key === "Enter") setSearchOpen(true);
                if (e.key === "Escape") setSearchOpen(false);
              }}
            />

            <div className="userbox">
              <div className="userbox-top">
                <button className="avatar-btn" onClick={() => setMenuOpen((prev) => !prev)}>
                  Q
                </button>
              </div>

              <div className="user-email">{user?.email || "未登录用户"}</div>

              {menuOpen && (
                <div className="menu">
                  <div
                    className="menu-item"
                    onClick={() => {
                      setMenuOpen(false);
                      navigate("/notebook");
                    }}
                  >
                    Notebook / 生词本
                  </div>

                  <div
                    className="menu-item"
                    onClick={() => {
                      setMenuOpen(false);
                      navigate("/settings");
                    }}
                  >
                    Settings / 设置
                  </div>

                  <div
                    className="menu-item menu-item--danger"
                    onClick={() => {
                      try {
                        localStorage.removeItem("foxwords_email");
                        localStorage.removeItem("foxwords_token");
                      } catch (e) {
                        console.warn("localStorage remove failed:", e);
                      }
                      setUser(null);
                      setMenuOpen(false);
                      navigate("/login");
                    }}
                  >
                    Logout
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>
    )}

    <main className={`app-main ${isLogin ? "app-main--login" : ""}`}>
      <Routes>
        <Route
          path="/login"
          element={
            <LoginPage
              apiBase={API_BASE}
              onLogin={(u) => {
                try {
                  if (u?.email) localStorage.setItem("foxwords_email", u.email);
                  if (u?.token) localStorage.setItem("foxwords_token", u.token);
                } catch (e) {
                  console.warn("localStorage set failed:", e);
                }

                setUser(u);

                const from = location.state?.from || "/";
                navigate(from, { replace: true });
              }}
            />
          }
        />

        <Route
          path="/"
          element={
            <RequireAuth>
              <HomePage onNavigate={(p) => navigate(p)} />
            </RequireAuth>
          }
        />
        <Route
          path="/books"
          element={
            <RequireAuth>
              <BooksPage onNavigate={(p) => navigate(p)} />
            </RequireAuth>
          }
        />
        <Route
          path="/notebook"
          element={
            <RequireAuth>
              <NotebookPage />
            </RequireAuth>
          }
        />
        <Route
          path="/study"
          element={
            <RequireAuth>
              <WordPracticePage />
            </RequireAuth>
          }
        />
        <Route
          path="/review"
          element={
            <RequireAuth>
              <StoryReviewPage />
            </RequireAuth>
          }
        />
        <Route
          path="/settings"
          element={
            <RequireAuth>
              <SettingsPage />
            </RequireAuth>
          }
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </main>

    {/* ✅ 全局搜索浮层挂在最外层，任何页面都能浮起来 */}
    <SearchOverlay
      open={searchOpen}
      onClose={() => setSearchOpen(false)}
      query={searchQuery}
      setQuery={setSearchQuery}
      loading={searchLoading}
      error={searchError}
      results={searchResults}
      onAdd={addToNotebookFromSearch}
    />
  </div>
);
}


export default App;