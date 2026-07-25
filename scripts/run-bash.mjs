#!/usr/bin/env node
/**
 * Cross-platform launcher for devnull's shell scripts (scripts/*.sh).
 *
 * Why this exists: package.json used to call `bash scripts/foo.sh` directly. On Linux/macOS
 * that "just works" because bash is always on PATH. On native Windows (cmd.exe / PowerShell,
 * no WSL or Git Bash) there is no `bash` binary, so the very first `npm install` fails with a
 * bare ENOENT and no actionable message.
 *
 * This shim:
 *   1. On Linux/macOS: just execs bash as before (zero behavior change).
 *   2. On Windows: looks for a real bash in the usual places (Git for Windows, WSL), and uses
 *      whichever is found.
 *   3. If nothing is found anywhere: prints a clear, actionable error (not a raw ENOENT) and
 *      exits non-zero, instead of letting npm swallow it into a cryptic lifecycle failure.
 *
 * Usage: node scripts/run-bash.mjs <script-relative-to-repo-root> [...args]
 *   e.g. node scripts/run-bash.mjs scripts/setup.sh --non-interactive
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const [, , scriptRelPath, ...scriptArgs] = process.argv;

if (!scriptRelPath) {
  console.error("run-bash.mjs: missing required argument <script-path>");
  process.exit(1);
}

const repoRoot = process.cwd();
const scriptAbsPath = path.resolve(repoRoot, scriptRelPath);

function tryRun(bashPath) {
  const res = spawnSync(bashPath, [scriptAbsPath, ...scriptArgs], {
    stdio: "inherit",
    cwd: repoRoot,
  });
  return res;
}

if (os.platform() !== "win32") {
  // Linux / macOS: unchanged behavior.
  const res = tryRun("bash");
  process.exit(res.status ?? 1);
}

// ─── Windows: locate a real bash ────────────────────────────────────────────
const candidates = [
  // Git for Windows (by far the most common source of a real bash on Windows dev machines)
  path.join(process.env["ProgramFiles"] ?? "C:\\Program Files", "Git", "bin", "bash.exe"),
  path.join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Git", "bin", "bash.exe"),
  path.join(process.env["LOCALAPPDATA"] ?? "", "Programs", "Git", "bin", "bash.exe"),
  // WSL's bash shim (translates the path via wslpath internally when given a Windows path
  // starting with the drive letter — works for scripts that don't assume a Linux-only tool
  // is present, which is a separate limitation noted in the review, not something this shim
  // can paper over).
  path.join(process.env["SystemRoot"] ?? "C:\\Windows", "System32", "bash.exe"),
];

const found = candidates.find((p) => existsSync(p));

if (!found) {
  console.error(
    [
      "",
      "devnull: this command needs a real `bash` to run, but none was found on this Windows machine.",
      "",
      "Install one of the following, then re-run this command:",
      "  - Git for Windows (recommended): https://git-scm.com/download/win",
      "  - WSL: run `wsl --install` in an admin PowerShell, then re-run inside the WSL shell",
      "",
      `Attempted: ${scriptRelPath} ${scriptArgs.join(" ")}`,
      "",
    ].join("\n")
  );
  process.exit(1);
}

const res = tryRun(found);
process.exit(res.status ?? 1);
