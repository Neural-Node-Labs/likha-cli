# Duplicate Detection Logic Analysis

> Generated: 2026-07-23
> Phase 1, 2 & 3 of the Duplicate Detection Enhancement task.

---

## Table of Contents

1. [Core Duplicate Action Detector](#1-core-duplicate-action-detector)
2. [Step Scorer Integration](#2-step-scorer-integration)
3. [Self-Healing Nudge in Orchestrator](#3-self-healing-nudge-in-orchestrator)
4. [Live Diagnostics Diagnostic #3](#4-live-diagnostics-diagnostic-3)
5. [Context Compaction (Stale File Reads)](#5-context-compaction-stale-file-reads)
6. [Goal Validator (Independent Verification)](#6-goal-validator-independent-verification)
7. [Workspace Manager (File Copy Dedup)](#7-workspace-manager-file-copy-dedup)
8. [Site Crawler URL Deduplication](#8-site-crawler-url-deduplication)
9. [URL Summarizer Content Deduplication](#9-url-summarizer-content-deduplication)
10. [API User Management Duplicate Check](#10-api-user-management-duplicate-check)
11. [Project Store Name Deduplication](#11-project-store-name-deduplication)
12. [Pattern Specification (Generalized)](#12-pattern-specification-generalized)
13. [Phase 3: Adaptation Instructions for New Agent Integration](#13-phase-3-adaptation-instructions-for-new-agent-integration)

---

## 1. Core Duplicate Action Detector

**File:** `src/core/duplicateActionDetector.ts`

This is the **primary** duplicate detection mechanism in the codebase. It detects when the LLM calls the exact same tool with the exact same arguments and gets the exact same observation — meaning no new information was gained.

### Data Structures

```typescript
export interface ToolCallRecord {
  tool: string;
  args: unknown;
  observation: unknown;
}

export interface DuplicateActionViolation {
  tool: string;
  args: unknown;
  occurrences: number;
  reason: string;
}
```

### Detection Algorithm

```typescript
export function findDuplicateActions(calls: ToolCallRecord[]): DuplicateActionViolation[] {
  const groups = new Map<string, ToolCallRecord[]>();

  // 1. Group by (tool, stable-stringified-args) composite key
  for (const call of calls) {
    const key = `${call.tool}::${stableStringify(call.args)}`;
    const list = groups.get(key) ?? [];
    list.push(call);
    groups.set(key, list);
  }

  const violations: DuplicateActionViolation[] = [];
  for (const [, group] of groups) {
    if (group.length < 2) continue; // skip unique calls

    // 2. Check if ALL observations in the group are identical
    const observationStrings = group.map((c) => stableStringify(c.observation));
    const allIdentical = observationStrings.every((o) => o === observationStrings[0]);

    if (allIdentical) {
      violations.push({
        tool: group[0].tool,
        args: group[0].args,
        occurrences: group.length,
        reason: `Called ${group.length} times with identical arguments AND an identical observation every time...`,
      });
    }
  }
  return violations;
}
```

### Key Design Decisions

1. **Composite key:** `tool::stableStringify(args)` — groups calls by both tool name AND serialized arguments. This means `run_command_tool({command: "echo hi"})` and `run_command_tool({command: "echo bye"})` are different groups.

2. **Observation comparison:** Only flags as duplicate if ALL observations in the group are identical. This is deliberate — running the same test command after an edit should produce a *different* observation (the test now passes), so it won't be flagged.

3. **Stable stringify:** Uses a custom `stableStringify()` that sorts object keys alphabetically, ensuring `{b:1, a:2}` and `{a:2, b:1}` produce the same key.

### Stable Stringify Implementation

```typescript
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map((k) =>
    `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`
  ).join(",")}}`;
}
```

### Flow

```
ToolCallRecord[] (full run history)
        │
        ▼
  Group by (tool, stableStringify(args))
        │
        ▼
  For each group with >= 2 entries:
        │
        ▼
  Compare all observations via stableStringify
        │
        ▼
  If ALL identical → DuplicateActionViolation
  If any different → not a duplicate (legitimate re-run)
```

---

## 2. Step Scorer Integration

**File:** `src/core/stepScorer.ts`

The step scorer uses `findDuplicateActions()` from the duplicate action detector to penalize duplicate actions in the health score.

### Data Structures

```typescript
export interface HealthState {
  scores: number[];          // rolling history, oldest first
  callHistory: ToolCallRecord[]; // full run history, reused for duplicate-action detection
}
```

### Scoring Logic

```typescript
export function scoreStep(
  state: HealthState,
  step: { tool: string; args: unknown; observation: unknown; isError: boolean }
): StepScore {
  // 1. Push current step into callHistory
  state.callHistory.push({ tool: step.tool, args: step.args, observation: step.observation });

  let score = 70; // neutral baseline
  const reasons: string[] = [];

  if (step.isError) {
    score -= 45;
    reasons.push("tool call errored");
  } else {
    score += 10;
    reasons.push("completed without error");
  }

  // 2. Check for duplicates across ENTIRE history (not just recent window)
  const violations = findDuplicateActions(state.callHistory);
  const isDuplicate = violations.some((v) => v.tool === step.tool && sameArgs(v.args, step.args));
  if (isDuplicate) {
    score -= 35;
    reasons.push("repeated an identical action with an identical result — no new information gained");
  }

  // Mild reward for write_edit_tool and run_command_tool
  if (!step.isError && (step.tool === "write_edit_tool" || step.tool === "run_command_tool")) {
    score += 10;
    reasons.push(`${step.tool} succeeded`);
  }

  score = Math.max(0, Math.min(100, score));
  state.scores.push(score);
  return { score, reasons };
}
```

### Key Details

- **Duplicate penalty:** -35 points (severe — more than an error's -45 but close)
- **Scope:** Scans the ENTIRE `callHistory` array, not just a recent window. This means a duplicate from 20 iterations ago still counts.
- **`sameArgs` helper:** Uses simple `JSON.stringify` comparison (not stable stringify) for the violation match check.
- **Rolling health:** `rollingHealth()` averages the last 5 scores (default window).

### Flow

```
Each tool step completes
        │
        ▼
  Push to callHistory[]
        │
        ▼
  Call findDuplicateActions(callHistory)
        │
        ▼
  Check if current step matches any violation
        │
        ▼
  If duplicate → score -= 35
  If not → score stays at baseline ± adjustments
        │
        ▼
  Push score to scores[] for rolling average
```

---

## 3. Self-Healing Nudge in Orchestrator

**File:** `src/core/orchestrator.ts` (lines ~1680-1700)

The orchestrator uses the rolling health score (which includes duplicate detection) to inject a self-healing nudge when the score drops too low.

### Logic

```typescript
if (this.opts.selfHealing !== false) {
  const avgHealth = rollingHealth(this.health);
  const cooldownPassed = iteration - this.lastNudgeIteration >= 3;
  if (avgHealth < 40 && cooldownPassed && this.health.scores.length >= 2) {
    this.lastNudgeIteration = iteration;
    // Inject nudge message into context
    messages.push({
      role: "user",
      content: `[self-check] Your last several steps haven't been making much progress (rolling health score: ${avgHealth}/100 — errors and/or repeated identical actions with no new information). Before continuing: re-read the current state of whatever you're working on rather than assuming, double-check your last assumption was actually correct, and consider a genuinely different approach instead of retrying something similar.`,
    });
  }
}
```

### Key Details

- **Threshold:** Rolling health < 40/100 triggers the nudge
- **Cooldown:** At least 3 iterations between nudges (`lastNudgeIteration`)
- **Minimum data:** At least 2 scored steps required before nudging
- **Message content:** Explicitly mentions "repeated identical actions with no new information" — directly referencing the duplicate detection signal

### Flow

```
End of each ReAct iteration
        │
        ▼
  Calculate rollingHealth(health, window=5)
        │
        ▼
  If avgHealth < 40 AND cooldown passed AND >= 2 scores:
        │
        ▼
  Inject self-check message into LLM context
        │
        ▼
  LLM sees the nudge on next iteration
```

---

## 4. Live Diagnostics Diagnostic #3

**File:** `src/core/liveDiagnostics.ts` (function `diagnoseNoDuplicateActions`)

This is a **runtime diagnostic** that tests whether the LLM produces wasteful duplicate actions during a real task.

### Logic

```typescript
async function diagnoseNoDuplicateActions(llm: LlmClient, baseDir: string): Promise<DiagnosticResult> {
  const dir = newWorkspace(baseDir, "d3-no-duplicates");
  // Write a simple flaky.js file
  fs.writeFileSync(path.join(dir, "flaky.js"),
    "function compute() { return 2 + 2; }\nconsole.log(compute());\n");

  // Run the orchestrator with a task that explicitly warns against duplicates
  const result = await orchestrator.run(
    "Read flaky.js, run it, confirm the output is 4, and report completion. " +
    "Don't repeat a check you've already done with no new information."
  );

  // After run, extract all tool calls from the thinking log
  const calls: ToolCallRecord[] = entries
    .filter((e) => e.action?.tool && e.action.tool !== "goal_validator"
      && e.action.tool !== "iteration_limit_check")
    .map((e) => ({ tool: e.action!.tool, args: e.action!.input, observation: e.observation }));

  // Run the duplicate detector
  const violations = findDuplicateActions(calls);
  const passed = violations.length === 0 && result.length > 0;
  // ...
}
```

### Key Details

- **Task instruction explicitly warns:** "Don't repeat a check you've already done with no new information"
- **Filters out** `goal_validator` and `iteration_limit_check` from the call history (these are orchestrator-internal, not LLM-driven)
- **Pass condition:** Zero duplicate violations AND non-empty result

### Negative Test

**File:** `src/test/testLiveDiagnosticsNegative.ts`

A mock-based test that deliberately injects a duplicate call to verify the diagnostic catches it:

```typescript
// #3: BAD -- calls the exact same command twice with no reason
if (task.includes("flaky.js")) {
  const script: LlmResponse[] = [
    { content: "", toolCalls: [tc("c1", "run_command_tool", { command: "node flaky.js" })] },
    { content: "", toolCalls: [tc("c2", "run_command_tool", { command: "node flaky.js" })] }, // wasteful repeat
    { content: "task_complete: confirmed output is 4.", toolCalls: [] },
  ];
  return script[step] ?? script[script.length - 1];
}
```

Assertion:
```typescript
assert.equal(d3.passed, false, "diagnostic 3 should FAIL: the mock made a genuinely wasteful exact-duplicate call");
assert.ok(d3.evidence.some((e) => e.includes("node flaky.js")),
  "diagnostic 3's evidence should name the specific duplicated call");
```

---

## 5. Context Compaction (Stale File Reads)

**File:** `src/core/contextCompaction.ts`

This is a **different kind of deduplication** — not detecting duplicate actions, but removing stale/superseded file read observations from context to save tokens.

### Logic

```typescript
export function compactStaleFileReads(
  messages: LlmMessage[],
  filePath: string,
  currentToolCallId: string
): void {
  for (const msg of messages) {
    if (msg.role !== "assistant" || !msg.tool_calls) continue;

    for (const call of msg.tool_calls) {
      if (call.function.name !== "read_tool") continue;
      if (call.id === currentToolCallId) continue; // skip the current/fresh one

      const args = safeParseArgs(call.function.arguments);
      if (!args || args.filePath !== filePath) continue;

      // Find the corresponding tool-role message
      const toolMsg = messages.find((m) => m.role === "tool" && m.tool_call_id === call.id);
      if (!toolMsg || toolMsg.content.includes(STALE_READ_MARKER)) continue;

      // Replace with a short placeholder
      toolMsg.content = JSON.stringify({
        content: `${STALE_READ_MARKER}: "${filePath}" was read or modified again after this point...`,
      });
    }
  }
}
```

### Key Details

- **Trigger:** Called after every `read_tool` or `write_edit_tool` result is pushed
- **Scope:** Scans ALL earlier assistant messages for `read_tool` calls on the same `filePath`
- **Replacement marker:** `"[stale file snapshot omitted — lean token mode]"`
- **Preserves:** The latest/freshest read observation is always kept intact
- **Does NOT touch:** `tool_calls` arrays, `reasoning_content`, or `tool_call_id` linkage (required by DeepSeek's thinking-mode API)

### Flow

```
After pushing a new read_tool or write_edit_tool observation
        │
        ▼
  Scan all earlier assistant messages for read_tool calls
        │
        ▼
  For each read_tool on the same filePath (excluding current):
        │
        ▼
  Replace its tool-role content with stale marker
```

---

## 6. Goal Validator (Independent Verification)

**File:** `src/core/goalValidator.ts`

The goal validator is an **independent LLM call** that checks whether the agent's claimed completion is supported by the recorded observations. While not a "duplicate detector" per se, it serves as a verification gate that prevents the agent from claiming completion without evidence.

### Logic

```typescript
export async function validateGoal(
  llm: LlmClient,
  taskDescription: string,
  observationTranscript: string,
  candidateFinalAnswer: string
): Promise<ValidationResult> {
  // System prompt instructs the validator to be skeptical
  const messages: LlmMessage[] = [
    {
      role: "system",
      content:
        "You are an independent verification agent auditing another agent's claimed task completion. " +
        "You did not do the work. You only see the task, the raw tool observations that were actually " +
        "recorded, and the claimed final answer. Be skeptical: flag any claim not directly supported by " +
        "an observation...",
    },
    {
      role: "user",
      content:
        `TASK:\n${taskDescription}\n\n` +
        `OBSERVATIONS RECORDED DURING THE TASK:\n${observationTranscript}\n\n` +
        `AGENT'S CLAIMED FINAL ANSWER:\n${candidateFinalAnswer}\n\n` +
        `Is the claimed final answer fully supported by the observations...?`,
    },
  ];

  const response = await llm.complete(messages, { responseFormat: "json_object" });
  // Parse { valid: boolean, reason: string }
}
```

### Key Details

- **Isolation:** The validator gets NO tools and NO conversation history — only the task, observations, and claimed answer
- **Response format:** Strict JSON `{"valid": true|false, "reason": "..."}`
- **Fail-open:** If the validator's response is unparseable, defaults to `valid: true` (logged)
- **Retries:** Up to `maxValidatorRetries` (default 2) before accepting unverified

---

## 7. Workspace Manager (File Copy Dedup)

**File:** `src/core/workspaceManager.ts`

The workspace manager avoids re-copying files that haven't changed when preparing an isolated workspace.

### Logic

```typescript
function needsCopy(srcPath: string, destPath: string): boolean {
  if (!fs.existsSync(destPath)) return true;
  const srcStat = fs.statSync(srcPath);
  const destStat = fs.statSync(destPath);
  return srcStat.mtimeMs > destStat.mtimeMs || srcStat.size !== destStat.size;
}
```

### Key Details

- **Comparison:** Uses `mtime` (modification time) AND `size` — if either differs, the file is re-copied
- **Scope:** Only applies to the `workspace-agent/` isolated workspace setup
- **Excluded directories:** `.agent`, `.git`, `.log`, `node_modules`, `dist`, `build`, `tasks'

---

## 8. Site Crawler URL Deduplication

**File:** `src/tools/siteCrawlerTool.ts`

The site crawler uses a `visited` Set to avoid re-visiting URLs during BFS traversal, and deduplicates internal links per page using `new Set()`.

### Data Structures

```typescript
const visited = new Set<string>();       // global visited set across entire crawl
const queue: [string, number, string | null][] = [[rootUrl, 0, null]];  // BFS queue
```

### Detection Algorithm

```typescript
// BFS loop
while (queue.length > 0 && pages.length < maxPages) {
  const [currentUrl, depth, parentUrl] = queue.shift()!;

  if (visited.has(currentUrl)) continue;  // Skip already-visited URLs
  if (depth > maxDepth) continue;
  visited.add(currentUrl);

  // ... fetch page, extract links ...

  // Filter internal links
  const internalLinks: string[] = [];
  for (const link of page.links) {
    const normalized = normalizeUrl(link, currentUrl);
    if (!normalized) continue;
    if (sameDomain && extractDomain(normalized) !== rootDomain) continue;
    if (normalized.StartsWith("mailto:") || normalized.StartsWith("tel:") ||
        normalized.StartsWith("javascript:")) continue;
    if (visited.has(normalized)) continue;  // Skip already-queued URLs
    internalLinks.push(normalized);
  }

  // Deduplicate internal links (in case normalize produced duplicates)
  const uniqueInternal = [...new Set(internalLinks)];

  // Enqueue unvisited internal links
  for (const link of uniqueInternal) {
    if (!visited.has(link)) {
      queue.push([link, depth + 1, currentUrl]);
    }
  }
}
```

### Key Details

- **Two-layer dedup:** The `visited` Set prevents re-visiting any URL across the entire crawl. The `new Set(internalLinks)` deduplicates links found on a single page (after normalization).
- **Normalization:** URLs are normalized (trailing slash removed, origin+pathname extracted) before comparison, so `https://example.com/foo` and `https://example.com/foo/` are treated as the same URL.
- **Scope:** Dedup is global across the entire crawl — once a URL is visited, it's never enqueued again.
- **Edge cases:** Non-HTTP protocols (mailto:, tel:, javascript:) are filtered out before dedup. Failed fetches are silently skipped.

### Flow

```
BFS starts at rootUrl
        |
        v
  Dequeue next URL
        |
        v
  If visited.has(url) -> skip (already processed)
        |
        v
  Add to visited Set
        |
        v
  Fetch page, extract links
        |
        v
  Normalize each link, filter by domain/protocol
        |
        v
  Deduplicate with new Set(internalLinks)
        |
        v
  For each unique link not in visited -> enqueue
```


---

## 9. URL Summarizer Content Deduplication

**File:** `src/tools/summarizeUrlTool.ts`

The URL summarizer deduplicates content at the extraction stage — it removes non-content HTML elements before parsing, and deduplicates text by limiting to unique paragraphs.

### Logic

```typescript
// Remove non-content elements before extraction
$("script, style, nav, footer, header, aside, iframe, noscript, svg, form, button, input").remove();

// Extract paragraphs with meaningful content (skip short fragments and boilerplate)
const paragraphs: string[] = [];
$("p, li, blockquote, td, th, .content p, article p, main p").each((_, el) => {
  const text = $(el).text().trim();
  if (text.length > 40) paragraphs.push(text);  // Skip boilerplate < 40 chars
});

// Also grab any article or main content block as a fallback
let mainContent = "";
$("article, main, .post-content, .entry-content, .article-body, [role='main']").each((_, el) => {
  const text = $(el).text().trim();
  if (text.length > mainContent.length) mainContent = text;
});

// Build the readable text — deduplicate and limit to avoid token blowup
const allText = [
  ...(metaDescription ? [`Meta: ${metaDescription}`] : []),
  ...headings.map((h) => `## ${h}`),
  ...paragraphs,
  ...(mainContent && paragraphs.length < 5 ? [mainContent.slice(0, 3000)] : []),
].join("\n\n");

// Truncate to ~4000 chars to keep LLM calls reasonable
const truncated = allText.slice(0, 4000);
```

### Key Details

- **Structural dedup:** Removes navigation, scripts, styles, forms, and other non-content elements before extraction — prevents boilerplate from appearing in the summary.
- **Length filter:** Paragraphs shorter than 40 characters are discarded (filters out navigation labels, short button text, etc.).
- **Fallback dedup:** The `mainContent` fallback is only included when fewer than 5 paragraphs were found (avoids duplicating content that's already captured in paragraphs).
- **Token limit:** Final output is truncated to 4000 characters — a hard cap that prevents token blowup in LLM calls.
- **No Set-based dedup:** Unlike the site crawler, the summarizer doesn't use a Set for deduplication. It relies on structural removal and length filtering instead.

### Flow

```
Fetch URL -> parse HTML with cheerio
        |
        v
  Remove non-content elements (script, style, nav, etc.)
        |
        v
  Extract title, meta description, headings
        |
        v
  Extract paragraphs (length > 40 chars)
        |
        v
  Extract main content block (fallback if < 5 paragraphs)
        |
        v
  Join all text, truncate to 4000 chars
        |
        v
  Return UrlSummary
```


---

## 10. API User Management Duplicate Check

**File:** `src/api/routes.ts` (lines ~780-800) and `src/api/auth.ts`

The API's user management endpoints check for duplicate usernames before creating or updating users.

### Logic (routes.ts — POST /users)

```typescript
// Check for duplicate username
if (storedUsers.some((u) => u.username === username.trim())) {
  const body: ApiResponse = { success: false, error: "Username already exists" };
  res.status(409).json(body);
  return;
}
```

### Logic (routes.ts — PUT /users/:id)

```typescript
if (updates.name !== undefined) {
  const trimmedName = updates.name.trim();
  if (!trimmedName) return { error: "Project name is required" };
  if (projects.some((p) => p.id !== id && p.name.toLowerCase() === trimmedName.toLowerCase())) {
    return { error: "A project named \`" + trimmedName + "\` already exists" };
  }
  project.name = trimmedName;
}
```

### Key Details

- **Case-insensitive comparison:** Username comparison uses `===` (exact match after trim), but project name comparison uses `.toLowerCase()` for case-insensitive matching.
- **HTTP 409 Conflict:** Returns HTTP 409 (Conflict) for duplicate usernames, not 400 (Bad Request) — semantically correct.
- **Scope:** Only checks against the in-memory `storedUsers` array (not persisted to disk beyond the session).
- **Edge case — first-user registration:** The `/register` endpoint (no auth required) only works when no users exist. It doesn't need a duplicate check because there are no users to conflict with.
- **Edge case — self-update:** The PUT endpoint excludes the current user from the duplicate check (`p.id !== id`), so a user can keep their own username.

### Flow

```
POST /users request with { username, password }
        |
        v
  Validate inputs (non-empty, password >= 4 chars)
        |
        v
  Check storedUsers.some(u => u.username === username.trim())
        |
        v
  If duplicate -> 409 "Username already exists"
  If unique -> create user, 201 Created
```


---

## 11. Project Store Name Deduplication

**File:** `src/api/projectStore.ts`

The project store checks for duplicate project names before adding or updating projects, and also deduplicates filesystem slugs to avoid folder collisions.

### Logic (addProject — name dedup)

```typescript
export function addProject(name: string): AddProjectResult {
  const trimmedName = name.trim();
  if (!trimmedName) return { error: "Project name is required" };

  const projects = load();
  if (projects.some((p) => p.name.toLowerCase() === trimmedName.toLowerCase())) {
    return { error: `A project named "${trimmedName}" already exists` };
  }

  // ... create project ...
}
```

### Logic (uniqueSlug — filesystem dedup)

```typescript
function slugify(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "project";
}

function uniqueSlug(base: string, taken: Set<string>): string {
  const isFree = (candidate: string) =>
    !taken.has(candidate) && !fs.existsSync(path.join(PROJECTS_ROOT, candidate));
  if (isFree(base)) return base;
  let n = 2;
  while (!isFree(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}
```

### Logic (updateProject — name dedup)

```typescript
export function updateProject(id: string, updates: UpdateProjectInput): AddProjectResult {
  const projects = load();
  const project = projects.find((p) => p.id === id);
  if (!project) return { error: "Project not found" };

  if (updates.name !== undefined) {
    const trimmedName = updates.name.trim();
    if (!trimmedName) return { error: "Project name is required" };
    if (projects.some((p) => p.id !== id && p.name.toLowerCase() === trimmedName.toLowerCase())) {
      return { error: `A project named "${trimmedName}" already exists` };
    }
    project.name = trimmedName;
  }
  // ...
}
```

### Key Details

- **Two-layer dedup:** Project names are checked for uniqueness in the metadata store (case-insensitive). Filesystem slugs are checked for uniqueness on disk (since slugify can produce collisions from different names).
- **Case-insensitive name comparison:** Uses `.toLowerCase()` for both add and update checks.
- **Self-exclusion in update:** The `updateProject` check excludes the current project (`p.id !== id`) so renaming to the same name is allowed.
- **Slug collision resolution:** `uniqueSlug` appends `-2`, `-3`, etc. until the folder name doesn't collide with any existing project's folder or an orphaned directory on disk.
- **Edge case — empty slug:** If the name is all non-alphanumeric characters (emoji, punctuation), `slugify` returns `"project"` as fallback.

### Flow

```
addProject("My Project")
        |
        v
  Check projects.some(p => p.name.toLowerCase() === "my project")
        |
        v
  If duplicate -> error "already exists"
  If unique:
        |
        v
  slugify("My Project") -> "my-project"
  uniqueSlug("my-project", takenSlugs) -> "my-project" or "my-project-2"
        |
        v
  Create folder at PROJECTS_ROOT/<slug>
  Save to projects.json
```

