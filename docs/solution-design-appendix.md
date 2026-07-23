# Solution Design Appendix

This file contains sections that were too large for the main `solution-design.md` file. It completes the documentation.

## 11.2 UI Pages (continued)

| Page | Route | Description |
|------|-------|-------------|
| Plan Detail | `/plans/:id` | View and manage a specific plan |
| Task History | `/history` | Browse past task executions |
| Phase Reports | `/phases` | View per-phase results |
| Telemetry | `/telemetry` | Browse thinking logs and LLM call logs |
| Diagnostics | `/diagnostics` | View health scores and system diagnostics |
| Settings | `/settings` | LLM API key configuration |
| Admin | `/admin` | User administration panel |
| Projects | `/projects` | Add and switch between projects |

### 11.3 UI Architecture

```
ui/
├── src/
│   ├── pages/           # Page components (one per route)
│   ├── components/      # Shared UI components
│   │   ├── Badge.tsx
│   │   ├── Button.tsx
│   │   ├── Card.tsx
│   │   └── PageHeader.tsx
│   ├── contexts/        # React contexts
│   │   ├── AuthContext.tsx   # Token management, login state
│   │   └── ThemeContext.tsx  # Light/dark mode
│   ├── App.tsx          # Root app with routing
│   ├── main.tsx         # Entry point
│   └── client.ts        # API client (fetch wrapper)
├── index.html
├── package.json
├── vite.config.ts
└── tsconfig.json
```

---

## 12. Design Decisions & Trade-offs

### 12.1 Engine Registry Pattern (Factory)

**Decision:** Engines are registered via a static factory (`EngineRegistry.ts`) rather than discovered at runtime or hardcoded in the CLI.

**Rationale:**
- New engines can be added by registering them in one file without touching the CLI or API
- The factory encapsulates construction logic (mapping options between engine-specific and generic)
- The `IReactEngine` interface provides a stable contract that all call sites depend on

**Trade-off:** Engines must be explicitly registered at module load time. Dynamic discovery (scanning a directory) would be more extensible but adds complexity and startup cost.

### 12.2 Four Engine Implementations

**Decision:** Provide four distinct engine implementations rather than one configurable engine.

**Rationale:**
- Each engine has fundamentally different execution semantics (sequential vs. graph-based vs. parallel swarm)
- A single configurable engine would be a complex monolith with feature flags
- The interface contract ensures they're interchangeable at the call site

**Trade-off:** Code duplication across engines (each has its own `buildSystemPrompt`, `extractPartialSuccessContext`, `synthesizeReport`). A shared base class could reduce duplication but would couple the engines together.

### 12.3 Skill System (Hot-Pluggable)

**Decision:** Skills are defined as markdown files with YAML frontmatter, loaded at runtime from `agent/skills/`.

**Rationale:**
- Non-developers can add/modify skills without touching TypeScript code
- Skills are self-documenting (the markdown body IS the skill definition)
- The `composes_with` field enables multi-skill composition without code changes

**Trade-off:** Skills are loaded from the filesystem at runtime, which means they're not type-checked. A malformed YAML header silently fails to load.

### 12.4 Context Compaction (Lean-Token Mode)

**Decision:** Stale file reads are automatically collapsed to placeholders (enabled by default).

**Rationale:**
- File reads are the largest contributor to token bloat in long-running tasks
- Keeping every historical snapshot of every file is wasteful and confusing to the model
- The latest snapshot is always preserved — only stale copies are compacted

**Trade-off:** If a task needs to compare old and new versions of a file, the old version is no longer in context. The model must re-read the file or rely on its own memory.

### 12.5 Goal Validation (Independent LLM Call)

**Decision:** Before accepting a completion, an independent LLM call verifies the claim against recorded observations.

**Rationale:**
- Prevents the agent from claiming completion without evidence
- The validator has no access to the agent's reasoning — only raw observations
- Fail-open on parse errors prevents the validator from blocking legitimate completions

**Trade-off:** Adds one extra LLM call per completion attempt (plus retries). For simple tasks, this is ~10-20% overhead. For complex tasks, it's negligible.

### 12.6 Duplicate Iteration Reason Detection (Dormant)

**Decision:** The `thought` parameter for duplicate iteration reason detection exists in the API but is not passed by any call site.

**Rationale:**
- The feature was added to `scoreStep()` as an optional parameter for backward compatibility
- Activating it requires changes at four call sites (orchestrator.ts, LeanEngine.ts, LangGraphEngine.ts, SwarmEngine.ts)
- The feature is tested in unit tests but dormant in production

**Trade-off:** The feature exists but provides no value until the call sites are updated. This is a deliberate staging decision — the detection logic is verified, and activation is a mechanical change.

### 12.7 File-Based vs. Database Persistence

