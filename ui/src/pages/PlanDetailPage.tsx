import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { JsonViewer } from "../components/JsonViewer";

interface Plan {
  id: string;
  taskDescription: string;
  planContent: string;
  status: "active" | "completed" | "cancelled";
  createdAt: string;
  updatedAt: string;
}

interface PlanTask {
  id: string;
  planId: string;
  description: string;
  status: "pending" | "in_progress" | "completed" | "failed" | "skipped";
  order: number;
  createdAt: string;
  updatedAt: string;
}

const TASK_STATUSES = ["pending", "in_progress", "completed", "failed", "skipped"] as const;

const STATUS_COLORS: Record<string, string> = {
  pending: "var(--color-text-secondary)",
  in_progress: "var(--color-primary)",
  completed: "var(--color-success)",
  failed: "var(--color-error)",
  skipped: "var(--color-warning)",
};

export function PlanDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [tasks, setTasks] = useState<PlanTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newTaskDesc, setNewTaskDesc] = useState("");
  const [addingTask, setAddingTask] = useState(false);

  useEffect(() => {
    if (id) loadPlan(id);
  }, [id]);

  const loadPlan = async (planId: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getPlan(planId);
      if (res.success && res.data) {
        setPlan(res.data.plan ?? null);
        setTasks(res.data.tasks ?? []);
      } else {
        setError(res.error ?? "Failed to load plan");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  const updateTaskStatus = async (taskId: string, status: string) => {
    try {
      const res = await api.updateTaskStatus(id!, taskId, status);
      if (res.success) {
        setTasks((prev) =>
          prev.map((t) => (t.id === taskId ? { ...t, status: status as any, updatedAt: new Date().toISOString() } : t))
        );
      }
    } catch (err) {
      console.error("Failed to update task status:", err);
    }
  };

  const addTask = async () => {
    if (!newTaskDesc.trim()) return;
    setAddingTask(true);
    try {
      const res = await api.addPlanTask(id!, newTaskDesc.trim());
      if (res.success && res.data?.task) {
        const task = res.data.task;
        setTasks((prev) => [...prev, task]);
        setNewTaskDesc("");
      }
    } catch (err) {
      console.error("Failed to add task:", err);
    } finally {
      setAddingTask(false);
    }
  };

  const deleteTask = async (taskId: string) => {
    try {
      const res = await api.deletePlanTask(id!, taskId);
      if (res.success) {
        setTasks((prev) => prev.filter((t) => t.id !== taskId));
      }
    } catch (err) {
      console.error("Failed to delete task:", err);
    }
  };

  const updatePlanStatus = async (status: "active" | "completed" | "cancelled") => {
    try {
      const res = await api.updatePlanStatus(id!, status);
      if (res.success && plan) {
        setPlan({ ...plan, status, updatedAt: new Date().toISOString() });
      }
    } catch (err) {
      console.error("Failed to update plan status:", err);
    }
  };

  const sectionStyle: React.CSSProperties = {
    background: "var(--color-card-bg)",
    border: "1px solid var(--color-border)",
    borderRadius: "10px",
    padding: "24px",
    marginBottom: "16px",
  };

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: "60px", color: "var(--color-text-secondary)" }}>
        Loading plan...
      </div>
    );
  }

  if (error || !plan) {
    return (
      <div>
        <button onClick={() => navigate("/plans")} style={{ padding: "6px 14px", borderRadius: "6px", border: "1px solid var(--color-border)", background: "transparent", color: "var(--color-text-secondary)", fontSize: "13px", cursor: "pointer", marginBottom: "16px" }}>
          ← Back to Plans
        </button>
        <div style={{ ...sectionStyle, borderColor: "var(--color-error)" }}>
          <p style={{ color: "var(--color-error)", fontSize: "13px", margin: 0 }}>{error || "Plan not found"}</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "24px" }}>
        <button onClick={() => navigate("/plans")} style={{ padding: "6px 14px", borderRadius: "6px", border: "1px solid var(--color-border)", background: "transparent", color: "var(--color-text-secondary)", fontSize: "13px", cursor: "pointer" }}>
          ← Back
        </button>
        <h1 style={{ fontSize: "24px", fontWeight: 700, margin: 0, flex: 1 }}>Plan Details</h1>
      </div>

      {/* Plan info */}
      <div style={sectionStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
          <div>
            <h2 style={{ fontSize: "18px", fontWeight: 600, margin: "0 0 4px" }}>{plan.taskDescription}</h2>
            <p style={{ fontSize: "12px", color: "var(--color-text-secondary)", margin: 0 }}>
              Created: {new Date(plan.createdAt).toLocaleString()} · Updated: {new Date(plan.updatedAt).toLocaleString()}
            </p>
          </div>
          <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
            <span
              style={{
                padding: "3px 12px",
                borderRadius: "12px",
                fontSize: "12px",
                fontWeight: 600,
                textTransform: "uppercase",
                background: `color-mix(in srgb, ${STATUS_COLORS[plan.status]} 15%, transparent)`,
                color: STATUS_COLORS[plan.status],
              }}
            >
              {plan.status}
            </span>
          </div>
        </div>

        {/* Plan status actions */}
        {plan.status === "active" && (
          <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
            <button onClick={() => updatePlanStatus("completed")} style={{ padding: "6px 14px", borderRadius: "6px", border: "none", background: "var(--color-success)", color: "#fff", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}>
              Mark Completed
            </button>
            <button onClick={() => updatePlanStatus("cancelled")} style={{ padding: "6px 14px", borderRadius: "6px", border: "1px solid var(--color-error)", background: "transparent", color: "var(--color-error)", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}>
              Cancel Plan
            </button>
          </div>
        )}

        {/* Plan content */}
        <div>
          <h3 style={{ fontSize: "14px", fontWeight: 600, marginBottom: "8px", color: "var(--color-text-secondary)" }}>Plan Content</h3>
          <pre
            style={{
              background: "var(--color-bg-secondary)",
              padding: "16px",
              borderRadius: "6px",
              fontSize: "13px",
              lineHeight: "1.5",
              overflowX: "auto",
              whiteSpace: "pre-wrap",
              color: "var(--color-text)",
              margin: 0,
              maxHeight: "300px",
              overflowY: "auto",
            }}
          >
            {plan.planContent}
          </pre>
        </div>
      </div>

      {/* Tasks */}
      <div style={sectionStyle}>
        <h2 style={{ fontSize: "18px", fontWeight: 600, marginBottom: "16px" }}>
          Tasks ({tasks.length})
        </h2>

        {tasks.length === 0 ? (
          <p style={{ color: "var(--color-text-secondary)", fontSize: "13px" }}>
            No tasks in this plan yet.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {tasks.map((task) => (
              <div
                key={task.id}
                style={{
                  padding: "12px 16px",
                  borderRadius: "6px",
                  background: "var(--color-bg-secondary)",
                  border: "1px solid var(--color-border)",
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                }}
              >
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 600,
                    color: "var(--color-text-secondary)",
                    minWidth: "24px",
                  }}
                >
                  #{task.order + 1}
                </span>
                <span style={{ flex: 1, fontSize: "13px", color: "var(--color-text)" }}>
                  {task.description}
                </span>
                <select
                  value={task.status}
                  onChange={(e) => updateTaskStatus(task.id, e.target.value)}
                  style={{
                    padding: "4px 8px",
                    borderRadius: "4px",
                    border: `1px solid ${STATUS_COLORS[task.status]}`,
                    background: `color-mix(in srgb, ${STATUS_COLORS[task.status]} 10%, transparent)`,
                    color: STATUS_COLORS[task.status],
                    fontSize: "11px",
                    fontWeight: 600,
                    outline: "none",
                    cursor: "pointer",
                  }}
                >
                  {TASK_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s.replace("_", " ")}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => deleteTask(task.id)}
                  style={{
                    padding: "4px 8px",
                    borderRadius: "4px",
                    border: "1px solid var(--color-border)",
                    background: "transparent",
                    color: "var(--color-error)",
                    fontSize: "11px",
                    cursor: "pointer",
                  }}
                  title="Delete task"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Add task */}
        <div style={{ display: "flex", gap: "8px", marginTop: "16px" }}>
          <input
            type="text"
            value={newTaskDesc}
            onChange={(e) => setNewTaskDesc(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addTask();
            }}
            placeholder="Add a new task..."
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
            onClick={addTask}
            disabled={addingTask || !newTaskDesc.trim()}
            style={{
              padding: "8px 16px",
              borderRadius: "6px",
              border: "none",
              background: addingTask || !newTaskDesc.trim() ? "var(--color-text-secondary)" : "var(--color-primary)",
              color: "#fff",
              fontSize: "13px",
              fontWeight: 600,
              cursor: addingTask || !newTaskDesc.trim() ? "not-allowed" : "pointer",
            }}
          >
            {addingTask ? "..." : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}

