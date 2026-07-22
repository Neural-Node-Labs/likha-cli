import React, { useState, useRef, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { api, ChatOptions } from "../api/client";

interface ChatMessage {
  role: "user" | "assistant" | "system" | "limitation";
  content: string;
  timestamp: Date;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  healthScore?: number;
  /** When true, the server explicitly requested user input to continue (iteration limit hit).
   *  The UI should highlight the "Continue" button in red to draw attention. */
  continueRequested?: boolean;
  /** When true, the run stopped because the iteration limit was reached. The UI should
   *  highlight the limitation message in red to distinguish it from other limitation types. */
  iterationMaxReached?: boolean;
}

const CHAT_STORAGE_KEY = "xcoder_chat_state";

interface PersistedChatState {
  messages: ChatMessage[];
  input: string;
  planMode: "auto" | "always" | "never";
  fullContextToken: boolean;
  phasePlanning: boolean;
  isolatedWorkspace: boolean;
  maxIterations: number | "";
  showAdvanced: boolean;
  currentPlan: string | null;
  sessionId: string | null;
  lastTaskText: string;
}

function saveChatState(state: Partial<PersistedChatState>): void {
  try {
    const existing = loadChatState();
    const merged = { ...existing, ...state };
    sessionStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(merged));
  } catch {
    // sessionStorage may be full or unavailable — silently ignore
  }
}

function loadChatState(): PersistedChatState | null {
  try {
    const raw = sessionStorage.getItem(CHAT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Rehydrate Date objects in messages
    if (parsed.messages) {
      parsed.messages = parsed.messages.map((m: any) => ({
        ...m,
        timestamp: new Date(m.timestamp),
      }));
    }
    return parsed as PersistedChatState;
  } catch {
    return null;
  }
}

function clearChatState(): void {
  try {
    sessionStorage.removeItem(CHAT_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/* ─── Toast Notification Helpers ─────────────────────────────────────────── */

interface Toast {
  id: number;
  message: string;
  type: "success" | "warning" | "error";
}

let toastIdCounter = 0;
let globalSetToasts: React.Dispatch<React.SetStateAction<Toast[]>> | null = null;

function showToast(message: string, type: Toast["type"] = "success"): void {
  if (!globalSetToasts) return;
  const id = ++toastIdCounter;
  globalSetToasts((prev) => [...prev, { id, message, type }]);
  // Auto-dismiss after 5 seconds
  setTimeout(() => {
    globalSetToasts?.((prev) => prev.filter((t) => t.id !== id));
  }, 5000);
}

function requestBrowserNotification(title: string, body: string): void {
  if (!("Notification" in window)) return;
  if (Notification.permission === "granted") {
    new Notification(title, { body });
  } else if (Notification.permission !== "denied") {
    Notification.requestPermission().then((permission) => {
      if (permission === "granted") {
        new Notification(title, { body });
      }
    });
  }
}

/* ─── Toast Container Component ─────────────────────────────────────────── */

function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div className="xcoder-toast-container">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`xcoder-toast xcoder-toast-${t.type}`}
          onClick={() => onDismiss(t.id)}
        >
          {t.type === "success" ? "✅" : t.type === "warning" ? "⚠️" : "❌"} {t.message}
        </div>
      ))}
    </div>
  );
}

/* ─── ChatPage Component ────────────────────────────────────────────────── */