**Decision:** Task history is always written to files (`.agent/task-history.jsonl` + `.agent/task_history.md`). Database persistence is an additional layer for the API/UI.

**Rationale:**
- File-based persistence works without any database setup
- The markdown file is human-readable and git-friendly
- Database persistence enables the UI to query and filter history

**Trade-off:** Two persistence paths means two code paths to maintain. The database path is best-effort (errors are caught and logged, never propagated).

### 12.8 AgentIO Abstraction

**Decision:** All engine I/O goes through the `AgentIO` interface rather than calling `console.log`/`readline` directly.

**Rationale:**
- The engine can run safely in headless contexts (API server, CI, tests) without hanging on stdin
- The CLI gets ANSI colors, spinners, and interactive prompts via `CliIO`
- The API server uses `AutoIO` which never reads stdin and auto-answers prompts

**Trade-off:** Adds an indirection layer. Every new output format (e.g., JSON mode for programmatic consumption) requires a new `AgentIO` implementation.

### 12.9 Phase Planning vs. Single Phase

**Decision:** Phase planning is enabled by default, dividing tasks into sequential phases with isolated context.

**Rationale:**
- Reduces per-phase token footprint significantly for long tasks
- Each phase starts with a clean context, preventing context window overflow
- Phase summaries carry forward only what's relevant

**Trade-off:** Cross-phase context is lost. A decision made in phase 1 that affects phase 3 must be explicitly summarized. The LLM call for summarization adds cost.

### 12.10 Subagent Delegation

**Decision:** Subagents run as fresh orchestrator instances with isolated message history.

**Rationale:**
- Subagent tool calls and reasoning never enter the parent's context window
- The parent only sees the final summary, keeping context clean
- Subagents can be continued or retried independently

**Trade-off:** Subagents cannot access the parent's accumulated context. All necessary context must be passed in the task description. This is by design (isolation) but means the subagent may re-discover information the parent already knows.

---

## 13. Deployment Architecture

### 13.1 Local Development

```
npm run dev → ts-node src/cli/index.ts --task "..."
npm test   → vitest run
```

### 13.2 Production Build

```
npm run build → tsc + copy agent/ to dist/config/agent/
npm start     → node dist/cli/index.js
```

### 13.3 Docker Deployment

```
npm run package:docker → docker build -t xcoder .
xcoder --deploy --docker → docker compose up -d --build
```

### 13.4 Remote Deployment

```
xcoder --deploy --docker --remote 192.168.1.100
  → Packages workspace
  → SCP to remote host
  → docker compose up -d --build on remote
  → Health check
  → Rollback on failure
```

### 13.5 Fleet Operations

```
XCODER_SSH_TARGETS=host1:22,host2:22
XCODER_SSH_USER=fleet-user
XCODER_SSH_PASSWORD=fleet-password

ssh_copy_tool → Upload to all targets
ssh_run_command → Execute on all targets in parallel
```

---

## 14. Sequence Diagrams

### 14.1 Basic ReAct Loop

```
┌─────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│  User   │     │  Engine  │     │   LLM    │     │  Tools   │
└────┬────┘     └────┬─────┘     └────┬─────┘     └────┬─────┘
     │                │                │                │
     │ run(task)      │                │                │
     │───────────────>│                │                │
     │                │ complete()     │                │
     │                │───────────────>│                │
     │                │  tool_calls    │                │
     │                │<───────────────│                │
     │                │                │                │
     │                │ dispatch()     │                │
     │                │────────────────────────────────>│
     │                │  observation   │                │
     │                │<────────────────────────────────│
     │                │                │                │
     │                │ complete()     │                │
     │                │───────────────>│                │
     │                │  final answer  │                │
     │                │<───────────────│                │
     │                │                │                │
     │                │ validate()     │                │
     │                │───────────────>│                │
     │                │  valid/invalid │                │
     │                │<───────────────│                │
     │                │                │                │
     │  result        │                │                │
     │<───────────────│                │                │
```

### 14.2 Phase Planning Flow

```
┌─────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│  User   │     │  Engine  │     │  Phase 1 │     │  Phase 2 │
└────┬────┘     └────┬─────┘     └────┬─────┘     └────┬─────┘
     │                │                │                │
     │ run(task)      │                │                │
     │───────────────>│                │                │
     │                │                │                │
     │                │ Generate phases│                │
     │                │── (LLM call) ──│                │
     │                │                │                │
     │ Show phases    │                │                │
     │<───────────────│                │                │
     │ Approve        │                │                │
     │───────────────>│                │                │
     │                │                │                │
     │                │ run(phase 1)   │                │
     │                │───────────────>│                │
     │                │  result        │                │
     │                │<───────────────│                │
     │                │                │                │
     │                │ Summarize      │                │
     │                │── (LLM call) ──│                │
     │                │                │                │
     │                │ run(phase 2)   │                │
     │                │────────────────────────────────>│
     │                │  result        │                │
     │                │<────────────────────────────────│
     │                │                │                │
     │  final result  │                │                │
     │<───────────────│                │                │
```

