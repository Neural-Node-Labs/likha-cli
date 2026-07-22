import fs from "node:fs";
import path from "node:path";

const PROTOCOL_PATH = path.join("agent", "xcoder.md");
const LESSONS_PATH = path.join("tasks", "lessons.md");
const TODO_PATH = path.join("tasks", "todo.md");

/** Reads agent/xcoder.md if present; this is the engineering protocol from the workflow doc. */
export function loadProtocol(cwd: string = process.cwd()): string | undefined {
  const p = path.join(cwd, PROTOCOL_PATH);
  if (fs.existsSync(p)) return fs.readFileSync(p, "utf-8").trim();

  // Fall back to the protocol baked into the xcoder install (Docker image) if the workspace
  // doesn't ship its own -- same reasoning as SkillRegistry's XCODER_HOME fallback.
  const home = process.env.XCODER_HOME;
  if (home) {
    const hp = path.join(home, PROTOCOL_PATH);
    if (fs.existsSync(hp)) return fs.readFileSync(hp, "utf-8").trim();
  }
  return undefined;
}

/** Reads tasks/lessons.md if present — patterns captured from prior user corrections. */
export function loadLessons(cwd: string = process.cwd()): string | undefined {
  const p = path.join(cwd, LESSONS_PATH);
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

/**
 * Builds the system prompt with the protocol/lessons/skills wrapped in the XML tags
 * DeepSeek's docs recommend for segmenting a large instruction payload within one message.
 */
export function buildProtocolPrompt(cwd: string = process.cwd()): string {
  const protocol = loadProtocol(cwd);
  const lessons = loadLessons(cwd);

  let out = "";
  if (protocol) {
    out += `<system_directive>\nYou are xcoder, operating under the following engineering protocol.\n</system_directive>\n\n<engineering_protocol>\n${protocol}\n</engineering_protocol>\n\n`;
  }
  if (lessons) {
    out += `<lessons_learned>\nPatterns captured from prior corrections in this workspace — apply them proactively.\n${lessons}\n</lessons_learned>\n\n`;
  }
  return out;
}


