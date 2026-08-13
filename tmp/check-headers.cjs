// ronin:version 1 | ronin:task task-4508cb | ronin:updated 2026-08-13T15:31:54.124Z | ronin:subtask code-st-885544
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;

function scan(dir) {
  const p = path.join(dir, 'skills');
  if (!fs.existsSync(p)) { console.log(dir + ': missing'); return; }
  const dirs = fs.readdirSync(p, { withFileTypes: true }).filter(d => d.isDirectory());
  let ok = 0;
  const problems = [];
  for (const d of dirs) {
    const f = path.join(p, d.name, 'SKILL.md');
    if (!fs.existsSync(f)) { problems.push(d.name + ':no-SKILL.md'); continue; }
    const m = fs.readFileSync(f, 'utf8').match(RE);
    if (!m) { problems.push(d.name + ':no-frontmatter'); continue; }
    let h;
    try { h = yaml.load(m[1]); } catch (e) { problems.push(d.name + ':yaml'); continue; }
    const misses = [];
    if (!h || typeof h !== 'object') { problems.push(d.name + ':not-object'); continue; }
    if (typeof h.name !== 'string' || !h.name) misses.push('name');
    if (typeof h.role !== 'string' || !h.role) misses.push('role');
    if (typeof h.description !== 'string' || !h.description) misses.push('description');
    if (!Array.isArray(h.triggers)) misses.push('triggers');
    if (!Array.isArray(h.composes_with)) misses.push('composes_with');
    if (!Array.isArray(h.requires_tools)) misses.push('requires_tools');
    if (typeof h.version !== 'string' || !h.version) misses.push('version');
    if (misses.length) problems.push(d.name + ':missing=' + misses.join(','));
    else if (h.name !== d.name) problems.push(d.name + ':name=' + h.name + ' (DIR_NAME_MISMATCH)');
    else ok++;
  }
  console.log(dir + ' ok=' + ok + ' problems=' + problems.length);
  for (const p2 of problems.slice(0, 20)) console.log('  ' + p2);
}
scan('agent');
scan('dist/config/agent');
