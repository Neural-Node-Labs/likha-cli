#!/usr/bin/env node
/**
 * package-standalone.mjs — Build the standalone desktop package (no Docker)
 *
 * Creates a self-contained directory `devnull-standalone/` with:
 *   - dist/              (compiled JS artifacts)
 *   - node_modules/      (production dependencies only)
 *   - agent/             (skills, protocol, config)
 *   - migrations/        (SQLite migration files)
 *   - scripts/           (launcher scripts)
 *   - package.json       (package manifest)
 *   - .env.example       (environment template)
 *   - README.md          (install/run instructions)
 *
 * Also creates a tarball: devnull-standalone.tar.gz
 *
 * Usage:
 *   node scripts/package-standalone.mjs
 *
 * Environment:
 *   SKIP_BUILD=1   — Skip TypeScript compilation (use existing dist/)
 *   SKIP_NPM=1     — Skip npm install (use existing node_modules/)
 */

import { execSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, rmSync } from "node:fs";
import { createWriteStream } from "node:fs";
import { join, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import archiver from "archiver";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = resolve(__dirname, "..");
const OUTPUT_DIR = join(PROJECT_DIR, "devnull-standalone");
const TARBALL_PATH = join(PROJECT_DIR, "devnull-standalone.tar.gz");

// ─── Colors ───────────────────────────────────────────────────────────────────
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const BLUE = "\x1b[34m";
const NC = "\x1b[0m";

function info(msg)  { console.log(`${BLUE}[INFO]${NC}  ${msg}`); }
function ok(msg)    { console.log(`${GREEN}[OK]${NC}    ${msg}`); }
function warn(msg)  { console.log(`${YELLOW}[WARN]${NC}  ${msg}`); }
function error(msg) { console.log(`${RED}[ERROR]${NC} ${msg}`); }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function run(cmd, opts = {}) {
  try {
    const result = execSync(cmd, { cwd: PROJECT_DIR, encoding: "utf-8", stdio: "pipe", ...opts });
    return { stdout: result.trim(), stderr: "", exitCode: 0 };
  } catch (e) {
    return { stdout: e.stdout?.trim() || "", stderr: e.stderr?.trim() || "", exitCode: e.status ?? 1 };
  }
}

function copyDir(src, dest, filter = () => true) {
  if (!existsSync(src)) {
    warn(`Source directory not found: ${src}`);
    return;
  }
  mkdirSync(dest, { recursive: true });

  const entries = readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);

    if (!filter(srcPath, entry)) continue;

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath, filter);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

function copyFile(src, dest) {
  if (!existsSync(src)) {
    warn(`Source file not found: ${src}`);
    return false;
  }
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  return true;
}

// ─── Step 1: Compile TypeScript ───────────────────────────────────────────────

function compile() {
  info("Step 1/5: Compiling TypeScript...");

  if (process.env.SKIP_BUILD) {
    if (existsSync(join(PROJECT_DIR, "dist"))) {
      warn("SKIP_BUILD=1 — using existing dist/");
      return;
    }
    error("SKIP_BUILD=1 but dist/ does not exist");
    process.exit(1);
  }

  // Clean previous build
  if (existsSync(join(PROJECT_DIR, "dist"))) {
    rmSync(join(PROJECT_DIR, "dist"), { recursive: true });
  }

  const result = run("npx tsc -p tsconfig.json");
  if (result.exitCode !== 0) {
    error("TypeScript compilation failed:");
    console.error(result.stderr || result.stdout);
    process.exit(1);
  }

  if (!existsSync(join(PROJECT_DIR, "dist", "cli", "index.js"))) {
    error("Compilation failed — dist/cli/index.js not found");
    process.exit(1);
  }

  const jsCount = readdirSync(join(PROJECT_DIR, "dist"), { recursive: true })
    .filter(f => f.endsWith(".js")).length;
  ok(`TypeScript compilation complete — ${jsCount} JS files`);
}

// ─── Step 2: Install production dependencies ──────────────────────────────────

