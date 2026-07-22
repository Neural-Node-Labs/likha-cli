const API_BASE = "/api/v1";

// ─── Token Management ───────────────────────────────────────────────────────

const TOKEN_KEY = "xcoder_auth_token";
const USER_KEY = "xcoder_auth_user";

export interface AuthUser {
  username: string;
  role: "admin" | "user";
}

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): AuthUser | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function storeAuth(token: string, user: AuthUser): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearAuth(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

/** Alias for storeAuth — used by api/AuthContext.tsx */
export const setAuth = storeAuth;

/** Get the current user from localStorage. */
export function getCurrentUser(): AuthUser | null {
  return getStoredUser();
}

/** Check if the user is authenticated (has a stored token). */
export function isAuthenticated(): boolean {
  return getStoredToken() !== null;
}

/** Check if the stored user has admin role. */
export function isAdmin(): boolean {
  const user = getStoredUser();
  return user?.role === "admin";
}

// ─── API Response Types ─────────────────────────────────────────────────────

interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

interface LoginResponse {
  token: string;
  username: string;
  role: "admin" | "user";
}

interface HealthResponse {
  status: string;
  version: string;
  uptime: number;
}

export interface User {
  id: string;
  username: string;
  role: "admin" | "user";
  createdAt: string;
}

export interface SkillListEntry {
  name: string;
  role: string;
  description: string;
  triggers: string[];
  composes_with: string[];
}

export interface Project {
  id: string;
  name: string;
  path: string;
  active: boolean;
  includeInLlm: boolean;
  createdAt: string;
}

export interface WorkspaceFile {
  name: string;
  path: string;
  size: number;
  isDir: boolean;
}

export interface TaskHistoryEntry {
  id: string;
  task: string;
  summary: string;
  timestamp: string;
  iterations: number;
  totalTokens?: number;
}

export interface UsageInfo {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  reasoningTokens?: number;
}

/** Mirrors the CLI's flags — see src/cli/index.ts in xcoder-core for the source of truth. */
export interface ChatOptions {
  planMode?: "auto" | "always" | "never";
  /** When true, keeps every historical copy of read_tool file snapshots in context instead of
   *  collapsing stale ones (lean-token compaction is the default). Default: false. */
  fullContextToken?: boolean;
  isolatedWorkspace?: boolean;
  maxIterations?: number;
  projectId?: string;
  /** When true, the orchestrator auto-continues past the iteration limit instead of stopping.
   *  Used by the UI's "Continue" button when a limitation message is shown. */
  continueOnLimit?: boolean;
  /** When true, enables phase-based planning: the task is divided into multiple phases, each
   *  with isolated ReAct memory to reduce token footprint. Default: false. */
  phasePlanning?: boolean;
}

export interface ChatResult {
  result: string;
  iterations: number;
  plan?: string;
  sessionId?: string;
  usage?: UsageInfo;
  healthScore?: number;
  limitation?: string;
  /** When present, a subagent hit its iteration limit and the preserved context is included
   *  so the UI can re-send it with continueOnLimit: true to resume the subagent without
   *  losing progress. */
  subagentContext?: {
    lastThought: string;
    toolCalls: string[];
    observations: string[];
    iterationCount: number;
  };
}

// ─── HTTP Helpers ───────────────────────────────────────────────────────────

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal
): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  const token = getStoredToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });

  // Guard against non-JSON responses (e.g. proxy HTML error pages, 404 catch-all pages)
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    const text = await res.text();
    throw new Error(
      `Server returned non-JSON response (HTTP ${res.status}, Content-Type: ${contentType}): ${text.slice(0, 300)}`
    );
  }

  const json: ApiResponse<T> = await res.json();

  // If we get a 401/403, clear auth state (token expired/invalid)
  if ((res.status === 401 || res.status === 403) && token) {
    clearAuth();
    window.dispatchEvent(new CustomEvent("auth:logout"));
  }

  return json;
}

// ─── API Methods ────────────────────────────────────────────────────────────

