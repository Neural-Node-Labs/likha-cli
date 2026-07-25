import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import "dotenv/config";
import os from "node:os";

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

// function resolveConfigPath(): string {
//   if (fs.existsSync(DEFAULT_CONFIG_PATH)) return DEFAULT_CONFIG_PATH;
//   const home = process.env.XCODER_HOME;
//   if (home) {
//     const homePath = path.join(home, "agent", "config", "llm.yaml");
//     if (fs.existsSync(homePath)) return homePath;
//   }
//   return DEFAULT_CONFIG_PATH;
// }


export function resolveConfigPath(): string {
  const candidatePaths: string[] = [];

  // 4. Check App Directory (where this source file/code is running from)
  // For ES Modules use import.meta.dirname; for CommonJS use __dirname
  const appDir = typeof import.meta !== "undefined" && import.meta.dirname
    ? import.meta.dirname
    : __dirname;

//   console.log(`process.cwd() : ${process.cwd()}`);
//   console.log(`os.homedir() : ${os.homedir()}`);
//   console.log(`process.env.XCODER_HOME : ${process.env.XCODER_HOME}`);
//   console.log(`appDir : ${appDir}`);

  candidatePaths.push(path.join(appDir,RELATIVE_HOME_PATH));

  // 1. Check explicit XCODER_HOME env variable first (if provided)
  if (process.env.XCODER_HOME) {
    candidatePaths.push(path.join(process.env.XCODER_HOME,RELATIVE_HOME_PATH));
  }

  // 2. Check Current Working Directory (where the user ran the terminal command)
  candidatePaths.push(path.join(process.cwd(),RELATIVE_HOME_PATH));

  // 3. Check User's Home Directory (~/agent/config/llm.yaml or C:\Users\Username\...)
  candidatePaths.push(path.join(os.homedir(),RELATIVE_HOME_PATH));



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
      max_tokens: 4096,
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


