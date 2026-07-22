import React from "react";
import { Outlet } from "react-router-dom";
import { Navbar } from "./Navbar";

export function Layout() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--color-bg)",
        color: "var(--color-text)",
        fontFamily: "var(--font-sans)",
      }}
    >
      <Navbar />
      <main className="xcoder-main" style={{ padding: "var(--space-6)", maxWidth: "1280px", margin: "0 auto" }}>
        <Outlet />
      </main>
    </div>
  );
}


