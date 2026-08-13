// ronin:version 1 | ronin:task task-b88b43 | ronin:updated 2026-08-13T05:53:08.606Z | ronin:subtask code-st-5a7e6a
import fs from "node:fs";
import path from "node:path";
import { resolveConfigPath, resolveAgentPath } from "../config/loadConfig.js";
import { describeShell } from "../tools/runCommandTool.js";

const PROTOCOL_PATH = path.join("xcoder.md");
const LESSONS_PATH = path.join("lessons.md");
const TODO_PATH = path.join("tasks", "todo.md");

/** Reads agent/xcoder.md if present; this is the engineering protocol from the workflow doc. */
function loadProtocol(cwd: string = resolveConfigPath()): string | undefined {
  const p = path.join(cwd, PROTOCOL_PATH);
  if (fs.existsSync(p)) {
    console.log(`Protocol loaded ...`)
  } else {
    console.log(`Protocol not found! ...${p}`)
  }
  return fs.existsSync(p) ? fs.readFileSync(p, "utf-8").trim() : undefined;
}

/** Reads tasks/lessons.md if present — patterns captured from prior user corrections. */
export function loadLessons(cwd: string = resolveAgentPath()): string | undefined {
  const p = path.join(cwd, LESSONS_PATH);
  if (fs.existsSync(p)) {
    console.log(`Lessons loaded ...`)
  } else {
    console.log(`Lessons not found! ...${p}`)
  }
  return fs.existsSync(p) ? fs.readFileSync(p, "utf-8").trim() : undefined;
}

/** Appends a timestamped lesson entry, per "Self-Improvement Loop" in the protocol. */
export function recordLesson(lesson: string, cwd: string = resolveAgentPath()): void {
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
/**
 * Efficient-filesystem operating protocol appended to every engine's system prompt.
 * Enforces the search-first/outline-first/batched-read/cheapest-edit-ladder discipline.
 */
const EFFICIENT_FILESYSTEM_PROTOCOL = `
EFFICIENT FILESYSTEM PROTOCOL
- Locate with glob_tool/find_files_tool/search_code_tool/search_ast_tool/get_dependency_graph_tool before full reads.
- First read of a file >150 lines: read_outline_tool, then read_file_range_tool of the needed slice.
- Cross-file analysis: one read_multiple_files_tool call, not N read_tool calls.
- Edit selection: exact string → search_replace_block_tool; regex → sed_replace_tool / sed_replace_multi_tool;
  line-addressed → line_patch_tool (always with expectedSha1); whole function → update_function_tool;
  semantic rename → rename_symbol_tool; multi-hunk → apply_unified_diff_tool;
  full rewrite → write_file_tool with force:true above 200 lines.
- After every edit: validate_file_tool (edit tools report errors themselves) and git_diff_tool to confirm intent.
- Replace consumed search/list output in context with a one-line summary (dead-context pruning).
`;

export function buildProtocolPrompt(cwd: string = process.cwd()): string {
  const protocol = loadProtocol(resolveConfigPath());
  const lessons = loadLessons(resolveAgentPath());

  let out = `<runtime_environment>\nCommands from run_command_tool execute on this host via ${describeShell()}\n</runtime_environment>\n\n`;
  if (protocol) {
    out += `<system_directive>\nYou are xcoder, operating under the following engineering protocol.\n</system_directive>\n\n<engineering_protocol>\n${protocol}\n</engineering_protocol>\n\n`;
  }
  if (lessons) {
    out += `<lessons_learned>\nPatterns captured from prior corrections in this workspace — apply them proactively.\n${lessons}\n</lessons_learned>\n\n`;
  }
  out += `<efficient_filesystem_protocol>\n${EFFICIENT_FILESYSTEM_PROTOCOL}\n</efficient_filesystem_protocol>\n\n`;
  return out;
}


