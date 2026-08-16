#!/usr/bin/env node
/**
 * build-installer.mjs — Compile likha into a standalone binary
 *
 * Produces a single self-contained executable (via `bun build --compile`)
 * that embeds the Bun runtime, so end users do NOT need Node, Bun, or
 * `npm install` to run it. You just hand them the binary (and the small
 * runtime assets folder this script copies alongside it).
 *
 * Usage:
 *   node build-installer.mjs                # compile for the current OS/arch only
 *   node build-installer.mjs --all           # cross-compile for macOS/Linux/Windows (x64+arm64)
 *   node build-installer.mjs --target=bun-linux-x64
 *   node build-installer.mjs --out=release   # output directory (default: dist-installer)
 *
 * Requires Bun (this script will install it if missing) — Bun itself is only
 * needed on the machine doing the *building*, not on the end user's machine.
 */

import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, cpSync, rmSync, writeFileSync } from "node:fs";
import { homedir, platform, arch } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const buildAll = args.includes("--all");
const explicitTarget = args.find((a) => a.startsWith("--target="))?.split("=")[1];
const outDirArg = args.find((a) => a.startsWith("--out="))?.split("=")[1];
const OUT_DIR = outDirArg || "dist-installer";

const isWindows = platform() === "win32";
const bunBinDir = join(homedir(), ".bun", "bin");

const color = {
  info: (msg) => console.log(`\x1b[1;34m==>\x1b[0m ${msg}`),
  warn: (msg) => console.log(`\x1b[1;33m!!\x1b[0m ${msg}`),
  error: (msg) => console.error(`\x1b[1;31mxx\x1b[0m ${msg}`),
};

function withBunOnPath() {
  const sep = isWindows ? ";" : ":";
  return { ...process.env, PATH: `${bunBinDir}${sep}${process.env.PATH ?? ""}` };
}

function run(cmd, cmdArgs, opts = {}) {
  execFileSync(cmd, cmdArgs, { stdio: "inherit", env: withBunOnPath(), shell: isWindows, ...opts });
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
  color.info("Bun not found. Installing Bun (needed to build the binary, not to run it)...");
  if (isWindows) {
    run("powershell", ["-NoProfile", "-Command", "irm bun.sh/install.ps1 | iex"]);
  } else {
    run("sh", ["-c", "curl -fsSL https://bun.sh/install | bash"]);
  }
  if (!bunAvailable()) {
    color.error("Bun installation failed or PATH wasn't picked up. Open a new terminal and re-run.");
    process.exit(1);
  }
}

// ---- 0. sanity ---------------------------------------------------------

if (!existsSync("package.json")) {
  color.error("package.json not found. Run this from the likha project root.");
  process.exit(1);
}
if (!existsSync("src/cli/index.ts")) {
  color.error("src/cli/index.ts not found — adjust ENTRY below if your entry file moved.");
  process.exit(1);
}

if (!bunAvailable()) installBun();
color.info(`Bun ready: ${execSync("bun --version", { env: withBunOnPath() }).toString().trim()}`);

// ---- 1. install deps + normal build (needed for tsc typecheck + agent config copy) ----

color.info("Installing dependencies (bun install)...");
run("bun", ["install"]);

color.info("Running project build (bun run build)...");
run("bun", ["run", "build"]);

// ---- 2. figure out compile targets -------------------------------------

const ENTRY = "src/cli/index.ts";

// bun --target values: bun, bun-linux-x64, bun-linux-arm64, bun-linux-x64-musl,
// bun-windows-x64, bun-darwin-x64, bun-darwin-arm64
const ALL_TARGETS = [
  { target: "bun-darwin-arm64", name: "likha-macos-arm64" },
  { target: "bun-darwin-x64", name: "likha-macos-x64" },
  { target: "bun-linux-x64", name: "likha-linux-x64" },
  { target: "bun-linux-arm64", name: "likha-linux-arm64" },
  { target: "bun-windows-x64", name: "likha-windows-x64.exe" },
];

