const fs = require('fs');
const path = require('path');

const clarificationSection = `\\n\\n### Clarification Requests\\n` +
`You have the ability to ask the user for clarification when you genuinely cannot proceed without more information. ` +
`Use the \`clarification_tool\` to ask a question. The tool accepts:\\n` +
`- \`question\` (required): The specific question you need answered. Be precise and actionable.\\n` +
`- \`context\` (required): Brief context explaining why you're asking and what you've already determined.\\n` +
`- \`options\` (optional): A list of predefined choices the user can pick from.\\n\\n` +
`**When to use it:**\\n` +
`- **Ambiguous requirements:** "Build a login system" without specifying auth method (JWT? OAuth? Session?).\\n` +
`- **Missing technology choices:** "Implement caching" without specifying Redis, Memcached, or in-memory.\\n` +
`- **Unclear constraints:** "Make it fast" without performance targets or benchmarks.\\n` +
`- **Contradictory instructions:** "Use SQL but also be schema-less" — ask which takes priority.\\n` +
`- **Missing context:** "Fix the bug" without specifying which bug, where it occurs, or how to reproduce.\\n\\n` +
`**When NOT to use it:**\\n` +
`- Do NOT ask for clarification as a default behavior — only when genuinely uncertain.\\n` +
`- Do NOT ask for clarification on trivial details you can infer from context.\\n` +
`- Do NOT ask for clarification when you have enough information to make a reasonable choice — make the choice and proceed.\\n` +
`- Do NOT ask multiple questions at once — ask one question at a time.\\n\\n` +
`When you call \`clarification_tool\`, execution pauses and your question is presented to the user. ` +
`Their answer is injected back into your context so you can continue.`;

// ─── 1. ReActOrchestrator (orchestrator.ts) ───
const orchPath = path.join(__dirname, 'src', 'core', 'orchestrator.ts');
let orch = fs.readFileSync(orchPath, 'utf8');

// Find the Health Score Awareness section and add clarification after it
const healthSectionEnd = "when the score indicates you're stuck.";
const healthIdx = orch.indexOf(healthSectionEnd);
if (healthIdx === -1) {
  console.error('ERROR: Health Score section not found in orchestrator.ts');
  process.exit(1);
}

const orchInsertPoint = healthIdx + healthSectionEnd.length;
orch = orch.substring(0, orchInsertPoint) + clarificationSection + orch.substring(orchInsertPoint);
fs.writeFileSync(orchPath, orch, 'utf8');
console.log('SUCCESS: orchestrator.ts system prompt updated');

// ─── 2. LeanEngine ───
const leanPath = path.join(__dirname, 'src', 'core', 'engine', 'LeanEngine.ts');
let lean = fs.readFileSync(leanPath, 'utf8');

const leanIdx = lean.indexOf(healthSectionEnd);
if (leanIdx === -1) {
  console.error('ERROR: Health Score section not found in LeanEngine.ts');
  process.exit(1);
}

const leanInsertPoint = leanIdx + healthSectionEnd.length;
lean = lean.substring(0, leanInsertPoint) + clarificationSection + lean.substring(leanInsertPoint);
fs.writeFileSync(leanPath, lean, 'utf8');
console.log('SUCCESS: LeanEngine.ts system prompt updated');

// ─── 3. LangGraphEngine ───
const langPath = path.join(__dirname, 'src', 'core', 'engine', 'LangGraphEngine.ts');
let lang = fs.readFileSync(langPath, 'utf8');

const langIdx = lang.indexOf(healthSectionEnd);
if (langIdx === -1) {
  console.error('ERROR: Health Score section not found in LangGraphEngine.ts');
  process.exit(1);
}

const langInsertPoint = langIdx + healthSectionEnd.length;
lang = lang.substring(0, langInsertPoint) + clarificationSection + lang.substring(langInsertPoint);
fs.writeFileSync(langPath, lang, 'utf8');
console.log('SUCCESS: LangGraphEngine.ts system prompt updated');

// ─── 4. SwarmEngine ───
const swarmPath = path.join(__dirname, 'src', 'core', 'engine', 'SwarmEngine.ts');
let swarm = fs.readFileSync(swarmPath, 'utf8');

// SwarmEngine has a different system prompt — find the orchestrator prompt section
const swarmSearch = "You also have the standard filesystem, execution, and validation tools available if you";
const swarmIdx = swarm.indexOf(swarmSearch);
if (swarmIdx === -1) {
  console.error('ERROR: SwarmEngine system prompt section not found');
  process.exit(1);
}

const swarmClarification = `\\n\\n### Clarification Requests\\n` +
`You have the ability to ask the user for clarification when you genuinely cannot proceed without more information. ` +
`Use the \`clarification_tool\` to ask a question. The tool accepts:\\n` +
`- \`question\` (required): The specific question you need answered. Be precise and actionable.\\n` +
`- \`context\` (required): Brief context explaining why you're asking and what you've already determined.\\n` +
`- \`options\` (optional): A list of predefined choices the user can pick from.\\n\\n` +
`**When to use it:**\\n` +
`- **Ambiguous requirements:** "Build a login system" without specifying auth method (JWT? OAuth? Session?).\\n` +
`- **Missing technology choices:** "Implement caching" without specifying Redis, Memcached, or in-memory.\\n` +
`- **Unclear constraints:** "Make it fast" without performance targets or benchmarks.\\n` +
`- **Contradictory instructions:** "Use SQL but also be schema-less" — ask which takes priority.\\n` +
`- **Missing context:** "Fix the bug" without specifying which bug, where it occurs, or how to reproduce.\\n\\n` +
`**When NOT to use it:**\\n` +
`- Do NOT ask for clarification as a default behavior — only when genuinely uncertain.\\n` +
`- Do NOT ask for clarification on trivial details you can infer from context.\\n` +
`- Do NOT ask for clarification when you have enough information to make a reasonable choice — make the choice and proceed.\\n` +
`- Do NOT ask multiple questions at once — ask one question at a time.\\n\\n` +
`When you call \`clarification_tool\`, execution pauses and your question is presented to the user. ` +
`Their answer is injected back into your context so you can continue.`;

const swarmInsertPoint = swarmIdx + swarmSearch.length;
swarm = swarm.substring(0, swarmInsertPoint) + swarmClarification + swarm.substring(swarmInsertPoint);
fs.writeFileSync(swarmPath, swarm, 'utf8');
console.log('SUCCESS: SwarmEngine.ts system prompt updated');

console.log('\\nAll 4 engine system prompts updated successfully!');
