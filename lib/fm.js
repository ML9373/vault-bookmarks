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

const BARE = /^[\p{L}\p{N}_/-]+$/u;
const RESERVED = /^(true|false|null|yes|no|on|off|~|\d+)$/i;
const item = (v) => (BARE.test(v) && !RESERVED.test(v) ? v : JSON.stringify(v));

/**
 * Sets, replaces or removes one property of a note's frontmatter and returns the new text, or null
 * when the note has no frontmatter. `value` is a string (written JSON-quoted), `true` (written bare,
 * as Obsidian writes a checkbox), a list of strings (written as a block list) or `null` (the
 * property is removed). Only that property changes: every other byte, the body included, is kept,
 * with the note's own line endings.
 */
export function setProp(text, key, value) {
  const src = String(text);
  const bom = src.startsWith('\ufeff') ? '\ufeff' : '';
  const t = src.slice(bom.length);
  const eol = t.includes('\r\n') ? '\r\n' : '\n';
  const lines = t.split(eol);
  if (lines[0] !== '---') return null;
  const end = lines.findIndex((l, i) => i > 0 && /^---[ \t]*$/.test(l));
  if (end === -1) return null;
  const at = lines.findIndex((l, i) => i > 0 && i < end && (l === `${key}:` || l.startsWith(`${key}:`) && /\s/.test(l[key.length + 1] ?? ' ')));
  let span = 1;
  if (at !== -1) while (at + span < end && /^\s+-\s/.test(lines[at + span])) span++;
  const out = value === null ? [] : value === true ? [`${key}: true`]
    : Array.isArray(value) ? (value.length ? [`${key}:`, ...value.map((v) => `  - ${item(v)}`)] : [`${key}: []`])
    : [`${key}: ${JSON.stringify(String(value))}`];
  if (at !== -1) lines.splice(at, span, ...out);
  else lines.splice(end, 0, ...out);
  return bom + lines.join(eol);
}

/** Sets (`on`) or removes (`!on`) the line `key: true`. */
export const setFlag = (text, key, on) => setProp(text, key, on ? true : null);

/** Obsidian writes a checkbox as `true`; a few hand-written spellings are accepted too. */
export const isTrue = (v) => /^(true|yes|1)$/i.test(String(v ?? '').trim());
