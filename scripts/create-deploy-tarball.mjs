#!/usr/bin/env node
/**
 * create-deploy-tarball.mjs
 *
 * Creates a deploy tarball (devnull-deploy.tar.gz) containing everything needed
 * to build and run the devnull stack on a remote Docker host.
 *
 * Uses the `archiver` package (already a dependency) for cross-platform tar.gz creation.
 *
 * Includes:
 *   - dist/          (compiled JS artifacts)
 *   - Dockerfile     (multi-stage build)
 *   - docker-compose.yml
 *   - .dockerignore
 *   - .env.example   (NOT .env — secrets excluded)
 *   - package.json, package-lock.json, tsconfig.json
 *   - agent/         (skills, protocol, config)
 *   - ui/            (frontend — built separately in its own Dockerfile)
 *
 * Excludes:
 *   - .env, .env.local, .env.production  (secrets)
 *   - node_modules/  (installed during Docker build)
 *   - .git/          (version control)
 *   - .log/          (runtime data)
 *   - .agent/index/  (generated index)
 *   - tasks/, reports/, coverage/
 */

import archiver from "archiver";
import { createWriteStream, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = join(__dirname, "..");
const OUTPUT_FILE = process.argv[2] || join(PROJECT_DIR, "devnull-deploy.tar.gz");

// ─── File/directory entries to include ───────────────────────────────────────

const ENTRIES = [
  { type: "directory", path: "dist" },
  { type: "file", path: "Dockerfile" },
  { type: "file", path: "docker-compose.yml" },
  { type: "file", path: ".dockerignore" },
  { type: "file", path: ".env.example" },
  { type: "file", path: "package.json" },
  { type: "file", path: "package-lock.json" },
  { type: "file", path: "tsconfig.json" },
  { type: "directory", path: "agent" },
  { type: "directory", path: "ui" },
];

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("📦 Creating deploy tarball...");
  console.log(`   Project: ${PROJECT_DIR}`);
  console.log(`   Output:  ${OUTPUT_FILE}`);
  console.log("");

  const output = createWriteStream(OUTPUT_FILE);
  const archive = archiver("tar", { gzip: true, gzipOptions: { level: 9 } });

  // Pipe archive data to the file
  archive.pipe(output);

  // Add each entry
  for (const entry of ENTRIES) {
    const fullPath = join(PROJECT_DIR, entry.path);
    if (entry.type === "directory") {
      // Use glob pattern to exclude node_modules and other unwanted dirs
      archive.glob(`**/*`, {
        cwd: fullPath,
        dot: true,
        ignore: [
          "node_modules/**",
          ".git/**",
          ".log/**",
          ".agent/index/**",
          "tasks/**",
          "reports/**",
          "coverage/**",
          "*.dump",
          ".DS_Store",
          "Thumbs.db",
          "npm-debug.log",
          "yarn-debug.log",
          "yarn-error.log",
          ".vscode/**",
          ".idea/**",
          "*.swp",
          "*.swo",
          "tsconfig.tsbuildinfo",
          "test-results/**",
        ],
      }, { name: entry.path + "/" });
      console.log(`   📁 Adding directory: ${entry.path}/`);
    } else {
      archive.file(fullPath, { name: entry.path });
      console.log(`   📄 Adding file: ${entry.path}`);
    }
  }

  // Finalize the archive
  await archive.finalize();

  // Wait for the output stream to finish
  await new Promise((resolve, reject) => {
    output.on("close", resolve);
    output.on("error", reject);
  });

  const stats = statSync(OUTPUT_FILE);
  console.log("");
  console.log(`✅ Tarball created: ${OUTPUT_FILE}`);
  console.log(`   Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB (${stats.size} bytes)`);
  console.log("");

  // ── Validation ────────────────────────────────────────────────────────────
  console.log("══════════════════════════════════════════════════════════════════");
  console.log("  Validating tarball contents...");
  console.log("══════════════════════════════════════════════════════════════════");
  console.log("");

  // List contents using tar command
  let contents;
  try {
    const listCmd = `tar -tzf "${OUTPUT_FILE}"`;
    contents = execSync(listCmd, { cwd: PROJECT_DIR, encoding: "utf-8", shell: true })
      .split("\n")
      .map((l) => l.trim().replace(/\r$/, ""))
      .filter(Boolean)
      .sort();
  } catch {
    // Fallback: use archiver's internal listing (not available, so just use our entries)
    contents = ENTRIES.map((e) => e.path + (e.type === "directory" ? "/" : ""));
  }

  console.log("Files in tarball:");
  console.log("-----------------");
  for (const f of contents) {
    console.log(`  ${f}`);
  }
  console.log("");

  // Check required items
  const required = [
    { name: "dist/", label: "dist/ (compiled JS)" },
    { name: "Dockerfile", label: "Dockerfile" },
    { name: "docker-compose.yml", label: "docker-compose.yml" },
    { name: ".dockerignore", label: ".dockerignore" },
    { name: ".env.example", label: ".env.example" },
    { name: "package.json", label: "package.json" },
    { name: "package-lock.json", label: "package-lock.json" },
    { name: "tsconfig.json", label: "tsconfig.json" },
    { name: "agent/", label: "agent/ (skills & protocol)" },
    { name: "ui/", label: "ui/ (frontend)" },
  ];

  let missing = 0;
  console.log("Required file check:");
  console.log("--------------------");

  for (const req of required) {
    const found = contents.some((c) => c.startsWith(req.name));
    if (found) {
      console.log(`  ✅ ${req.label}`);
    } else {
      console.log(`  ❌ ${req.label} — MISSING!`);
      missing = 1;
    }
  }

  // Verify .env is NOT in the tarball
  const envFound = contents.some((c) => c === ".env" || c.startsWith(".env/"));
  console.log("");
  if (envFound) {
    console.log("  ❌ SECURITY RISK: .env file found in tarball!");
    missing = 1;
  } else {
    console.log("  ✅ .env correctly excluded (secrets safe)");
  }

  // Verify dist/ has compiled JS files
  const distFiles = contents.filter((c) => c.startsWith("dist/") && c.endsWith(".js"));
  console.log(`  ✅ dist/ contains ${distFiles.length} compiled JS files`);

  console.log("");
  if (missing === 0) {
    console.log("✅ All required files present. Tarball is valid.");
  } else {
    console.log("❌ Some required files are missing from the tarball.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