export const api = {
  /** Login with username/password. Returns token + user info. */
  async login(username: string, password: string): Promise<ApiResponse<LoginResponse>> {
    return request<LoginResponse>("POST", "/login", { username, password });
  },

  /** Register the first user (only works when no users exist). Returns token + user info. */
  async register(username: string, password: string): Promise<ApiResponse<LoginResponse>> {
    return request<LoginResponse>("POST", "/register", { username, password });
  },

  /** Check how many users exist (no auth required). */
  async getUserCount(): Promise<ApiResponse<{ count: number }>> {
    return request<{ count: number }>("GET", "/users/count");
  },

  /** Check API health. */
  async health(): Promise<ApiResponse<HealthResponse>> {
    return request<HealthResponse>("GET", "/health");
  },

  /** List all users (admin only). */
  async listUsers(): Promise<ApiResponse<User[]>> {
    return request<User[]>("GET", "/users");
  },

  /** Create a new user (admin only). */
  async createUser(username: string, password: string, role?: "admin" | "user"): Promise<ApiResponse<User>> {
    return request<User>("POST", "/users", { username, password, role });
  },

  /** Update a user (admin only). */
  async updateUser(id: string, updates: { username?: string; role?: "admin" | "user" }): Promise<ApiResponse<User>> {
    return request<User>("PUT", `/users/${id}`, updates);
  },

  /** Delete a user (admin only). */
  async deleteUser(id: string): Promise<ApiResponse<User>> {
    return request<User>("DELETE", `/users/${id}`);
  },

  /** Send a chat message. Accepts the same options the CLI exposes as flags (fullContextToken,
   *  isolatedWorkspace, maxIterations, projectId) in addition to planMode. */
  async chat(task: string, opts: ChatOptions = {}, signal?: AbortSignal): Promise<ApiResponse<ChatResult>> {
    return request<ChatResult>("POST", "/chat", { task, ...opts }, signal);
  },

  /** Generate a plan without executing. */
  async generatePlan(task: string, opts: ChatOptions = {}): Promise<ApiResponse<ChatResult>> {
    return request<ChatResult>("POST", "/chat/plan", { task, ...opts });
  },

  /** Execute an approved plan. */
  async executePlan(sessionId: string): Promise<ApiResponse<ChatResult>> {
    return request<ChatResult>("POST", "/chat/execute", { sessionId });
  },

  // ─── Projects ──────────────────────────────────────────────────────────

  async listProjects(): Promise<ApiResponse<Project[]>> {
    return request<Project[]>("GET", "/projects");
  },

  /** Creates a project from a name only — the server always creates its workspace folder
   *  under the forced ./workspace root, so there's no path for the caller to get wrong. */
  async addProject(name: string): Promise<ApiResponse<Project> & { created?: boolean }> {
    return request<Project>("POST", "/projects", { name }) as Promise<ApiResponse<Project> & { created?: boolean }>;
  },

  async updateProject(id: string, updates: { name?: string; includeInLlm?: boolean }): Promise<ApiResponse<Project>> {
    return request<Project>("PUT", `/projects/${id}`, updates);
  },

  async activateProject(id: string): Promise<ApiResponse<Project>> {
    return request<Project>("POST", `/projects/${id}/activate`);
  },

  async deleteProject(id: string): Promise<ApiResponse<{ deleted: boolean }>> {
    return request("DELETE", `/projects/${id}`);
  },

  async listProjectFiles(id: string, subPath = ""): Promise<ApiResponse<{ files: WorkspaceFile[]; workspaceRoot: string; path: string }>> {
    const q = subPath ? `?path=${encodeURIComponent(subPath)}` : "";
    return request("GET", `/projects/${id}/files${q}`);
  },

  async deleteProjectFile(id: string, filePath: string): Promise<ApiResponse<{ deleted: boolean }>> {
    return request("DELETE", `/projects/${id}/files`, { path: filePath });
  },

  /** Downloads the project's workspace as a zip via an authenticated fetch (a plain <a href>
   *  wouldn't carry the Authorization header the backend actually requires) and triggers the
   *  browser's normal save-file flow via a Blob object URL. */
  async downloadProject(id: string, projectName: string): Promise<{ success: boolean; error?: string }> {
    const token = getStoredToken();
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const res = await fetch(`${API_BASE}/projects/${id}/download`, { headers });
    if (!res.ok) {
      let error = `Download failed (${res.status})`;
      try {
        const body = await res.json();
        if (body?.error) error = body.error;
      } catch {
        // response wasn't JSON (e.g. the zip stream itself) — keep the generic message
      }
      return { success: false, error };
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${projectName.replace(/[^a-z0-9_-]/gi, "_")}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return { success: true };
  },

  async uploadProjectFile(id: string, file: File, subPath = ""): Promise<ApiResponse<{ path: string; size: number }>> {
    const form = new FormData();
    form.append("file", file);
    if (subPath) form.append("path", subPath);
    const token = getStoredToken();
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(`${API_BASE}/projects/${id}/upload`, { method: "POST", headers, body: form });
    return res.json();
  },

  // ─── Task History ──────────────────────────────────────────────────────

  async getTaskHistory(projectId?: string, limit = 10): Promise<ApiResponse<{ tasks: TaskHistoryEntry[] }>> {
    const params = new URLSearchParams();
    if (projectId) params.set("projectId", projectId);
    params.set("limit", String(limit));
    return request("GET", `/task-history?${params.toString()}`);
  },

  // ─── LLM Key ───────────────────────────────────────────────────────────

  async getLlmKeyStatus(): Promise<ApiResponse<{ hasKey: boolean }>> {
    return request("GET", "/settings/llm-key");
  },

  async setLlmKey(apiKey: string): Promise<ApiResponse<{ hasKey: boolean }>> {
    return request("PUT", "/settings/llm-key", { apiKey });
  },

  async clearLlmKey(): Promise<ApiResponse<{ hasKey: boolean }>> {
    return request("DELETE", "/settings/llm-key");
  },

  /** Get telemetry entries. */
  async getTelemetry(log?: string, limit?: number): Promise<ApiResponse> {
    const params = new URLSearchParams();
    if (log) params.set("log", log);
    if (limit) params.set("limit", String(limit));
    return request("GET", `/telemetry?${params.toString()}`);
  },

  /** List available skills. */
  async listSkills(): Promise<ApiResponse> {
    return request("GET", "/skills");
  },

  // ─── Plans ──────────────────────────────────────────────────────────────

  async listPlans(): Promise<ApiResponse<{ plans: any[] }>> {
    return request("GET", "/plans");
  },

  async getPlan(id: string): Promise<ApiResponse<{ plan: any; tasks: any[] }>> {
    return request("GET", `/plans/${id}`);
  },

  async savePlan(taskDescription: string, planContent: string, tasks: string[]): Promise<ApiResponse<{ plan: any }>> {
    return request("POST", "/plans", { taskDescription, planContent, tasks });
  },

  async updatePlanStatus(id: string, status: string): Promise<ApiResponse> {
    return request("PUT", `/plans/${id}/status`, { status });
  },

  async updateTaskStatus(planId: string, taskId: string, status: string): Promise<ApiResponse> {
    return request("PUT", `/plans/${planId}/tasks/${taskId}`, { status });
  },

  async addPlanTask(planId: string, description: string): Promise<ApiResponse<{ task: any }>> {
    return request("POST", `/plans/${planId}/tasks`, { description });
  },

  async deletePlanTask(planId: string, taskId: string): Promise<ApiResponse> {
    return request("DELETE", `/plans/${planId}/tasks/${taskId}`);
  },

  /** Alias for listSkills — used by DiagnosticsPage. */
  async skills(): Promise<ApiResponse> {
    return this.listSkills();
  },

  /** Alias for getTelemetry — used by DiagnosticsPage. */
  async telemetry(log?: string, limit?: number): Promise<ApiResponse> {
    return this.getTelemetry(log, limit);
  },

  /** Logout — revoke the current token on the server. */
  async logout(): Promise<ApiResponse> {
    return request("POST", "/logout");
  },
};

