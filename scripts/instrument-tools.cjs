/**
 * Script to add structured error logging to all tool implementations.
 * Handles \r\n line endings on Windows.
 */
const fs = require("fs");
const path = require("path");

const TOOLS_DIR = path.join(__dirname, "..", "src", "tools");

// Map of tool file -> modifications to make
const modifications = {
  "globTool.ts": {
    importLine: `import { logToolError } from "./toolLogger.js";`,
    wrapFunction: {
      name: "globTool",
      body: `  try {
    const ignore = loadIgnoreRules(cwd);
    return fg(pattern, { cwd, ignore, dot: false, onlyFiles: true });
  } catch (err) {
    logToolError("glob_tool", err, \`pattern=\${pattern}, cwd=\${cwd}\`);
    throw err;
  }`,
    },
  },
  "grepTool.ts": {
    importLine: `import { logToolError } from "./toolLogger.js";`,
    wrapFunction: {
      name: "grepTool",
      body: `  const files = await globTool(globPattern, cwd);
  const re = new RegExp(regex);
  const matches = [];

  for (const file of files) {
    let content;
    try {
      content = fs.readFileSync(\`\${cwd}/\${file}\`, "utf-8");
    } catch {
      continue; // binary or unreadable file — skip
    }
    const lines = content.split("\\n");
    lines.forEach((line, idx) => {
      if (re.test(line)) {
        matches.push({ file, line: idx + 1, text: line.trim() });
      }
    });
  }
  return matches;`,
    },
  },
  "readTool.ts": {
    importLine: `import { logToolError } from "./toolLogger.js";`,
    wrapFunction: {
      name: "readTool",
      body: `  try {
    const full = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
    return fs.readFileSync(full, "utf-8");
  } catch (err) {
    logToolError("read_tool", err, \`filePath=\${filePath}, cwd=\${cwd}\`);
    throw err;
  }`,
    },
  },
  "writeEditTool.ts": {
    importLine: `import { logToolError } from "./toolLogger.js";`,
    wrapFunctions: [
      {
        name: "writeFile",
        body: `  try {
    const full = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf-8");
    return { file: full, bytesWritten: Buffer.byteLength(content, "utf-8") };
  } catch (err) {
    logToolError("write_edit_tool", err, \`mode=write, filePath=\${filePath}\`);
    throw err;
  }`,
      },
      {
        name: "editFile",
        body: `  try {
    const full = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
    const content = fs.readFileSync(full, "utf-8");

    const occurrences = content.split(oldStr).length - 1;
    if (occurrences === 0) throw new Error(\`editFile: old string not found in \${filePath}\`);
    if (occurrences > 1) throw new Error(\`editFile: old string is not unique in \${filePath} (\${occurrences} matches)\`);

    const updated = content.replace(oldStr, newStr);
    fs.writeFileSync(full, updated, "utf-8");
    return { file: full, bytesWritten: Buffer.byteLength(updated, "utf-8") };
  } catch (err) {
    logToolError("write_edit_tool", err, \`mode=edit, filePath=\${filePath}\`);
    throw err;
  }`,
      },
    ],
  },
  "runCommandTool.ts": {
    importLine: `import { logToolError } from "./toolLogger.js";`,
    wrapFunction: {
      name: "runCommand",
      body: `  return new Promise((resolve) => {
    // Strip NODE_ENV so it doesn't leak from devnull's own container runtime
    const { NODE_ENV, ...childEnv } = process.env;

    const child = spawn(command, { cwd, shell: true, timeout: timeoutMs, env: childEnv });
    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (d) => (stdout += d.toString()));
    child.stderr?.on("data", (d) => (stderr += d.toString()));

    child.on("close", (code) => {
      resolve({ command, exitCode: code ?? -1, stdout, stderr });
    });

    child.on("error", (err) => {
      logToolError("run_command_tool", err, \`command=\${command}, cwd=\${cwd}\`);
      resolve({ command, exitCode: -1, stdout, stderr: String(err) });
    });
  });`,
    },
  },
};

function normalizeLineEndings(content) {
  return content.replace(/\r\n/g, "\n");
}

function addImport(content, importLine) {
  // Add import after the last existing import
  const lines = content.split("\n");
  let lastImportIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("import ")) {
      lastImportIdx = i;
    }
  }
  if (lastImportIdx >= 0) {
    lines.splice(lastImportIdx + 1, 0, importLine);
  } else {
    // No existing imports, add at the top
    lines.unshift(importLine);
  }
  return lines.join("\n");
}

function wrapFunctionBody(content, functionName, newBody) {
  // Find the function declaration and its body
  const funcStartRegex = new RegExp(
    `(export\\s+)?(async\\s+)?function\\s+${functionName}\\s*\\([^)]*\\)\\s*:\\s*[^{]*\\{`
  );
  const match = content.match(funcStartRegex);
  if (!match) {
    console.error(`  Could not find function ${functionName}`);
    return content;
  }

  const startIdx = match.index + match[0].length;
  // Find the matching closing brace
  let depth = 1;
  let endIdx = startIdx;
  while (depth > 0 && endIdx < content.length) {
    if (content[endIdx] === "{") depth++;
    else if (content[endIdx] === "}") depth--;
    endIdx++;
  }

  // Replace the body (between opening { and closing })
  const before = content.slice(0, startIdx);
  const after = content.slice(endIdx);
  return before + "\n" + newBody + "\n" + after;
}

function processFile(fileName) {
  const filePath = path.join(TOOLS_DIR, fileName);
  let content = fs.readFileSync(filePath, "utf8");
  const originalContent = content;

  // Normalize to \n for processing
  content = normalizeLineEndings(content);

  const mod = modifications[fileName];
  if (!mod) return;

  console.log(`Processing ${fileName}...`);

  // Add import
  if (mod.importLine) {
    content = addImport(content, mod.importLine);
  }

  // Wrap single function
  if (mod.wrapFunction) {
    content = wrapFunctionBody(content, mod.wrapFunction.name, mod.wrapFunction.body);
  }

  // Wrap multiple functions
  if (mod.wrapFunctions) {
    for (const fn of mod.wrapFunctions) {
      content = wrapFunctionBody(content, fn.name, fn.body);
    }
  }

  // Write back with original line endings
  if (content !== normalizeLineEndings(originalContent)) {
    // Preserve \r\n if original had it
    if (originalContent.includes("\r\n")) {
      content = content.replace(/\n/g, "\r\n");
    }
    fs.writeFileSync(filePath, content, "utf8");
    console.log(`  ✓ Updated`);
  } else {
    console.log(`  - No changes needed`);
  }
}

// Process all tool files
const toolFiles = Object.keys(modifications);
for (const file of toolFiles) {
  processFile(file);
}

console.log("\nDone. Now manually verify the remaining tool files.");
