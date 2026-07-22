import React, { useState, useEffect } from "react";
import { api, TaskHistoryEntry } from "../api/client";

/* ─── Color Helpers ─────────────────────────────────────────────────────── */

function tokenColor(tokens: number | undefined): { color: string; label: string } {
  if (tokens == null) return { color: "var(--color-text-secondary)", label: "N/A" };
  if (tokens > 1_000_000) return { color: "#ef4444", label: "🔴 >1M" };
  if (tokens > 500_000) return { color: "#22c55e", label: "🟢 >500K" };
  return { color: "#3b82f6", label: "🔵 <500K" };
}

function iterationColor(iterations: number): { color: string; label: string } {
  if (iterations > 100) return { color: "#ef4444", label: "🔴 >100" };
  if (iterations > 50) return { color: "#22c55e", label: "🟢 >50" };
  return { color: "#3b82f6", label: "🔵 <20" };
}

/* ─── Badge Component ───────────────────────────────────────────────────── */

function StatBadge({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        padding: "2px 8px",
        borderRadius: "4px",
        fontSize: "11px",
        fontWeight: 600,
        color: "#fff",
        background: color,
        lineHeight: "18px",
      }}
    >
      {label}: {typeof value === "number" ? value.toLocaleString() : value}
    </span>
  );
}

/* ─── Task History Page ─────────────────────────────────────────────────── */

export function TaskHistoryPage() {
  const [tasks, setTasks] = useState<TaskHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    loadTasks();
  }, []);

  async function loadTasks() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getTaskHistory(undefined, 50);
      if (res.success && res.data) {
        setTasks(res.data.tasks);
      } else {
        setError(res.error ?? "Failed to load task history");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  }

  const sectionStyle: React.CSSProperties = {
    background: "var(--color-card-bg)",
    border: "1px solid var(--color-border)",
    borderRadius: "10px",
    padding: "24px",
    marginBottom: "16px",
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
        <h1 style={{ fontSize: "24px", fontWeight: 700, margin: 0 }}>Task History</h1>
        <button
          onClick={loadTasks}
          disabled={loading}
          style={{
            padding: "6px 14px",
            borderRadius: "6px",
            border: "1px solid var(--color-border)",
            background: "transparent",
            color: "var(--color-text-secondary)",
            fontSize: "13px",
            cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          {loading ? "Loading..." : "↻ Refresh"}
        </button>
      </div>

      {error && (
        <div style={{ ...sectionStyle, borderColor: "var(--color-error)" }}>
          <p style={{ color: "var(--color-error)", fontSize: "13px", margin: 0 }}>{error}</p>
        </div>
      )}

      {loading && (
        <div style={{ ...sectionStyle, textAlign: "center", color: "var(--color-text-secondary)", fontSize: "14px" }}>
          <span className="xcoder-spinner" aria-hidden="true" /> Loading task history...
        </div>
      )}

      {!loading && !error && tasks.length === 0 && (
        <div style={{ ...sectionStyle, textAlign: "center", color: "var(--color-text-secondary)", fontSize: "14px", padding: "40px" }}>
          No task history yet. Run a task in the Chat page to see it here.
        </div>
      )}

      {!loading && tasks.map((task) => {
        const tColor = tokenColor(task.totalTokens);
        const iColor = iterationColor(task.iterations);
        const isExpanded = expandedId === task.id;
        const date = new Date(task.timestamp);
        const localTimestamp = date.toLocaleString("en-US", {
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          timeZoneName: "short",
        });

        return (
          <div
            key={task.id}
            style={{
              ...sectionStyle,
              cursor: "pointer",
              transition: "border-color 0.15s ease",
              borderColor: isExpanded ? "var(--color-primary)" : "var(--color-border)",
            }}
            onClick={() => setExpandedId(isExpanded ? null : task.id)}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h3
                  style={{
                    fontSize: "14px",
                    fontWeight: 600,
                    margin: "0 0 4px 0",
                    color: "var(--color-text)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={task.task}
                >
                  {task.task}
                </h3>
                <p style={{ fontSize: "11px", color: "var(--color-text-secondary)", margin: 0 }}>
                  {localTimestamp}
                </p>
              </div>
              <div style={{ display: "flex", gap: "6px", flexShrink: 0, flexWrap: "wrap" }}>
                <StatBadge label="Tokens" value={task.totalTokens?.toLocaleString() ?? "N/A"} color={tColor.color} />
                <StatBadge label="Iterations" value={task.iterations} color={iColor.color} />
              </div>
            </div>

            {isExpanded && (
              <div
                style={{
                  marginTop: "12px",
                  paddingTop: "12px",
                  borderTop: "1px solid var(--color-border)",
                  fontSize: "13px",
                  lineHeight: "1.6",
                  color: "var(--color-text-secondary)",
                  whiteSpace: "pre-wrap",
                  maxHeight: "300px",
                  overflowY: "auto",
                }}
              >
                <strong style={{ color: "var(--color-text)" }}>Summary:</strong>
                <p style={{ margin: "4px 0 0 0" }}>{task.summary}</p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

