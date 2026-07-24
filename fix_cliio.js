const fs = require('fs');
let c = fs.readFileSync('src/cli/CliIO.ts', 'utf8');

// 1. Add reportTaskTokenSummary to import
c = c.replace(
  '  reportPhaseStats,\r\n} from "./consoleReporter.js"',
  '  reportPhaseStats,\r\n  reportTaskTokenSummary,\r\n} from "./consoleReporter.js"'
);

// 2. Add prompt and taskTokenSummary methods before the closing brace of the class
c = c.replace(
  '    } finally {\r\n      rl.close();\r\n    }\r\n  }\r\n}',
  '    } finally {\r\n      rl.close();\r\n    }\r\n  }\r\n\r\n  async prompt(question: string, opts?: { defaultValue?: string }): Promise<string | null> {\r\n    const interactive = this.opts.interactive !== false;\r\n    if (!interactive) {\r\n      return opts?.defaultValue ?? null;\r\n    }\r\n    const rl = readline.createInterface({ input, output });\r\n    try {\r\n      const answer = await rl.question(`${question} `);\r\n      const trimmed = answer.trim();\r\n      if (!trimmed) return opts?.defaultValue ?? null;\r\n      return trimmed;\r\n    } finally {\r\n      rl.close();\r\n    }\r\n  }\r\n\r\n  taskTokenSummary(\r\n    taskTokenSummaries: Record<\r\n      string,\r\n      {\r\n        phases: Record<string, { input: number; output: number; cached: number; total: number; expectedTotal: number }>;\r\n        runningTotal: number;\r\n      }\r\n    >,\r\n    indent = 0,\r\n  ): void {\r\n    reportTaskTokenSummary(taskTokenSummaries, indent);\r\n  }\r\n}'
);

fs.writeFileSync('src/cli/CliIO.ts', c, 'utf8');
console.log('Done. New length:', c.length);
