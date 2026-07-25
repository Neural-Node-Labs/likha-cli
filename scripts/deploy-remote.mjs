#!/usr/bin/env node
/**
 * Direct deploy script that bypasses the cached module system.
 * Uses dynamic imports with cache-busting to ensure the latest compiled code is used.
 */
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, "..", "dist");

async function main() {
  const host = "86.38.217.69";
  const user = (process.env.REMOTE_SSH_USER || "").trim();
  const password = process.env.REMOTE_SSH_PASSWORD;
  const remotePath = "/opt/devnull";

  if (!user || !password) {
    console.error("REMOTE_SSH_USER and REMOTE_SSH_PASSWORD must be set");
    process.exit(1);
  }

  // Dynamic import with cache-busting (use file:// URL on Windows)
  const modulePath = path.join(distDir, "tools", "dockerDeploySshTool.js");
  const moduleUrl = new URL("file:///" + modulePath.replace(/\\/g, "/")).href + "?t=" + Date.now();
  const { deployWorkspaceViaSsh } = await import(moduleUrl);

  const result = await deployWorkspaceViaSsh({
    host,
    user,
    password,
    remotePath,
  }, process.cwd());

  console.log(JSON.stringify(result, null, 2));
  process.exit(result.success ? 0 : 1);
}

main().catch((err) => {
  console.error("Deploy failed:", err);
  process.exit(1);
});
