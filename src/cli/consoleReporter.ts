/**
 * Live console reporting for the ReAct loop. Purely presentational — never affects control
 * flow. Telemetry (src/telemetry/logger.ts) remains the source of truth for the persisted
 * record; this module just mirrors what's happening to stdout as it happens, instead of the
 * terminal going silent for the duration of every LLM call and tool execution.
 *
 * Degrades gracefully when stdout isn't a TTY (piped output, CI logs, etc.): the animated
 * spinner is skipped in favor of a single static line, and ANSI color codes are omitted.
 */

const isTTY = Boolean(process.stdout.isTTY);

const ANSI = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  italic: "\x1b[3m",
  cyan: "\x1b[36m",
  brightCyan: "\x1b[96m",
  magenta: "\x1b[35m",
  brightMagenta: "\x1b[95m",
  green: "\x1b[32m",
  brightGreen: "\x1b[92m",
  red: "\x1b[31m",
  brightRed: "\x1b[91m",
  yellow: "\x1b[33m",
  brightYellow: "\x1b[93m",
  blue: "\x1b[34m",
  brightBlue: "\x1b[94m",
  bgMagenta: "\x1b[45m",
  white: "\x1b[97m",
};

function color(text: string, code: string): string {
  return isTTY ? `${code}${text}${ANSI.reset}` : text;
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/**
 * Shows an animated "thinking" spinner while an async operation (an LLM call) is in flight,
 * then clears the line. No-ops the animation (falls back to a single static line) when stdout
 * isn't a TTY, since carriage-return redraws don't make sense in piped/log output.
 */
export class Spinner {
  private frame = 0;
  private timer: NodeJS.Timeout | null = null;
  private startedAt = 0;

  start(label: string): void {
    this.startedAt = Date.now();
    if (!isTTY) {
      console.log(color(`… ${label}`, ANSI.dim));
      return;
    }
    process.stdout.write(`${SPINNER_FRAMES[0]} ${label}`);
    this.timer = setInterval(() => {
      this.frame = (this.frame + 1) % SPINNER_FRAMES.length;
      const elapsed = ((Date.now() - this.startedAt) / 1000).toFixed(1);
      process.stdout.write(`\r${color(SPINNER_FRAMES[this.frame], ANSI.cyan)} ${label} ${color(`(${elapsed}s)`, ANSI.dim)}\x1b[K`);
    }, 90);
  }

  /** Clears the spinner line. Pass a message to leave a short summary in its place. */
  stop(message?: string): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (isTTY) {
      process.stdout.write("\r\x1b[K");
    }
    if (message) console.log(message);
  }
}

/** Indent prefix so subagent output is visually distinguishable from the parent run. */
function prefix(indent: number): string {
  return indent > 0 ? "  ".repeat(indent) + color("↳ ", ANSI.dim) : "";
}

/**
 * Prints the model's reasoning/thought for this step. `reasoningContent` is DeepSeek's
 * thinking-mode chain-of-thought (see deepseekClient.ts); falls back to `content` when
 * thinking mode is off or the model didn't return one, so there's always something shown.
 *
 * Deliberately the most visually prominent line in the loop (highlighted label + bright body,
 * not dimmed) — this is the one line a human skimming a long-running task actually wants to
 * catch at a glance, so it shouldn't look the same weight as everything else.
 */
export function reportThought(text: string | undefined, indent = 0): void {
  if (!text || !text.trim()) return;
  const label = isTTY
    ? `${ANSI.bgMagenta}${ANSI.white}${ANSI.bold} THOUGHT ${ANSI.reset}`
    : "[THOUGHT]";
  const body = truncate(text.trim(), 500);
  console.log(`${prefix(indent)}${label} ${color(body, isTTY ? ANSI.brightMagenta : "")}`);
}

export function reportAction(tool: string, input: unknown, indent = 0): void {
  const label = color("🔧 ACTION", ANSI.brightCyan + ANSI.bold);
  console.log(`${prefix(indent)}${label} ${color(tool, ANSI.brightCyan)} ${color(summarizeInput(input), ANSI.dim)}`);
}

export function reportObservation(observation: unknown, isError: boolean, indent = 0, score?: number): void {
  const label = isError
    ? color("✖ OBSERVATION", ANSI.brightRed + ANSI.bold)
    : color("👁 OBSERVATION", ANSI.brightGreen + ANSI.bold);
  const bodyColor = isError ? ANSI.brightRed : ANSI.dim;
  const scoreBit = score === undefined ? "" : ` ${scoreBadge(score)}`;
  console.log(`${prefix(indent)}${label} ${color(summarizeInput(observation), bodyColor)}${scoreBit}`);
}

function scoreBadge(score: number): string {
  const code = score >= 70 ? ANSI.green : score >= 40 ? ANSI.yellow : ANSI.brightRed;
  return color(`[health ${score}]`, code);
}

/** Printed once when the rolling health average drops low enough to trigger a self-correction
 *  nudge — see orchestrator.ts. Deliberately loud (not dim) since it's meant to catch the eye. */
