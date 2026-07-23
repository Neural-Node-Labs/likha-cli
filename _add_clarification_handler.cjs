const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src', 'tools', 'toolDispatcher.ts');
let c = fs.readFileSync(filePath, 'utf8');

// Find the conversation_tool case and add clarification_tool case before it
const searchStr = 'case "conversation_tool":';
const idx = c.indexOf(searchStr);
if (idx === -1) {
  console.error('ERROR: conversation_tool case not found');
  process.exit(1);
}

const clarificationHandler = `        case "clarification_tool": {
          // The clarification_tool is handled by the orchestrator/engine before dispatch.
          // If it reaches the dispatcher, it means the engine didn't intercept it — return
          // the clarification request as the observation so the engine can process it.
          return {
            toolCallId: call.id,
            toolName: name,
            observation: {
              type: "clarification_request",
              question: args.question,
              context: args.context,
              options: args.options,
              message: "Clarification requested — the engine should intercept this before dispatch."
            },
            isError: false,
          };
        }
`;

const result = c.substring(0, idx) + clarificationHandler + c.substring(idx);
fs.writeFileSync(filePath, result, 'utf8');
console.log('SUCCESS: clarification_tool handler added to toolDispatcher.ts');
