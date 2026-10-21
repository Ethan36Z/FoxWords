// src/App.jsx
import { useEffect, useRef, useState } from "react";
import { Routes, Route, Navigate, NavLink, useNavigate, useLocation } from "react-router-dom";
import { API_BASE } from "./apiBase";

import HomePage from "./HomePage";
import WordPracticePage from "./WordPracticePage";
import SettingsPage from "./SettingsPage";
import LoginPage from "./LoginPage";
import StoryReviewPage from "./StoryReviewPage";
import PatternsPage from "./PatternsPage";
import PatternPracticePage from "./PatternPracticePage";
import BooksPage from "./BooksPage";
import NotebookPage from "./NotebookPage";
import SearchOverlay from "./SearchOverlay";

const NAV_ITEMS = [
  { to: "/", label: "首页", end: true },
  { to: "/books", label: "词书" },
  { to: "/study", label: "学习" },
  { to: "/patterns", label: "句型" },
  { to: "/notebook", label: "生词本" },
  { to: "/review", label: "故事" },
];

// Logged in = both token and email are stored
function RequireAuth({ children }) {
  const token = localStorage.getItem("foxwords_token");
  const email = localStorage.getItem("foxwords_email");
  const location = useLocation();

  if (!token || !email) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return children;
}

function readStoredUser() {
  try {
    const email = localStorage.getItem("foxwords_email");
    const token = localStorage.getItem("foxwords_token");
    return email && token ? { email, token } : null;
  } catch {
    return null;
  }
}

function App() {
  const [user, setUser] = useState(readStoredUser);
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const menuRef = useRef(null);

  const navigate = useNavigate();
  const location = useLocation();
  const isLogin = location.pathname === "/login";

  // Close the account menu when clicking elsewhere
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  // "/" or Cmd/Ctrl+K opens dictionary search from anywhere
  useEffect(() => {
    if (isLogin) return;
    const onKey = (e) => {
      const tag = e.target?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isLogin]);

  const goTo = (path) => {
    setMenuOpen(false);
    navigate(path);
  };

  const logout = () => {
    try {
      localStorage.removeItem("foxwords_email");
      localStorage.removeItem("foxwords_token");
    } catch (e) {
      console.warn("localStorage remove failed:", e);
    }
    setUser(null);
    setMenuOpen(false);
    navigate("/login");
  };

  const initial = (user?.email || "?").trim().charAt(0).toUpperCase();

  return (
    <div className="app-shell">
      {!isLogin && (
        <header className="app-header">
          <div className="app-header__inner">
            <NavLink to="/" className="brand" aria-label="FoxWords 首页">
              <span className="brand-mark" aria-hidden="true">🦊</span>
              <span className="brand-name">FoxWords</span>
            </NavLink>

            <nav className="nav" aria-label="主导航">
              {NAV_ITEMS.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => `nav-link${isActive ? " is-active" : ""}`}
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>

            <div className="header-right">
              <button
                type="button"
                className="search-trigger"
                onClick={() => setSearchOpen(true)}
                aria-label="搜索单词"
              >
                <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
                  <circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
                  <path d="M13 13l4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
                <span className="search-trigger__text">搜索单词</span>
                <kbd className="kbd">/</kbd>
              </button>

              <div className="userbox" ref={menuRef}>
                <button
                  type="button"
                  className="avatar-btn"
                  onClick={() => setMenuOpen((prev) => !prev)}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  aria-label="账户菜单"
                >
                  {initial}
                </button>

                {menuOpen && (
                  <div className="menu" role="menu">
                    <div className="menu-head">
                      <div className="menu-head__label">已登录</div>
                      <div className="menu-head__email">{user?.email || "未登录用户"}</div>
                    </div>
                    <button type="button" className="menu-item" role="menuitem" onClick={() => goTo("/notebook")}>
                      生词本
                    </button>
                    <button type="button" className="menu-item" role="menuitem" onClick={() => goTo("/settings")}>
                      设置
                    </button>
                    <button type="button" className="menu-item menu-item--danger" role="menuitem" onClick={logout}>
                      退出登录
                    </button>
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

          <Route path="/" element={<RequireAuth><HomePage onNavigate={(p) => navigate(p)} /></RequireAuth>} />
          <Route path="/books" element={<RequireAuth><BooksPage onNavigate={(p) => navigate(p)} /></RequireAuth>} />
          <Route path="/notebook" element={<RequireAuth><NotebookPage /></RequireAuth>} />
          <Route path="/study" element={<RequireAuth><WordPracticePage /></RequireAuth>} />
          <Route path="/patterns" element={<RequireAuth><PatternsPage /></RequireAuth>} />
          <Route path="/patterns/practice" element={<RequireAuth><PatternPracticePage /></RequireAuth>} />
          <Route path="/review" element={<RequireAuth><StoryReviewPage /></RequireAuth>} />
          <Route path="/settings" element={<RequireAuth><SettingsPage /></RequireAuth>} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      {/* Global search overlay: it owns its own query, results and requests */}
      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}

export default App;
