import fs from "node:fs";
import path from "node:path";

export const WORKSPACE_DIR_NAME = "workspace-agent";

/** Never copied into the isolated workspace — either agent-internal metadata that belongs at
 *  the project root, or build/VCS artifacts that would just waste time and disk to duplicate. */
export const EXCLUDED = new Set([WORKSPACE_DIR_NAME, ".agent", ".git", ".log", "node_modules", "dist", "build", "tasks"]);

/**
 * Mirrors `projectRoot` into `projectRoot/workspace-agent/`, excluding the paths above, and
 * returns the workspace-agent path. Tool calls (read/write/run_command/etc.) operate inside
 * this copy, not the live project — so a bad edit or an errant `rm` from an agent run never
 * touches the user's actual files directly. Protocol/lessons/task-history/todo still read and
 * write at `projectRoot` itself (see orchestrator.ts's `projectRoot` vs `cwd` split), since
 * those are meant to persist across workspace resets, not be part of the disposable copy.
 *
 * Re-syncs on every call (full re-copy of changed files) rather than tracking a diff — simple
 * and correct, though not the fastest option for very large repos. Existing files in
 * workspace-agent that no longer exist in the source are left alone rather than deleted, so
 * anything the agent created that hasn't been reconciled back isn't silently lost on the next
 * sync.
 */
export function prepareWorkspace(projectRoot: string): string {
  const workspacePath = path.join(projectRoot, WORKSPACE_DIR_NAME);
  fs.mkdirSync(workspacePath, { recursive: true });
  copyRecursive(projectRoot, workspacePath, projectRoot);
  return workspacePath;
}

function copyRecursive(srcRoot: string, destRoot: string, currentSrcDir: string): void {
  const entries = fs.readdirSync(currentSrcDir, { withFileTypes: true });
  for (const entry of entries) {
    if (EXCLUDED.has(entry.name)) continue;

    const srcPath = path.join(currentSrcDir, entry.name);
    const relPath = path.relative(srcRoot, srcPath);
    const destPath = path.join(destRoot, relPath);

    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyRecursive(srcRoot, destRoot, srcPath);
    } else if (entry.isFile()) {
      // Skip the copy if the destination is already byte-identical and not older — cheap way
      // to avoid needlessly rewriting (and bumping mtime on) files that haven't changed.
      if (!needsCopy(srcPath, destPath)) continue;
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function needsCopy(srcPath: string, destPath: string): boolean {
  if (!fs.existsSync(destPath)) return true;
  const srcStat = fs.statSync(srcPath);
  const destStat = fs.statSync(destPath);
  return srcStat.mtimeMs > destStat.mtimeMs || srcStat.size !== destStat.size;
}