### 14.3 Swarm Engine Flow

```
┌─────────┐   ┌──────────────┐   ┌──────────┐   ┌──────────┐
│  User   │   │  Orchestrator│   │  Agent 1 │   │  Agent 2 │
└────┬────┘   └──────┬───────┘   └────┬─────┘   └────┬─────┘
     │                │                │                │
     │ run(task)      │                │                │
     │───────────────>│                │                │
     │                │                │                │
     │                │ Generate WBS   │                │
     │                │── (LLM call) ──│                │
     │                │                │                │
     │                │ Dispatch T1    │                │
     │                │───────────────>│                │
     │                │                │                │
     │                │ Dispatch T2    │                │
     │                │────────────────────────────────>│
     │                │                │                │
     │                │  T1 result     │                │
     │                │<───────────────│                │
     │                │                │                │
     │                │  T2 result     │                │
     │                │<────────────────────────────────│
     │                │                │                │
     │                │ Check status   │                │
     │                │── (LLM call) ──│                │
     │                │                │                │
     │  final result  │                │                │
     │<───────────────│                │                │
```

---

## Appendix A: Configuration Reference

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DEEPSEEK_API_KEY` | Yes | — | DeepSeek API key |
| `DEEPSEEK_BASE_URL` | No | `https://api.deepseek.com` | DeepSeek API base URL |
| `DEEPSEEK_MODEL` | No | `deepseek-chat` | Model name |
| `MAX_ITERATIONS` | No | `20` | Override max iterations |
| `XCODER_API_PORT` | No | `3001` | API server port |
| `XCODER_API_HOST` | No | `0.0.0.0` | API server host |
| `DATABASE_URL` | No | — | PostgreSQL connection string |
| `REMOTE_SSH_USER` | No | — | SSH user for remote deploy |
| `REMOTE_SSH_PASSWORD` | No | — | SSH password for remote deploy |
| `XCODER_SSH_TARGETS` | No | — | Fleet SSH targets (comma-separated) |
| `XCODER_SSH_USER` | No | — | Fleet SSH user |
| `XCODER_SSH_PASSWORD` | No | — | Fleet SSH password |
| `GITHUB_TOKEN` | No | — | GitHub token for git operations |

### OrchestratorOptions

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxIterations` | `number` | `20` | Max ReAct iterations per round |
| `planMode` | `"auto" \| "always" \| "never"` | `"auto"` | Plan mode trigger strategy |
| `validateGoal` | `boolean` | `true` | Independent validation before completion |
| `maxValidatorRetries` | `number` | `2` | Max validator rejection retries |
| `interactive` | `boolean` | `true` | Enable interactive stdin prompts |
| `auto` | `boolean` | `false` | Fully autonomous mode |
| `continueOnLimit` | `boolean` | `false` | Auto-continue past iteration limit |
| `consoleThoughts` | `boolean` | `true` | Show live console output |
| `leanToken` | `boolean` | `true` | Enable context compaction |
| `fullContextToken` | `boolean` | `false` | Disable context compaction |
| `selfHealing` | `boolean` | `true` | Enable self-healing nudges |
| `isolatedWorkspace` | `boolean` | `false` | Run in isolated workspace copy |
| `singlePhase` | `boolean` | `false` | Disable phase planning |
| `io` | `AgentIO` | `AutoIO` | I/O abstraction |
| `persistToDb` | `boolean` | `false` | Enable database persistence |

---

## Appendix B: File Reference

### Source Files

| File | Purpose |
|------|---------|
| `src/cli/index.ts` | CLI entry point (Commander) |
| `src/cli/CliIO.ts` | Terminal I/O (spinner, prompts, colors) |
| `src/api/server.ts` | Express server startup |
| `src/api/routes.ts` | All API endpoints |
| `src/api/auth.ts` | Token-based authentication |
| `src/api/types.ts` | API request/response types |
| `src/core/orchestrator.ts` | Full-featured ReAct orchestrator |
| `src/core/types.ts` | Core type definitions |
| `src/core/protocol.ts` | Protocol prompt builder |
| `src/core/skillRegistry.ts` | Skill loading and routing |
| `src/core/stepScorer.ts` | Health scoring per step |
| `src/core/duplicateActionDetector.ts` | Duplicate tool call detection |
| `src/core/iterationReasonDedup.ts` | Duplicate reasoning detection |
| `src/core/contextCompaction.ts` | Stale file read compaction |
| `src/core/goalValidator.ts` | Independent completion validation |
| `src/core/workspaceManager.ts`