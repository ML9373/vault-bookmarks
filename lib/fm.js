// Minimal reader for the frontmatter of bookmark notes: flat `key: value` scalars,
// block lists (`  - item`) and inline lists (`[a, b]`). Nothing else is needed by the schema.

function scalar(raw) {
  const s = raw.trim();
  if (s.startsWith('"')) {
    try { return JSON.parse(s); } catch { return s.replace(/^"|"$/g, ''); }
  }
  if (s.startsWith("'")) return s.replace(/^'|'$/g, '').replace(/''/g, "'");
  return s.replace(/\s+#.*$/, '');
}

function inlineList(raw) {
  const inner = raw.trim().slice(1, -1).trim();
  return inner ? inner.split(',').map(scalar) : [];
}

export function parseFrontmatter(text) {
  const t = String(text).replace(/^﻿/, '').replace(/\r\n/g, '\n');
  if (!t.startsWith('---\n')) return null;
  const end = t.indexOf('\n---', 3);
  if (end === -1) return null;
  const lines = t.slice(4, end).split('\n');
  const fm = {};
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^([^\s#:][^:]*?):(?:\s+(.*))?$/);
    if (!m) continue;
    const [, key, rest = ''] = m;
    if (rest.trim() === '') {
      const list = [];
      while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) {
        list.push(scalar(lines[++i].replace(/^\s*-\s+/, '')));
      }
      fm[key] = list.length ? list : '';
    } else if (rest.trim().startsWith('[')) {
      fm[key] = inlineList(rest);
    } else {
      fm[key] = scalar(rest);
    }
  }
  return fm;
}
