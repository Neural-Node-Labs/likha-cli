import fs from "node:fs";
import path from "node:path";

const HISTORY_PATH = path.join(".agent", "task-history.jsonl");
const MARKDOWN_PATH = path.join(".agent", "task_history.md");
const MAX_ENTRIES = 200; // cap file growth; oldest entries drop off on append past this
const MAX_MARKDOWN_ENTRIES = 50;

export interface TaskHistoryEntry {
  id: string;
  task: string;
  summary: string;
  timestamp: string; // ISO 8601
  iterations: number;
  totalTokens?: number;
}

/**
 * Appends a completed top-level task to .agent/task-history.jsonl AND tasks/task_history.md
 * (never called for subagent runs — those are internal implementation detail, not something a
 * user would call "the last task"). Deliberately NOT read back into `messages` anywhere in
 * orchestrator.ts — the only way this data reaches the model is if it explicitly calls
 * task_history_tool, per the design goal of keeping it out of default context while still being
 * queryable on demand.
 */
export function appendTaskHistory(
  cwd: string,
  entry: Omit<TaskHistoryEntry, "id" | "timestamp">
): TaskHistoryEntry {
  const full: TaskHistoryEntry = {
    id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    ...entry,
  };

  // --- Write to .agent/task-history.jsonl ---
  const jsonlPath = path.join(cwd, HISTORY_PATH);
  fs.mkdirSync(path.dirname(jsonlPath), { recursive: true });

  const existing = readTaskHistory(cwd, MAX_ENTRIES);
  const updated = [...existing, full].slice(-MAX_ENTRIES);
  fs.writeFileSync(jsonlPath, updated.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf-8");

  // --- Write to .agent/task_history.md ---
  const mdPath = path.join(cwd, MARKDOWN_PATH);
  fs.mkdirSync(path.dirname(mdPath), { recursive: true });

  const mdEntry = formatMarkdownEntry(full);

  // Atomic read → append → write: read existing content, prepend new entry, write back
  let existingRows: string[] = [];
  if (fs.existsSync(mdPath)) {
    const existingMd = fs.readFileSync(mdPath, "utf-8");
    // Extract existing table rows (lines starting with "| " that are not header or separator)
    existingRows = existingMd.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("|---") && !l.startsWith("| Timestamp"));
  }

  // Prepend the new entry, then cap at MAX_MARKDOWN_ENTRIES
  const allRows = [mdEntry, ...existingRows].slice(0, MAX_MARKDOWN_ENTRIES);
  const mdContent = MARKDOWN_HEADER + allRows.join("\n") + "\n";

  fs.writeFileSync(mdPath, mdContent, "utf-8");

  return full;
}

/** The header written at the top of tasks/task_history.md when the file is first created. */
const MARKDOWN_HEADER = `# Task History

This file records completed top-level tasks. Each entry is a row in the table below.
New entries are prepended on task completion. The file is capped at ${MAX_MARKDOWN_ENTRIES} entries (oldest entries drop off).

| Timestamp | Task | Summary | Iterations | Tokens |
|---|---|---|---|---|
`;

/** Format a single entry as a markdown table row. */
function formatMarkdownEntry(entry: TaskHistoryEntry): string {
  const date = new Date(entry.timestamp);
  const localTimestamp = date.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  });

  // Escape pipe characters in task and summary to avoid breaking the table
  const escapedTask = (entry.task || "").replace(/\|/g, "\\|");
  const escapedSummary = (entry.summary || "").replace(/\|/g, "\\|").replace(/\n/g, " ");
  const tokens = entry.totalTokens != null ? entry.totalTokens.toLocaleString() : "-";

  return `| ${localTimestamp} | ${escapedTask} | ${escapedSummary} | ${entry.iterations} | ${tokens} |`;
}

/** Most recent `limit` tasks, newest first. */
export function readTaskHistory(cwd: string, limit = 5): TaskHistoryEntry[] {
  const p = path.join(cwd, HISTORY_PATH);
  if (fs.existsSync(p)) {
    const lines = fs.readFileSync(p, "utf-8").split("\n").filter((l) => l.trim());
    const entries: TaskHistoryEntry[] = [];
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line));
      } catch {
        // skip a corrupt line rather than fail the whole read
      }
    }
    return entries.slice(-limit).reverse();
  }

  // Fallback: read from .agent/task_history.md
  const mdPath = path.join(cwd, MARKDOWN_PATH);
  if (!fs.existsSync(mdPath)) return [];

  const md = fs.readFileSync(mdPath, "utf-8");
  return parseMarkdownEntries(md).slice(0, limit);
}

/** Parse markdown table rows back into TaskHistoryEntry objects. */
function parseMarkdownEntries(md: string): TaskHistoryEntry[] {
  const entries: TaskHistoryEntry[] = [];
  // Extract table rows (lines starting with "| " that are not the header separator)
  const rows = md.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("|---"));
  for (const row of rows) {
    // Split on "|" and trim each cell
    const cells = row.split("|").map((c) => c.trim()).filter((c) => c.length > 0);
    if (cells.length < 5) continue;

    const timestampStr = cells[0];
    const task = cells[1];
    const summary = cells[2];
    const iterations = parseInt(cells[3], 10) || 0;
    const tokenStr = cells[4];
    const totalTokens = tokenStr && tokenStr !== "-" ? parseInt(tokenStr.replace(/,/g, ""), 10) || undefined : undefined;

    // Convert local timestamp back to ISO — best effort
    const parsedDate = new Date(timestampStr);
    const timestamp = isNaN(parsedDate.getTime()) ? new Date().toISOString() : parsedDate.toISOString();

    entries.push({
      id: `md_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      task,
      summary,
      timestamp,
      iterations,
      totalTokens,
    });
  }
  return entries;
}

/** Keyword search across task descriptions and summaries, newest match first. */
export function searchTaskHistory(cwd: string, query: string, limit = 5): TaskHistoryEntry[] {
  const all = readTaskHistory(cwd, MAX_ENTRIES);
  const q = query.toLowerCase();
  return all.filter((e) => e.task.toLowerCase().includes(q) || e.summary.toLowerCase().includes(q)).slice(0, limit);
}

