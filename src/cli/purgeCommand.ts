// ronin:version 3 | ronin:task task-bc7d1e | ronin:updated 2026-08-13T07:33:32.176Z | ronin:subtask code-st-2ad77b
import type { Command } from "commander";
import { runPurge, PURGE_TARGETS } from "./purge.js";
import type { PurgeOptions, PurgeResult, PurgeScope } from "./purge.js";
import { CliIO } from "./CliIO.js";

export interface PurgeCommandArgs {
  scope?: "workspace" | "global";
  targets?: string;
  dryRun?: boolean;
  force?: boolean;
  auto?: boolean;
  cwd?: string;
}

export interface PurgeCommandOutcome {
  exitCode: 0 | 1;
  result: PurgeResult;
  dryRun: boolean;
}

/**
 * Single shared handler for both `xcoder purge [options]` and the legacy
 * `xcoder --purge [...]` flag so the two spellings cannot drift.
 *
 * Prints the results itself; the caller only needs the computed exit code.
 * Dry-runs never prompt or delete. Interactive runs prompt once before
 * deleting; `--auto` and non-TTY runs auto-approve (current behavior).
 */
export async function runPurgeCommand(args: PurgeCommandArgs): Promise<PurgeCommandOutcome> {
  const scope: PurgeScope = args.scope === "global" ? "global" : "workspace";
  const dryRun = args.dryRun === true;
  const force = args.force === true;
  const auto = args.auto === true;
  const targets = args.targets
    ? args.targets.split(",").map((t) => t.trim()).filter(Boolean)
    : undefined;

  const options: PurgeOptions = {
    scope,
    dryRun,
    force,
    targets,
    cwd: args.cwd,
  };

  if (!dryRun) {
    const io = new CliIO({ interactive: !auto && !!process.stdin.isTTY });
    options.confirm = (message) => io.confirm(message);
  }

  let result: PurgeResult;
  try {
    result = await runPurge(options);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`❌ [Purge] ${message}`);
    return {
      exitCode: 1,
      result: { removed: [], skipped: [], failed: [{ target: "targets", error: message }] },
      dryRun,
    };
  }

  const label = dryRun ? "[Purge] (dry-run)" : "[Purge]";
  for (const t of result.removed) {
    console.log(`${dryRun ? "🔍" : "🗑️"} ${label} ${t}`);
  }
  for (const t of result.skipped) {
    console.log(`⏭️  ${label} ${t} (not found — skipped)`);
  }
  for (const f of result.failed) {
    console.error(`❌ ${label} ${f.target}: ${f.error}`);
  }

  return { exitCode: result.failed.length > 0 ? 1 : 0, result, dryRun };
}

/**
 * Registers the `xcoder purge` subcommand on the provided Commander program.
 * The subcommand wins over the parent `[task]` positional for the exact token
 * `purge`, while multi-word quoted tasks (`xcoder "purge my notes"`) still
 * route to the parent ReAct path.
 */
export function registerPurgeSubcommand<T extends Command>(program: T, defaults?: { cwd?: string }): T {
  const subcommand = program.command("purge");
  subcommand
    .description("remove agent-internal metadata and generated artifacts (.agent/, .log/, tasks/)")
    .option("--scope <workspace|global>", "scope for purge: 'workspace' (default) or 'global' (os.homedir())")
    .option("--targets <list>", `comma-separated subset of targets to purge (default: ${PURGE_TARGETS.join(",")})`)
    .option("--dry-run", "print what would be removed without deleting anything")
    .option("--force", "remove symlinks themselves (never their referents)")
    .option("--auto", "fully autonomous mode — automatically approves the confirmation prompt")
    .option("--cwd <path>", "override the workspace root (test/embedding seam; default: process.cwd())")
    .action(async (opts: PurgeCommandArgs) => {
      const outcome = await runPurgeCommand({
        ...opts,
        cwd: opts.cwd ?? defaults?.cwd ?? process.cwd(),
      });
      if (outcome.exitCode !== 0) process.exitCode = outcome.exitCode;
    });
  return program;
}
