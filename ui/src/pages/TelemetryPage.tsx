import React, { useEffect, useState } from "react";
import { api } from "../api/client";
import { JsonViewer } from "../components/JsonViewer";

interface TelemetryEntry {
  timestamp?: string;
  data?: unknown;
  raw?: string;
}

export function TelemetryPage() {
  const [logFile, setLogFile] = useState("thinking");
  const [entries, setEntries] = useState<TelemetryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedEntries, setExpandedEntries] = useState<Set<number>>(new Set());
  const [taskFilter, setTaskFilter] = useState("");

  useEffect(() => {
    loadTelemetry();
  }, [logFile]);

  const loadTelemetry = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getTelemetry(logFile, 100);
      if (res.success && res.data) {
        const data = res.data as any;
        setEntries(data.entries ?? []);
      } else {
        setError(res.error ?? "Failed to load telemetry");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  const toggleEntry = (index: number) => {
    setExpandedEntries((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const filteredEntries = (() => {
    let result = entries;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((entry) => {
        const content = entry.data
          ? JSON.stringify(entry.data).toLowerCase()
          : (entry.raw ?? "").toLowerCase();
        return content.includes(q);
      });
    }
    if (taskFilter.trim()) {
      const tf = taskFilter.toLowerCase();
      result = result.filter((entry) => {
        const content = entry.data
          ? JSON.stringify(entry.data).toLowerCase()
          : (entry.raw ?? "").toLowerCase();
        return content.includes(tf);
      });
    }
    return result;
  })();

  const logFiles = ["thinking", "llm", "sys"];

  const sectionStyle: React.CSSProperties = {
    background: "var(--color-card-bg)",
    border: "1px solid var(--color-border)",
    borderRadius: "10px",
    padding: "24px",
  };

  /**
   * Extract the "thought" field from a telemetry entry for the collapsed view.
   */
  const getThoughtPreview = (entry: TelemetryEntry): string | null => {
    if (!entry.data) return null;
    const d = entry.data as Record<string, unknown>;
    if (d.thought && typeof d.thought === "string") {
      return d.thought;
    }
    // For llm.log entries, show a summary
    if (d.request || d.response) {
      return "[LLM call]";
    }
    // For sys.log entries, show context/message
    if (d.context || d.message) {
      return `[${d.context || "system"}] ${d.message || ""}`;
    }
    return null;
  };

  /**
   * Extract the task_id from a telemetry entry if present.
   */
  const getTaskId = (entry: TelemetryEntry): string | null => {
    if (!entry.data) return null;
    const d = entry.data as Record<string, unknown>;
    if (d.taskId && typeof d.taskId === "string") return d.taskId;
    return null;
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
        <div>
          <h1 style={{ fontSize: "24px", fontWeight: 700, marginBottom: "4px" }}>Telemetry</h1>
          <p style={{ color: "var(--color-text-secondary)", fontSize: "14px", margin: 0 }}>
            View agent logs and telemetry data
          </p>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          {logFiles.map((file) => (
            <button
              key={file}
              onClick={() => setLogFile(file)}
              style={{
                padding: "6px 14px",
                borderRadius: "6px",
                border: logFile === file ? "2px solid var(--color-primary)" : "1px solid var(--color-border)",
                background: logFile === file ? "color-mix(in srgb, var(--color-primary) 10%, transparent)" : "transparent",
                color: logFile === file ? "var(--color-primary)" : "var(--color-text-secondary)",
                fontSize: "13px",
                fontWeight: logFile === file ? 600 : 400,
                cursor: "pointer",
                textTransform: "capitalize",
                transition: "all 0.15s ease",
              }}
            >
              {file}
            </button>
          ))}
          <button
            onClick={loadTelemetry}
            style={{
              padding: "6px 14px",
              borderRadius: "6px",
              border: "1px solid var(--color-border)",
              background: "transparent",
              color: "var(--color-text-secondary)",
              fontSize: "13px",
              cursor: "pointer",
              marginLeft: "8px",
            }}
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Search and filter inputs */}
      <div style={{ display: "flex", gap: "12px", marginBottom: "16px" }}>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search telemetry entries..."
          aria-label="Search telemetry"
          style={{
            flex: 1,
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
        <input
          type="text"
          value={taskFilter}
          onChange={(e) => setTaskFilter(e.target.value)}
          placeholder="Filter by task ID..."
          aria-label="Filter by task ID"
          style={{
            width: "200px",
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

      {/* ReAct trace structure indicators */}
      <div
        style={{
          display: "flex",
          gap: "16px",
          marginBottom: "16px",
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            padding: "8px 14px",
            borderRadius: "6px",
            background: "color-mix(in srgb, var(--color-primary) 10%, transparent)",
            border: "1px solid var(--color-border)",
            fontSize: "12px",
            color: "var(--color-primary)",
            fontWeight: 500,
          }}
        >
          💭 Reason / Thought
        </div>
        <div
          style={{
            padding: "8px 14px",
            borderRadius: "6px",
            background: "color-mix(in srgb, var(--color-accent) 10%, transparent)",
            border: "1px solid var(--color-border)",
            fontSize: "12px",
            color: "var(--color-accent)",
            fontWeight: 500,
          }}
        >
          🔧 Action / Tool Call
        </div>
        <div
          style={{
            padding: "8px 14px",
            borderRadius: "6px",
            background: "color-mix(in srgb, var(--color-success) 10%, transparent)",
            border: "1px solid var(--color-border)",
            fontSize: "12px",
            color: "var(--color-success)",
            fontWeight: 500,
          }}
        >
          👁️ Observation / Result
        </div>
        <div
          style={{
            padding: "8px 14px",
            borderRadius: "6px",
            background: "color-mix(in srgb, var(--color-warning) 10%, transparent)",
            border: "1px solid var(--color-border)",
            fontSize: "12px",
            color: "var(--color-warning)",
            fontWeight: 500,
          }}
        >
          ⚡ Command Executed
        </div>
        <div
          style={{
            padding: "8px 14px",
            borderRadius: "6px",
            background: "color-mix(in srgb, var(--color-text-secondary) 10%, transparent)",
            border: "1px solid var(--color-border)",
            fontSize: "12px",
            color: "var(--color-text-secondary)",
            fontWeight: 500,
          }}
        >
          🔢 Token Usage
        </div>
      </div>

      {error && (
        <div
          style={{
            padding: "10px 16px",
            borderRadius: "6px",
            marginBottom: "16px",
            fontSize: "13px",
            background: "color-mix(in srgb, var(--color-error) 15%, transparent)",
            color: "var(--color-error)",
          }}
        >
          {error}
        </div>
      )}

      <div style={sectionStyle}>
        {loading ? (
          <p style={{ color: "var(--color-text-secondary)", textAlign: "center", padding: "40px" }}>
            Loading telemetry data...
          </p>
        ) : filteredEntries.length === 0 ? (
          <p style={{ color: "var(--color-text-secondary)", textAlign: "center", padding: "40px" }}>
            {searchQuery.trim()
              ? `No entries matching "${searchQuery}" in "${logFile}"`
              : `No telemetry entries found for "${logFile}"`}
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {filteredEntries.map((entry, i) => {
              const isExpanded = expandedEntries.has(i);
              const thoughtPreview = getThoughtPreview(entry);
              const taskId = getTaskId(entry);

              // Determine entry type for labeling
              const contentStr = entry.data
                ? JSON.stringify(entry.data).toLowerCase()
                : (entry.raw ?? "").toLowerCase();
              let typeLabel = "entry";
              let typeColor = "var(--color-text-secondary)";
              if (contentStr.includes("reason") || contentStr.includes("thought") || contentStr.includes("think")) {
                typeLabel = "Reason";
                typeColor = "var(--color-primary)";
              } else if (contentStr.includes("action") || contentStr.includes("tool")) {
                typeLabel = "Action";
                typeColor = "var(--color-accent)";
              } else if (contentStr.includes("observation") || contentStr.includes("result") || contentStr.includes("output")) {
                typeLabel = "Observation";
                typeColor = "var(--color-success)";
              } else if (contentStr.includes("command") || contentStr.includes("exec") || contentStr.includes("run")) {
                typeLabel = "Command";
                typeColor = "var(--color-warning)";
              } else if (contentStr.includes("token") || contentStr.includes("usage") || contentStr.includes("cost")) {
                typeLabel = "Token Usage";
                typeColor = "var(--color-text-secondary)";
              }

              return (
                <div
                  key={i}
                  onClick={() => toggleEntry(i)}
                  style={{
                    padding: "12px 16px",
                    borderRadius: "6px",
                    background: isExpanded ? "var(--color-bg-secondary)" : "transparent",
                    fontSize: "13px",
                    lineHeight: "1.5",
                    borderLeft: `3px solid ${typeColor}`,
                    cursor: "pointer",
                    transition: "background 0.15s ease",
                    userSelect: "none",
                  }}
                >
                  {/* Collapsed view: show thought preview only */}
                  {!isExpanded && (
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ fontSize: "12px", color: "var(--color-text-secondary)", flexShrink: 0 }}>
                        ▶
                      </span>
                      {taskId && (
                        <span
                          style={{
                            fontSize: "10px",
                            fontWeight: 600,
                            color: "var(--color-accent)",
                            padding: "1px 6px",
                            borderRadius: "3px",
                            background: "color-mix(in srgb, var(--color-accent) 15%, transparent)",
                            flexShrink: 0,
                          }}
                        >
                          #{taskId}
                        </span>
                      )}
                      <span
                        style={{
                          fontSize: "10px",
                          fontWeight: 600,
                          color: typeColor,
                          padding: "1px 6px",
                          borderRadius: "3px",
                          background: `color-mix(in srgb, ${typeColor} 15%, transparent)`,
                          textTransform: "uppercase",
                          flexShrink: 0,
                        }}
                      >
                        {typeLabel}
                      </span>
                      {entry.timestamp && (
                        <span style={{ color: "var(--color-text-secondary)", fontSize: "11px", fontFamily: "monospace", flexShrink: 0 }}>
                          {entry.timestamp}
                        </span>
                      )}
                      <span style={{ color: "var(--color-text)", fontSize: "13px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                        {thoughtPreview || (entry.data ? JSON.stringify(entry.data).slice(0, 120) : entry.raw?.slice(0, 120))}
                      </span>
                    </div>
                  )}

                  {/* Expanded view: full detail with JSON pretty-print */}
                  {isExpanded && (
                    <div>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: "8px",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                            ▼
                          </span>
                          {taskId && (
                            <span
                              style={{
                                fontSize: "10px",
                                fontWeight: 600,
                                color: "var(--color-accent)",
                                padding: "1px 6px",
                                borderRadius: "3px",
                                background: "color-mix(in srgb, var(--color-accent) 15%, transparent)",
                              }}
                            >
                              #{taskId}
                            </span>
                          )}
                          <span
                            style={{
                              fontSize: "10px",
                              fontWeight: 600,
                              color: typeColor,
                              padding: "1px 6px",
                              borderRadius: "3px",
                              background: `color-mix(in srgb, ${typeColor} 15%, transparent)`,
                              textTransform: "uppercase",
                            }}
                          >
                            {typeLabel}
                          </span>
                          {entry.timestamp && (
                            <span style={{ color: "var(--color-text-secondary)", fontSize: "11px", fontFamily: "monospace" }}>
                              {entry.timestamp}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* JSON pretty-print with syntax highlighting */}
                      <div
                        style={{
                          background: "#1e1e1e",
                          padding: "16px",
                          borderRadius: "6px",
                          fontSize: "12px",
                          lineHeight: "1.6",
                          overflowX: "auto",
                          fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Consolas', monospace",
                          color: "#d4d4d4",
                          maxHeight: "400px",
                          overflowY: "auto",
                        }}
                      >
                        {entry.data ? (
                          <JsonViewer data={entry.data} defaultExpandDepth={3} />
                        ) : (
                          <pre style={{ margin: 0, whiteSpace: "pre-wrap", color: "#d4d4d4" }}>
                            {entry.raw}
                          </pre>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

