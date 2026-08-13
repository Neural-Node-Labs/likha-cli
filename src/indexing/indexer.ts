import fs from "node:fs";
import path from "node:path";
import { globTool } from "../tools/globTool.js";
import { loadIgnoreRules } from "./ignoreRules.js";
import { IndexEntry, IndexFile } from "../core/types.js";

const MAX_DUMP_BYTES = 500 * 1024; // 500KB hard ceiling per dump file
const INDEX_DIR = ".agent/index";

/**
 * Walks the workspace (respecting .agentignore/.gitignore/.dockerignore), and dumps every
 * file's content into chunked index00x.dump files, each marked so the original file can be
 * reconstructed, while index.json tracks filename -> (dump file, start byte, end byte).
 *
 * Byte offsets (rather than line numbers) are used so reconstruction is byte-exact
 * regardless of the file's line-ending style (LF vs CRLF).
 */
export async function buildIndex(cwd: string = process.cwd()): Promise<IndexFile> {
  const indexDirAbs = path.join(cwd, INDEX_DIR);
  fs.mkdirSync(indexDirAbs, { recursive: true });

  // fresh rebuild: clear old dump files
  for (const f of fs.readdirSync(indexDirAbs)) {
    if (f.startsWith("index") && f.endsWith(".dump")) fs.unlinkSync(path.join(indexDirAbs, f));
  }

  loadIgnoreRules(cwd); // ensures ignore file merging happens even if globTool caches later
  const files = await globTool("**/*", cwd);

  const entries: IndexEntry[] = [];
  let dumpIndex = 1;
  let currentDumpPath = path.join(indexDirAbs, dumpFileName(dumpIndex));
  let currentDumpSize = 0;
  let currentStream = fs.createWriteStream(currentDumpPath, { flags: "w" });

  for (const relPath of files) {
    const abs = path.join(cwd, relPath);
    let content: string;
    try {
      content = fs.readFileSync(abs, "utf-8");
    } catch {
      continue; // skip binary/unreadable files
    }

    const marker = `>>> FILE: ${relPath} >>>\n`;
    const endMarker = `<<< END: ${relPath} <<<\n`;
    const block = marker + content + (content.endsWith("\n") ? "" : "\n") + endMarker;
    const blockBytes = Buffer.byteLength(block, "utf-8");
    const markerBytes = Buffer.byteLength(marker, "utf-8");
    const contentBytes = Buffer.byteLength(content, "utf-8");

    // roll to a new dump file if this block would exceed the cap
    if (currentDumpSize + blockBytes > MAX_DUMP_BYTES && currentDumpSize > 0) {
      currentStream.end();
      dumpIndex += 1;
      currentDumpPath = path.join(indexDirAbs, dumpFileName(dumpIndex));
      currentStream = fs.createWriteStream(currentDumpPath, { flags: "w" });
      currentDumpSize = 0;
    }

    // content occupies [currentDumpSize + markerBytes, currentDumpSize + markerBytes + contentBytes)
    const startByte = currentDumpSize + markerBytes;
    currentStream.write(block);
    currentDumpSize += blockBytes;
    const endByte = startByte + contentBytes;

    entries.push({
      filename: path.basename(relPath),
      filepath: relPath,
      fileVersion: hashContent(content),
      dumpFile: dumpFileName(dumpIndex),
      startByte,
      endByte,
    });
  }
  currentStream.end();

  const indexFile: IndexFile = { generatedAt: new Date().toISOString(), entries };
  fs.writeFileSync(path.join(indexDirAbs, "index.json"), JSON.stringify(indexFile, null, 2), "utf-8");
  return indexFile;
}

/** Reads a specific file's content back out of the dump, using index.json byte offsets. */
export function readFromIndex(filepath: string, cwd: string = process.cwd()): string | undefined {
  const indexPath = path.join(cwd, INDEX_DIR, "index.json");
  if (!fs.existsSync(indexPath)) return undefined;

  const index = JSON.parse(fs.readFileSync(indexPath, "utf-8")) as IndexFile;
  const entry = index.entries.find((e) => e.filepath === filepath);
  if (!entry) return undefined;

  const dumpPath = path.join(cwd, INDEX_DIR, entry.dumpFile);
  // Read as a Buffer and slice by byte offsets so reconstruction is byte-exact
  // (String.slice would use UTF-16 code-unit indices and diverge on non-ASCII).
  const dump = fs.readFileSync(dumpPath);
  return dump.slice(entry.startByte, entry.endByte).toString("utf-8");
}

function dumpFileName(n: number): string {
  return `index${String(n).padStart(3, "0")}.dump`;
}

function hashContent(content: string): string {
  // lightweight content fingerprint, not cryptographic — good enough for change detection
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    hash = (hash * 31 + content.charCodeAt(i)) | 0;
  }
  return `v${(hash >>> 0).toString(16)}`;
}


