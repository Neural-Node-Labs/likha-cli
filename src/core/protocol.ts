import fs from "node:fs";
import path from "node:path";
import { resolveConfigPath } from "../config/loadConfig.js";
import os from 'node:os';
const PROTOCOL_PATH = path.join("xcoder.md");
const LESSONS_PATH = path.join("tasks", "lessons.md");
const TODO_PATH = path.join("tasks", "todo.md");

/** Reads agent/xcoder.md if present; this is the engineering protocol from the workflow doc. */
function loadProtocol(cwd: string = resolveConfigPath()): string | undefined {
  const p = path.join(cwd, PROTOCOL_PATH);
  if (fs.existsSync(p)) {
      console.log(`Protocol loaded ...`)
  } else {
      console.log(`Protocol not found! ...${p}`)
  }
  return fs.existsSync(p) ? fs.readFileSync(p, "utf-8").trim(): undefined;
}

/** Reads tasks/lessons.md if present — patterns captured from prior user corrections. */
export function loadLessons(cwd: string = process.cwd()): string | undefined {
  const p = path.join(cwd, LESSONS_PATH);
  if (fs.existsSync(p)) {
      console.log(`Lessons loaded ...`)
  } else {
      console.log(`Lessons not found! ...${p}`)
  }
  return fs.existsSync(p) ? fs.readFileSync(p, "utf-8").trim() : undefined;
}

/** Appends a timestamped lesson entry, per "Self-Improvement Loop" in the protocol. */
export function recordLesson(lesson: string, cwd: string = process.cwd()): void {
  const p = path.join(cwd, LESSONS_PATH);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const entry = `\n## ${new Date().toISOString()}\n${lesson}\n`;
  fs.appendFileSync(p, entry, "utf-8");
}

export function writeTodo(cwd: string, content: string): void {
  const p = path.join(cwd, TODO_PATH);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, "utf-8");
}

export function appendTodoReview(cwd: string, review: string): void {
  const p = path.join(cwd, TODO_PATH);
  fs.appendFileSync(p, `\n## Review\n${review}\n`, "utf-8");
}

export function getOS(): string {
    const platform: NodeJS.Platform = os.platform();
    switch (platform) {
        case 'win32':
          return 'Windows';
        case 'darwin':
          return 'macOS';
        case 'linux':
          return 'Linux';
        default:
          return platform;
      }
}

/**
 * Builds the system prompt with the protocol/lessons/skills wrapped in the XML tags
 * DeepSeek's docs recommend for segmenting a large instruction payload within one message.
 */
export function buildProtocolPrompt(cwd: string = process.cwd()): string {
  const protocol = loadProtocol(resolveConfigPath());
  const lessons = loadLessons(cwd);
  const os_platform = getOS();

  let out = "";
  if (protocol) {
    out += `<system_directive>\nYou are xcoder, operating under the following engineering protocol.\n</system_directive>\n\n<engineering_protocol>\n${protocol}\n</engineering_protocol>\n\n`;
  }
  if (lessons) {
    out += `<lessons_learned>\nPatterns captured from prior corrections in this workspace — apply them proactively.\n${lessons}\n</lessons_learned>\n\n`;
  }

  if (os_platform) {
    out += `<os_platform>\nOS Platform used command available for this platform.\n${os_platform}\n</os_platform>\n\n`;
  }
  return out;
}


