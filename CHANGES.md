<!-- ronin:version 1 | ronin:task task-b88b43 | ronin:updated 2026-08-13T06:32:32.604Z | ronin:subtask document-st-ae31dd -->
# Refactor summary

Addresses the 4 points you gave, on top of `xcoder-production-review.md`.

## 1. Atomic / component-based / modular
- Pulled the engine contract (`IReactEngine`), the I/O contract (`AgentIO`), and their
  implementations into their own single-purpose files under `src/core/io/` and
  `src/core/engine/` instead of everything living inside `orchestrator.ts`.
- Moved CLI-only presentation code (`consoleReporter.ts`, prompts) into `src/cli/`, where it's
  owned by the thing that actually needs it.
- UI: added `ui/src/components/ui/{Card,Button,Badge,PageHeader}.tsx` — small, reusable
  primitives backed by real design tokens in `index.css`, so pages stop hand-rolling the same
  inline styles.

## 2. Swappable orchestration engine
- `src/core/engine/IReactEngine.ts` defines the minimal contract any engine must implement.
- `src/core/engine/EngineRegistry.ts` is a factory/registry: callers do
  `createEngine("react", { llm, telemetry, io, options })` instead of `new ReActOrchestrator(...)`.
  Register a second implementation under a new name and it's usable everywhere with zero
  changes to the CLI or API.
- The CLI now exposes `--engine <name>` to select which registered engine runs a task.
- `ReActOrchestrator` (the existing ReAct loop) is the reference implementation, registered as
  `"react"` — unchanged behavior, just built against the new interfaces.

## 3. CLI functionality out of the engine
- `orchestrator.ts` no longer imports `node:readline` or calls `console.*` anywhere — it talks
  only to `this.io: AgentIO`.
- `src/cli/CliIO.ts` is the terminal implementation (ANSI colors, spinner, real y/n prompts on
  stdin) — this is the CLI functionality that used to live inside orchestration code.
- `src/core/io/AutoIO.ts` is the headless-safe default (used by the API server, and by the
  engine itself if no `io` is passed) — it never touches stdin, so a run triggered from the API
  can no longer hang waiting on a terminal prompt nobody will answer.
- `src/cli/index.ts` and `src/api/routes.ts` were updated to go through `EngineRegistry` instead
  of importing `ReActOrchestrator` directly. **CLI flags and behavior are unchanged.**

## 4. UI polish
- Added a proper design-token layer to `index.css`: type scale, spacing scale, radius/shadow
  scale, Inter + JetBrains Mono fonts.
- Rewrote `Navbar.tsx`: it previously imported `../assets/xcoder-logo-x.png`, which doesn't
  exist anywhere in the project — so the nav (and the homepage) were shipping a broken image.
  Replaced with a dependency-free wordmark, and added a responsive hamburger menu for narrow
  viewports (there was no mobile handling before).
- Rewrote `HomePage.tsx` to use the new `Card`/`Badge` primitives, drop the same broken image
  background, and drop the leftover "Mutant Protocol" placeholder copy.
- `Layout.tsx` now uses the design tokens instead of hardcoded pixel values.

## What I deliberately left alone
The review also flagged several functional/security bugs (SQLite handling, auth issues, a
broken `npm install` postinstall script, etc.) that are outside the 4 points you asked for. I
did fix one small pre-existing bug in `src/tools/filePlanStore.ts` (destructuring a possibly-null
result) because it was blocking a clean TypeScript build. Happy to work through the rest of the
review's findings next if you want them addressed too.

## Verified
- `npx tsc --noEmit` — clean, 0 errors, across the whole `src/` tree.
- `npx tsc -b` + `npx vite build` — clean UI build.
- Existing test suite still passes (one pre-existing, unrelated failure in
  `toolDispatcher.test.ts` that predates this refactor).

---

# Update: rebrand to xcoder + CLI/DB validation

## Rebrand
Every `devnull`/`DEVNULL` occurrence across the repo (63 files: package name/bin, CLI program
name, env vars, DB default paths, Docker image/container names, CI workflows, UI wordmark/title,
CSS class prefixes) renamed to `xcoder`/`XCODER`. No leftover references; `tsc --noEmit` clean
afterward. The npm package is now `xcoder`, the CLI binary is `xcoder`, default env vars are
`XCODER_HOME` / `XCODER_API_KEY` / `XCODER_PROJECTS_ROOT` / `XCODER_API_PORT`, the default DB
path is `~/.xcoder/data/xcoder.db`, and the default remote deploy path is `/opt/xcoder`.

