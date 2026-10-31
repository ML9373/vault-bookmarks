// The notes as a Netscape bookmarks file, the format every browser imports.

const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const link = (i) => `<DT><A HREF="${esc(i.url)}"${i.groups.length ? ` TAGS="${esc(i.groups.join(','))}"` : ''}>${esc(i.title)}</A>`;

/** One folder per category, links without a category at the top level; Dead links only when asked. */
export function exportBookmarksHtml(items, { includeDead = false } = {}) {
  const kept = items.filter((i) => includeDead || i.status !== 'Dead');
  const byCategory = new Map();
  for (const i of kept) byCategory.set(i.category, [...(byCategory.get(i.category) || []), i]);
  const out = ['<!DOCTYPE NETSCAPE-Bookmark-file-1>', '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">', '<TITLE>Bookmarks</TITLE>', '<H1>Bookmarks</H1>', '<DL><p>'];
  for (const [name, links] of [...byCategory.entries()].filter(([n]) => n).sort(([a], [b]) => a.localeCompare(b))) {
    out.push(`    <DT><H3>${esc(name)}</H3>`, '    <DL><p>', ...links.map((i) => `        ${link(i)}`), '    </DL><p>');
  }
  out.push(...(byCategory.get('') || []).map((i) => `    ${link(i)}`), '</DL><p>', '');
  return out.join('\n');
}
