import { LlmMessage } from "./types.js";

/**
 * Context compaction (lean-token mode) — enabled by default. Set
 * OrchestratorOptions.fullContextToken to true to keep the full history instead.
 *
 * What this does NOT touch, and why:
 *   - Every assistant message's `tool_calls` (the Action) and `reasoning_content` stay exactly
 *     as returned by the model, for the entire run. DeepSeek's thinking-mode API requires that
 *     once a tool call happens, the reasoning_content tied to it must be passed back unchanged
 *     on every subsequent request in that same run, or the API rejects the request outright
 *     (see https://api-docs.deepseek.com/guides/thinking_mode/). This isn't a token-savings
 *     knob — trimming it breaks the conversation.
 *   - tool_call_id linkage is never broken: every tool-role message keeps referencing a real
 *     preceding assistant tool_calls entry, which the API requires structurally.
 *
 * What this DOES touch:
 *   - Only the `content` string of tool-role (Observation) messages for read_tool. That's
 *     where the actual bloat lives — read_tool returns a file's full contents, and on a task
 *     that touches the same file across several iterations (read -> edit -> re-read -> edit
 *     again...), every earlier snapshot stays in context by default, each one a full copy of
 *     a file that's since changed.
 *   - Whenever a file at `filePath` is read or written again, every STRICTLY EARLIER read_tool
 *     Observation for that same path is collapsed to a short placeholder. The latest snapshot
 *     of any given file is always left intact and readable — only stale, superseded copies are
 *     compacted. This also fixes a correctness footgun, not just a cost one: without this, an
 *     old stale full-file read technically stays in context looking just as authoritative as
 *     the current one, which the model has no built-in way to tell apart from the real state.
 */

export const STALE_READ_MARKER = "[stale file snapshot omitted — lean token mode]";

/**
 * Call after pushing a new tool-role message for a read_tool or write_edit_tool call.
 * `filePath` is the path that was just read/written; `currentToolCallId` is that call's id
 * (never compacted, since it's the fresh snapshot we want to keep).
 */
export function compactStaleFileReads(
  messages: LlmMessage[],
  filePath: string,
  currentToolCallId: string
): void {
  for (const msg of messages) {
    if (msg.role !== "assistant" || !msg.tool_calls) continue;

    for (const call of msg.tool_calls) {
      if (call.function.name !== "read_tool") continue;
      if (call.id === currentToolCallId) continue;

      const args = safeParseArgs(call.function.arguments);
      if (!args || args.filePath !== filePath) continue;

      const toolMsg = messages.find((m) => m.role === "tool" && m.tool_call_id === call.id);
      if (!toolMsg || toolMsg.content.includes(STALE_READ_MARKER)) continue;

      toolMsg.content = JSON.stringify({
        content: `${STALE_READ_MARKER}: "${filePath}" was read or modified again after this point — see the latest Observation of this file for its current contents.`,
      });
    }
  }
}

function safeParseArgs(json: string): { filePath?: string } | null {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

