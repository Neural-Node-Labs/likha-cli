import { LlmResponse, ToolCall } from "./types.js";

/**
 * Detects PM-2026-07-25-001 ("Silent File Truncation in write_edit_tool") before it happens,
 * instead of after.
 *
 * Root cause per that postmortem: the LLM's completion gets cut off by the max_tokens budget
 * while generating a large `content`/`newStr` argument for write_edit_tool, and the truncated
 * value gets written to disk with no warning. The postmortem's own investigation could only
 * infer this indirectly (byte-size boundaries that lined up suspiciously well with a 4096-token
 * budget) because nothing in the pipeline checked the one signal that actually says so directly:
 * the API's own `finish_reason` field. OpenAI-compatible APIs (DeepSeek included) return
 * `finish_reason: "length"` specifically to mean "this stopped because of max_tokens, not
 * because the model was done." Anthropic's equivalent (`stop_reason: "max_tokens"`) is
 * normalized to the same "length" value in deepseekClient.ts's callAnthropic.
 *
 * Tools whose arguments can legitimately be large enough to hit this. Read-only/small-argument
 * tools (read_tool, grep_tool, run_command_tool, ...) aren't at risk here — their arguments are
 * small regardless of file size, so a "length" finish on those turns doesn't indicate truncated
 * tool output.
 */
const LARGE_PAYLOAD_TOOLS = new Set(["write_edit_tool"]);

export interface TruncationCheckResult {
  /** Tool calls from this response that are safe to dispatch as normal. */
  safeCalls: ToolCall[];
  /** Tool calls withheld because their arguments were very likely truncated mid-generation. */
  blockedCalls: ToolCall[];
}

/**
 * Splits a response's tool_calls into ones safe to dispatch and ones that should be withheld
 * because `finish_reason === "length"` landed on a turn containing a large-payload tool call.
 * Call this right after receiving a response and before dispatching any of its tool_calls.
 */
export function checkForTruncatedToolCalls(response: LlmResponse): TruncationCheckResult {
  if (response.finishReason !== "length") {
    return { safeCalls: response.toolCalls, blockedCalls: [] };
  }

  const safeCalls: ToolCall[] = [];
  const blockedCalls: ToolCall[] = [];
  for (const call of response.toolCalls) {
    (LARGE_PAYLOAD_TOOLS.has(call.function.name) ? blockedCalls : safeCalls).push(call);
  }
  return { safeCalls, blockedCalls };
}

/** Observation text fed back for a withheld call, so the ReAct loop retries productively
 *  instead of the truncated content silently reaching disk. */
export function truncationWarningFor(call: ToolCall): string {
  return JSON.stringify({
    error: true,
    truncated: true,
    message:
      `This ${call.function.name} call was withheld: the response that generated it was cut off ` +
      `by the completion token limit (finish_reason: "length") while still generating the ` +
      `content/newStr argument, so it is very likely incomplete mid-file. Writing it would ` +
      `silently truncate the file (see incident PM-2026-07-25-001). ` +
      `Break this write into smaller pieces -- e.g. multiple write_edit_tool calls with ` +
      `mode='edit' to append each section -- and try again with less content per call.`,
  });
}
