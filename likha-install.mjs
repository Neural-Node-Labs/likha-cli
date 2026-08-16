#!/usr/bin/env node
/**
 * install.mjs — Cross-platform Bun installer for likha
 *
 * Works on macOS, Linux, and Windows (run with `node install.mjs` or `bun install.mjs`).
 * Installs Bun if missing, installs dependencies (root + ui), builds the project,
 * and links the CLI binaries (likha, xcoder) globally via `bun link`.
 *
 * Usage:
 *   node install.mjs            # install deps, build, and link globally
 *   node install.mjs --no-link  # install deps and build only, skip global link
 *   node install.mjs --no-ui    # skip the ui/ subproject install+build
 *   node install.mjs --dev      # install deps only, skip build/link
 */

import { execFileSync, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const noLink = args.includes("--no-link");
const noUi = args.includes("--no-ui");
const devOnly = args.includes("--dev");
const isWindows = platform() === "win32";

const color = {
  info: (msg) => console.log(`\x1b[1;34m==>\x1b[0m ${msg}`),
  warn: (msg) => console.log(`\x1b[1;33m!!\x1b[0m ${msg}`),
  error: (msg) => console.error(`\x1b[1;31mxx\x1b[0m ${msg}`),
};

// Bun's default global install location
const bunBinDir = join(homedir(), ".bun", "bin");

function withBunOnPath() {
  const sep = isWindows ? ";" : ":";
  return { ...process.env, PATH: `${bunBinDir}${sep}${process.env.PATH ?? ""}` };
}

function run(cmd, cmdArgs, opts = {}) {
  execFileSync(cmd, cmdArgs, {
    stdio: "inherit",
    env: withBunOnPath(),
    shell: isWindows, // needed on Windows to resolve .cmd/.ps1 shims
    ...opts,
  });
}

function bunAvailable() {
  try {
    execSync("bun --version", { env: withBunOnPath(), stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function installBun() {
  color.info("Bun not found. Installing Bun...");
  try {
    if (isWindows) {
      run("powershell", ["-NoProfile", "-Command", "irm bun.sh/install.ps1 | iex"]);
    } else {
      run("sh", ["-c", "curl -fsSL https://bun.sh/install | bash"]);
    }
  } catch (err) {
    color.error("Bun installation failed.");
    console.error(err.message);
    process.exit(1);
  }

  if (!bunAvailable()) {
    color.error("Bun installation finished but 'bun' is still not runnable.");
    if (isWindows) {
      color.error(`Open a new terminal, or add "${bunBinDir}" to your PATH, then re-run this script.`);
    } else {
      color.error(`Open a new shell (or 'source ~/.bashrc' / '~/.zshrc'), then re-run this script.`);
    }
    process.exit(1);
  }
}

// ---- 1. ensure Bun is installed --------------------------------------------

if (bunAvailable()) {
  const version = execSync("bun --version", { env: withBunOnPath() }).toString().trim();
  color.info(`Bun found: ${version}`);
} else {
  installBun();
}

// ---- 2. sanity checks -------------------------------------------------------

if (!existsSync("package.json")) {
  color.error("package.json not found. Run this script from the likha project root.");
  process.exit(1);
}

try {
  const nodeVersion = process.version; // e.g. v20.14.0
  const major = parseInt(nodeVersion.slice(1).split(".")[0], 10);
  if (major < 20) {
    color.warn(`Detected Node ${nodeVersion}. This project's devDependencies target Node 20 types.`);
  }
} catch {
  // ignore
}

const hasUi = existsSync("ui") && !noUi;

// ---- 3. install dependencies with Bun --------------------------------------

color.info("Installing root dependencies with Bun...");
run("bun", ["install"]);

// better-sqlite3 and playwright ship native/binary bits pulled in via postinstall
// scripts; bun runs these automatically unless disabled, so nothing extra needed.
if (existsSync(join(process.cwd(), "node_modules", "playwright"))) {
  color.info("Playwright detected — you may need browser binaries: bun run playwright install");
}

if (hasUi) {
  color.info("Installing ui/ dependencies with Bun...");
  run("bun", ["install"], { cwd: "ui" });
} else if (existsSync("ui") && noUi) {
  color.info("Skipping ui/ dependency install (--no-ui).");
}

if (devOnly) {
  color.info("Dependencies installed. Skipping build/link (--dev).");
  color.info("Run the CLI in dev mode with: bun run dev");
  process.exit(0);
}

// ---- 4. build ---------------------------------------------------------------

color.info("Building core (bun run build)...");
run("bun", ["run", "build"]);

if (hasUi) {
  color.info("Building ui/ (bun run build)...");
  run("bun", ["run", "build"], { cwd: "ui" });
}

if (!existsSync("dist")) {
  color.error("Build finished but 'dist' directory was not created. Check the build output above.");
  process.exit(1);
}

// ---- 5. link binaries globally ----------------------------------------------

if (!noLink) {
  color.info("Linking CLI binaries globally with Bun (likha, xcoder)...");
  run("bun", ["link"]);

  color.info("Verifying bin entries...");
  const bins = ["likha", "xcoder"];
  for (const bin of bins) {
    try {
      const cmd = isWindows ? `where ${bin}` : `command -v ${bin}`;
      const resolved = execSync(cmd, {
        env: withBunOnPath(),
        shell: isWindows ? "cmd.exe" : "/bin/sh",
      })
        .toString()
        .trim()
        .split("\n")[0];
      color.info(`  \u2713 ${bin} -> ${resolved}`);
    } catch {
      color.warn(`  \u2717 ${bin} not found on PATH after linking.`);
      color.warn(`    Make sure Bun's global bin dir is on your PATH: ${bunBinDir}`);
    }
  }
} else {
  color.info("Skipping global link (--no-link). Run locally with: node dist/cli/index.js");
}

color.info("Done. Try: likha --help");
