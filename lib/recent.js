// Links opened from the popup, newest first. Kept by the extension, never written to the notes.
import { urlKey } from './note.js';

export const RECENT_MAX = 50;

/** Puts the link on top; the same link opened again (tracking parameters aside) is not listed twice. */
export function recordOpen(list, url, at = Date.now()) {
  const key = urlKey(url);
  return [{ url, at }, ...(Array.isArray(list) ? list : []).filter((r) => urlKey(r.url) !== key)].slice(0, RECENT_MAX);
}

/** The notes behind the recent links, newest first; a link whose note is gone is skipped. */
export function recentItems(items, list) {
  const byKey = new Map(items.map((i) => [urlKey(i.url), i]));
  const out = [];
  for (const r of Array.isArray(list) ? list : []) {
    const item = byKey.get(urlKey(r.url));
    if (item && !out.includes(item)) out.push(item);
  }
  return out;
}

/** Categories for the grouped view, alphabetical, links without a category last. */
export function groupByCategory(items) {
  const byTitle = (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
  const groups = new Map();
  for (const i of items) groups.set(i.category, [...(groups.get(i.category) || []), i]);
  return [...groups.entries()]
    .sort(([a], [b]) => (!a) - (!b) || a.localeCompare(b, undefined, { sensitivity: 'base' }))
    .map(([name, links]) => ({ name, links: links.sort(byTitle) }));
}
