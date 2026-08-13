import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * `xcoder purge` — removes agent-internal metadata and generated artifacts from a workspace.
 *
 * The target set is derived from the `EXCLUDED` set in `src/core/workspaceManager.ts`, which is
 * the single source of truth for "agent-internal / generated" paths. Only the three directories
 * that are safe to delete wholesale are purged: `.agent/`, `.log/`, and `tasks/`. Everything
 * else in `EXCLUDED` (`.git`, `node_modules`, `dist`, `build`, `workspace-agent`) is deliberately
 * NOT purged — those are either user-owned VCS/build artifacts or the isolated-workspace copy.
 *
 * Safety model (see the Phase 2 design note):
 *   - Allow-list: only the three hard-coded target names are ever removed, never arbitrary paths.
 *   - Containment: each target is resolved against the scope root and must stay inside it.
 *   - Type check: symlinks are refused by default (removing a symlink could surprise the user);
 *     `--force` removes the link itself, never the referent.
 *   - Missing targets are tolerated (exit 0) — purging an already-clean workspace is a no-op.
 */

/** The three directories `xcoder purge` removes. Mirrors the purge-relevant subset of `EXCLUDED`. */
export const PURGE_TARGETS = [".agent", ".log", "tasks"] as const;

export type PurgeScope = "workspace" | "global";

export interface PurgeOptions {
  /** Root directory the targets are resolved against. */
  scope: PurgeScope;
  /** When true, print what would be removed without deleting anything. */
  dryRun: boolean;
  /** When true, remove symlinks themselves (never their referents). */
  force: boolean;
  /** Optional subset of PURGE_TARGETS to remove. Defaults to all three. */
  targets?: string[];
  /** Interactive confirmation callback. Defaults to a no-op that returns true. */
  confirm?: (message: string) => Promise<boolean>;
  /** Override the workspace root (defaults to process.cwd()). Used by tests. */
  cwd?: string;
}

export interface PurgeResult {
  /** Targets that were removed (or would be, in dry-run). */
  removed: string[];
  /** Targets that were skipped because they did not exist. */
  skipped: string[];
  /** Targets that failed to remove (permission errors, etc.). */
  failed: { target: string; error: string }[];
}

/** Resolves the scope root: `process.cwd()` for workspace, `os.homedir()` for global. */
export function resolveScopeRoot(scope: PurgeScope, cwd?: string): string {
  return scope === "global" ? os.homedir() : cwd ?? process.cwd();
}

/** Validates a user-supplied `--targets` list against the allow-list. Returns the normalized
 *  subset, or `null` if any entry is not a recognized purge target. */
export function normalizeTargets(targets: string[] | undefined): string[] | null {
  if (!targets || targets.length === 0) return [...PURGE_TARGETS];
  const normalized = targets.map((t) => t.trim()).filter(Boolean);
  for (const t of normalized) {
    if (!(PURGE_TARGETS as readonly string[]).includes(t)) return null;
  }
  return [...new Set(normalized)];
}

/**
 * Performs the purge. Never throws for missing targets or per-target removal failures — those
 * are reported in the result so the caller can decide the exit code. Throws only for invalid
 * input (unknown target, path escape), which the caller treats as a hard error.
 */
export async function runPurge(opts: PurgeOptions): Promise<PurgeResult> {
  const targets = normalizeTargets(opts.targets);
  if (targets === null) {
    throw new Error(
      `Invalid --targets value. Allowed targets: ${PURGE_TARGETS.join(", ")}.`
    );
  }

  const root = resolveScopeRoot(opts.scope, opts.cwd);
  const result: PurgeResult = { removed: [], skipped: [], failed: [] };

  // Confirmation guard: when not a dry-run and a confirm callback is supplied, ask once
  // before deleting anything. A `false` answer aborts the whole purge (nothing removed).
  if (!opts.dryRun && opts.confirm) {
    const approved = await opts.confirm(
      `Remove ${targets.join(", ")} from ${root}?`
    );
    if (!approved) {
      return result;
    }
  }

  for (const target of targets) {
    const resolved = path.resolve(root, target);
    const normalizedRoot = path.resolve(root);

    // Containment: the resolved path must stay inside the scope root.
    if (resolved !== normalizedRoot && !resolved.startsWith(normalizedRoot + path.sep)) {
      throw new Error(`Refusing to purge "${target}" — resolves outside the scope root.`);
    }

    // lstatSync (not existsSync) so we can also detect dangling symlinks and inspect the
    // entry type in one call. A missing path throws ENOENT → tolerated as "skipped".
    let stat;
    try {
      stat = fs.lstatSync(resolved);
    } catch {
      result.skipped.push(target);
      continue;
    }

    // Type check: refuse symlinks unless --force (which removes the link, not the referent).
    if (stat.isSymbolicLink() && !opts.force) {
      result.failed.push({
        target,
        error: `is a symbolic link (use --force to remove the link itself)`,
      });
      continue;
    }

    if (opts.dryRun) {
      result.removed.push(target);
      continue;
    }

    try {
      fs.rmSync(resolved, { recursive: true, force: true });
      result.removed.push(target);
    } catch (err) {
      result.failed.push({
        target,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}