function currentHostTarget() {
  const p = platform();
  const a = arch(); // 'x64' | 'arm64'
  if (p === "darwin") return a === "arm64" ? ALL_TARGETS[0] : ALL_TARGETS[1];
  if (p === "linux") return a === "arm64" ? ALL_TARGETS[3] : ALL_TARGETS[2];
  if (p === "win32") return ALL_TARGETS[4];
  color.error(`Unsupported host platform: ${p}`);
  process.exit(1);
}

let targets;
if (explicitTarget) {
  const match = ALL_TARGETS.find((t) => t.target === explicitTarget);
  if (!match) {
    color.error(`Unknown --target=${explicitTarget}. Valid: ${ALL_TARGETS.map((t) => t.target).join(", ")}`);
    process.exit(1);
  }
  targets = [match];
} else if (buildAll) {
  targets = ALL_TARGETS;
} else {
  targets = [currentHostTarget()];
}

// ---- 3. compile ----------------------------------------------------------

if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

const warnings = [];

for (const { target, name } of targets) {
  color.info(`Compiling standalone binary for ${target}...`);
  const outfile = join(OUT_DIR, name);
  try {
    run("bun", [
      "build",
      ENTRY,
      "--compile",
      "--minify",
      `--target=${target}`,
      `--outfile=${outfile}`,
    ]);
    color.info(`  \u2713 built ${outfile}`);
  } catch (err) {
    color.warn(`  \u2717 failed for ${target}: ${err.message}`);
    warnings.push(target);
  }
}

// ---- 4. copy runtime assets that aren't bundled into the binary ----------
// `agent/` holds skill/config files read from disk at runtime (see the
// project's `build` script, which copies it into dist/config/agent). The
// compiled binary can't read files bundled at compile time as plain paths,
// so ship this folder alongside the binary.

if (existsSync("agent")) {
  color.info("Copying agent/ runtime assets next to the binaries...");
  cpSync("agent", join(OUT_DIR, "agent"), { recursive: true });
}
if (existsSync(".env.example")) {
  cpSync(".env.example", join(OUT_DIR, ".env.example"));
}

// ---- 5. write a README for whoever receives the installer ----------------

const readme = `# likha — standalone build

This folder contains a self-contained likha executable. The person running it
does NOT need Node.js, Bun, or \`npm install\` — everything is embedded.

## Run it

macOS / Linux:
  ./likha-macos-arm64     (or the .exe / matching file for your platform)
  chmod +x likha-* first if needed: chmod +x ./likha-<platform>

Windows:
  likha-windows-x64.exe

## Notes

- Keep the \`agent/\` folder next to the binary — it holds config/skill files
  read from disk at startup, and is NOT embedded inside the executable.
- Copy \`.env.example\` to \`.env\` and fill in required values (API keys, etc.)
  in the same folder as the binary, if the project loads env vars via dotenv.
- To install it as a global command, move the binary onto your PATH, e.g.:
    macOS/Linux: sudo mv ./likha-<platform> /usr/local/bin/likha
    Windows: move it into a folder that's on your PATH, or add its folder to PATH.
${warnings.length ? `\n## Build warnings\n\nThese targets failed to compile and were skipped: ${warnings.join(", ")}.\nRe-run with --target=<name> on a matching host if you need them.\n` : ""}`;

writeFileSync(join(OUT_DIR, "README.md"), readme);

color.info(`Done. Standalone build output: ${OUT_DIR}/`);
if (warnings.length) {
  color.warn(`Some targets failed: ${warnings.join(", ")}. See ${OUT_DIR}/README.md.`);
}
color.warn(
  "Heads-up: likha depends on native modules (better-sqlite3, ssh2, playwright). " +
    "bun --compile bundles these where supported, but always test the compiled " +
    "binary on a clean machine of the target OS before distributing it."
);
