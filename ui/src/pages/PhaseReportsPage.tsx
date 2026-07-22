import React, { useState, useEffect } from "react";
import { api } from "../api/client";

/* ─── Types ─────────────────────────────────────────────────────────────── */

interface PhaseReportEntry {
  id: string;
  taskId: string;
  phaseNumber: number;
  phaseTitle: string;
  content: string;
  tokens: number;
  iterations: number;
  createdAt: string;
}

/* ─── Color Helpers ─────────────────────────────────────────────────────── */

function tokenColor(tokens: number): { color: string; label: string } {
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

/* ─── Phase Reports Page ────────────────────────────────────────────────── */

export function PhaseReportsPage() {
  const [reports, setReports] = useState<PhaseReportEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [taskIdFilter, setTaskIdFilter] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    loadReports();
  }, []);

  async function loadReports(taskId?: string) {
    setLoading(true);
    setError(null);
    try {
      // We need a taskId to query phase reports. If none provided, try to discover
      // task IDs from the task history first.
      if (!taskId) {
        // Try to get task history to find task IDs
        const historyRes = await api.getTaskHistory(undefined, 10);
        if (historyRes.success && historyRes.data?.tasks?.length) {
          // Load reports for the most recent task
          const recentTaskId = historyRes.data.tasks[0].id;
          await loadReportsForTask(recentTaskId);
          return;
        }
        setReports([]);
        setLoading(false);
        return;
      }
      await loadReportsForTask(taskId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
      setLoading(false);
    }
  }

  async function loadReportsForTask(taskId: string) {
    try {
      const res = await fetch(`/api/v1/phase-reports?taskId=${encodeURIComponent(taskId)}`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("xcoder_auth_token") ?? ""}`,
        },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error ?? `HTTP ${res.status}`);
        setReports([]);
        return;
      }
      const json = await res.json();
      if (json.success && json.data?.reports) {
        setReports(json.data.reports);
      } else {
        setError(json.error ?? "Failed to load phase reports");
        setReports([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
      setReports([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleSearch() {
    if (!taskIdFilter.trim()) {
      loadReports();
      return;
    }
    setLoading(true);
    setError(null);
    await loadReportsForTask(taskIdFilter.trim());
  }

  const sectionStyle: React.CSSProperties = {
    background: "var(--color-card-bg)",
    border: "1px solid var(--color-border)",
    borderRadius: "10px",
    padding: "24px",
    marginBottom: "16px",
  };

  // Group reports by taskId
  const grouped = reports.reduce<Record<string, PhaseReportEntry[]>>((acc, r) => {
    if (!acc[r.taskId]) acc[r.taskId] = [];
    acc[r.taskId].push(r);
    return acc;
  }, {});

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
        <h1 style={{ fontSize: "24px", fontWeight: 700, margin: 0 }}>Phase Reports</h1>
        <button
          onClick={() => loadReports()}
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

      {/* Search by task ID */}
      <div style={{ ...sectionStyle, padding: "12px 16px", display: "flex", gap: "8px", alignItems: "center" }}>
        <input
          type="text"
          value={taskIdFilter}
          onChange={(e) => setTaskIdFilter(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }}
          placeholder="Filter by task ID (leave empty for most recent)..."
          style={{
            flex: 1,
            padding: "8px 12px",
            borderRadius: "6px",
            border: "1px solid var(--color-border)",
            background: "var(--color-input-bg)",
            color: "var(--color-text)",
            fontSize: "13px",
            outline: "none",
          }}
        />
        <button
          onClick={handleSearch}
          style={{
            padding: "8px 16px",
            borderRadius: "6px",
            border: "none",
            background: "var(--color-primary)",
            color: "#fff",
            fontSize: "13px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Search
        </button>
      </div>

      {error && (
        <div style={{ ...sectionStyle, borderColor: "var(--color-error)" }}>
          <p style={{ color: "var(--color-error)", fontSize: "13px", margin: 0 }}>{error}</p>
        </div>
      )}

      {loading && (
        <div style={{ ...sectionStyle, textAlign: "center", color: "var(--color-text-secondary)", fontSize: "14px" }}>
          <span className="xcoder-spinner" aria-hidden="true" /> Loading phase reports...
        </div>
      )}

      {!loading && !error && reports.length === 0 && (
        <div style={{ ...sectionStyle, textAlign: "center", color: "var(--color-text-secondary)", fontSize: "14px", padding: "40px" }}>
          No phase reports found. Run a task with phase planning enabled to see reports here.
        </div>
      )}

      {!loading && Object.entries(grouped).map(([taskId, taskReports]) => (
        <div key={taskId} style={{ marginBottom: "24px" }}>
          <h2 style={{ fontSize: "16px", fontWeight: 600, margin: "0 0 12px 0", color: "var(--color-text-secondary)" }}>
            Task: <code style={{ fontSize: "13px", color: "var(--color-primary)" }}>{taskId}</code>
          </h2>

          {taskReports.map((report) => {
            const tColor = tokenColor(report.tokens);
            const iColor = iterationColor(report.iterations);
            const isExpanded = expandedId === report.id;

            return (
              <div
                key={report.id}
                style={{
                  ...sectionStyle,
                  cursor: "pointer",
                  transition: "border-color 0.15s ease",
                  borderColor: isExpanded ? "var(--color-primary)" : "var(--color-border)",
                  padding: "16px 20px",
                }}
                onClick={() => setExpandedId(isExpanded ? null : report.id)}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h3 style={{ fontSize: "14px", fontWeight: 600, margin: "0 0 2px 0", color: "var(--color-text)" }}>
                      Phase {report.phaseNumber}: {report.phaseTitle}
                    </h3>
                    <p style={{ fontSize: "11px", color: "var(--color-text-secondary)", margin: 0 }}>
                      {new Date(report.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: "6px", flexShrink: 0, flexWrap: "wrap" }}>
                    <StatBadge label="Tokens" value={report.tokens.toLocaleString()} color={tColor.color} />
                    <StatBadge label="Iterations" value={report.iterations} color={iColor.color} />
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
                      maxHeight: "400px",
                      overflowY: "auto",
                    }}
                  >
                    {report.content}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