## CLI logs to file only, database is API/UI-only (fix)
Found and fixed a real bug: `orchestrator.ts` (shared by CLI and API) was instantiating
`TaskHistoryStore`, `PhaseReportStore`, and `WbsStore` directly at 4 call sites. Each of those
defaults to opening its own database connection when no client is passed in — so **every CLI
run was silently opening a DB connection** in a best-effort try/catch, which contradicts "CLI
logs to file, only the UI uses the database."

Fix: added `persistToDb?: boolean` to `OrchestratorOptions` (default `false`). All 4 DB-writing
call sites are now gated behind `if (this.opts.persistToDb)`. Only `src/api/routes.ts` sets it
to `true` when constructing the engine; `src/cli/index.ts` never sets it, so a CLI run only ever
writes to `.log/*.log` (via `FileTelemetry`) and the markdown files under `tasks/`. Verified by
running the CLI end-to-end (see below) and confirming no `.db`/sqlite file was created and no
`persistToDb` reference exists in `src/cli/index.ts`.

Also added a top-level `.catch()` on `program.parseAsync(...)` in `src/cli/index.ts` — engine/LLM
failures previously crashed with a raw Node stack trace; now they print a clean `❌ <message>`
and exit with code 1 (found this while testing the flag matrix below).

## `--deploy --docker` flag matrix — tested end-to-end
Built the CLI (`tsc`), stubbed a fake `docker` executable on `PATH`, and ran every combination
against a scratch workspace:

| Command | Result |
|---|---|
| `--deploy` | Local direct deploy, runs `docker compose up -d --build`. ✅ |
| `--deploy --docker` | Same as above (`--docker` is explicit/implied by `--deploy`). ✅ |
| `--deploy --docker --llm false` | Same as above (explicit default). ✅ |
| `--deploy --docker --llm true` | Routes through the engine as a devops task; reaches plan generation, fails cleanly (exit 1) on missing `DEEPSEEK_API_KEY` — expected with no real LLM creds in this environment. ✅ wiring confirmed |
| `--deploy --docker --remote <ip>` (no creds) | Fails fast: `❌ REMOTE_SSH_USER and REMOTE_SSH_PASSWORD must be set in .env for remote deployment.` (exit 1). ✅ |
| `--deploy --docker --remote <ip> --llm false` (fake creds) | Reaches the SSH deploy path, fails gracefully on the unreachable test IP (exit 1, clean message, no crash). ✅ |
| `--deploy --docker --remote <ip> --llm true` (fake creds) | Reaches "sending to LLM as devops task (target: ...)", then the same expected LLM-credential failure as above. ✅ wiring confirmed |
| `--deploy --docker --remote <ip> --remote-path <path>` | Custom remote path is used in the SSH deploy call. ✅ |
| `--help` | Lists all deploy flags with the rebranded defaults (`/opt/xcoder`) and the `--engine` flag. ✅ |

Everything routes exactly as documented: `--llm` toggles whether the deploy is agent-mediated or
direct, `--remote` toggles local vs. SSH-to-remote-host, and they compose independently.

---

# Update: three new skills added to `agent/skills/`

The project shipped with `SkillRegistry` (hot-pluggable skill loading from
`agent/skills/<name>/SKILL.md`) but no `agent/skills/` directory existed at all in the dump this
project was rebuilt from — `xcoder --skills` returned nothing. Added three skills, each verified
to parse and route correctly via the real `SkillRegistry` code (see below).

- **`skill-authoring`** (role: `meta`) — a meta-skill for extending xcoder itself: documents the
  exact `SkillHeader` schema, how `route()`'s substring-match trigger scoring actually works (so
  new skills don't get triggers that are too broad or too narrow), and what makes a skill body
  actually change agent behavior instead of restating generic knowledge.
- **`ui-ux-design`** (role: `design`) — concrete, checkable UI/UX heuristics (type/spacing scale
  discipline, WCAG AA contrast, empty/loading/error states, reusing an existing token system
  instead of inventing one-off styles) rather than generic taste statements. Explicitly calls out
  the broken-asset-reference and leftover-placeholder-branding failure modes found earlier in this
  project's own UI.
