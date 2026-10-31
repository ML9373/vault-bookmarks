// Saving a link without the form: used by the context menu, the "save every tab" button and the importer.
import { noteExists, writeNote, toItem } from './vault.js';
import { formatNote, sanitizeFilename, stripTitleCounter, truncateName, localDate, hostOf, suggestFor } from './note.js';

/** The first free name for a note: `Name`, then `Name 2`, `Name 3`... */
export async function freeName(dir, base) {
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? base : `${base} ${n}`;
    if (!(await noteExists(dir, `${candidate}.md`))) return candidate;
  }
}

/**
 * Saves one link as a new note, unless the folder already holds it. Category and tags default to what
 * the notes of the same site already use; pass them (even empty) to decide. The new note is added to
 * `items`, so a link repeated in one batch is saved once.
 */
export async function saveLink({ dir, settings, items, url, title = '', description = '', category, tags, date }) {
  if (!/^https?:\/\/\S+$/i.test(url)) return { status: 'invalid' };
  const { existing, category: cat, tag } = suggestFor(items, url);
  if (existing) return { status: 'exists', title: existing.title };
  const name = stripTitleCounter(title).trim() || hostOf(url);
  const fileTitle = await freeName(dir, truncateName(sanitizeFilename(name)) || hostOf(url));
  const content = formatNote({
    fileTitle, name, url, description,
    category: category ?? cat,
    tags: tags ?? (tag ? [tag] : []),
    date: date || localDate(),
  }, settings);
  await writeNote(dir, `${fileTitle}.md`, content);
  const item = toItem(`${fileTitle}.md`, content, settings);
  if (item) { item.folder = ''; items.push(item); }
  return { status: 'saved', title: fileTitle };
}
