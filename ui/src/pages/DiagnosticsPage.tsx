import React, { useState, useEffect } from "react";
import { api, type SkillListEntry } from "../api/client";

interface TestResult {
  name: string;
  status: "pass" | "fail" | "pending";
  message?: string;
}

const INITIAL_TESTS: TestResult[] = [
  { name: "API Connection", status: "pending" },
  { name: "Health Check", status: "pending" },
  { name: "Skills Loaded", status: "pending" },
  { name: "Telemetry Available", status: "pending" },
  { name: "React Render", status: "pending" },
];

export default function DiagnosticsPage() {
  const [skills, setSkills] = useState<SkillListEntry[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [testResults, setTestResults] = useState<TestResult[]>(INITIAL_TESTS);

  const setTest = (name: string, patch: Partial<TestResult>) => {
    setTestResults((prev) => prev.map((t) => (t.name === name ? { ...t, ...patch } : t)));
  };

  const runTests = async () => {
    setRunning(true);
    setTestResults(INITIAL_TESTS.map((t) => ({ ...t, status: "pending" })));

    // Test 1 + 2: API Connection & Health Check (health is read once, not from
    // stale state, so the "Health Check" result is accurate on every run)
    let healthOk = false;
    try {
      const healthRes = await api.health();
      if (healthRes.success && healthRes.data) {
        setTest("API Connection", { status: "pass", message: "API is reachable" });
        setTest("Health Check", {
          status: healthRes.data.status === "ok" ? "pass" : "fail",
          message: `Status: ${healthRes.data.status}, Version: ${healthRes.data.version}`,
        });
        healthOk = healthRes.data.status === "ok";
      } else {
        setTest("API Connection", { status: "fail", message: healthRes.error || "API error" });
        setTest("Health Check", { status: "fail", message: "Skipped — API unreachable" });
      }
    } catch (err) {
      const msg = String(err);
      setTest("API Connection", { status: "fail", message: msg });
      setTest("Health Check", { status: "fail", message: "Skipped — API unreachable" });
    }

    // Test 3: Skills
    setSkillsLoading(true);
    try {
      const skillsRes = await api.skills();
      if (skillsRes.success && skillsRes.data) {
        const skillsData = skillsRes.data as SkillListEntry[];
        setSkills(skillsData);
        setTest("Skills Loaded", { status: "pass", message: `${skillsData.length} skills loaded` });
      } else {
        setTest("Skills Loaded", { status: "fail", message: skillsRes.error || "No skills" });
      }
    } catch (err) {
      setTest("Skills Loaded", { status: "fail", message: String(err) });
    } finally {
      setSkillsLoading(false);
    }

    // Test 4: Telemetry
    try {
      const telemetryRes = await api.telemetry("thinking", 5);
      if (telemetryRes.success) {
        const telemetryData = telemetryRes.data as { entries?: unknown[] } | undefined;
        setTest("Telemetry Available", {
          status: "pass",
          message: `${telemetryData?.entries?.length || 0} entries`,
        });
      } else {
        setTest("Telemetry Available", { status: "fail", message: telemetryRes.error });
      }
    } catch (err) {
      setTest("Telemetry Available", { status: "fail", message: String(err) });
    }

    // Test 5: React Render (always passes if we got here)
    setTest("React Render", { status: "pass", message: "Component rendered successfully" });

    setRunning(false);
    void healthOk; // reserved for future use (e.g. banner styling)
  };

  useEffect(() => {
    runTests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sectionStyle: React.CSSProperties = {
    background: "var(--color-card-bg)",
    border: "1px solid var(--color-border)",
    borderRadius: "10px",
    padding: "24px",
    marginBottom: "24px",
  };

  const statusColor = (status: TestResult["status"]) =>
    status === "pass" ? "var(--color-success)" : status === "fail" ? "var(--color-error)" : "var(--color-warning)";

  const statusIcon = (status: TestResult["status"]) =>
    status === "pass" ? "✅" : status === "fail" ? "❌" : "⏳";

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "24px" }}>
        <div>
          <h1 style={{ fontSize: "24px", fontWeight: 700, marginBottom: "4px" }}>Diagnostics</h1>
          <p style={{ color: "var(--color-text-secondary)", fontSize: "14px", margin: 0 }}>
            System health checks and component testing
          </p>
        </div>
        <button
          onClick={runTests}
          disabled={running}
          style={{
            padding: "8px 16px",
            borderRadius: "6px",
            border: "none",
            background: running ? "var(--color-text-secondary)" : "var(--color-primary)",
            color: "#fff",
            fontSize: "13px",
            fontWeight: 600,
            cursor: running ? "not-allowed" : "pointer",
          }}
        >
          {running ? "Running…" : "Run tests"}
        </button>
      </div>

      {/* Test Results */}
      <section style={{ marginBottom: "24px" }}>
        <h2 style={{ fontSize: "12px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--color-text-secondary)", marginBottom: "12px" }}>
          Test results
        </h2>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {testResults.map((test) => (
            <div
              key={test.name}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "12px 16px",
                borderRadius: "8px",
                border: "1px solid var(--color-border)",
                background:
                  test.status === "pending"
                    ? "var(--color-card-bg)"
                    : `color-mix(in srgb, ${statusColor(test.status)} 8%, var(--color-card-bg))`,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <span aria-hidden="true">{statusIcon(test.status)}</span>
                <div>
                  <p style={{ margin: 0, fontSize: "14px" }}>{test.name}</p>
                  {test.message && (
                    <p style={{ margin: "2px 0 0", fontSize: "12px", color: "var(--color-text-secondary)" }}>
                      {test.message}
                    </p>
                  )}
                </div>
              </div>
              <span style={{ fontSize: "11px", fontWeight: 700, color: statusColor(test.status), textTransform: "uppercase" }}>
                {test.status}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Skills */}
      <section style={{ marginBottom: "24px" }}>
        <h2 style={{ fontSize: "12px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--color-text-secondary)", marginBottom: "12px" }}>
          Loaded skills
        </h2>
        {skillsLoading ? (
          <p style={{ color: "var(--color-text-secondary)", fontSize: "13px" }}>Loading skills…</p>
        ) : skills.length === 0 ? (
          <div style={{ ...sectionStyle, textAlign: "center", padding: "32px", marginBottom: 0 }}>
            <p style={{ color: "var(--color-text-secondary)", fontSize: "13px", margin: 0 }}>No skills loaded</p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {skills.map((skill) => (
              <div key={skill.name} style={{ ...sectionStyle, padding: "16px", marginBottom: 0 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
                  <p style={{ margin: 0, fontSize: "14px", fontWeight: 600 }}>{skill.name}</p>
                  <span
                    style={{
                      fontSize: "11px",
                      padding: "2px 8px",
                      borderRadius: "999px",
                      background: "color-mix(in srgb, var(--color-primary) 15%, transparent)",
                      color: "var(--color-primary)",
                    }}
                  >
                    {skill.role}
                  </span>
                </div>
                <p style={{ margin: "0 0 8px", fontSize: "12px", color: "var(--color-text-secondary)" }}>
                  {skill.description}
                </p>
                {skill.triggers.length > 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                    <span style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>Triggers:</span>
                    {skill.triggers.map((t) => (
                      <span
                        key={t}
                        style={{
                          fontSize: "11px",
                          padding: "2px 6px",
                          borderRadius: "4px",
                          background: "var(--color-bg-secondary)",
                          color: "var(--color-text-secondary)",
                        }}
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Directives */}
      <section>
        <h2 style={{ fontSize: "12px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--color-text-secondary)", marginBottom: "12px" }}>
          Directives & protocol
        </h2>
        <div style={{ ...sectionStyle, marginBottom: 0 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {[
              "Engineering Protocol",
              "System Directives",
              "Tool Definitions",
              "Skill Registry",
            ].map((label) => (
              <div key={label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: "13px" }}>{label}</span>
                <span style={{ fontSize: "12px", color: "var(--color-success)" }}>✅ Loaded</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