export function reportHealthWarning(rollingAvg: number, indent = 0): void {
  const label = isTTY
    ? `${ANSI.brightRed}${ANSI.bold}⚠ SELF-CHECK${ANSI.reset}`
    : "[SELF-CHECK]";
  console.log(
    `${prefix(indent)}${label} ${color(`rolling health ${rollingAvg}/100 — nudging the agent to reconsider its approach`, ANSI.brightRed)}`
  );
}

export function reportSubagentStart(task: string, indent = 0): void {
  console.log(`${prefix(indent)}${color("🧩 SUBAGENT", ANSI.brightBlue + ANSI.bold)} ${color(truncate(task, 200), ANSI.brightBlue)}`);
}

/** Per-call token usage, printed right after the Thought for that same LLM call. */
export function reportUsage(
  usage: { promptTokens: number; completionTokens: number; reasoningTokens?: number; cachedTokens?: number } | undefined,
  runningTotal: number,
  indent = 0
): void {
  if (!usage) return;
  const bits = [`${usage.promptTokens.toLocaleString()} in`, `${usage.completionTokens.toLocaleString()} out`];
  if (usage.reasoningTokens) bits.push(`${usage.reasoningTokens.toLocaleString()} reasoning`);
  if (usage.cachedTokens) bits.push(`${usage.cachedTokens.toLocaleString()} cached`);
  const tokenBreakdown = color(bits.join(" · "), ANSI.dim);
  const totalLabel = color(`— ${runningTotal.toLocaleString()} total this run`, ANSI.brightYellow + ANSI.bold);
  console.log(`${prefix(indent)}${color("🪙", ANSI.yellow)} ${tokenBreakdown} ${totalLabel}`);
}

/**
 * Color-coded per-phase stats, printed after each phase completes in phase-planning mode.
 * Token count: red if >1M, green if >500K, blue if <500K.
 * Iteration count: red if >100, green if >50, blue if <20.
 */
export function reportPhaseStats(phaseNumber: number, phaseTitle: string, tokens: number, iterations: number, indent = 0): void {
  const tokenColor = tokens > 1_000_000 ? ANSI.red : tokens > 500_000 ? ANSI.green : ANSI.blue;
  const iterColor = iterations > 100 ? ANSI.red : iterations > 50 ? ANSI.green : ANSI.blue;
  const p = prefix(indent);
  console.log(
    `${p}${color("📊 Phase", ANSI.bold)} ${color(`${phaseNumber}: ${phaseTitle}`, ANSI.brightCyan)} — ` +
    `${color(`${tokens.toLocaleString()} tokens`, tokenColor)} · ` +
    `${color(`${iterations} iterations`, iterColor)}`
  );
}

/** End-of-run summary, printed once after the final answer. */
export function reportTotalUsage(
  cumulative: { promptTokens: number; completionTokens: number; totalTokens: number; reasoningTokens?: number },
  callCount: number,
  indent = 0
): void {
  if (callCount === 0) return;
  const reasoningBit = cumulative.reasoningTokens ? ` (${cumulative.reasoningTokens.toLocaleString()} reasoning)` : "";
  console.log(
    `${prefix(indent)}${color("🪙 Total", ANSI.bold)} ${color(
      `${cumulative.totalTokens.toLocaleString()} tokens${reasoningBit} — ${cumulative.promptTokens.toLocaleString()} in · ${cumulative.completionTokens.toLocaleString()} out across ${callCount} LLM call${callCount === 1 ? "" : "s"}`,
      ANSI.dim
    )}`
  );
}

/**
 * Outputs a token usage summary breakdown aggregated by task and phase.
 */
export function reportTaskTokenSummary(
  taskTokenSummaries: Record<
    string,
    {
      phases: Record<string, { input: number; output: number; cached: number; total: number; expectedTotal: number }>;
      runningTotal: number;
    }
  >,
  indent = 0
): void {
  const p = prefix(indent);
  console.log(`${p}${color("📋 Task Token Breakdown", ANSI.bold + ANSI.brightYellow)}`);

  for (const [taskId, taskData] of Object.entries(taskTokenSummaries)) {
    console.log(`${p}  ${color(`Task: ${taskId}`, ANSI.brightCyan)} (Running Total: ${taskData.runningTotal.toLocaleString()})`);

    for (const [phaseId, phaseStats] of Object.entries(taskData.phases)) {
      const details = `${phaseStats.input.toLocaleString()} in · ${phaseStats.output.toLocaleString()} out · ${phaseStats.cached.toLocaleString()} cached`;
      console.log(
        `${p}    ${color(`• Phase ${phaseId}:`, ANSI.dim)} ${color(`${phaseStats.total.toLocaleString()} tokens`, ANSI.yellow)} (${color(details, ANSI.dim)})`
      );
    }
  }
}

function truncate(text: string, max: number): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

function summarizeInput(value: unknown): string {
  try {
    const json = typeof value === "string" ? value : JSON.stringify(value);
    return truncate(json, 300);
  } catch {
    return String(value);
  }
}