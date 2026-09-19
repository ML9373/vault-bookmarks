import { parseFrontmatter } from './fm.js';
import { resolve } from './settings.js';

const DB = 'vault-bookmarks';
const STORE = 'kv';
const KEY = 'folder';
const SETTINGS_KEY = 'settings';
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
    groups: list(fm.tags).filter((t) => t.toLowerCase() !== marker && !(s.markerProperty === 'tags' && t === s.markerValue)),
    aliases: list(fm.aliases),
  };
}

async function readHead(handle) {
  const file = await handle.getFile();
  const head = await file.slice(0, HEAD_BYTES).text();
  const closed = /\n---[ \t]*(\r?\n|$)/.test(head.slice(3));
  return file.size > HEAD_BYTES && head.startsWith('---') && !closed ? file.text() : head;
}

/** Top-level notes only: subfolders are ignored, and a note that is not marked as a bookmark (a hub, say) is skipped. */
export async function readIndex(dir, settings) {
  const entries = [];
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === 'file' && name.endsWith('.md')) entries.push([name, handle]);
  }
  const items = [];
  for (let i = 0; i < entries.length; i += 32) {
    const chunk = await Promise.all(entries.slice(i, i + 32).map(async ([name, h]) => toItem(name, await readHead(h), settings)));
    items.push(...chunk.filter(Boolean));
  }
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

/** A vault root holds `.obsidian`: refusing it keeps the grant scoped to the bookmarks folder. */
export async function looksLikeVaultRoot(dir) {
  for await (const [name] of dir.entries()) if (name === '.obsidian') return true;
  return false;
}
