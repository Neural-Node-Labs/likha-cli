import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);
const MARKER_PREFIX = "# xcoder-schedule:";

export interface ScheduledJob {
  id: string;
  cronExpr: string;
  command: string;
}

async function readCrontab(): Promise<string> {
  try {
    const { stdout } = await execFileP("crontab", ["-l"]);
    return stdout;
  } catch {
    return ""; // no crontab yet for this user
  }
}

async function writeCrontab(content: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("crontab", ["-"]);
    child.stdin.write(content);
    child.stdin.end();
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`crontab write failed (exit ${code})`))));
  });
}

/** Registers a recurring OS-level cron job: `<cronExpr> <command>`, tagged with an id marker for later listing/removal. */
export async function scheduleCron(id: string, cronExpr: string, command: string): Promise<{ id: string; cronExpr: string }> {
  const current = await readCrontab();
  const line = `${MARKER_PREFIX}${id}\n${cronExpr} ${command}\n`;
  await writeCrontab(current + (current.endsWith("\n") || current === "" ? "" : "\n") + line);
  return { id, cronExpr };
}

/** Schedules a one-off command to run after `delaySeconds`, surviving beyond the current process. */
export async function scheduleOnce(delaySeconds: number, command: string): Promise<{ scheduledFor: string }> {
  const child = spawn("bash", ["-c", `sleep ${delaySeconds} && ${command}`], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  return { scheduledFor: new Date(Date.now() + delaySeconds * 1000).toISOString() };
}

export async function listScheduled(): Promise<ScheduledJob[]> {
  const content = await readCrontab();
  const lines = content.split("\n");
  const jobs: ScheduledJob[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith(MARKER_PREFIX)) {
      const id = lines[i].slice(MARKER_PREFIX.length);
      const jobLine = lines[i + 1] ?? "";
      const match = jobLine.match(/^(\S+\s+\S+\s+\S+\s+\S+\s+\S+)\s+(.*)$/);
      if (match) jobs.push({ id, cronExpr: match[1], command: match[2] });
    }
  }
  return jobs;
}

export async function removeScheduled(id: string): Promise<{ removed: boolean }> {
  const content = await readCrontab();
  const lines = content.split("\n");
  const out: string[] = [];
  let skipNext = false;
  let removed = false;
  for (const line of lines) {
    if (skipNext) {
      skipNext = false;
      continue;
    }
    if (line === `${MARKER_PREFIX}${id}`) {
      skipNext = true;
      removed = true;
      continue;
    }
    out.push(line);
  }
  await writeCrontab(out.join("\n"));
  return { removed };
}


