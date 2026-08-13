#!/usr/bin/env node
// ronin:version 4 | ronin:task task-bc7d1e | ronin:updated 2026-08-13T07:33:45.044Z | ronin:subtask code-st-2ad77b
import { Command } from "commander";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { loadLlmConfig } from "../config/loadConfig.js";
import { DeepSeekClient } from "../llm/deepseekClient.js";
import { FileTelemetry } from "../telemetry/logger.js";
import { OrchestratorOptions } from "../core/orchestrator.js";
import { IReactEngine } from "../core/engine/IReactEngine.js";
import { createEngine, listEngines, DEFAULT_ENGINE } from "../core/engine/EngineRegistry.js";
import { CliIO } from "./CliIO.js";
import { SkillRegistry } from "../core/skillRegistry.js";
import { buildIndex } from "../indexing/indexer.js";
import { recordLesson } from "../core/protocol.js";
import { auditReactLoop } from "../core/reactAuditor.js";
import { runLiveDiagnostics } from "../core/liveDiagnostics.js";
import { startApiServer } from "../api/server.js";
import { dockerComposeUp } from "../tools/dockerComposeDeployTool.js";
import { deployWorkspaceViaSsh } from "../tools/dockerDeploySshTool.js";
import { initializeDatabase } from "../db/initialize.js";
import { installProcessCrashHandler } from "../core/processCrashHandler.js";
import { runPurgeCommand, registerPurgeSubcommand } from "./purgeCommand.js";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import os from "node:os";

// ─── Install top-level process crash handler ──────────────────────────────────────
// This MUST be the first thing that runs — before any other initialization — so it
// catches crashes from ALL code paths (engine.run(), runPhasePlanning(), runSubagent(),
// chatLoop(), deploy/audit/diagnose paths, etc.).
//
// The handler:
// 1. Logs the error with full stack trace to stderr
// 2. Generates a crash report at reports/crash-<timestamp>.md
// 3. Attempts graceful shutdown
// 4. Exits with code 1 — NO restart/retry logic (no infinite restart loops)
installProcessCrashHandler(process.cwd());

const program = new Command();
program.name("xcoder").description("xcoder — ReAct CLI agent with hot-pluggable role skills").version("0.1.0");
program.showHelpAfterError();
registerPurgeSubcommand(program);

