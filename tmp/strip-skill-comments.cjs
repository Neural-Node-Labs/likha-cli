// ronin:version 1 | ronin:task task-4508cb | ronin:updated 2026-08-13T15:31:19.905Z | ronin:subtask code-st-885544
const fs = require('fs');
const files = [
  'agent/skills/conversation/SKILL.md',
  'agent/skills/filesystem-management/SKILL.md'
];
for (const f of files) {
  let raw = fs.readFileSync(f, 'utf8');
  while (/^<!--[\s\S]*?-->\s*\n?/.test(raw)) {
    raw = raw.replace(/^<!--[\s\S]*?-->\s*\n?/, '');
  }
  fs.writeFileSync(f, raw, 'utf8');
  console.log('cleaned ' + f + ' first-line=' + JSON.stringify(raw.split('\n')[0]));
}
