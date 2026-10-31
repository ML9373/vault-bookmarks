import { parseFrontmatter, setFlag, isTrue } from './fm.js';
import { applyChange } from './note.js';
import { resolve } from './settings.js';

const DB = 'vault-bookmarks';
const STORE = 'kv';
const KEY = 'folder';
const SETTINGS_KEY = 'settings';
const RECENT_KEY = 'recent';
const VIEW_KEY = 'view';
const OPENS_KEY = 'opens';
const CACHE_KEY = 'index-cache';
const HEAD_BYTES = 4096;

function db() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const store = d.transaction(STORE, mode).objectStore(STORE);
    const req = fn(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const saveHandle = (handle) => tx('readwrite', (s) => s.put(handle, KEY));
export const loadHandle = () => tx('readonly', (s) => s.get(KEY));
export const saveSettings = (settings) => tx('readwrite', (s) => s.put(settings, SETTINGS_KEY));
export const loadSettings = async () => resolve(await tx('readonly', (s) => s.get(SETTINGS_KEY)).catch(() => null));
export const loadRecent = () => tx('readonly', (s) => s.get(RECENT_KEY)).then((v) => (Array.isArray(v) ? v : []), () => []);
export const saveRecent = (list) => tx('readwrite', (s) => s.put(list, RECENT_KEY));
export const loadView = () => tx('readonly', (s) => s.get(VIEW_KEY)).catch(() => null);
export const saveView = (view) => tx('readwrite', (s) => s.put(view, VIEW_KEY)).catch(() => {});
export const loadOpens = () => tx('readonly', (s) => s.get(OPENS_KEY)).then((v) => (v && typeof v === 'object' ? v : {}), () => ({}));
export const saveOpens = (opens) => tx('readwrite', (s) => s.put(opens, OPENS_KEY));
/** What was read from each note last time, so only a note whose size or date changed is read again. `signature` ties it to the settings it was built with. */
export const loadIndexCache = (signature) => tx('readonly', (s) => s.get(CACHE_KEY)).then((v) => new Map(v?.signature === signature ? v.entries : []), () => new Map());
export const saveIndexCache = (signature, cache) => tx('readwrite', (s) => s.put({ signature, entries: [...cache] }, CACHE_KEY)).catch(() => {});
export const permissionState = (handle) => handle.queryPermission({ mode: 'readwrite' });
export const requestPermission = (handle) => handle.requestPermission({ mode: 'readwrite' });

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()) : []);

const isMarked = (fm, s) => {
  const v = fm[s.markerProperty];
  return Array.isArray(v) ? v.includes(s.markerValue) : v === s.markerValue;
};

/** Only the frontmatter is parsed and only a marked note with an http(s) URL is kept: a note's body is never read into memory, and a note cannot make the popup open a file:, chrome: or javascript: address. */
export function toItem(fileName, text, s) {
  const fm = parseFrontmatter(text);
  if (!fm || !isMarked(fm, s) || !/^https?:\/\/\S+$/i.test(str(fm[s.urlProperty]))) return null;
  const marker = s.markerTag.toLowerCase();
  return {
    file: fileName,
    title: str(fm.title) || fileName.replace(/\.md$/, ''),
    url: str(fm[s.urlProperty]),
    category: s.categoryProperty ? str(fm[s.categoryProperty]) : '',
    description: s.descriptionProperty ? str(fm[s.descriptionProperty]) : '',
    status: (s.statusProperty && str(fm[s.statusProperty])) || 'Active',
    favorite: Boolean(s.favoriteProperty) && isTrue(fm[s.favoriteProperty]),
    groups: list(fm.tags).filter((t) => t.toLowerCase() !== marker && !(s.markerProperty === 'tags' && t === s.markerValue)),
    aliases: list(fm.aliases),
  };
}

async function readHead(file) {
  const head = await file.slice(0, HEAD_BYTES).text();
  const closed = /\n---[ \t]*(\r?\n|$)/.test(head.slice(3));
  return file.size > HEAD_BYTES && head.startsWith('---') && !closed ? file.text() : head;
}

/** The folder a note sits in, from the root of the chosen folder ('' for the root itself). */
export async function dirAt(root, folder) {
  let dir = root;
  for (const part of folder ? folder.split('/') : []) dir = await dir.getDirectoryHandle(part);
  return dir;
}