program
  .argument("[task]", "task description — equivalent to --task <description>")
  .option("--chat", "enter interactive chat mode (workspace = current folder)")
  .option("--task <description>", "execute a single task, asking for clarification if needed")
  .option("--index", "index the current workspace into .agent/index/")
  .option("--skills", "list all loaded skills and their trigger keywords")
  .option("--lesson <text>", "record a lesson to tasks/lessons.md (see xcoder.md Self-Improvement Loop)")
  .option("--plan", "force Plan Mode on, regardless of task complexity heuristic")
  .option("--no-plan", "force Plan Mode off, regardless of task complexity heuristic")
  .option("--full-context-token", "keep every historical copy of read_tool file snapshots in context instead of collapsing stale ones (see src/core/contextCompaction.ts); default: off, lean-token compaction is on")
  .option("--single-phase", "disable phase-based planning and run as a single ReAct loop; default: phase-planning is ON")
  .option("--auto", "fully autonomous mode — automatically answers 'yes' to ALL interactive prompts (plan approval, phase plan approval, iteration limit continuation, subagent continuation). The LLM drives end-to-end without any human intervention. Use this for CI/CD, automated testing, or any scenario where zero human input is desired.")
  .option("--isolated-workspace", "run tool operations against an isolated ./workspace-agent copy instead of the live project files (see src/core/workspaceManager.ts); default: off")
  .option("--audit-react", "run the built-in bug-fixing scenario battery through the real orchestrator and report on how it performed")
  .option("--audit-out <path>", "where to write the audit report markdown (default: reports/react-audit-<timestamp>.md)")
  .option("--diagnose-live", "run the 7-point ReAct diagnostic suite against the real configured LLM: iteration stopping, restart-approval, duplicate-action avoidance, tool/skill usage, ground-up deployable app, bug fixing, and full SDLC")
  .option("--diagnose-out <path>", "where to write the live diagnostics report markdown (default: reports/live-diagnostics-<timestamp>.md)")
  .option("--serve", "start the xcoder HTTP API server")
  .option("--ui", "start both the xcoder HTTP API server and the UI frontend")
  .option("--port <number>", "port for the API server (default: 3001)", parseInt)
  .option("--host <address>", "host for the API server (default: 0.0.0.0)")
  .option("--deploy", "trigger deploy mode — runs docker compose up -d --build")
  .option("--docker", "use docker compose for deployment (implied by --deploy)")
  .option("--llm <boolean>", "if true, send the deploy task to the LLM as a devops task; if false, execute directly (default: false)", (v) => v === "true" || v === "1")
  .option("--remote <ip>", "remote host IP to deploy to (uses REMOTE_SSH_USER and REMOTE_SSH_PASSWORD from .env)")
  .option("--remote-path <path>", "remote directory path for deployment (default: /opt/xcoder)")
  .option("--engine <name>", `orchestration engine to use (default: "${DEFAULT_ENGINE}"). Registered engines: ${listEngines().join(", ")}. See src/core/engine/EngineRegistry.ts to register another implementation.`, DEFAULT_ENGINE)
  .option("--initialize-db", "initialize the SQLite database (create tables, run migrations). Idempotent — safe to run multiple times.")
  .option("--purge", "remove agent-internal metadata and generated artifacts (.agent/, .log/, tasks/) from the workspace (see also `xcoder purge --help`)")
  .option("--purge-scope <scope>", "scope for --purge: 'workspace' (default) or 'global' (os.homedir())")
  .option("--purge-targets <list>", "comma-separated subset of targets to purge (default: .agent,.log,tasks)")
  .option("--purge-dry-run", "with --purge: print what would be removed without deleting anything")
  .option("--purge-force", "with --purge: remove symlinks themselves (never their referents)")
  .action(async (taskArg, opts, cmd) => {



    const cwd = process.cwd();
    const telemetry = new FileTelemetry(cwd);
    const llmConfig = loadLlmConfig();
    const io = new CliIO({ interactive: !opts.auto });

    // ─── Initialize Database ────────────────────────────────────────────────
    if (opts.initializeDb) {
      try {
        io.log("[Database] Initializing database (create tables + run migrations)...");
        const db = await initializeDatabase();
        io.log("[Database] Database initialized successfully.");
        await db.close();
      } catch (err) {
        io.error(
          `[Database] Initialization failed: ${err instanceof Error ? err.message : String(err)}`
        );
        process.exit(1);
      }
      return;
    }

    // ─── Purge ─────────────────────────────────────────────────────────────
    // Both spellings (“xcoder purge” and “xcoder --purge”) go through the same
    // shared handler so the legacy flag cannot drift from the subcommand.
    if (opts.purge) {
      const outcome = await runPurgeCommand({
        scope: opts.purgeScope === "global" ? "global" : "workspace",
        targets: opts.purgeTargets ? String(opts.purgeTargets) : undefined,
        dryRun: opts.purgeDryRun === true,
        force: opts.purgeForce === true,
        auto: opts.auto === true,
        cwd: process.cwd(),
      });
      if (outcome.exitCode !== 0) process.exit(outcome.exitCode);
      return;
    }

    // Merge positional [task] with --task: positional takes precedence if both are given
    const task = taskArg ?? opts.task;

    if (opts.index) {
      const result = await buildIndex(cwd);
      console.log(`Indexed ${result.entries.length} files into .agent/index/`);
      return;
    }

    if (opts.skills) {
      const registry = new SkillRegistry();
      const headers = registry.loadHeaders();
      for (const h of headers) {
        console.log(`- ${h.name} (${h.role}) — triggers: ${h.triggers.join(", ")}`);
      }
      return;
    }

    if (opts.lesson) {
      recordLesson(opts.lesson, cwd);
      console.log(`Lesson recorded to tasks/lessons.md`);
      return;
    }

    if (opts.auditReact) {
      const llm = new DeepSeekClient(llmConfig, telemetry);
      console.log(`Running ReAct bug-fixing audit against ${llmConfig.model}...\n`);
      const report = await auditReactLoop(llm, llmConfig.model);

      const outPath = opts.auditOut ?? path.join(cwd, "reports", `react-audit-${Date.now()}.md`);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, report.markdown, "utf-8");

      console.log(report.markdown);
      console.log(`\nFull report written to ${outPath}`);
      console.log(
        `Result: ${report.summary.passed}/${report.summary.total} scenarios passed (independently verified), ` +
          `${report.summary.totalInvariantViolations} invariant violation(s) across all scenarios.`
      );
      return;
    }

    if (opts.diagnoseLive) {
      const llm = new DeepSeekClient(llmConfig, telemetry);
      console.log(`Running the 7-point live ReAct diagnostic suite against ${llmConfig.model}...\n`);
      console.log(`This makes real API calls and may take several minutes (diagnostic 7 alone can need 15-25 LLM calls).\n`);
      const report = await runLiveDiagnostics(llm, llmConfig.model);

      const outPath = opts.diagnoseOut ?? path.join(cwd, "reports", `live-diagnostics-${Date.now()}.md`);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, report.markdown, "utf-8");

      console.log(report.markdown);
      console.log(`\nFull report written to ${outPath}`);
      console.log(`Result: ${report.summary.passed}/${report.summary.total} diagnostics passed.`);
      return;
    }

    if (opts.ui) {
      const port = opts.port || 3001;
      const host = opts.host || "0.0.0.0";

      console.log("🚀 Starting xcoder API server and UI frontend...\n");

      // 1. Start the API server
      startApiServer({ port, host });

      // 2. Resolve UI path (assuming UI package/folder is in 'ui' or root)
      const uiDir = path.resolve(cwd, "ui"); // adjust path to where xcoder-ui lives

      if (!fs.existsSync(uiDir)) {
        console.error(`❌ UI directory not found at: ${uiDir}`);
        process.exit(1);
      }

      // 3. Spawn the Vite dev server process for UI
      const uiProcess = spawn("npm", ["run", "dev"], {
        cwd: uiDir,
        stdio: "inherit",
        shell: true,
      });

      uiProcess.on("error", (err) => {
        console.error("❌ Failed to start UI server:", err);
      });

      // Cleanup spawned UI process when CLI exits
      process.on("SIGINT", () => {
        uiProcess.kill("SIGINT");
        process.exit(0);
      });

      return;
    }

    if (opts.serve) {
      startApiServer({ port: opts.port, host: opts.host });
      return;
    }

    // ─── Deploy Mode ────────────────────────────────────────────────────────
    // Usage:
    //   Local:  xcoder --deploy --docker --llm true|false
    //   Remote: xcoder --deploy --docker --remote <ip> [--llm true|false]
    //
    //   --llm true  → send the deploy task to the LLM as a devops task (resolves issues)
    //   --llm false → execute deploy directly
    //   --remote <ip> → deploy to remote host using REMOTE_SSH_USER and REMOTE_SSH_PASSWORD from .env
    if (opts.deploy || opts.docker) {
      const useLlm = opts.llm === true;
      const remoteHost = opts.remote as string | undefined;

      if (remoteHost) {
        // ── Remote Deploy ────────────────────────────────────────────────
        const remoteUser = (process.env.REMOTE_SSH_USER || "").trim();
        const remotePassword = process.env.REMOTE_SSH_PASSWORD;
        const remotePath = (opts.remotePath as string) || "/opt/xcoder";

        if (!remoteUser || !remotePassword) {
          console.error("❌ REMOTE_SSH_USER and REMOTE_SSH_PASSWORD must be set in .env for remote deployment.");
          process.exit(1);
        }

        if (useLlm) {
          // Send to LLM with remote deploy context
          const llm = new DeepSeekClient(llmConfig, telemetry);
          const engine = createEngine(opts.engine, { llm, telemetry, io, options: { cwd, planMode: "always" } });
          console.log(`🚀 Remote deploy mode: sending to LLM as devops task (target: ${remoteHost})...\n`);
          await engine.run(
            `Deploy the xcoder stack to remote host ${remoteHost} via SSH. ` +
            `Use the docker_deploy_ssh_tool with host="${remoteHost}", user="${remoteUser}", ` +
            `passwordEnvVar="REMOTE_SSH_PASSWORD", remotePath="${remotePath}". ` +
            `If the build or deployment fails, diagnose and fix any issues. ` +
            `Verify all containers are healthy after deployment. ` +
            `Act as a DevOps engineer — resolve any issues you find.`
          );
        } else {
          // Direct remote execution — no LLM involvement
          console.log(`🚀 Remote deploy mode: deploying to ${remoteHost}...\n`);
          const result = await deployWorkspaceViaSsh({
            host: remoteHost,
            user: remoteUser,
            password: remotePassword,
            remotePath,
          }, cwd);

          if (result.success) {
            console.log(`✅ Remote deploy to ${remoteHost} succeeded.\n`);
            console.log(`  Services: ${result.services.length} running`);
            for (const svc of result.services) {
              console.log(`    - ${svc.name}: ${svc.status} (${svc.health || "no health check"})`);
            }
          } else {
            console.error(`❌ Remote deploy to ${remoteHost} failed.\n`);
            console.error(`  Summary: ${result.summary}`);
            if (result.dockerCommandResult.stderr) {
              console.error(`  Docker stderr: ${result.dockerCommandResult.stderr}`);
            }
            process.exit(1);
          }
        }
      } else if (useLlm) {
        // ── Local Deploy via LLM ─────────────────────────────────────────
        const llm = new DeepSeekClient(llmConfig, telemetry);
        const engine = createEngine(opts.engine, { llm, telemetry, io, options: { cwd, planMode: "always" } });
        console.log("🚀 Deploy mode: sending to LLM as devops task...\n");
        await engine.run(
          "Deploy the xcoder stack using docker compose. " +
          "Run `docker compose up -d --build` in the project root. " +
          "If the build or deployment fails, diagnose and fix any issues. " +
          "Verify all containers are healthy after deployment. " +
          "Act as a DevOps engineer — resolve any issues you find."
        );
      } else {
        // ── Local Direct Deploy ──────────────────────────────────────────
        console.log("🚀 Deploy mode: executing docker compose up -d --build directly...\n");
        const result = await dockerComposeUp(undefined, cwd);
        if (result.exitCode === 0) {
          console.log("✅ Docker Compose deployment succeeded.\n");
          console.log(result.stdout);
        } else {
          console.error("❌ Docker Compose deployment failed.\n");
          console.error(result.stderr);
          process.exit(result.exitCode);
        }
      }
      return;
    }

    const maxIterations = process.env.MAX_ITERATIONS ? parseInt(process.env.MAX_ITERATIONS, 10) : undefined;
    const orchestratorOpts: OrchestratorOptions = { cwd, maxIterations };
    if (opts.plan === true) orchestratorOpts.planMode = "always";
    if (opts.plan === false) orchestratorOpts.planMode = "never";
    if (opts.fullContextToken) orchestratorOpts.fullContextToken = true;
    if (opts.isolatedWorkspace) orchestratorOpts.isolatedWorkspace = true;
    if (opts.singlePhase) orchestratorOpts.singlePhase = true;
    if (opts.auto) orchestratorOpts.auto = true;

    const llm = new DeepSeekClient(llmConfig, telemetry);
    const engine = createEngine(opts.engine, { llm, telemetry, io, options: orchestratorOpts });

    if (task) {
      await engine.run(task);
      return;
    }

    if (opts.chat) {
      await chatLoop(engine);
      return;
    }

    program.help();
  });

async function chatLoop(engine: IReactEngine): Promise<void> {
  const rl = readline.createInterface({ input, output });
  console.log("xcoder chat mode. Type 'quit', 'exit', or 'bye' to leave.");

  while (true) {
    const line = await rl.question("\n> ");
    const trimmed = line.trim();
    if (/^(quit|exit|bye)$/i.test(trimmed)) break;
    if (!trimmed) continue;

    await engine.run(trimmed);
  }
  rl.close();
}

program.parseAsync(process.argv).catch((err) => {
  console.error(`\n❌ ${err instanceof Error ? err.message : String(err)}`);
  if (process.env.DEBUG) console.error(err);
  process.exit(1);
});

