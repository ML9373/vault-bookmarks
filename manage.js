import { loadHandle, loadSettings, permissionState, requestPermission, readIndex, updateNote, itemKey } from './lib/vault.js';
import { checkLink, pool } from './lib/linkcheck.js';
import { flattenBookmarks, foldersOf } from './lib/importer.js';
import { saveLink } from './lib/quicksave.js';
import { localDate, hostOf, urlKey } from './lib/note.js';
import { exportBookmarksHtml } from './lib/exporter.js';
import { msg, plural, localize } from './lib/i18n.js';
import { requestOrigins, requestBookmarks, getBookmarkTree } from './lib/platform.js';

const $ = (id) => document.getElementById(id);
const say = (id, text, cls = '') => { $(id).textContent = text; $(id).className = cls; };
const state = { dir: null, settings: null, items: [], found: [], stop: false };

async function boot() {
  localize();
  const dir = await loadHandle().catch(() => null);
  if (!dir) return say('state', msg('mNoFolder'), 'error');
  state.dir = dir;
  state.settings = await loadSettings();
  if ((await permissionState(dir)) !== 'granted') {
    $('allow').hidden = false;
    return say('state', msg('msgAllow'));
  }
  await ready();
}

async function ready() {
  $('allow').hidden = true;
  state.items = await readIndex(state.dir, state.settings);
  say('state', msg('mNotes', state.items.length, state.dir.name));
  $('tools').hidden = false;
  $('check-off').hidden = Boolean(state.settings.statusProperty);
  $('check-start').disabled = !state.settings.statusProperty;
}

$('allow').addEventListener('click', async () => {
  if ((await requestPermission(state.dir)) === 'granted') await ready();
  else say('state', msg('mDenied'), 'error');
});

// ---- check links -------------------------------------------------------------------------

function resultRow(list, item, detail, checked) {
  const li = document.createElement('li');
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = checked;
  const text = document.createElement('div');
  text.style.minWidth = 0;
  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = item.title;
  const sub = document.createElement('div');
  sub.className = 'sub';
  sub.textContent = `${hostOf(item.url)} · ${itemKey(item)}`;
  text.append(title, sub);
  const tag = document.createElement('span');
  tag.className = 'tag';
  tag.textContent = detail === 'no answer' ? msg('detailNoAnswer') : detail;
  li.append(box, text, tag);
  li.item = item;
  list.append(li);
}

async function startCheck() {
  say('check-status', '');
  if (!navigator.onLine) return say('check-status', msg('offlineNow'), 'error');
  if (!(await requestOrigins())) return say('check-status', msg('errOrigins'), 'error');
  state.stop = false;
  state.found = [];
  $('check-start').hidden = true;
  $('check-stop').hidden = false;
  $('check-bar').hidden = false;
  $('check-results').hidden = true;
  const items = [...state.items];
  let done = 0;
  await pool(items, 6, async (item) => {
    const r = await checkLink(item.url);
    state.found.push({ item, ...r });
    $('check-progress').textContent = msg('checkProgress', ++done, items.length);
    $('check-bar').firstElementChild.style.width = `${(done / items.length) * 100}%`;
  }, () => state.stop);
  $('check-start').hidden = false;
  $('check-stop').hidden = true;
  const dead = (i) => i.status === 'Dead';
  const broken = state.found.filter((f) => f.verdict === 'broken' && !dead(f.item));
  const back = state.found.filter((f) => f.verdict === 'ok' && dead(f.item));
  const checked = state.found.length;
  // Nearly every site silent at once means the network is down, not that the links are dead.
  const offline = checked >= 10 && state.found.filter((f) => f.detail === 'no answer').length > checked * 0.8;
  $('broken').replaceChildren();
  $('back').replaceChildren();
  for (const f of broken) resultRow($('broken'), f.item, f.detail, !offline);
  for (const f of back) resultRow($('back'), f.item, f.detail, true);
  $('broken-title').textContent = plural(broken.length, 'brokenOne', 'brokenMany');
  $('back-title').textContent = plural(back.length, 'backOne', 'backMany');
  $('mark-dead').hidden = $('broken').hidden = !broken.length;
  $('mark-active').hidden = $('back').hidden = !back.length;
  $('check-results').hidden = false;
  const unknown = state.found.filter((f) => f.verdict === 'unknown').length;
  say('check-status', [msg(state.stop ? 'checkStopped' : 'checkDone', checked), unknown ? msg('checkUnknown', unknown) : '', offline ? msg('checkOfflineHint') : ''].filter(Boolean).join(' '));
}

