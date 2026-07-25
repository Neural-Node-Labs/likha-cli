#!/usr/bin/env node
// Thin cross-platform wrapper around scripts/*.sh.
//
// These scripts (install.sh, setup.sh, init-db.sh, install-docker.sh, build.sh) are
// production/deployment tooling — they create system users, install to /opt, talk to
// PostgreSQL, and drive Docker Compose. They're intentionally POSIX-only: production
// deployment targets are Linux hosts (see the SSH/Docker deploy tools elsewhere in this repo),
// so there's no missing "Windows equivalent" to build here. `scripts/devnull-server.bat` is
// the actual local-dev/Windows entry point (mirrors devnull-server.sh) and needs none of this.
//
// This wrapper exists only so invoking one of these via `npm run` on a machine without bash
// (e.g. native Windows cmd/PowerShell without WSL or Git Bash) fails with a clear, actionable
// message instead of a raw "'bash' is not recognized" or ENOENT.
//
// Usage: node scripts/cross-platform-shell.mjs <script-name> [-- ...args passed to the script]

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const [, , name, ...rest] = process.argv;
const passthroughArgs = rest.filter((a) => a !== "--");

const SCRIPT_MAP = {
  install: "install.sh",
  setup: "setup.sh",
  "init-db": "init-db.sh",
  "install-docker": "install-docker.sh",
  build: "build.sh",
};

function findBash() {
  if (process.platform === "win32") {
    // Git Bash / WSL bash — genuinely fine to run these scripts through, since they're just
    // bash at that point. Native cmd.exe/PowerShell without either is the case we can't help.
    const candidates = ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Windows\\System32\\wsl.exe"];
    return candidates.find((p) => existsSync(p));
  }
  const candidates = ["/bin/bash", "/usr/bin/bash", "/usr/local/bin/bash"];
  return candidates.find((p) => existsSync(p));
}

const shFile = SCRIPT_MAP[name];
if (!shFile) {
  console.error(`Unknown script name "${name}". Expected one of: ${Object.keys(SCRIPT_MAP).join(", ")}`);
  process.exit(1);
}

const scriptPath = path.join(repoRoot, "scripts", shFile);
const bashPath = findBash();

if (!bashPath) {
  console.error(
    `\n"npm run ${name}" needs scripts/${shFile}, which requires bash (${
      process.platform === "win32"
        ? "not found — no native cmd.exe/PowerShell equivalent exists for this script on purpose"
        : "not found on this system"
    }).\n\n` +
      `This is a production/deployment script (PostgreSQL/Docker/system-level setup), meant to ` +
      `run on the Linux/macOS host you're actually deploying to.\n` +
      (process.platform === "win32"
        ? `Run it under WSL or Git Bash instead, or run it directly on your Linux deployment target.\n`
        : `Install bash and try again.\n`)
  );
  process.exit(1);
}

const isWsl = bashPath.toLowerCase().endsWith("wsl.exe");
const args = isWsl ? ["bash", scriptPath, ...passthroughArgs] : [scriptPath, ...passthroughArgs];
const result = spawnSync(bashPath, args, { stdio: "inherit", cwd: repoRoot });
process.exit(result.status ?? 1);
