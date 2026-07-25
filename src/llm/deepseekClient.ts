import { LlmClient, LlmMessage, LlmResponse, ToolSchema } from "../core/types.js";
import { LlmConfig, resolveModelForSkill } from "../config/loadConfig.js";
import { TelemetryInterface } from "../core/types.js";

/**
 * Class name kept as DeepSeekClient for backward compatibility with existing imports (CLI,
 * API routes, tests) even though it's now a generic provider-routing client — DeepSeek is
 * xcoder's default backend, but `config.provider` (and `config.fallback.provider`) determine
 * which shape actually gets used for both the primary call AND the fallback, so either one can
 * be DeepSeek, Anthropic, or swapped between the two via llm.yaml alone with no code changes.
 */
export class DeepSeekClient implements LlmClient {
  constructor(
    private config: LlmConfig,
    private telemetry?: TelemetryInterface,
    private skillName?: string
  ) {}

  async complete(
    messages: LlmMessage[],
    opts?: { model?: string; temperature?: number; tools?: ToolSchema[]; responseFormat?: "json_object" }
  ): Promise<LlmResponse> {
    const resolved = resolveModelForSkill(this.config, this.skillName);
    const model = opts?.model ?? resolved.model;
    const apiKey = process.env[this.config.api_key_env];

    if (!apiKey) {
      return this.fallback(messages, opts, `missing ${this.config.api_key_env}`);
    }

    try {
      if (this.config.provider === "anthropic") {
        return await this.callAnthropic(model, apiKey, messages, this.config, opts);
      }
      return await this.callOpenAiCompatible(model, apiKey, messages, this.config, resolved, opts, "DeepSeekClient");
    } catch (err) {
      await this.telemetry?.logError(err, "DeepSeekClient");
      return this.fallback(messages, opts, err instanceof Error ? err.message : "request failed");
    }
  }