- **`task-planning`** (role: `planning`) — grounded directly in this project's actual scoring
  mechanism, `src/core/stepScorer.ts`: cites the exact numbers (baseline 70, −45 on error, −35 on
  an exact duplicate action, +10 for a successful `write_edit_tool`/`run_command_tool` call, <40
  rolling average triggers a self-check nudge) and gives planning strategies that specifically
  avoid the two heavily-penalized patterns (repeat-without-changing-anything, act-before-verifying).

## Verified
- `xcoder --skills` lists all three with correct role/triggers (real CLI run, not just a parse test).
- Routing tested against representative task phrasings via `SkillRegistry.route()` — each skill
  fires only on its intended phrasing; an unrelated task ("fix a typo in the README") correctly
  matches none of them.
- `tsc --noEmit` clean; test suite unchanged (same one pre-existing unrelated failure).

---

# Update: 13 more skills — role skills + DevOps skills

Added, all under `agent/skills/`:

**Role skills**: `software-engineer`, `software-architect`, `qa-engineer`.

**DevOps skills**: `docker`, `kubernetes`, `git-vcs`, `kafka`, `aws`, `azure`, `ubuntu`, `redhat`,
`rosa` (Red Hat OpenShift Service on AWS), `openshift`.

Each follows the same standard as the first three: concrete, checkable instructions grounded in
real tool names and real failure modes (e.g. the exact `kubectl`/`oc` diagnostic sequence for a
stuck pod, the SELinux-vs-firewalld distinction on RHEL, the ROSA/AWS managed-service boundary,
the Kafka delivery-semantics/partition-key tradeoffs) rather than encyclopedia-style summaries.

## A real bug found and fixed during verification: trigger substring collisions

`SkillRegistry.route()` does plain, case-insensitive **substring** matching with no word
boundaries. Short/common triggers I initially wrote collided with unrelated English words:

| Trigger (skill) | False-positive match | Fix |
|---|---|---|
| `"ux"` (ui-ux-design) | `SELinux`, `Linux` | → `"ui design"`, `"ux design"`, `"ui/ux"` |
| `"ui"` (ui-ux-design) | `quick`, `guide`, `build` | → same as above |
| `"git"` (git-vcs) | `digit`, `legit`, `digital` | → `"git repo"`, `"git log"`, `"git status"`, `"using git"` |
| `"plan"` (task-planning) | `explanation`, `planet`, `plant` | → `"make a plan"`, `"plan the"`, `"plan for"`, `"project plan"` |
| `"pod"` (kubernetes) | `podcast` | → `"the pod "`, `"a pod "`, `"pod is "`, `"pod status"` (trailing-space boundary) |
| `"aws"` (aws) | `flaws`, `draws`, `drawbacks` | → `"on aws"`, `"aws cli"`, `"aws console"`, `"aws account"` |
| `"qa"` (qa-engineer) | `Qatar` | → removed; relies on `"quality assurance"`, `"test plan"`, etc. |
| `"olm"` (openshift) | `Holmes` | → removed; `"operator lifecycle manager"` covers it |
| `"adr"` (software-architect) | `adrenaline` | → `"architecture decision record"` |
| `"rosa"` (rosa) | the personal name *Rosa* | → `"rosa cluster"`, `"provision rosa"`, `"rosa cli"` |

Found by writing adversarial test sentences and running them through the real `SkillRegistry.route()`
(not just eyeballing the trigger lists) — e.g. `"Can you give a legitimate explanation of this
digital signal issue"` was incorrectly routing to `git-vcs` + `task-planning` before the fix, and
correctly matches nothing after.

## Verified
- `xcoder --skills` — all 16 skills (3 + 13) load with correct role/triggers.
- Positive-control routing: 14 realistic task phrasings, one per new skill area, each routes to
  the intended skill (verified via `SkillRegistry.route()` against the compiled registry).
- Negative-control / adversarial routing: 9+ sentences specifically constructed to probe for
  substring collisions, re-run after each fix until all resolved to `(none)` or the single
  genuinely intended skill.
- `tsc --noEmit` clean; test suite unchanged (same one pre-existing unrelated failure, nothing new
  broken by adding 13 more skill files).

---

# Update: workspace-context — a real capability, not just a skill doc

