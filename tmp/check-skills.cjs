// ronin:version 1 | ronin:task task-4508cb | ronin:updated 2026-08-13T15:18:08.732Z | ronin:subtask requirements-st-085e02
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;

function scan(dir) {
  const p = path.join(dir, 'skills');
  if (!fs.existsSync(p)) return { dir: p, exists: false, ok: 0, bad: [] };
  const out = { dir: p, exists: true, ok: 0, bad: [] };
  for (const d of fs.readdirSync(p, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const f = path.join(p, d.name, 'SKILL.md');
    if (!fs.existsSync(f)) { out.bad.push(d.name + ':no-SKILL.md'); continue; }
    const raw = fs.readFileSync(f, 'utf8');
    const m = raw.match(RE);
    if (!m) { out.bad.push(d.name + ':no-frontmatter'); continue; }
    try {
      const h = yaml.load(m[1]);
      const problems = [];
      if (!h || typeof h !== 'object') problems.push('header-not-object');
      else {
        if (!h.name) problems.push('name-missing');
        if (!Array.isArray(h.triggers)) problems.push('triggers-not-array:' + typeof h.triggers);
        if (!Array.isArray(h.composes_with)) problems.push('composes_with-not-array:' + typeof h.composes_with);
        if (!Array.isArray(h.requires_tools)) problems.push('requires_tools-not-array:' + typeof h.requires_tools);
      }
      if (problems.length) out.bad.push(d.name + ':' + problems.join(','));
      else out.ok++;
    } catch (e) { out.bad.push(d.name + ':yaml-error:' + e.message); }
  }
  return out;
}

const results = [scan('agent'), scan('.agent'), scan('dist/config/agent')];
for (const r of results) {
  console.log('DIR ' + r.dir + ' exists=' + r.exists + ' ok=' + r.ok + ' bad=' + r.bad.length);
  for (const b of r.bad.slice(0, 30)) console.log('  BAD ' + b);
}
const totalBad = results.reduce((a, r) => a + r.bad.length, 0);
process.exit(totalBad > 0 ? 2 : 0);
