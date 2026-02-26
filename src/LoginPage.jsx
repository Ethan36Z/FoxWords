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

      // ✅ 只把结果交给 App，让 App 统一落盘 + 跳转
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
    <div className="page page--center">
      <div className="card card--narrow card--padded">
        <h1 className="title">FoxWords 🦊</h1>
        <p className="subtitle">Login to start your vocabulary journey.</p >

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label className="label">Email</label>
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>

          <div className="field">
            <label className="label">Password</label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>

          {error && <p className="error">{error}</p >}

          <button type="submit" disabled={loading} className="btn btn-primary btn-block">
            {loading ? "Logging in..." : "Login"}
          </button>
        </form>

        <p className="hint">
          Demo login · you can use <br />
          <code>test@example.com / 123456</code>
        </p >
      </div>
    </div>
  );
}

export default LoginPage;