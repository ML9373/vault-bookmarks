// Runs the real popup in a normal page: an OPFS directory stands in for the picked folder (same
// FileSystemDirectoryHandle API) and chrome.* calls are replaced through globalThis.__vbTest.
// Serve the repository root (`python3 -m http.server`) and open /test/harness.html.
import { saveHandle, saveSettings } from '../lib/vault.js';

const q = new URLSearchParams(location.search);
const root_url = new URL('../', import.meta.url).href;
const base = q.get('fixtures') || new URL('fixtures/', import.meta.url).href;

const root = await navigator.storage.getDirectory();
try { await root.removeEntry('bookmarks', { recursive: true }); } catch {}
const dir = await root.getDirectoryHandle('bookmarks', { create: true });
const names = await (await fetch(`${base}index.json`)).json();
for (const name of names) {
  const text = await (await fetch(base + encodeURIComponent(name))).text();
  const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
  await w.write(text);
  await w.close();
}
const sub = await dir.getDirectoryHandle('export', { create: true });
const w = await (await sub.getFileHandle('Bookmarks.md', { create: true })).createWritable();
await w.write('---\ntype: bookmark\nURL: https://must-not-be-indexed.example/\n---\n');
await w.close();
if (q.has('nohandle')) await new Promise((res) => { const r = indexedDB.deleteDatabase('vault-bookmarks'); r.onsuccess = r.onerror = r.onblocked = res; });
else await saveHandle(dir);

if (q.has('settings')) await saveSettings(JSON.parse(q.get('settings')));

window.__dir = dir;
window.__opened = [];
window.__vbTest = {
  getActiveTab: async () => ({ title: q.get('title') || 'Guide: New page | Example Docs', url: q.get('url') || 'https://docs.example.com/guide/new/page' }),
  openUrl: (url, active) => { window.__opened.push({ url, active }); },
  setupUrl: `${root_url}setup.html`,
  faviconUrl: (u) => (new URL(u).hostname.endsWith('example.com') ? `${root_url}icons/icon32.png` : `/missing/${new URL(u).hostname}.png`),
};

const html = await (await fetch(`${root_url}popup.html`)).text();
document.open();
document.write(html.replace('<head>', `<head><base href="${root_url}">`));
document.close();

if (q.get('view') === 'save') {
  while (document.getElementById('view-find')?.hidden !== false) await new Promise((r) => setTimeout(r, 50));
  document.getElementById('tab-save').click();
}