function installDeps() {
  info("Step 2/5: Installing production dependencies...");

  if (process.env.SKIP_NPM) {
    if (existsSync(join(PROJECT_DIR, "node_modules"))) {
      warn("SKIP_NPM=1 — using existing node_modules/");
      return;
    }
    error("SKIP_NPM=1 but node_modules/ does not exist");
    process.exit(1);
  }

  const result = run("npm install --omit=dev --no-audit --no-fund");
  if (result.exitCode !== 0) {
    error("npm install failed:");
    console.error(result.stderr || result.stdout);
    process.exit(1);
  }
  ok("Production dependencies installed");
}

// ─── Step 3: Create standalone directory ──────────────────────────────────────

function createPackage() {
  info("Step 3/5: Creating standalone package directory...");

  // Clean previous output
  if (existsSync(OUTPUT_DIR)) {
    rmSync(OUTPUT_DIR, { recursive: true });
  }
  mkdirSync(OUTPUT_DIR, { recursive: true });

  // 3a. Copy dist/
  info("  Copying dist/ (compiled JS)...");
  copyDir(join(PROJECT_DIR, "dist"), join(OUTPUT_DIR, "dist"));
  ok("  dist/ copied");

  // 3b. Copy node_modules/ (production only)
  info("  Copying node_modules/ (production dependencies)...");
  copyDir(join(PROJECT_DIR, "node_modules"), join(OUTPUT_DIR, "node_modules"));
  ok("  node_modules/ copied");

  // 3c. Copy agent/
  info("  Copying agent/ (skills, protocol, config)...");
  copyDir(join(PROJECT_DIR, "agent"), join(OUTPUT_DIR, "agent"));
  ok("  agent/ copied");

  // 3d. Copy migrations/
  info("  Copying migrations/ (SQLite)...");
  copyDir(join(PROJECT_DIR, "migrations"), join(OUTPUT_DIR, "migrations"));
  ok("  migrations/ copied");

  // 3e. Copy scripts/ (launcher scripts only)
  info("  Copying scripts/ (launcher)...");
  mkdirSync(join(OUTPUT_DIR, "scripts"), { recursive: true });
  const launcherScripts = ["devnull-server.sh", "devnull-server.bat"];
  for (const script of launcherScripts) {
    copyFile(join(PROJECT_DIR, "scripts", script), join(OUTPUT_DIR, "scripts", script));
  }
  ok("  scripts/ copied");

  // 3f. Copy package.json
  info("  Copying package.json...");
  copyFile(join(PROJECT_DIR, "package.json"), join(OUTPUT_DIR, "package.json"));
  ok("  package.json copied");

  // 3g. Copy .env.example
  info("  Copying .env.example...");
  copyFile(join(PROJECT_DIR, ".env.example"), join(OUTPUT_DIR, ".env.example"));
  ok("  .env.example copied");

  // 3h. Copy README
  info("  Copying README.md...");
  copyFile(join(PROJECT_DIR, "devnull-standalone", "README.md"), join(OUTPUT_DIR, "README.md"));
  ok("  README.md copied");

  // 3i. Copy LICENSE
  info("  Copying LICENSE...");
  copyFile(join(PROJECT_DIR, "LICENSE"), join(OUTPUT_DIR, "LICENSE"));
  ok("  LICENSE copied");

  // Calculate size
  let totalSize = 0;
  function calcSize(dir) {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) calcSize(fullPath);
      else totalSize += statSync(fullPath).size;
    }
  }
  calcSize(OUTPUT_DIR);

  ok(`Package directory created: ${OUTPUT_DIR}`);
  info(`  Size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
}

// ─── Step 4: Create tarball ───────────────────────────────────────────────────

async function createTarball() {
  info("Step 4/5: Creating tarball...");

  if (!existsSync(OUTPUT_DIR)) {
    error("Package directory not found — run createPackage first");
    process.exit(1);
  }

  const output = createWriteStream(TARBALL_PATH);
  const archive = archiver("tar", { gzip: true, gzipOptions: { level: 9 } });

  archive.pipe(output);

  // Add the entire package directory
  archive.directory(OUTPUT_DIR, false);

  await archive.finalize();

  await new Promise((resolve, reject) => {
    output.on("close", resolve);
    output.on("error", reject);
  });

  const stats = statSync(TARBALL_PATH);
  ok(`Tarball created: ${TARBALL_PATH}`);
  info(`  Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
}

