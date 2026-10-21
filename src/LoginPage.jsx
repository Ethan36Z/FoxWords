// src/LoginPage.jsx
import { useState } from "react";
import { API_BASE } from "./apiBase";

function LoginPage({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch(`${API_BASE}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      let data = {};
      try {
        data = await res.json();
      } catch {
        data = {};
      }

      if (!res.ok) {
        throw new Error(data.error || "Login failed");
      }

      // App stores the login and handles the redirect
      if (onLogin) {
        onLogin({ email: data.email, token: data.token });
      }
    } catch (err) {
      console.error("Login error:", err);
      setError(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page page--center login-page">
      <div className="card card--narrow card--padded login-card">
        <div className="login-brand">
          <span className="brand-mark" aria-hidden="true">🦊</span>
          <h1 className="title" style={{ margin: 0 }}>FoxWords</h1>
        </div>
        <p className="subtitle">登录后开始你的单词之旅。</p>

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label className="label" htmlFor="login-email">邮箱</label>
            <input
              id="login-email"
              className="input"
              type="email"
              autoComplete="username"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>

          <div className="field">
            <label className="label" htmlFor="login-password">密码</label>
            <input
              id="login-password"
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>

          {error && <p className="error">{error}</p>}

          <button type="submit" disabled={loading} className="btn btn-primary btn-block">
            {loading ? "登录中…" : "登录"}
          </button>
        </form>

        <p className="hint">
          演示账号：<code>test@example.com</code> / <code>123456</code>
        </p>
      </div>
    </div>
  );
}

export default LoginPage;