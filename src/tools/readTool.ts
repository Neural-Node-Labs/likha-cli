import fs from "node:fs";
import path from "node:path";

export function readTool(filePath: string, cwd: string = process.cwd()): string {
  const full = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
  return fs.readFileSync(full, "utf-8");
}


