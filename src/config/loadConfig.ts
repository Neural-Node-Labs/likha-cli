// ronin:version 2 | ronin:task task-d8bbc5 | ronin:updated 2026-08-13T07:19:27.550Z | ronin:subtask code-st-db60d1
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import "dotenv/config";
import os from "node:os";

/**
 * LLM backend configuration — the single source of truth for which provider xcoder talks to.
 *
 * - `provider` names the active backend: `"anthropic"` or any OpenAI-compatible provider
 *   (`"deepseek"`, `"openai"`, `"openrouter"`, `"groq"`, `"ollama"`, or a custom name).
 * - `base_url`/`endpoint` are REQUIRED for OpenAI-compatible providers (they are unused by
 *   Anthropic, whose Messages endpoint is fixed). When `base_url` is present but `endpoint`
 *   is absent, `endpoint` defaults to `/chat/completions`. When `base_url` is absent and
 *   `provider` is a known provider, `DEFAULT_OPENAI_COMPATIBLE_PROVIDER_URLS` supplies it.
 * - `api_key_env` names the environment variable holding the key — keys are NEVER inlined
 *   in yaml.
 */
export interface LlmConfig {
  provider: string;
  base_url?: string; // required for openai-compatible providers (deepseek, etc); unused for anthropic
  endpoint?: string; // required for openai-compatible providers (deepseek, etc); unused for anthropic
  model: string;
  api_key_env: string;
  max_tokens: number;
  temperature: number;
  thinking?: boolean;
  reasoning_effort?: "high" | "max"; // only meaningful when thinking is enabled
  overrides?: Record<string, { model?: string; temperature?: number; thinking?: boolean; reasoning_effort?: "high" | "max" }>;
  fallback?: { provider: string; model: string; api_key_env: string; base_url?: string; endpoint?: string };
}

const RELATIVE_CONFIG_PATH = path.join("agent", "config", "llm.yaml");
const RELATIVE_HOME_PATH = path.join("agent");
const RELATIVE_AGENT_PATH = path.join(".agent");

/** Known base URLs for common OpenAI-compatible providers, so llm.yaml can switch by naming
 *  a provider alone. Explicit `config.base_url` ALWAYS wins over this map. */
export const DEFAULT_OPENAI_COMPATIBLE_PROVIDER_URLS: Record<string, string> = {
  deepseek: "https://api.deepseek.com/v1",
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  groq: "https://api.groq.com/openai/v1",
  ollama: "http://localhost:11434/v1",
};

/** Backward-compatible alias for the pre-existing (private) constant name. */
export const DEFAULT_OPENAI_COMPATIBLE_BASE_URLS = DEFAULT_OPENAI_COMPATIBLE_PROVIDER_URLS;

/** Resolve the OpenAI-compatible base URL for a config: explicit base_url wins, otherwise the
 *  known-provider registry is consulted. Returns undefined for unknown providers with no
 *  explicit base_url (callers must surface the misconfiguration error). */
export function resolveOpenAiBaseUrl(config: Pick<LlmConfig, "provider" | "base_url">): string | undefined {
  return config.base_url ?? DEFAULT_OPENAI_COMPATIBLE_PROVIDER_URLS[config.provider];
}

/** OpenAI-compatible endpoint defaults to /chat/completions when base_url is present. */
export function resolveOpenAiEndpoint(config: Pick<LlmConfig, "endpoint">): string {
  return config.endpoint ?? "/chat/completions";
}


export function resolveConfigPath(): string {
  const candidatePaths: string[] = [];

  // 4. Check App Directory (where this source file/code is running from)
  // For ES Modules use import.meta.dirname; for CommonJS use __dirname
  const appDir = typeof import.meta !== "undefined" && import.meta.dirname
    ? import.meta.dirname
    : __dirname;

  candidatePaths.push(path.join(appDir, RELATIVE_HOME_PATH));

  // 1. Check explicit XCODER_HOME env variable first (if provided)
  if (process.env.XCODER_HOME) {
    candidatePaths.push(path.join(process.env.XCODER_HOME, RELATIVE_HOME_PATH));
  }

  // 2. Check Current Working Directory (where the user ran the terminal command)
  candidatePaths.push(path.join(process.cwd(), RELATIVE_HOME_PATH));

  // 3. Check User's Home Directory (~/agent/config/llm.yaml or C:\Users\Username\...)
  candidatePaths.push(path.join(os.homedir(), RELATIVE_HOME_PATH));



  // Return the first path that actually exists on disk
  for (const configPath of candidatePaths) {
    if (fs.existsSync(configPath)) {
      console.log(`configPath : ${configPath}`);
      return configPath;
    }
  }

  // Default fallback if no file is found anywhere (will trigger loadLlmConfig defaults)
  return candidatePaths[0] ?? path.join(process.cwd(), RELATIVE_CONFIG_PATH);
}

export function resolveAgentPath(): string {
  const candidatePaths: string[] = [];

  // 4. Check App Directory (where this source file/code is running from)
  // For ES Modules use import.meta.dirname; for CommonJS use __dirname
  const appDir = typeof import.meta !== "undefined" && import.meta.dirname
    ? import.meta.dirname
    : __dirname;

  // 3. Check User's Home Directory (~/agent/config/llm.yaml or C:\Users\Username\...)
  candidatePaths.push(path.join(os.homedir(), RELATIVE_AGENT_PATH));

  // 1. Check explicit XCODER_HOME env variable first (if provided)
  if (process.env.XCODER_HOME) {
    candidatePaths.push(path.join(process.env.XCODER_HOME, RELATIVE_AGENT_PATH));
  }

  // 2. Check Current Working Directory (where the user ran the terminal command)
  candidatePaths.push(path.join(process.cwd(), RELATIVE_AGENT_PATH));





  // Return the first path that actually exists on disk
  for (const configPath of candidatePaths) {
    if (fs.existsSync(configPath)) {
      console.log(`configPath : ${configPath}`);
      return configPath;
    }
  }

  // Default fallback if no file is found anywhere (will trigger loadLlmConfig defaults)
  return candidatePaths[0] ?? path.join(process.cwd(), RELATIVE_CONFIG_PATH);
}

export function loadLlmConfig(configPath: string = path.join(resolveConfigPath(), "config", "llm.yaml")): LlmConfig {
  if (!fs.existsSync(configPath)) {
    // Sane default: DeepSeek non-thinking mode, current model IDs, temperature 0.0 per
    // DeepSeek's own published guidance for code/math tasks (this is a coding agent).
    return {
      provider: "deepseek",
      base_url: "https://api.deepseek.com/v1",
      endpoint: "/chat/completions",
      model: "deepseek-v4-flash",
      api_key_env: "DEEPSEEK_API_KEY",
      max_tokens: 16384,
      temperature: 0.0,
      thinking: false,
    };
  }
  //console.log(`Configuration Path: ${configPath}`)
  const raw = fs.readFileSync(configPath, "utf-8");
  return yaml.load(raw) as LlmConfig;
}

export function resolveModelForSkill(config: LlmConfig, skillName?: string) {
  const override = skillName ? config.overrides?.[skillName] : undefined;
  return {
    model: override?.model ?? config.model,
    temperature: override?.temperature ?? config.temperature,
    thinking: override?.thinking ?? config.thinking ?? false,
    reasoningEffort: override?.reasoning_effort ?? config.reasoning_effort,
  };
}


