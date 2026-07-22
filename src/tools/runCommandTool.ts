import { spawn } from "node:child_process";

export interface CommandResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Executes the Validation phase's Action: run tests / linter / type-checker / kubectl /
 * docker build / repro steps — whatever the active skill needs — and returns the raw
 * Observation for the ReAct loop to reason over.
 */
export function runCommand(command: string, cwd: string = process.cwd(), timeoutMs = 120_000): Promise<CommandResult> {
  return new Promise((resolve) => {
    // Strip NODE_ENV so it doesn't leak from xcoder's own container runtime
    // config (set to "production" in the Dockerfile/docker-compose.yml) into
    // build/install commands run against the target workspace. Left as-is,
    // `npm install`/`npm ci` in child commands would silently skip
    // devDependencies for any project xcoder is asked to work on.
    const { NODE_ENV, ...childEnv } = process.env;

    const child = spawn(command, { cwd, shell: true, timeout: timeoutMs, env: childEnv });
    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (d) => (stdout += d.toString()));
    child.stderr?.on("data", (d) => (stderr += d.toString()));

    child.on("close", (code) => {
      resolve({ command, exitCode: code ?? -1, stdout, stderr });
    });
  });
}