export function ChatPage() {
  const [searchParams] = useSearchParams();
  const savedState = loadChatState();

  // If there's a ?task= query param (from PlansPage "Continue/Validate" button), use it as
  // the initial input and clear the URL so a refresh doesn't re-trigger it.
  const urlTask = searchParams.get("task");
  const initialInput = urlTask ?? savedState?.input ?? "";

  const [messages, setMessages] = useState<ChatMessage[]>(savedState?.messages ?? []);
  const [input, setInput] = useState(initialInput);
  const [planMode, setPlanMode] = useState<"auto" | "always" | "never">(savedState?.planMode ?? "always");
  const [fullContextToken, setFullContextToken] = useState(savedState?.fullContextToken ?? false);
  const [phasePlanning, setPhasePlanning] = useState(savedState?.phasePlanning ?? false);
  const [isolatedWorkspace, setIsolatedWorkspace] = useState(savedState?.isolatedWorkspace ?? false);
  const [maxIterations, setMaxIterations] = useState<number | "">(savedState?.maxIterations ?? "");
  const [showAdvanced, setShowAdvanced] = useState(savedState?.showAdvanced ?? false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPlan, setCurrentPlan] = useState<string | null>(savedState?.currentPlan ?? null);
  const [sessionId, setSessionId] = useState<string | null>(savedState?.sessionId ?? null);
  const [isListening, setIsListening] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [lastTaskText, setLastTaskText] = useState<string>(savedState?.lastTaskText ?? "");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [showContinueDialog, setShowContinueDialog] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const recognitionRef = useRef<any>(null);

  // Register the global toast setter so showToast() works from anywhere in this component
  useEffect(() => {
    globalSetToasts = setToasts;
    return () => { globalSetToasts = null; };
  }, []);

  // Persist state changes to sessionStorage
  useEffect(() => {
    saveChatState({
      messages,
      input,
      planMode,
      fullContextToken,
      phasePlanning,
      isolatedWorkspace,
      maxIterations,
      showAdvanced,
      currentPlan,
      sessionId,
      lastTaskText,
    });
  }, [messages, input, planMode, fullContextToken, phasePlanning, isolatedWorkspace, maxIterations, showAdvanced, currentPlan, sessionId, lastTaskText]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading]);

  // Auto-send if a task was passed via URL (from PlansPage "Continue/Validate" button)
  const autoSentRef = useRef(false);
  useEffect(() => {
    if (urlTask && !autoSentRef.current && messages.length === 0) {
      autoSentRef.current = true;
      // Small delay to let the component fully render before sending
      const timer = setTimeout(() => {
        handleSend();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [urlTask]);

  const buildOptions = (): ChatOptions => {
    const opts: ChatOptions = { planMode, phasePlanning };
    if (fullContextToken) opts.fullContextToken = true;
    if (isolatedWorkspace) opts.isolatedWorkspace = true;
    if (maxIterations !== "" && maxIterations > 0) opts.maxIterations = maxIterations;
    return opts;
  };

  const handleNewChat = () => {
    if (messages.length > 0 && !confirm("Start a new chat? The current conversation will be cleared.")) return;
    setMessages([]);
    setInput("");
    setError(null);
    setCurrentPlan(null);
    setSessionId(null);
    setLastTaskText("");
    clearChatState();
  };

  const handleSend = async () => {
    if (!input.trim() || loading) return;

    const userMessage: ChatMessage = { role: "user", content: input.trim(), timestamp: new Date() };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);
    setError(null);
    setCurrentPlan(null);
    setSessionId(null);
    setLastTaskText(userMessage.content);

    try {
      const controller = new AbortController();
      abortControllerRef.current = controller;
      const res = await api.chat(userMessage.content, buildOptions(), controller.signal);

      if (res.success && res.data) {
        const data = res.data;

        if (data.plan) {
          setCurrentPlan(data.plan);
          setSessionId(data.sessionId ?? null);
          setMessages((prev) => [...prev, { role: "system", content: `📋 Plan generated:\n${data.plan}`, timestamp: new Date() }]);

          // Persist the plan to the database so it shows up on the Plans page
          api.savePlan(userMessage.content, data.plan, []).catch((err) => {
            console.warn("Failed to auto-save plan:", err);
          });
        }

        if (data.result) {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: data.result, timestamp: new Date(), usage: data.usage, healthScore: data.healthScore },
          ]);
        }

        // The task ran but didn't cleanly finish (iteration limit / plan rejected) — this is
        // distinct from a transport error: the agent produced a real, honest explanation of
        // why it stopped, and that deserves its own visual treatment, not silence and not the
        // same red "something broke" styling as an actual exception.
        if (data.limitation) {
          setMessages((prev) => [...prev, { role: "limitation", content: data.limitation!, timestamp: new Date() }]);
        }
      } else {
        setError(res.error ?? "Request failed");
        setMessages((prev) => [...prev, { role: "system", content: `❌ Error: ${res.error ?? "Request failed"}`, timestamp: new Date() }]);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setMessages((prev) => [...prev, { role: "system", content: "⏹️ Request cancelled", timestamp: new Date() }]);
      } else {
        const msg = err instanceof Error ? err.message : "An error occurred";
        setError(msg);
        setMessages((prev) => [...prev, { role: "system", content: `❌ Error: ${msg}`, timestamp: new Date() }]);
      }
    } finally {
      abortControllerRef.current = null;
      setLoading(false);
    }
  };

  const handleCancel = () => {
    abortControllerRef.current?.abort();
  };

  const handleApprovePlan = async () => {
    if (!sessionId || loading) return;
    setLoading(true);
    try {
      const res = await api.executePlan(sessionId);
      if (res.success && res.data) {
        const data = res.data;
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: data.result ?? "Plan executed successfully", timestamp: new Date(), usage: data.usage, healthScore: data.healthScore },
        ]);
        if (data.limitation) {
          setMessages((prev) => [...prev, { role: "limitation", content: data.limitation!, timestamp: new Date() }]);
        }
        setCurrentPlan(null);
        setSessionId(null);
      } else {
        setError(res.error ?? "Execution failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  const handleRejectPlan = () => {
    setMessages((prev) => [...prev, { role: "system", content: "❌ Plan rejected", timestamp: new Date() }]);
    setCurrentPlan(null);
    setSessionId(null);
  };

  /** Re-send the last task with continueOnLimit: true so the orchestrator auto-continues
   *  past the iteration limit instead of stopping. The user clicks this when they see a
   *  limitation message ("The task did not finish within the iteration limit.") and want
   *  the agent to keep going. */
  const handleContinue = async () => {
    if (!lastTaskText || loading) return;

    setMessages((prev) => [...prev, { role: "system", content: "⏩ Continuing task with extended iteration limit...", timestamp: new Date() }]);
    setLoading(true);
    setError(null);

    try {
      const controller = new AbortController();
      abortControllerRef.current = controller;
      const opts: ChatOptions = { ...buildOptions(), continueOnLimit: true };
      const res = await api.chat(lastTaskText, opts, controller.signal);

      if (res.success && res.data) {
        const data = res.data;
        if (data.result) {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: data.result, timestamp: new Date(), usage: data.usage, healthScore: data.healthScore },
          ]);
        }
        if (data.limitation) {
          setMessages((prev) => [...prev, { role: "limitation", content: data.limitation!, timestamp: new Date() }]);
        }
      } else {
        setError(res.error ?? "Request failed");
        setMessages((prev) => [...prev, { role: "system", content: `❌ Error: ${res.error ?? "Request failed"}`, timestamp: new Date() }]);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setMessages((prev) => [...prev, { role: "system", content: "⏹️ Request cancelled", timestamp: new Date() }]);
      } else {
        const msg = err instanceof Error ? err.message : "An error occurred";
        setError(msg);
        setMessages((prev) => [...prev, { role: "system", content: `❌ Error: ${msg}`, timestamp: new Date() }]);
      }
    } finally {
      abortControllerRef.current = null;
      setLoading(false);
    }
  };

  // Real Web Speech API integration — transcribes into the input box. No fake "listening..."
  // placeholder; if the browser doesn't support it, we say so and stop.
  const handleVoiceToggle = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError("Speech recognition is not supported in this browser");
      return;
    }

    if (isListening) {
      recognitionRef.current?.stop();
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results)
        .map((r: any) => r[0].transcript)
        .join("");
      setInput(transcript);
    };
    recognition.onerror = (event: any) => {
      setError(`Speech recognition error: ${event.error}`);
      setIsListening(false);
    };
    recognition.onend = () => setIsListening(false);

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  };

  // Real upload to the currently active project's workspace (see api.uploadProjectFile).
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (fileInputRef.current) fileInputRef.current.value = "";

    setUploading(true);
    try {
      const projectsRes = await api.listProjects();
      const active = projectsRes.data?.find((p) => p.active);
      if (!active) {
        setMessages((prev) => [...prev, { role: "system", content: "❌ No active project — add or select a project first (Projects page) before uploading.", timestamp: new Date() }]);
        return;
      }
      const res = await api.uploadProjectFile(active.id, file);
      if (res.success && res.data) {
        setMessages((prev) => [...prev, { role: "system", content: `📎 Uploaded "${res.data!.path}" to ${active.name}'s workspace`, timestamp: new Date() }]);
      } else {
        setMessages((prev) => [...prev, { role: "system", content: `❌ Upload failed: ${res.error ?? "unknown error"}`, timestamp: new Date() }]);
      }
    } finally {
      setUploading(false);
    }
  };

  const sectionStyle: React.CSSProperties = {
    background: "var(--color-card-bg)",
    border: "1px solid var(--color-border)",
    borderRadius: "10px",
    padding: "24px",
    marginBottom: "16px",
  };

  const checkboxLabel: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    fontSize: "12px",
    color: "var(--color-text-secondary)",
    cursor: "pointer",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 48px - 48px)", /* viewport minus navbar minus main padding */ }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px", flexShrink: 0 }}>
        <h1 style={{ fontSize: "24px", fontWeight: 700, margin: 0 }}>Chat</h1>
        {messages.length > 0 && (
          <button onClick={handleNewChat} style={{ padding: "6px 14px", borderRadius: "6px", border: "1px solid var(--color-border)", background: "transparent", color: "var(--color-text-secondary)", fontSize: "13px", cursor: "pointer" }}>
            + New chat
          </button>
        )}
      </div>

      {/* Chat messages — scrollable, fills remaining space */}
      <div role="log" aria-live="polite" aria-label="Chat messages" style={{ ...sectionStyle, flex: "1 1 auto", overflowY: "auto", display: "flex", flexDirection: "column", gap: "12px", minHeight: 0 }}>
        {messages.length === 0 ? (
          <p style={{ color: "var(--color-text-secondary)", textAlign: "center", padding: "40px" }}>
            Send a message to start chatting with xcoder
          </p>
        ) : (
          messages.map((msg, i) => (
            <div
              key={i}
              style={{
                padding: "12px 16px",
                borderRadius: "8px",
                background:
                  msg.role === "user"
                    ? "color-mix(in srgb, var(--color-primary) 10%, transparent)"
                    : msg.role === "limitation"
                    ? "color-mix(in srgb, var(--color-warning, #f59e0b) 15%, transparent)"
                    : msg.role === "system"
                    ? "color-mix(in srgb, var(--color-accent) 10%, transparent)"
                    : "var(--color-bg-secondary)",
                border: msg.role === "limitation" ? "1px solid color-mix(in srgb, var(--color-warning, #f59e0b) 40%, transparent)" : "none",
                alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
                maxWidth: "80%",
              }}
            >
              <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: "4px", display: "block" }}>
                {msg.role === "user" ? "You" : msg.role === "assistant" ? "xcoder" : msg.role === "limitation" ? "⚠ Limitation" : "System"}
              </span>
              <p style={{ margin: 0, fontSize: "14px", lineHeight: "1.5", whiteSpace: "pre-wrap" }}>{msg.content}</p>
              {msg.role === "limitation" && lastTaskText && (
                <div style={{ marginTop: "10px", display: "flex", gap: "8px" }}>
                  <button
                    onClick={handleContinue}
                    disabled={loading}
                    style={{ padding: "6px 16px", borderRadius: "6px", border: "none", background: loading ? "var(--color-text-secondary)" : "var(--color-warning, #f59e0b)", color: "#fff", fontSize: "12px", fontWeight: 600, cursor: loading ? "not-allowed" : "pointer" }}
                  >
                    {loading ? "Continuing..." : "▶ Continue"}
                  </button>
                </div>
              )}
              {(msg.usage || msg.healthScore !== undefined) && (
                <p style={{ margin: "8px 0 0", fontSize: "10px", color: "var(--color-text-secondary)", borderTop: "1px solid var(--color-border)", paddingTop: "6px" }}>
                  {msg.usage && `🪙 ${msg.usage.totalTokens.toLocaleString()} tokens`}
                  {msg.usage && msg.healthScore !== undefined && " · "}
                  {msg.healthScore !== undefined && `📈 health ${msg.healthScore}/100`}
                </p>
              )}
              <span style={{ fontSize: "10px", color: "var(--color-text-secondary)", marginTop: "4px", display: "block" }}>
                {msg.timestamp.toLocaleTimeString()}
              </span>
            </div>
          ))
        )}
        {loading && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", padding: "12px 16px", borderRadius: "8px", background: "var(--color-bg-secondary)", alignSelf: "flex-start", color: "var(--color-text-secondary)", fontSize: "14px" }}>
            <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span className="xcoder-spinner" aria-hidden="true" />
              Thinking...
            </span>
            <button onClick={handleCancel} style={{ background: "transparent", border: "1px solid var(--color-border)", color: "var(--color-text-secondary)", borderRadius: "6px", padding: "4px 10px", fontSize: "12px", cursor: "pointer" }}>
              Cancel
            </button>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Plan display */}
      {currentPlan && (
        <div style={{ ...sectionStyle, borderColor: "var(--color-accent)", borderWidth: "2px" }}>
          <h3 style={{ fontSize: "14px", fontWeight: 600, marginBottom: "12px", color: "var(--color-accent)" }}>
            Plan for: {messages.find((m) => m.role === "user")?.content ?? "Task"}
          </h3>
          <pre style={{ background: "var(--color-bg-secondary)", padding: "16px", borderRadius: "6px", fontSize: "13px", lineHeight: "1.5", overflowX: "auto", whiteSpace: "pre-wrap", color: "var(--color-text)", margin: 0, maxHeight: "300px", overflowY: "auto" }}>
            {currentPlan}
          </pre>
          <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
            <button onClick={handleApprovePlan} disabled={loading} style={{ padding: "8px 20px", borderRadius: "6px", border: "none", background: loading ? "var(--color-text-secondary)" : "var(--color-success)", color: "#fff", fontSize: "13px", fontWeight: 600, cursor: loading ? "not-allowed" : "pointer" }}>
              {loading ? "Executing..." : "Approve"}
            </button>
            <button onClick={handleRejectPlan} disabled={loading} style={{ padding: "8px 20px", borderRadius: "6px", border: "1px solid var(--color-error)", background: "transparent", color: "var(--color-error)", fontSize: "13px", fontWeight: 600, cursor: loading ? "not-allowed" : "pointer" }}>
              Reject
            </button>
          </div>
        </div>
      )}

      {error && (
        <div style={{ ...sectionStyle, borderColor: "var(--color-error)" }}>
          <p style={{ color: "var(--color-error)", fontSize: "13px", margin: 0 }}>{error}</p>
        </div>
      )}

      {/* Input area — always visible at the bottom */}
      <div style={{ ...sectionStyle, flexShrink: 0, marginBottom: 0 }}>
        <div style={{ display: "flex", gap: "8px", marginBottom: "12px", alignItems: "center", flexWrap: "wrap" }}>
          <select
            value={planMode}
            onChange={(e) => setPlanMode(e.target.value as "auto" | "always" | "never")}
            style={{ padding: "6px 10px", borderRadius: "6px", border: "1px solid var(--color-border)", background: "var(--color-input-bg)", color: "var(--color-text)", fontSize: "13px", outline: "none" }}
            aria-label="Plan mode"
          >
            <option value="always">Plan: Always</option>
            <option value="auto">Plan: Auto</option>
            <option value="never">Plan: Never</option>
          </select>

          <button
            onClick={handleVoiceToggle}
            style={{ padding: "6px 12px", borderRadius: "6px", border: "1px solid var(--color-border)", background: isListening ? "color-mix(in srgb, var(--color-error) 20%, transparent)" : "transparent", color: isListening ? "var(--color-error)" : "var(--color-text-secondary)", fontSize: "13px", cursor: "pointer", display: "flex", alignItems: "center", gap: "4px" }}
            title={isListening ? "Stop listening" : "Voice input"}
          >
            🎤 {isListening ? "Listening..." : "Voice"}
          </button>

          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            style={{ padding: "6px 12px", borderRadius: "6px", border: "1px solid var(--color-border)", background: "transparent", color: "var(--color-text-secondary)", fontSize: "13px", cursor: uploading ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: "4px" }}
            title="Upload file to the active project's workspace"
          >
            📎 {uploading ? "Uploading…" : "Upload"}
          </button>
          <input ref={fileInputRef} type="file" onChange={handleFileUpload} style={{ display: "none" }} />

          <button
            onClick={() => setShowAdvanced((v) => !v)}
            style={{ padding: "6px 12px", borderRadius: "6px", border: "1px solid var(--color-border)", background: "transparent", color: "var(--color-text-secondary)", fontSize: "13px", cursor: "pointer", marginLeft: "auto" }}
          >
            {showAdvanced ? "Hide options ▲" : "Options ▼"}
          </button>
        </div>

        {showAdvanced && (
          <div style={{ display: "flex", gap: "16px", alignItems: "center", flexWrap: "wrap", padding: "12px", marginBottom: "12px", background: "var(--color-bg-secondary)", borderRadius: "6px" }}>
            <label style={checkboxLabel}>
              <input type="checkbox" checked={fullContextToken} onChange={(e) => setFullContextToken(e.target.checked)} />
              Full context mode
            </label>
            <label style={checkboxLabel}>
              <input type="checkbox" checked={phasePlanning} onChange={(e) => setPhasePlanning(e.target.checked)} />
              Phase planning
            </label>
            <label style={checkboxLabel}>
              <input type="checkbox" checked={isolatedWorkspace} onChange={(e) => setIsolatedWorkspace(e.target.checked)} />
              Isolated workspace
            </label>
            <label style={checkboxLabel}>
              Max iterations
              <input
                type="number"
                min={1}
                value={maxIterations}
                onChange={(e) => setMaxIterations(e.target.value === "" ? "" : parseInt(e.target.value, 10))}
                placeholder="20"
                style={{ width: "60px", padding: "4px 6px", borderRadius: "4px", border: "1px solid var(--color-border)", background: "var(--color-input-bg)", color: "var(--color-text)", fontSize: "12px" }}
              />
            </label>
          </div>
        )}

        <div style={{ display: "flex", gap: "8px" }}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Type your message here..."
            rows={3}
            style={{ flex: 1, padding: "10px 12px", borderRadius: "6px", border: "1px solid var(--color-border)", background: "var(--color-input-bg)", color: "var(--color-text)", fontSize: "14px", fontFamily: "inherit", resize: "none", outline: "none" }}
            aria-label="Message input"
          />
          <button
            onClick={handleSend}
            disabled={loading || !input.trim()}
            style={{ padding: "10px 20px", borderRadius: "6px", border: "none", background: loading || !input.trim() ? "var(--color-text-secondary)" : "var(--color-primary)", color: "#fff", fontSize: "14px", fontWeight: 600, cursor: loading || !input.trim() ? "not-allowed" : "pointer", alignSelf: "flex-end", transition: "background 0.15s ease" }}
          >
            {loading ? "..." : "Send"}
          </button>
        </div>
        <p style={{ margin: "8px 0 0", fontSize: "11px", color: "var(--color-text-secondary)" }}>
          Enter to send · Shift+Enter for a new line
        </p>
      </div>
    </div>
  );
}
