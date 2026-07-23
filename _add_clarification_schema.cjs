const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src', 'tools', 'toolSchemas.ts');
let c = fs.readFileSync(filePath, 'utf8');

const clarificationSchema = `    {
      type: "function",
      function: {
        name: "clarification_tool",
        description:
          "Ask the user for clarification when the task requirements are ambiguous, incomplete, or contradictory. " +
          "Use this ONLY when you genuinely cannot proceed without more information — do not use it as a default behavior. " +
          "Examples of when to use: ambiguous requirements (\"build a login system\" without specifying auth method), " +
          "missing technology choices (\"implement caching\" without specifying Redis/Memcached/in-memory), " +
          "unclear constraints (\"make it fast\" without performance targets), " +
          "contradictory instructions (\"use SQL but also be schema-less\"), " +
          "or missing context (\"fix the bug\" without specifying which bug or where). " +
          "When you call this tool, execution pauses and the user's answer is injected back into your context so you can continue.",
        parameters: {
          type: "object",
          properties: {
            question: {
              type: "string",
              description: "The specific question you need answered to proceed. Be precise and actionable."
            },
            context: {
              type: "string",
              description: "Brief context explaining why you're asking and what you've already determined. Helps the user give a better answer."
            },
            options: {
              type: "array",
              items: { type: "string" },
              description: "Optional list of predefined options the user can choose from. Use when the decision is between known alternatives."
            },
          },
          required: ["question", "context"],
        },
      },
    },
`;

// Find the conversation_tool entry and insert clarification_tool before it
const searchStr = 'name: "conversation_tool"';
const idx = c.indexOf(searchStr);
if (idx === -1) {
  console.error('ERROR: conversation_tool not found');
  process.exit(1);
}

// Find the start of the conversation_tool object (the { before it)
const before = c.lastIndexOf('{', idx);
const result = c.substring(0, before) + clarificationSchema + c.substring(before);
fs.writeFileSync(filePath, result, 'utf8');
console.log('SUCCESS: clarification_tool schema added to toolSchemas.ts');
