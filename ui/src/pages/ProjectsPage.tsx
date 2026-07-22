import React, { useState, useEffect, useCallback } from "react";
import { api, Project, WorkspaceFile } from "../api/client";

/** Mirrors the server's slugify() in src/api/projectStore.ts, purely so the form can preview
 *  the folder name before the project is actually created. The server is the source of truth
 *  (and handles de-duplication with a -2/-3 suffix) — this is just a friendly hint. */
function previewSlug(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "project";
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [currentPath, setCurrentPath] = useState("");
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);

  const [showAddForm, setShowAddForm] = useState(false);
  const [editProject, setEditProject] = useState<Project | null>(null);
  const [formName, setFormName] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [formBusy, setFormBusy] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const showMessage = (type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 4000);
  };

  const loadProjects = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await api.listProjects();
      if (res.success && res.data) {
        setProjects(res.data);
        const active = res.data.find((p) => p.active);
        if (active && !selectedProjectId) setSelectedProjectId(active.id);
      } else {
        setLoadError(res.error ?? "Failed to load projects");
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load projects");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const loadFiles = useCallback(async (projectId: string, subPath: string) => {
    setFilesLoading(true);
    setFilesError(null);
    try {
      const res = await api.listProjectFiles(projectId, subPath);
      if (res.success && res.data) {
        setFiles(res.data.files);
      } else {
        setFilesError(res.error ?? "Failed to load files");
      }
    } catch (err) {
      setFilesError(err instanceof Error ? err.message : "Failed to load files");
    } finally {
      setFilesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedProjectId) loadFiles(selectedProjectId, currentPath);
  }, [selectedProjectId, currentPath, loadFiles]);

  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null;

  const closeForm = () => {
    setShowAddForm(false);
    setEditProject(null);
    setFormName("");
    setFormError(null);
  };

  const handleAdd = async () => {
    setFormError(null);
    if (!formName.trim()) {
      setFormError("Project name is required.");
      return;
    }
    setFormBusy(true);
    try {
      const res = await api.addProject(formName.trim());
      if (res.success && res.data) {
        showMessage("success", `Project "${res.data.name}" created at ${res.data.path}`);
        closeForm();
        loadProjects();
        setSelectedProjectId(res.data.id);
        setCurrentPath("");
      } else {
        setFormError(res.error ?? "Failed to add project");
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to add project");
    } finally {
      setFormBusy(false);
    }
  };

  const handleUpdate = async () => {
    if (!editProject) return;
    setFormError(null);
    if (!formName.trim()) {
      setFormError("Project name is required.");
      return;
    }
    setFormBusy(true);
    try {
      const res = await api.updateProject(editProject.id, { name: formName.trim() });
      if (res.success) {
        showMessage("success", "Project renamed");
        closeForm();
        loadProjects();
      } else {
        setFormError(res.error ?? "Failed to update project");
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to update project");
    } finally {
      setFormBusy(false);
    }
  };

  const handleDelete = async (project: Project) => {
    if (!confirm(`Remove "${project.name}" from xcoder? This won't delete files on disk.`)) return;
    try {
      const res = await api.deleteProject(project.id);
      if (res.success) {
        showMessage("success", `Project "${project.name}" removed`);
        if (selectedProjectId === project.id) {
          setSelectedProjectId(null);
          setFiles([]);
        }
        loadProjects();
      } else {
        showMessage("error", res.error ?? "Failed to remove project");
      }
    } catch (err) {
      showMessage("error", err instanceof Error ? err.message : "Failed to remove project");
    }
  };

  const handleActivate = async (id: string) => {
    try {
      const res = await api.activateProject(id);
      if (res.success) {
        loadProjects();
      } else {
        showMessage("error", res.error ?? "Failed to activate project");
      }
    } catch (err) {
      showMessage("error", err instanceof Error ? err.message : "Failed to activate project");
    }
  };

  const toggleIncludeInLlm = async (project: Project) => {
    try {
      const res = await api.updateProject(project.id, { includeInLlm: !project.includeInLlm });
      if (res.success) {
        loadProjects();
      } else {
        showMessage("error", res.error ?? "Failed to update project");
      }
    } catch (err) {
      showMessage("error", err instanceof Error ? err.message : "Failed to update project");
    }
  };

  const startEdit = (p: Project) => {
    setShowAddForm(false);
    setEditProject(p);
    setFormName(p.name);
    setFormError(null);
  };

  const handleDownload = async (project: Project) => {
    setDownloadingId(project.id);
    try {
      const result = await api.downloadProject(project.id, project.name);
      if (!result.success) showMessage("error", result.error ?? "Download failed");
    } finally {
      setDownloadingId(null);
    }
  };

  const handleCopyPath = async (project: Project) => {
    try {
      await navigator.clipboard.writeText(project.path);
      setCopiedId(project.id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      showMessage("error", "Couldn't copy — your browser may be blocking clipboard access");
    }
  };

  const handleDeleteFile = async (filePath: string) => {
    if (!selectedProjectId) return;
    if (!confirm(`Delete "${filePath}"? This cannot be undone.`)) return;
    try {
      const res = await api.deleteProjectFile(selectedProjectId, filePath);
      if (res.success) {
        loadFiles(selectedProjectId, currentPath);
      } else {
        showMessage("error", res.error ?? "Failed to delete file");
      }
    } catch (err) {
      showMessage("error", err instanceof Error ? err.message : "Failed to delete file");
    }
  };

  const pathBreadcrumbs = currentPath ? currentPath.split("/") : [];

  // ─── Styles (matches the rest of the app's theme system) ─────────────────

  const sectionStyle: React.CSSProperties = {
    background: "var(--color-card-bg)",
    border: "1px solid var(--color-border)",
    borderRadius: "10px",
    padding: "24px",
    marginBottom: "24px",
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "10px 12px",
    borderRadius: "6px",
    border: "1px solid var(--color-border)",
    background: "var(--color-input-bg)",
    color: "var(--color-text)",
    fontSize: "14px",
    outline: "none",
    boxSizing: "border-box",
    transition: "border-color 0.15s ease",
  };

  const btnStyle = (variant: "primary" | "danger" | "ghost" = "primary"): React.CSSProperties => ({
    padding: "8px 16px",
    borderRadius: "6px",
    border: variant === "ghost" ? "1px solid var(--color-border)" : "none",
    background:
      variant === "primary" ? "var(--color-primary)" : variant === "danger" ? "var(--color-error)" : "transparent",
    color: variant === "ghost" ? "var(--color-text-secondary)" : "#fff",
    fontSize: "13px",
    fontWeight: 600,
    cursor: "pointer",
    transition: "all 0.15s ease",
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
  });

  const previewBoxStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "10px 12px",
    borderRadius: "6px",
    background: "color-mix(in srgb, var(--color-primary) 8%, transparent)",
    border: "1px dashed color-mix(in srgb, var(--color-primary) 40%, transparent)",
    fontSize: "12px",
    fontFamily: "monospace",
    color: "var(--color-text-secondary)",
  };

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: "48px", color: "var(--color-text-secondary)" }}>
        Loading projects…
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <h1 style={{ fontSize: "24px", fontWeight: 700, marginBottom: "4px" }}>Projects</h1>
          <p style={{ color: "var(--color-text-secondary)", fontSize: "14px", margin: 0 }}>
            Manage projects and browse their workspace files
          </p>
        </div>
        <button
          onClick={() => {
            setEditProject(null);
            setFormName("");
            setFormError(null);
            setShowAddForm(true);
          }}
          style={btnStyle("primary")}
        >
          <span aria-hidden="true">＋</span> New project
        </button>
      </div>

      <p style={{ fontSize: "12px", color: "var(--color-text-secondary)", margin: "0 0 24px", display: "flex", alignItems: "center", gap: "6px" }}>
        <span aria-hidden="true">📁</span>
        Every project gets its own folder under <code style={{ fontFamily: "monospace" }}>./workspace</code> — xcoder creates and manages it for you, so there's nothing to configure.
      </p>

      {loadError && (
        <div style={{ ...sectionStyle, borderColor: "var(--color-error)", color: "var(--color-error)", fontSize: "13px" }}>
          Couldn't load projects: {loadError}{" "}
          <button onClick={loadProjects} style={{ ...btnStyle("ghost"), marginLeft: "8px", padding: "4px 10px" }}>
            Retry
          </button>
        </div>
      )}

      {message && (
        <div
          style={{
            padding: "10px 16px",
            borderRadius: "6px",
            marginBottom: "16px",
            fontSize: "13px",
            fontWeight: 500,
            background:
              message.type === "success"
                ? "color-mix(in srgb, var(--color-success) 15%, transparent)"
                : "color-mix(in srgb, var(--color-error) 15%, transparent)",
            color: message.type === "success" ? "var(--color-success)" : "var(--color-error)",
          }}
          role="status"
        >
          {message.text}
        </div>
      )}

      {(showAddForm || editProject) && (
        <div style={{ ...sectionStyle, borderColor: "var(--color-primary)" }}>
          <h2 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "16px" }}>
            {editProject ? "Rename project" : "New project"}
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px", maxWidth: "480px" }}>
            <div>
              <label htmlFor="proj-name" style={{ display: "block", marginBottom: "6px", fontSize: "13px", color: "var(--color-text-secondary)" }}>
                Project name
              </label>
              <input
                id="proj-name"
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g. My Cool App"
                style={inputStyle}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") (editProject ? handleUpdate : handleAdd)();
                }}
              />
            </div>

            {!editProject && (
              <div style={previewBoxStyle}>
                <span aria-hidden="true">📁</span>
                <span>
                  ./workspace/<strong>{previewSlug(formName) || "…"}</strong>
                </span>
              </div>
            )}
            {editProject && (
              <p style={{ fontSize: "12px", color: "var(--color-text-secondary)", margin: 0 }}>
                Renaming only changes the display name — the workspace folder on disk stays put.
              </p>
            )}

            {formError && <p style={{ color: "var(--color-error)", fontSize: "13px", margin: 0 }}>{formError}</p>}
            <div style={{ display: "flex", gap: "8px" }}>
              <button onClick={editProject ? handleUpdate : handleAdd} disabled={formBusy} style={{ ...btnStyle("primary"), opacity: formBusy ? 0.6 : 1 }}>
                {formBusy ? "Saving…" : editProject ? "Save changes" : "Create project"}
              </button>
              <button onClick={closeForm} style={btnStyle("ghost")}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {projects.length === 0 && !loadError ? (
        <div style={{ ...sectionStyle, textAlign: "center", padding: "56px 24px" }}>
          <div style={{ fontSize: "32px", marginBottom: "12px" }} aria-hidden="true">📁</div>
          <p style={{ fontSize: "15px", fontWeight: 600, marginBottom: "4px" }}>No projects yet</p>
          <p style={{ color: "var(--color-text-secondary)", fontSize: "14px", marginBottom: "20px" }}>
            Give it a name — xcoder creates the workspace folder for you under <code style={{ fontFamily: "monospace" }}>./workspace</code>.
          </p>
          <button onClick={() => setShowAddForm(true)} style={{ ...btnStyle("primary"), margin: "0 auto" }}>
            <span aria-hidden="true">＋</span> New project
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "24px" }}>
          {projects.map((p) => (
            <div
              key={p.id}
              onClick={() => {
                setSelectedProjectId(p.id);
                setCurrentPath("");
              }}
              style={{
                ...sectionStyle,
                marginBottom: 0,
                padding: "16px 20px",
                cursor: "pointer",
                borderColor: p.id === selectedProjectId ? "var(--color-primary)" : "var(--color-border)",
                background: p.active
                  ? "color-mix(in srgb, var(--color-primary) 6%, var(--color-card-bg))"
                  : "var(--color-card-bg)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "12px",
                flexWrap: "wrap",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: 0 }}>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleActivate(p.id);
                  }}
                  aria-label={p.active ? `${p.name} is the active project` : `Set ${p.name} as active project`}
                  aria-pressed={p.active}
                  title={p.active ? "Active project" : "Set as active"}
                  style={{
                    flexShrink: 0,
                    width: "16px",
                    height: "16px",
                    borderRadius: "50%",
                    border: p.active ? "5px solid var(--color-primary)" : "2px solid var(--color-border)",
                    background: "transparent",
                    cursor: "pointer",
                    padding: 0,
                  }}
                />
                <div style={{ minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: "14px", fontWeight: 600 }}>
                    {p.name}
                    {p.active && (
                      <span style={{ marginLeft: "8px", fontSize: "10px", fontWeight: 700, color: "var(--color-primary)", background: "color-mix(in srgb, var(--color-primary) 15%, transparent)", padding: "2px 6px", borderRadius: "4px", textTransform: "uppercase" }}>
                        Active
                      </span>
                    )}
                  </p>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "2px" }}>
                    <span aria-hidden="true" style={{ fontSize: "11px" }}>📁</span>
                    <p style={{ margin: 0, fontSize: "12px", color: "var(--color-text-secondary)", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "360px" }} title={p.path}>
                      {p.path}
                    </p>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCopyPath(p);
                      }}
                      title="Copy path"
                      style={{ background: "none", border: "none", color: "var(--color-text-secondary)", cursor: "pointer", fontSize: "11px", padding: "0 2px", flexShrink: 0 }}
                    >
                      {copiedId === p.id ? "✓ copied" : "copy"}
                    </button>
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "16px", flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "var(--color-text-secondary)", cursor: "pointer" }}>
                  <input type="checkbox" checked={p.includeInLlm} onChange={() => toggleIncludeInLlm(p)} />
                  Include in LLM context
                </label>
                <button onClick={() => handleDownload(p)} disabled={downloadingId === p.id} style={btnStyle("ghost")}>
                  {downloadingId === p.id ? "Zipping…" : "⬇ Download"}
                </button>
                <button onClick={() => startEdit(p)} style={btnStyle("ghost")}>
                  Rename
                </button>
                <button onClick={() => handleDelete(p)} style={btnStyle("danger")}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedProject && (
        <div>
          <h2 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "12px" }}>
            Workspace: {selectedProject.name}
          </h2>
          <div style={sectionStyle}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px", paddingBottom: "12px", borderBottom: "1px solid var(--color-border)", flexWrap: "wrap", gap: "8px" }}>
              <div style={{ fontSize: "12px", fontFamily: "monospace", color: "var(--color-text-secondary)" }}>
                <button onClick={() => setCurrentPath("")} style={{ background: "none", border: "none", color: "var(--color-primary)", cursor: "pointer", padding: 0, fontFamily: "monospace", fontSize: "12px" }}>
                  {selectedProject.name}
                </button>
                {pathBreadcrumbs.map((seg, i) => (
                  <span key={i}>
                    {" / "}
                    <button
                      onClick={() => setCurrentPath(pathBreadcrumbs.slice(0, i + 1).join("/"))}
                      style={{ background: "none", border: "none", color: "var(--color-primary)", cursor: "pointer", padding: 0, fontFamily: "monospace", fontSize: "12px" }}
                    >
                      {seg}
                    </button>
                  </span>
                ))}
              </div>
            </div>

            {filesError ? (
              <p style={{ color: "var(--color-error)", fontSize: "13px", textAlign: "center", padding: "24px" }}>{filesError}</p>
            ) : filesLoading ? (
              <p style={{ color: "var(--color-text-secondary)", fontSize: "13px", textAlign: "center", padding: "24px" }}>Loading files…</p>
            ) : files.length === 0 ? (
              <p style={{ color: "var(--color-text-secondary)", fontSize: "13px", textAlign: "center", padding: "24px" }}>
                This folder is empty.
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column" }}>
                {files.map((f) => (
                  <div
                    key={f.path}
                    onClick={() => f.isDir && setCurrentPath(f.path)}
                    style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 4px", borderBottom: "1px solid var(--color-border)", fontSize: "13px", cursor: f.isDir ? "pointer" : "default" }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <span aria-hidden="true">{f.isDir ? "📁" : "📄"}</span>
                      <span>{f.name}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                      {!f.isDir && (
                        <span style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                          {f.size > 1024 ? `${(f.size / 1024).toFixed(1)} KB` : `${f.size} B`}
                        </span>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteFile(f.path);
                        }}
                        style={{ background: "none", border: "none", color: "var(--color-error)", fontSize: "12px", cursor: "pointer" }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