async function apply(listId, status, button) {
  const rows = [...$(listId).children].filter((li) => li.firstElementChild.checked);
  $(button).disabled = true;
  let done = 0;
  let failed = 0;
  for (const li of rows) {
    try { await updateNote(state.dir, li.item, { status }, state.settings); li.remove(); done++; } catch { failed++; }
  }
  $(button).disabled = false;
  state.items = await readIndex(state.dir, state.settings);
  say('check-status', [msg('applied', plural(done, 'linkOne', 'linkMany'), status), failed ? msg('appliedFailed', failed) : ''].filter(Boolean).join(' '));
}

$('check-start').addEventListener('click', startCheck);
$('check-stop').addEventListener('click', () => { state.stop = true; });
$('mark-dead').addEventListener('click', () => apply('broken', 'Dead', 'mark-dead'));
$('mark-active').addEventListener('click', () => apply('back', 'Active', 'mark-active'));

// ---- import ------------------------------------------------------------------------------

let links = [];

function selected() {
  const folders = new Set([...$('import-folders').children].filter((li) => li.firstElementChild.checked).map((li) => li.dataset.folder));
  const seen = new Set(state.items.map((i) => urlKey(i.url)));
  return links.filter((l) => folders.has(l.folder) && !seen.has(urlKey(l.url)) && seen.add(urlKey(l.url)));
}

function refreshCount() {
  const n = selected().length;
  $('import-go').textContent = plural(n, 'importGoOne', 'importGoMany');
  $('import-go').disabled = n === 0;
}

$('import-read').addEventListener('click', async () => {
  say('import-status', '');
  if (!(await requestBookmarks())) return say('import-status', msg('errBookmarksPerm'), 'error');
  links = flattenBookmarks(await getBookmarkTree());
  $('import-folders').replaceChildren(...foldersOf(links).map(([folder, n]) => {
    const li = document.createElement('li');
    li.dataset.folder = folder;
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = true;
    box.addEventListener('change', refreshCount);
    const name = document.createElement('div');
    name.textContent = folder || msg('importTop');
    const count = document.createElement('span');
    count.className = 'tag';
    count.textContent = String(n);
    li.append(box, name, count);
    return li;
  }));
  $('import-box').hidden = false;
  refreshCount();
  say('import-status', msg('importFound', links.length));
});

$('import-go').addEventListener('click', async () => {
  const todo = selected();
  const useFolder = $('import-category').checked;
  const keepDate = $('import-date').checked;
  $('import-go').disabled = true;
  let saved = 0;
  let failed = 0;
  for (const l of todo) {
    try {
      const r = await saveLink({
        dir: state.dir, settings: state.settings, items: state.items, url: l.url, title: l.title,
        category: useFolder ? l.category : '', tags: [],
        date: keepDate && l.added ? localDate(new Date(l.added)) : undefined,
      });
      if (r.status === 'saved') saved++;
    } catch { failed++; }
    say('import-status', msg('importProgress', saved + failed, todo.length));
  }
  state.items = await readIndex(state.dir, state.settings);
  say('import-status', [plural(saved, 'importDoneOne', 'importDoneMany'), failed ? msg('importFailed', failed) : ''].filter(Boolean).join(' '));
  refreshCount();
});

// ---- export ------------------------------------------------------------------------------

$('export-go').addEventListener('click', () => {
  const includeDead = $('export-dead').checked;
  const html = exportBookmarksHtml(state.items, { includeDead });
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: 'bookmarks.html' });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  say('export-status', msg('exportDone', state.items.filter((i) => includeDead || i.status !== 'Dead').length));
});

boot().catch((e) => say('state', msg('mStartErr', e.message), 'error'));