export const itemKey = (item) => (item.folder ? `${item.folder}/${item.file}` : item.file);

/**
 * The bookmark notes of the folder. Subfolders are read only when the settings say so (dot folders
 * never); a note that is not marked as a bookmark (a hub, say) is skipped. `cache` is optional: a Map
 * from path to what was read, kept up to date here, that spares the read of a note that did not change.
 */
export async function readIndex(root, settings, cache) {
  const deep = settings.subfolders === 'yes';
  const files = [];
  async function walk(dir, folder) {
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind === 'file' && name.endsWith('.md')) files.push({ folder, name, handle });
      else if (deep && handle.kind === 'directory' && !name.startsWith('.')) await walk(handle, folder ? `${folder}/${name}` : name);
    }
  }
  await walk(root, '');
  const seen = new Set();
  const items = [];
  for (let i = 0; i < files.length; i += 32) {
    const chunk = await Promise.all(files.slice(i, i + 32).map(async ({ folder, name, handle }) => {
      const key = folder ? `${folder}/${name}` : name;
      seen.add(key);
      const file = await handle.getFile();
      const hit = cache?.get(key);
      if (hit && hit.m === file.lastModified && hit.s === file.size) return hit.item;
      const item = toItem(name, await readHead(file), settings);
      if (item) {
        item.folder = folder;
        if (folder && !item.category) { item.category = folder.split('/')[0]; item.folderCategory = true; }
      }
      cache?.set(key, { m: file.lastModified, s: file.size, item });
      return item;
    }));
    items.push(...chunk.filter(Boolean));
  }
  if (cache) for (const key of [...cache.keys()]) if (!seen.has(key)) cache.delete(key);
  return items;
}

export async function noteExists(dir, fileName) {
  try { await dir.getFileHandle(fileName); return true; } catch (e) {
    if (e.name === 'NotFoundError') return false;
    throw e;
  }
}

/** Creates a note; never replaces one that exists. */
export async function writeNote(dir, fileName, content) {
  if (await noteExists(dir, fileName)) throw new Error(`"${fileName}" already exists`);
  const handle = await dir.getFileHandle(fileName, { create: true });
  const w = await handle.createWritable();
  await w.write(content);
  await w.close();
}

/** Re-reads the note from disk and refuses when it no longer holds the link the popup showed: an edit made in Obsidian since the popup opened is never overwritten. */
async function freshNote(root, item, settings) {
  const dir = await dirAt(root, item.folder || '');
  const handle = await dir.getFileHandle(item.file);
  const text = await (await handle.getFile()).text();
  if (toItem(item.file, text, settings)?.url !== item.url) throw new Error(`"${item.file}" changed on disk: reopen the popup`);
  return { dir, handle, text };
}

async function overwrite(handle, text) {
  const w = await handle.createWritable();
  await w.write(text);
  await w.close();
}

/**
 * Stars or unstars a note: the one line `<favoriteProperty>: true` is added or removed, the rest of
 * the file is written back unchanged.
 */
export async function setFavorite(root, item, settings, on) {
  const { handle, text } = await freshNote(root, item, settings);
  const next = setFlag(text, settings.favoriteProperty, on);
  if (next === null) throw new Error(`"${item.file}" has no properties block`);
  if (next !== text) await overwrite(handle, next);
}

/** Edits the properties named in `change` (see `applyChange`); the file keeps its name, so no link to it breaks. */
export async function updateNote(root, item, change, settings) {
  const { handle, text } = await freshNote(root, item, settings);
  const next = applyChange(text, change, settings);
  if (next === null) throw new Error(`"${item.file}" has no properties block`);
  if (next !== text) await overwrite(handle, next);
}

/** Deletes the note for good (the File System Access API has no trash), after the same check as an edit. */
export async function deleteNote(root, item, settings) {
  const { dir } = await freshNote(root, item, settings);
  await dir.removeEntry(item.file);
}

/** A vault root holds `.obsidian`: refusing it keeps the grant scoped to the bookmarks folder. */
export async function looksLikeVaultRoot(dir) {
  for await (const [name] of dir.entries()) if (name === '.obsidian') return true;
  return false;
}
