import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { Card } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";

interface HealthInfo {
  version: string;
  uptime: number;
}

interface DashboardCard {
  title: string;
  desc: string;
  link: string;
  icon: string;
}

const CARDS: DashboardCard[] = [
  { title: "Chat", desc: "Send tasks to the likha agent", link: "/chat", icon: "💬" },
  { title: "Projects", desc: "Manage workspaces and the active project", link: "/projects", icon: "📁" },
  { title: "Telemetry", desc: "View agent logs and telemetry data", link: "/telemetry", icon: "📊" },
  { title: "Diagnostics", desc: "Run health checks and view loaded skills", link: "/diagnostics", icon: "🩺" },
  { title: "Settings", desc: "Manage preferences, themes, and users", link: "/settings", icon: "⚙️" },
];

const ADMIN_CARD: DashboardCard = { title: "Admin", desc: "User management and system administration", link: "/admin", icon: "🛡️" };

export function HomePage() {
  const { user, isAdmin } = useAuth();
  const [health, setHealth] = useState<HealthInfo | null>(null);

  useEffect(() => {
    api.health().then((res) => {
      if (res.success && res.data) {
        setHealth(res.data as HealthInfo);
      }
    });
  }, []);

  const formatUptime = (seconds: number): string => {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const parts: string[] = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    return parts.join(" ") || "<1m";
  };

  const cards = isAdmin ? [...CARDS, ADMIN_CARD] : CARDS;

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "var(--space-4)",
          marginBottom: "var(--space-8)",
          padding: "var(--space-8) var(--space-6)",
          borderRadius: "var(--radius-lg)",
          border: "1px solid var(--color-border)",
          background: "linear-gradient(135deg, color-mix(in srgb, var(--color-primary) 14%, var(--color-bg-secondary)), var(--color-bg-secondary))",
        }}
      >
        <div>
          <h1 style={{ fontSize: "var(--text-2xl)", fontWeight: 800, letterSpacing: "-0.01em" }}>
            Welcome back, {user?.username}
          </h1>
          <p style={{ color: "var(--color-text-secondary)", fontSize: "var(--text-base)", marginTop: "var(--space-2)" }}>
            Here's an overview of your likha agent workspace.
          </p>
        </div>
        {health && <Badge tone="success">● Online</Badge>}
      </div>

      {health && (
        <div style={{ display: "flex", gap: "var(--space-4)", marginBottom: "var(--space-8)", flexWrap: "wrap" }}>
          <InfoStat label="API Version" value={health.version} />
          <InfoStat label="Uptime" value={formatUptime(health.uptime)} />
          <InfoStat label="Status" value="Online" tone="success" />
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
          gap: "var(--space-4)",
        }}
      >
        {cards.map((card) => (
          <Link key={card.link} to={card.link} style={{ textDecoration: "none", color: "inherit" }}>
            <Card interactive>
              <div
                style={{
                  fontSize: "22px",
                  width: "44px",
                  height: "44px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: "var(--radius-md)",
                  background: "color-mix(in srgb, var(--color-primary) 12%, transparent)",
                  marginBottom: "var(--space-4)",
                }}
              >
                {card.icon}
              </div>
              <h3 style={{ fontSize: "var(--text-md)", fontWeight: 600, marginBottom: "var(--space-1)" }}>{card.title}</h3>
              <p style={{ color: "var(--color-text-secondary)", fontSize: "var(--text-sm)" }}>{card.desc}</p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

function InfoStat({ label, value, tone }: { label: string; value: string; tone?: "success" }) {
  return (
    <Card padding="sm" style={{ minWidth: "150px", display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
      <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-secondary)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {label}
      </span>
      <span style={{ fontSize: "var(--text-lg)", fontWeight: 700, color: tone === "success" ? "var(--color-success)" : "var(--color-text)" }}>
        {value}
      </span>
    </Card>
  );
}
