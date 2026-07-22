import React from "react";
import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "80px 24px",
        textAlign: "center",
      }}
    >
      <span style={{ fontSize: "40px", marginBottom: "16px" }} aria-hidden="true">
        🧭
      </span>
      <h1 style={{ fontSize: "22px", fontWeight: 700, marginBottom: "8px" }}>Page not found</h1>
      <p style={{ color: "var(--color-text-secondary)", fontSize: "14px", marginBottom: "24px", maxWidth: "360px" }}>
        There's nothing at this address. Double-check the URL, or head back to the dashboard.
      </p>
      <Link
        to="/"
        style={{
          padding: "10px 20px",
          borderRadius: "6px",
          background: "var(--color-primary)",
          color: "#fff",
          fontSize: "14px",
          fontWeight: 600,
          textDecoration: "none",
        }}
      >
        Back to dashboard
      </Link>
    </div>
  );
}