  /** OpenAI-compatible /chat/completions shape — used for DeepSeek and any other
   *  OpenAI-compatible provider configured with a base_url + endpoint. */
  private async callOpenAiCompatible(
    model: string,
    apiKey: string,
    messages: LlmMessage[],
    config: LlmConfig,
    resolved: ReturnType<typeof resolveModelForSkill>,
    opts: { tools?: ToolSchema[]; temperature?: number; responseFormat?: "json_object" } | undefined,
    telemetrySource: string
  ): Promise<LlmResponse> {
    if (!config.base_url || !config.endpoint) {
      throw new Error(`provider "${config.provider}" is missing base_url/endpoint in its config`);
    }
    const url = `${config.base_url}${config.endpoint}`;

    // Per DeepSeek's Thinking Mode docs: temperature/top_p/presence_penalty/frequency_penalty
    // have NO EFFECT in thinking mode (silently ignored, not an error) -- omit them entirely
    // rather than sending dead parameters. reasoning_effort is the real lever there instead.
    // The `thinking` field itself is always sent explicitly (never omitted) so behavior never
    // depends on a model's own default, which can differ between tiers.
    const samplingParams = resolved.thinking ? {} : { temperature: opts?.temperature ?? resolved.temperature };
    const thinkingParams = resolved.thinking
      ? { thinking: { type: "enabled" }, ...(resolved.reasoningEffort ? { reasoning_effort: resolved.reasoningEffort } : {}) }
      : { thinking: { type: "disabled" } };

    const body = {
      model,
      max_tokens: config.max_tokens,
      messages: messages.map(stripUndefined),
      ...samplingParams,
      ...thinkingParams,
      ...(opts?.tools ? { tools: opts.tools, tool_choice: "auto" } : {}),
      ...(opts?.responseFormat ? { response_format: { type: opts.responseFormat } } : {}),
    };

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${config.provider} HTTP ${res.status}: ${text}`);
    }

    // Guard against non-JSON responses (e.g. proxy HTML error pages that return 200)
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json") && !contentType.includes("text/event-stream")) {
      const text = await res.text();
      throw new Error(
        `${config.provider} returned non-JSON response (Content-Type: ${contentType}): ${text.slice(0, 500)}`
      );
    }

    const data = (await res.json()) as {
      choices: {
        message: { content: string | null; tool_calls?: LlmResponse["toolCalls"]; reasoning_content?: string };
        finish_reason?: string;
      }[];
      usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
        prompt_cache_hit_tokens?: number;
        completion_tokens_details?: { reasoning_tokens?: number };
      };
    };
    const message = data.choices?.[0]?.message;
    await this.telemetry?.logLlmCall(body, data);
    return {
      content: message?.content ?? "",
      toolCalls: message?.tool_calls ?? [],
      reasoningContent: message?.reasoning_content,
      finishReason: data.choices?.[0]?.finish_reason,
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
            totalTokens: data.usage.total_tokens,
            reasoningTokens: data.usage.completion_tokens_details?.reasoning_tokens,
            cachedTokens: data.usage.prompt_cache_hit_tokens,
          }
        : undefined,
    };
  }

  /** Anthropic /v1/messages shape, including real tool-calling — translates our OpenAI-shaped
   *  messages/tools to Anthropic's format and tool_use content blocks back to ToolCall[]. This
   *  is not optional: the ReAct loop is driven entirely by tool_calls, so a text-only Anthropic
   *  integration would make the agent unusable as primary (one text reply, then it just stops
   *  since response.toolCalls.length === 0 immediately ends the loop). */
  private async callAnthropic(
    model: string,
    apiKey: string,
    messages: LlmMessage[],
    config: LlmConfig,
    opts?: { tools?: ToolSchema[]; responseFormat?: "json_object" }
  ): Promise<LlmResponse> {
    const { system, anthropicMessages } = convertMessagesToAnthropic(messages);
    const anthropicTools = convertToolsToAnthropic(opts?.tools);

    const body: Record<string, unknown> = {
      model,
      max_tokens: config.max_tokens,
      messages: anthropicMessages,
      ...(system ? { system } : {}),
      ...(anthropicTools ? { tools: anthropicTools } : {}),
    };

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`anthropic HTTP ${res.status}: ${text}`);
    }

    // Guard against non-JSON responses (e.g. proxy HTML error pages that return 200)
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      const text = await res.text();
      throw new Error(
        `anthropic returned non-JSON response (Content-Type: ${contentType}): ${text.slice(0, 500)}`
      );
    }

    const data = (await res.json()) as {
      content: AnthropicContentBlock[];
      usage?: { input_tokens: number; output_tokens: number };
      stop_reason?: string;
    };
    await this.telemetry?.logLlmCall(body, data);

    const textBlocks = data.content?.filter((b): b is { type: "text"; text: string } => b.type === "text") ?? [];
    const toolUseBlocks = data.content?.filter((b): b is AnthropicToolUseBlock => b.type === "tool_use") ?? [];

    return {
      content: textBlocks.map((b) => b.text).join("\n"),
      toolCalls: toolUseBlocks.map((b) => ({
        id: b.id,
        type: "function" as const,
        function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
      })),
      finishReason: data.stop_reason === "max_tokens" ? "length" : data.stop_reason,
      usage: data.usage
        ? {
            promptTokens: data.usage.input_tokens,
            completionTokens: data.usage.output_tokens,
            totalTokens: data.usage.input_tokens + data.usage.output_tokens,
          }
        : undefined,
    };
  }

  private async fallback(
    messages: LlmMessage[],
    opts: { model?: string; temperature?: number; tools?: ToolSchema[]; responseFormat?: "json_object" } | undefined,
    reason: string
  ): Promise<LlmResponse> {
    if (!this.config.fallback) {
      throw new Error(`Primary LLM call failed (${reason}) and no fallback provider configured.`);
    }
    await this.telemetry?.logError(new Error(`Falling back: ${reason}`), "DeepSeekClient.fallback");

    const { provider, model, api_key_env } = this.config.fallback;
    const apiKey = process.env[api_key_env];
    if (!apiKey) {
      // Surface the actual error first (the primary failure reason), then mention the
      // fallback as secondary context. Include the request payload for full diagnostics.
      const payload = {
        model: this.config.model,
        max_tokens: this.config.max_tokens,
        messageCount: messages.length,
        lastMessageRole: messages[messages.length - 1]?.role,
        lastMessagePreview: messages[messages.length - 1]?.content?.slice(0, 200),
      };
      throw new Error(
        `Primary LLM call failed: ${reason}. ` +
          `Fallback provider ${provider} also unavailable (missing ${api_key_env}). ` +
          `Request payload: ${JSON.stringify(payload)}`
      );
    }

    try {
      if (provider === "anthropic") {
        return await this.callAnthropic(model, apiKey, messages, this.config, opts);
      }
      if (provider === "deepseek" || this.config.fallback.base_url) {
        // Any OpenAI-compatible fallback (DeepSeek or otherwise), as long as base_url/endpoint
        // are given — reuses the exact same resolveModelForSkill-shaped defaults as primary,
        // just with the fallback's own model/temperature/thinking left at config defaults
        // (no per-skill overrides applied to the fallback provider).
        const fallbackConfig: LlmConfig = {
          ...this.config,
          provider,
          model,
          api_key_env,
          base_url: this.config.fallback.base_url ?? DEFAULT_OPENAI_COMPATIBLE_BASE_URLS[provider],
          endpoint: this.config.fallback.endpoint ?? "/chat/completions",
        };
        const resolved = { model, temperature: this.config.temperature, thinking: false, reasoningEffort: undefined };
        return await this.callOpenAiCompatible(model, apiKey, messages, fallbackConfig, resolved, opts, "DeepSeekClient.fallback");
      }
      throw new Error(`Unsupported fallback provider: ${provider}`);
    } catch (err) {
      throw new Error(
        `Primary LLM call failed: ${reason}. Fallback provider ${provider} also failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}

/** Known base URLs for OpenAI-compatible providers, so a fallback block doesn't have to repeat
 *  base_url/endpoint if it's just naming a well-known provider. Explicit base_url in config
 *  always wins over this. */
const DEFAULT_OPENAI_COMPATIBLE_BASE_URLS: Record<string, string> = {
  deepseek: "https://api.deepseek.com/v1",
};

function stripUndefinedOrig(message: LlmMessage): LlmMessage {
  return Object.fromEntries(Object.entries(message).filter(([, v]) => v !== undefined)) as LlmMessage;
}

function stripUndefined(message: LlmMessage): LlmMessage {
  return Object.fromEntries(
    Object.entries(message).filter(([k, v]) => {
      // Omit explicitly undefined values
      if (v === undefined) return false;

      // Omit empty tool_calls arrays to avoid API validation errors
      if (k === 'tool_calls' && Array.isArray(v) && v.length === 0) return false;

      return true;
    })
  ) as LlmMessage;
}


// ─── Anthropic <-> OpenAI-shaped message/tool translation ─────────────────────────────────
//
// Everywhere else in the codebase (orchestrator.ts, toolDispatcher.ts, types.ts) works in
// OpenAI's chat-completions shape: assistant messages carry `tool_calls`, tool results are
// separate `role: "tool"` messages with a `tool_call_id`. Anthropic's Messages API has a
// different shape: tool_use lives inside an assistant message's `content` array, and results
// go back as a `role: "user"` message with `tool_result` content blocks (typically batched --
// all tool_results answering one assistant turn belong in a single user message, not one each).
// These two functions are the only place that translation happens, so nothing upstream needs
// to know or care which provider is actually being called.

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | AnthropicToolUseBlock
  | { type: "tool_result"; tool_use_id: string; content: string };

interface AnthropicToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

function convertMessagesToAnthropic(messages: LlmMessage[]): { system?: string; anthropicMessages: AnthropicMessage[] } {
  const systemParts: string[] = [];
  const result: AnthropicMessage[] = [];

  for (const m of messages) {
    if (m.role === "system") {
      if (m.content) systemParts.push(m.content);
      continue;
    }

    if (m.role === "assistant") {
      const blocks: AnthropicContentBlock[] = [];
      if (m.content) blocks.push({ type: "text", text: m.content });
      for (const call of m.tool_calls ?? []) {
        blocks.push({
          type: "tool_use",
          id: call.id,
          name: call.function.name,
          input: safeParseArgs(call.function.arguments),
        });
      }
      // An assistant turn with nothing at all (shouldn't normally happen) still needs some
      // content — Anthropic rejects empty content arrays.
      result.push({ role: "assistant", content: blocks.length > 0 ? blocks : [{ type: "text", text: "" }] });
      continue;
    }

    if (m.role === "tool") {
      const resultBlock: AnthropicContentBlock = {
        type: "tool_result",
        tool_use_id: m.tool_call_id ?? "",
        content: m.content ?? "",
      };
      // Batch consecutive tool results into the same user message, matching Anthropic's
      // expectation that all tool_results for one assistant turn arrive together.
      const prev = result[result.length - 1];
      if (prev && prev.role === "user" && Array.isArray(prev.content) && prev.content.every((b) => b.type === "tool_result")) {
        prev.content.push(resultBlock);
      } else {
        result.push({ role: "user", content: [resultBlock] });
      }
      continue;
    }

    // plain user message
    result.push({ role: "user", content: m.content ?? "" });
  }

  return { system: systemParts.length > 0 ? systemParts.join("\n\n") : undefined, anthropicMessages: result };
}

function convertToolsToAnthropic(tools?: ToolSchema[]): { name: string; description: string; input_schema: unknown }[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }));
}

function safeParseArgs(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}

