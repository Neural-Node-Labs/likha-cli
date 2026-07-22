import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import "dotenv/config";

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

const DEFAULT_CONFIG_PATH = path.join(process.cwd(), "agent", "config", "llm.yaml");

function resolveConfigPath(): string {
  if (fs.existsSync(DEFAULT_CONFIG_PATH)) return DEFAULT_CONFIG_PATH;
  const home = process.env.XCODER_HOME;
  if (home) {
    const homePath = path.join(home, "agent", "config", "llm.yaml");
    if (fs.existsSync(homePath)) return homePath;
  }
  return DEFAULT_CONFIG_PATH;
}

export function loadLlmConfig(configPath: string = resolveConfigPath()): LlmConfig {
  if (!fs.existsSync(configPath)) {
    // Sane default: DeepSeek non-thinking mode, current model IDs, temperature 0.0 per
    // DeepSeek's own published guidance for code/math tasks (this is a coding agent).
    return {
      provider: "deepseek",
      base_url: "https://api.deepseek.com/v1",
      endpoint: "/chat/completions",
      model: "deepseek-v4-flash",
      api_key_env: "DEEPSEEK_API_KEY",
      max_tokens: 4096,
      temperature: 0.0,
      thinking: false,
    };
  }
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