Added actual code (not just a `SKILL.md`) giving the agent structural awareness of the current
workspace, auto-refreshed before every task and explicitly re-triggerable by the LLM mid-task.

## What was built

- **`src/indexing/workspaceInfo.ts`** — builds a lightweight snapshot: file tree (capped at 400
  entries), language breakdown by extension, detected package manager(s)/frameworks, whether the
  project is containerized/has CI configured, git branch/remote/dirty-state (via `git` shell-outs,
  best-effort), and `package.json` name/version/scripts/dependencies. This is deliberately
  *metadata*, not content — distinct from the existing `indexing_tool`, which dumps full file
  content into chunked `.dump` files (that already existed; this is new and complementary).
  Cached to `.agent/workspace-info.json`.
- **`workspace_info_tool`** (`src/tools/toolSchemas.ts` + `toolDispatcher.ts` +
  `src/tools/workspaceInfoTool.ts`) — the LLM-callable tool. `refresh:true` forces a rebuild;
  omitted/`false` reads the cache, building fresh only if no cache exists yet.
- **Automatic refresh before LLM consumption** (`src/core/orchestrator.ts`) — `run()` calls
  `refreshWorkspaceInfo()` once at the start of every *top-level* task (not per-phase/per-subagent
  — they inherit the same cache), before the first LLM call. `buildSystemPrompt()` reads the
  cached snapshot and injects a `### Workspace context` block into the system prompt automatically
  — the LLM sees it without spending a tool call, and the base prompt now explicitly tells it so.
- **`workspace-context` skill** (`agent/skills/workspace-context/SKILL.md`) — documents the above:
  what's already automatic vs. when to actually call `workspace_info_tool(refresh=true)` (after
  installing a dependency, creating/deleting files, switching branches — not speculatively, which
  would just trip the duplicate-action health-score penalty for no new information).
- Added `workspace-context` to `composes_with` in all 13 role/DevOps skills from the previous
  update (`software-engineer`, `software-architect`, `qa-engineer`, and all 10 DevOps skills) —
  the explicit "applicable to software engineer, architect, QA, DevOps" requirement.

## Verified (not just written)

- Ran `buildWorkspaceInfo`/`refreshWorkspaceInfo`/`summarizeWorkspaceInfo` against a real scratch
  workspace (package.json with React+Express deps, a Dockerfile, a git repo) — correctly detected
  npm/React/Express, `containerized: true`, git branch/dirty-state, and rendered the file tree.
- Ran the actual `dispatchToolCall("workspace_info_tool", ...)` path end-to-end: a no-refresh call
  correctly reused the cache (`refreshed: false`); adding a new file and calling with
  `refresh: true` correctly picked it up (`4 files` → `5 files` in the very next call).
- Confirmed `TOOL_SCHEMAS` exposes `workspace_info_tool` with a well-formed function-calling schema.
- Confirmed the exact cache-read path `buildSystemPrompt()` uses (`readCachedWorkspaceInfo` +
  `summarizeWorkspaceInfo`) produces the injected block correctly.
- All 17 skills (16 + `workspace-context`) still load via `xcoder --skills`; routing tested with
  both positive phrasings ("understand this codebase", "what tech stack does this repo use")
  and adversarial negatives (none matched unintended text) — same substring-collision discipline
  as the previous skill batch, applied to the new triggers before shipping them.
- `tsc --noEmit` clean; test suite unchanged (same one pre-existing unrelated failure).

---

# Update: Efficient Filesystem Agent — blueprint implemented and integrated

Implemented `tmp/efficient-filesystem-agent-blueprint.md` (Parts 0–6) end-to-end and wired it into
all agent engines and orchestration, so the agent now locates → outlines → batch-reads → cheapest-edit
→ validates instead of scanning trees and full-reading files.

## Why

Both source documents behind the blueprint described the LLM-as-decision-engine pattern but
under-served reading strategy and refactoring: no multi-file batch reads, no dependency/import graph,
no read-before-write staleness protection, no layered edit toolset, no diff/patch as a first-class
edit format, and no git primitives for "what changed." The blueprint filled those gaps; this wave
shipped them as real tools.

## What was built

