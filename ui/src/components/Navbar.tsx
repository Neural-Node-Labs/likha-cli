import React, { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Badge } from "./ui/Badge";

const NAV_ITEMS: { to: string; label: string; adminOnly?: boolean }[] = [
  { to: "/", label: "Home" },
  { to: "/chat", label: "Chat" },
  { to: "/projects", label: "Projects" },
  { to: "/telemetry", label: "Telemetry" },
  { to: "/plans", label: "Plans" },
  { to: "/diagnostics", label: "Diagnostics" },
  { to: "/settings", label: "Settings" },
  { to: "/admin", label: "Admin", adminOnly: true },
];

/** Wordmark — a plain text/icon lockup instead of an image asset, so the nav never
 *  depends on a shippable logo file existing (see enhancement review §4). */
function Wordmark() {
  return (
    <Link
      to="/"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        textDecoration: "none",
        marginRight: "var(--space-6)",
      }}
    >
      <span
        aria-hidden
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "30px",
          height: "30px",
          borderRadius: "8px",
          background: "linear-gradient(135deg, var(--color-primary), var(--color-accent))",
          color: "#fff",
          fontFamily: "var(--font-mono)",
          fontWeight: 700,
          fontSize: "14px",
        }}
      >
        {">_"}
      </span>
      <span style={{ fontWeight: 700, fontSize: "var(--text-lg)", color: "var(--color-text)", letterSpacing: "-0.01em" }}>
        likha
      </span>
    </Link>
  );
}

export function Navbar() {
  const { isAuthenticated, isAdmin, user, logout } = useAuth();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  if (!isAuthenticated) return null;

  const isActive = (path: string) => location.pathname === path;
  const items = NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin);

  const linkStyle = (path: string): React.CSSProperties => ({
    color: isActive(path) ? "var(--color-primary)" : "var(--color-sidebar-text)",
    textDecoration: "none",
    padding: "8px 14px",
    borderRadius: "var(--radius-sm)",
    fontSize: "var(--text-sm)",
    fontWeight: isActive(path) ? 600 : 500,
    background: isActive(path) ? "color-mix(in srgb, var(--color-primary) 12%, transparent)" : "transparent",
    transition: "all 0.15s var(--ease)",
  });

  const UserBadge = (
    <span style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--color-text-secondary)", fontSize: "var(--text-sm)" }}>
      {user?.username}
      {user?.role === "admin" && <Badge tone="primary">Admin</Badge>}
    </span>
  );

  const LogoutButton = (
    <button className="xcoder-btn xcoder-btn--secondary" onClick={() => logout()}>
      Log out
    </button>
  );

  return (
    <nav
      style={{
        background: "var(--color-nav-bg)",
        borderBottom: "1px solid var(--color-border)",
        position: "sticky",
        top: 0,
        zIndex: 100,
      }}
    >
      <div
        style={{
          padding: "0 var(--space-6)",
          display: "flex",
          alignItems: "center",
          height: "60px",
          gap: "4px",
          maxWidth: "1280px",
          margin: "0 auto",
          width: "100%",
        }}
      >
        <Wordmark />

        {/* Full link row — hidden below the responsive breakpoint (see index.css) */}
        <div className="xcoder-nav-links" style={{ display: "flex", gap: "2px", flex: 1 }}>
          {items.map((item) => (
            <Link key={item.to} to={item.to} style={linkStyle(item.to)}>
              {item.label}
            </Link>
          ))}
        </div>

        {/* User info + logout — hidden below the breakpoint, moved into the mobile panel */}
        <div className="xcoder-nav-user" style={{ display: "flex", alignItems: "center", gap: "var(--space-4)" }}>
          {UserBadge}
          {LogoutButton}
        </div>

        {/* Hamburger — only shown below the responsive breakpoint */}
        <button
          className="xcoder-nav-toggle"
          onClick={() => setMobileOpen((v) => !v)}
          aria-expanded={mobileOpen}
          aria-label={mobileOpen ? "Close navigation menu" : "Open navigation menu"}
          style={{
            marginLeft: "auto",
            background: "transparent",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-sm)",
            color: "var(--color-text)",
            width: "36px",
            height: "36px",
            cursor: "pointer",
            fontSize: "18px",
            lineHeight: 1,
          }}
        >
          {mobileOpen ? "✕" : "☰"}
        </button>
      </div>

      {/* Mobile dropdown panel */}
      {mobileOpen && (
        <div
          className="xcoder-nav-mobile-panel"
          style={{
            borderTop: "1px solid var(--color-border)",
            padding: "var(--space-3) var(--space-4)",
            display: "flex",
            flexDirection: "column",
            gap: "4px",
          }}
        >
          {items.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              onClick={() => setMobileOpen(false)}
              style={{ ...linkStyle(item.to), padding: "10px 12px" }}
            >
              {item.label}
            </Link>
          ))}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginTop: "var(--space-2)",
              paddingTop: "var(--space-3)",
              borderTop: "1px solid var(--color-border)",
            }}
          >
            {UserBadge}
            {LogoutButton}
          </div>
        </div>
      )}
    </nav>
  );
}
