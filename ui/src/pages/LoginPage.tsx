import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { api } from "../api/client";

export function LoginPage() {
  const { login, register, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [checkingUsers, setCheckingUsers] = useState(true);

  // Check if any users exist — if not, show registration form
  useEffect(() => {
    const checkUserCount = async () => {
      try {
        const res = await api.getUserCount();
        if (res.success && res.data) {
          setIsRegisterMode(res.data.count === 0);
        }
      } catch {
        // If the endpoint fails, assume users exist (login mode)
        setIsRegisterMode(false);
      } finally {
        setCheckingUsers(false);
      }
    };
    checkUserCount();
  }, []);

  // If already authenticated, redirect to home
  React.useEffect(() => {
    if (isAuthenticated) {
      navigate("/", { replace: true });
    }
  }, [isAuthenticated, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!username.trim() || !password.trim()) {
      setError("Please enter both username and password");
      return;
    }

    if (isRegisterMode && password.length < 4) {
      setError("Password must be at least 4 characters");
      return;
    }

    setLoading(true);
    try {
      let err: string | null;
      if (isRegisterMode) {
        err = await register(username.trim(), password);
      } else {
        err = await login(username.trim(), password);
      }
      if (err) {
        setError(err);
      } else {
        navigate("/", { replace: true });
      }
    } catch {
      setError("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  if (checkingUsers) {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          minHeight: "100vh",
          background: "var(--color-bg)",
          color: "var(--color-text-secondary)",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        Loading...
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        minHeight: "100vh",
        background: "var(--color-bg)",
      }}
    >
      <div
        style={{
          background: "var(--color-card-bg)",
          border: "1px solid var(--color-border)",
          borderRadius: "12px",
          padding: "40px",
          width: "100%",
          maxWidth: "400px",
        }}
      >
        <h1
          style={{
            fontSize: "24px",
            fontWeight: 700,
            marginBottom: "8px",
            color: "var(--color-text)",
          }}
        >
          xcoder
        </h1>
        <p
          style={{
            color: "var(--color-text-secondary)",
            marginBottom: "32px",
            fontSize: "14px",
          }}
        >
          {isRegisterMode
            ? "No users found. Register as the first admin user."
            : "Sign in to access the dashboard"}
        </p>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: "16px" }}>
            <label
              htmlFor="username"
              style={{
                display: "block",
                marginBottom: "6px",
                fontSize: "13px",
                fontWeight: 500,
                color: "var(--color-text-secondary)",
              }}
            >
              Username
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter your username"
              autoFocus
              autoComplete="username"
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: "6px",
                border: "1px solid var(--color-border)",
                background: "var(--color-input-bg)",
                color: "var(--color-text)",
                fontSize: "14px",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>

          <div style={{ marginBottom: "24px" }}>
            <label
              htmlFor="password"
              style={{
                display: "block",
                marginBottom: "6px",
                fontSize: "13px",
                fontWeight: 500,
                color: "var(--color-text-secondary)",
              }}
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isRegisterMode ? "Choose a password (min 4 chars)" : "Enter your password"}
              autoComplete={isRegisterMode ? "new-password" : "current-password"}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: "6px",
                border: "1px solid var(--color-border)",
                background: "var(--color-input-bg)",
                color: "var(--color-text)",
                fontSize: "14px",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>

          {error && (
            <div
              style={{
                color: "var(--color-error)",
                fontSize: "13px",
                marginBottom: "16px",
                padding: "8px 12px",
                background: "color-mix(in srgb, var(--color-error) 10%, transparent)",
                borderRadius: "6px",
              }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              padding: "10px 16px",
              borderRadius: "6px",
              border: "none",
              background: loading ? "var(--color-text-secondary)" : "var(--color-primary)",
              color: "#fff",
              fontSize: "14px",
              fontWeight: 600,
              cursor: loading ? "not-allowed" : "pointer",
              transition: "background 0.15s ease",
            }}
          >
            {loading ? "Please wait..." : isRegisterMode ? "Register & Sign In" : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}