// ─── Step 5: Validate ─────────────────────────────────────────────────────────

function validate() {
  info("Step 5/5: Validating standalone package...");

  let errors = 0;

  // Required files/directories
  const required = [
    { path: "dist/cli/index.js", label: "CLI entry point" },
    { path: "dist/api/server.js", label: "API server module" },
    { path: "dist/core/orchestrator.js", label: "Orchestrator module" },
    { path: "dist/tools/toolDispatcher.js", label: "Tool dispatcher" },
    { path: "node_modules", label: "node_modules/ (production deps)", isDir: true },
    { path: "agent/devnull.md", label: "Engineering protocol" },
    { path: "agent/config/llm.yaml", label: "LLM config" },
    { path: "agent/skills", label: "Skills directory", isDir: true },
    { path: "migrations/sqlite", label: "SQLite migrations", isDir: true },
    { path: "scripts/devnull-server.sh", label: "Linux launcher script" },
    { path: "scripts/devnull-server.bat", label: "Windows launcher script" },
    { path: "package.json", label: "Package manifest" },
    { path: ".env.example", label: "Environment template" },
    { path: "README.md", label: "README" },
    { path: "LICENSE", label: "License" },
  ];

  for (const req of required) {
    const fullPath = join(OUTPUT_DIR, req.path);
    const exists = req.isDir ? existsSync(fullPath) : existsSync(fullPath);
    if (exists) {
      ok(`  ${req.label}: ${req.path}`);
    } else {
      error(`  ${req.label}: ${req.path} — MISSING!`);
      errors++;
    }
  }

  // Check skill count
  const skillsDir = join(OUTPUT_DIR, "agent", "skills");
  if (existsSync(skillsDir)) {
    const skillDirs = readdirSync(skillsDir, { withFileTypes: true })
      .filter(d => d.isDirectory());
    ok(`  Skills: ${skillDirs.length} skill directories`);
  }

  // Check dist JS file count
  const distDir = join(OUTPUT_DIR, "dist");
  if (existsSync(distDir)) {
    const jsFiles = readdirSync(distDir, { recursive: true })
      .filter(f => f.endsWith(".js"));
    ok(`  Compiled JS: ${jsFiles.length} files in dist/`);
  }

  // Verify no .ts files leaked
  const tsFiles = readdirSync(OUTPUT_DIR, { recursive: true })
    .filter(f => f.endsWith(".ts") && !f.includes("node_modules"));
  if (tsFiles.length > 0) {
    warn(`  ${tsFiles.length} .ts files found in package (expected 0)`);
  } else {
    ok("  No .ts source files leaked into package");
  }

  console.log("");
  if (errors === 0) {
    ok("Standalone package validation PASSED — all checks OK");
  } else {
    error(`Standalone package validation FAILED — ${errors} error(s)`);
    process.exit(1);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("");
  console.log("══════════════════════════════════════════════════════════════════════");
  console.log("  devnull Standalone Package Builder");
  console.log("  Project: " + PROJECT_DIR);
  console.log("══════════════════════════════════════════════════════════════════════");
  console.log("");

  compile();
  console.log("");
  installDeps();
  console.log("");
  createPackage();
  console.log("");
  await createTarball();
  console.log("");
  validate();

  console.log("");
  console.log("══════════════════════════════════════════════════════════════════════");
  console.log("  Package Summary");
  console.log("══════════════════════════════════════════════════════════════════════");
  console.log("");
  console.log(`  Directory: ${OUTPUT_DIR}`);
  console.log(`  Tarball:   ${TARBALL_PATH}`);
  console.log("");
  console.log("  Quick start:");
  console.log(`    cd ${relative(PROJECT_DIR, OUTPUT_DIR)}`);
  console.log("    cp .env.example .env");
  console.log("    # Edit .env and add your DEEPSEEK_API_KEY");
  console.log("    scripts/devnull-server.sh    # Linux/macOS");
  console.log("    scripts\\devnull-server.bat   # Windows");
  console.log("");
}

main().catch(err => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