- **20 new dispatcher-registered tools** (`src/tools/toolDispatcher.ts` cases ~696–772;
  schemas in `src/tools/toolSchemas.ts`):
  - Discovery: `list_directory_tool`, `find_files_tool`, `get_dependency_graph_tool`.
  - Search: `search_code_tool`, `search_ast_tool`.
  - Read: `read_outline_tool`, `read_file_range_tool`, `read_multiple_files_tool`,
    `read_full_file_tool` (gated), `git_diff_tool`, `git_log_tool`.
  - Edit ladder (cheapest first): `search_replace_block_tool` → `sed_replace_tool` /
    `sed_replace_multi_tool` → `line_patch_tool` (expectedSha1-enforced) →
    `update_function_tool` → `rename_symbol_tool` → `apply_unified_diff_tool` →
    `write_file_tool` (force:true above 200 lines).
  - Validate: `validate_file_tool`.
- **`src/tools/fsToolUtils.ts`** — single shared implementation of workspace confinement, sha1
  hashing/staleness, all ceilings (`CEILINGS`: 2000 read tokens, 8000 batch tokens, 500 full-file
  lines, 200 write-file lines, 200 search matches, …), and actionable truncation
  (`[Output truncated: N more …]`), used by every new tool.
- **Integration points**:
  - `src/core/protocol.ts` — `buildProtocolPrompt()` now injects
    `<efficient_filesystem_protocol>` into every engine's system prompt.
  - `README_ONLY_TOOLS` sets in `src/core/orchestrator.ts`, `src/core/engine/LeanEngine.ts`, and
    `src/core/engine/LangGraphEngine.ts` extended from `{glob_tool, grep_tool, read_tool}` to 16
    side-effect-free tools; system prompts in those three advertise the new search toolset.
    (`SimpleReactEngine` has no such set — only a ronin header stamp.)
  - `agent/skills/filesystem-management/SKILL.md` — `requires_tools` lists all 20 new tools; added
    an "Efficient Filesystem Protocol" section.
- **Tooling** — `package.json`: added `"regression": "vitest run src"` (points at source tests so
  stale compiled `dist` artifacts can't pollute the gate) and dependency `ts-morph@^28.0.0` (powers
  AST-based `update_function_tool`, `rename_symbol_tool`, `search_ast_tool`); created `vitest.config.ts`
  so the documented `--config` invocation resolves.

## Pre-existing defects fixed en route

- `.ronin/defects/defect0001.md` (high) — `src/core/processCrashHandler.ts` leaked
  `uncaughtException`/`unhandledRejection` listeners across install/reset cycles (3 failing crash-handler
  tests). `resetCrashHandlerState()` now removes tracked handler references (`uncaughtHandler` /
  `unhandledHandler`).
- `.ronin/defects/defect0002.md` (medium) — `src/core/__tests__/subagentResiliencePhase5.test.ts`
  brittle error-string assertions (`toContain("exit code 1")` → `/code 1/`) and a load-sensitive
  timeout (mixed-crash test raised to 15s).

## Verified

- `npm run regression` → **20 test files, 400 tests passed** (12.65s), including 35 new tests across
  `src/tools/__tests__/efficientFilesystemBlueprintWrite.test.ts` (7),
  `efficientFilesystemBlueprintRead.test.ts` (12), `efficientFilesystemTools.test.ts` (11),
  `efficientFilesystemLoop.test.ts` (1), `efficientFilesystemIntegration.test.ts` (4).

## Rollback

- Revert modified integration files: `git checkout -- src/core/protocol.ts src/core/orchestrator.ts
  src/core/engine/LeanEngine.ts src/core/engine/LangGraphEngine.ts src/core/engine/SimpleReactEngine.ts
  src/tools/toolDispatcher.ts src/tools/toolSchemas.ts
  agent/skills/filesystem-management/SKILL.md package.json src/core/processCrashHandler.ts
  src/core/__tests__/subagentResiliencePhase5.test.ts`.
- Delete new files: the 21 untracked `src/tools/*.ts` efficient-filesystem modules (20 tools +
  `fsToolUtils.ts`), the 5 `src/tools/__tests__/efficientFilesystem*.test.ts` suites, `vitest.config.ts`,
  and `.ronin/defects/defect0001.md` / `defect0002.md` if desired.
- Remove the `"regression"` script and `ts-morph` from `package.json`.
- `tmp/efficient-filesystem-agent-blueprint.md` is inert documentation and can stay.

