# Lean Context Token Mode

## Overview

Lean Context Token mode is a token-optimization strategy that reduces LLM context window
consumption by collapsing stale/superseded `read_tool` file snapshots. It is **enabled by
default** — the `--lean` flag is an explicit affirmation of this default behavior.

To opt **out** of lean-token mode and keep the full read history in context, use the
`--full-context-token` flag.

## How It Works

The implementation lives in `src/core/contextCompaction.ts`. After every `read_tool` or
`write_edit_tool` call, the orchestrator scans the message history for any **strictly earlier**
`read_tool` observation of the **same file path** and replaces its full content with a short
placeholder:

```
[stale file snapshot omitted — lean token mode]: "path/to/file" was read or modified again
after this point — see the latest Observation of this file for its current contents.
```

This prevents the context window from accumulating multiple full copies of the same file as
the agent iterates (read → edit → re-read → edit again...).

## What Is NOT Touched

- **Every assistant message's `tool_calls`** (the Action) and `reasoning_content` stay exactly
  as returned by the model. DeepSeek's thinking-mode API requires that once a tool call happens,
  the `reasoning_content` tied to it must be passed back unchanged on every subsequent request
  in that same run, or the API rejects the request outright.
- **`tool_call_id` linkage** is never broken: every tool-role message keeps referencing a real
  preceding assistant `tool_calls` entry, which the API requires structurally.

## What IS Compacted

- Only the `content` string of **tool-role (Observation) messages for `read_tool`**.
- Only **stale/superseded** snapshots — the latest observation of any given file is always
  left intact and readable.

## CLI Usage

```bash
# Explicitly enable lean-token mode (default behavior)
xcoder --lean --task "..."

# Opt out — keep full read history
xcoder --full-context-token --task "..."

# The two flags are mutually exclusive; --full-context-token takes precedence
```

## Why This Matters

Without lean-token compaction, every historical `read_tool` snapshot of a file stays in context
looking just as authoritative as the current one. The model has no built-in way to tell apart
stale state from current state. This is both a **cost issue** (bloated context windows) and a
**correctness issue** (the model may act on outdated file contents).

## Implementation Details

| Component | File | Role |
|-----------|------|------|
| Compaction logic | `src/core/contextCompaction.ts` | Scans messages, replaces stale observations |
| Orchestrator integration | `src/core/orchestrator.ts` | Calls `compactStaleFileReads()` after each read/write |
| CLI flag | `src/cli/index.ts` | `--lean` flag (explicit opt-in) |
| Opt-out flag | `src/cli/index.ts` | `--full-context-token` flag (keeps full history) |
| Config option | `OrchestratorOptions.leanToken` | Programmatic API |
| Config option | `OrchestratorOptions.fullContextToken` | Programmatic opt-out |
