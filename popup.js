import { loadHandle, loadSettings, permissionState, readIndex, noteExists, writeNote, setFavorite, updateNote, deleteNote, restoreNote, itemKey, loadRecent, saveRecent, loadOpens, saveOpens, loadView, saveView, loadIndexCache, saveIndexCache } from './lib/vault.js';
import { recordOpen, recentItems, groupByCategory, bumpOpen, topItems, opensOf } from './lib/recent.js';
import { search } from './lib/search.js';
import { formatNote, sanitizeTag, sanitizeFilename, stripTitleCounter, truncateName, localDate, hostOf, urlKey, suggestFor, tagForCategory, tagsByUse, findDuplicates } from './lib/note.js';
import { msg, plural, localize } from './lib/i18n.js';
import { tagPicker } from './lib/tagpicker.js';
import { saveLink } from './lib/quicksave.js';
import { getActiveTab, getWindowTabs, getPageDescription, openUrl, openSetup, openManage, faviconUrl, closeSelf } from './lib/platform.js';

const $ = (id) => document.getElementById(id);
const MAX_ROWS = 60;
const URL_OK = /^https?:\/\/\S+$/i;

const state = { dir: null, settings: null, items: [], dupes: 0, group: '', rows: [], active: 0, tab: null, view: 'all', recent: [], opens: {}, open: new Set(), armed: null, select: false, picked: new Set(), editing: null, cache: null, sig: '', tabs: [] };
let saveTags;
let editTags;
let armTimer;
let undoTimer;
let undoList = [];

// ---- views -------------------------------------------------------------------------------

function show(view) {
  $('count').hidden = view !== 'find';
  for (const v of ['message', 'find', 'save', 'edit']) $(`view-${v}`).hidden = v !== view;
  $('tab-find').setAttribute('aria-selected', String(view === 'find'));
  $('tab-save').setAttribute('aria-selected', String(view === 'save'));
}

function message(text, actionLabel, action) {
  $('message-text').textContent = text;
  $('message-action').textContent = actionLabel;
  $('message-action').onclick = action;
  show('message');
}

/** Reads the folder again (only the notes that changed are read from disk) and redraws. */
async function reload() {
  state.items = await readIndex(state.dir, state.settings, state.cache);
  saveIndexCache(state.sig, state.cache);
  state.dupes = findDuplicates(state.items).length;
  buildGroupFilter();
}

function disarm() {
  clearTimeout(armTimer);
  state.armed = null;
}

// ---- find --------------------------------------------------------------------------------

function icon(url) {
  const img = document.createElement('img');
  img.className = 'favicon';
  img.alt = '';
  img.width = img.height = 20;
  img.src = faviconUrl(url);
  img.addEventListener('error', () => {
    const av = document.createElement('div');
    av.className = 'avatar';
    av.textContent = (hostOf(url) || '?')[0];
    img.replaceWith(av);
  });
  return img;
}

function buildGroupFilter() {
  const select = $('group-filter');
  const tags = tagsByUse(state.items).sort((a, b) => a.localeCompare(b));
  select.replaceChildren(new Option('All tags', ''), ...tags.map((t) => new Option(t, t)));
  select.value = tags.includes(state.group) ? state.group : '';
  state.group = select.value;
  select.hidden = tags.length === 0;
  $('tags-all').replaceChildren(...tags.map((t) => Object.assign(document.createElement('option'), { value: t })));
}

const EMPTY = { recent: 'emptyRecent', favorites: 'emptyFavorites', top: 'emptyTop', duplicates: 'emptyDuplicates' };

/** Rows on screen: links, or in the All view with no search, one collapsible row per category. */
function buildRows() {
  const q = $('q').value.trim();
  const pool = state.group ? state.items.filter((i) => i.groups.includes(state.group)) : state.items;
  const link = (item, nested = false) => ({ kind: 'link', item, nested });
  if (state.view === 'recent') {
    const recent = recentItems(pool, state.recent);
    const found = q ? search(recent, q) : recent;
    return { rows: found.map((i) => link(i)), total: found.length };
  }
  if (state.view === 'top') {
    const top = topItems(pool, state.opens);
    const found = q ? search(top, q) : top;
    return { rows: found.map((i) => link(i)), total: found.length };
  }
  if (state.view === 'favorites') {
    const found = search(pool.filter((i) => i.favorite), q);
    return { rows: found.map((i) => link(i)), total: found.length };
  }
  if (state.view === 'duplicates') {
    const rows = [];
    let total = 0;
    for (const g of findDuplicates(pool)) {
      const links = q ? search(g.links, q) : g.links;
      if (!links.length) continue;
      total += links.length;
      rows.push({ kind: 'group', name: g.key, count: links.length, open: true, fixed: true });
      rows.push(...links.map((i) => link(i, true)));
    }
    return { rows, total };
  }
  if (q) {
    const found = search(pool, q);
    return { rows: found.slice(0, MAX_ROWS).map((i) => link(i)), total: found.length, capped: found.length > MAX_ROWS };
  }
  const rows = [];
  for (const g of groupByCategory(pool)) {
    const open = state.open.has(g.name);
    rows.push({ kind: 'group', name: g.name, count: g.links.length, open });
    if (open) rows.push(...g.links.map((i) => link(i, true)));
  }
  return { rows, total: pool.length };
}

function actButton(action, text, label) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `act ${action}`;
  b.dataset.action = action;
  b.tabIndex = -1;
  b.textContent = text;
  b.setAttribute('aria-label', label);
  b.title = label;
  return b;
}

function linkRow(item, nested) {
  const li = document.createElement('li');
  li.className = nested ? 'link nested' : 'link';
  if (item.status === 'Dead') li.classList.add('dead');
  const armed = state.armed === itemKey(item);
  if (armed) li.classList.add('armed');
  const text = document.createElement('div');
  text.className = 'row-text';
  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = item.title;
  const sub = document.createElement('div');
  sub.className = 'sub';
  const dupView = state.view === 'duplicates';
  sub.textContent = [hostOf(item.url), nested && !dupView ? '' : item.category, dupView ? itemKey(item) : '', item.description].filter(Boolean).join(' · ');
  text.append(title, sub);
  const badge = document.createElement('span');
  badge.className = 'badge';
  const label = state.view === 'top' ? `${opensOf(item, state.opens)}×` : item.groups[0] || '';
  badge.textContent = label;
  badge.hidden = !label;
  const acts = document.createElement('span');
  acts.className = 'acts';
  if (state.settings.favoriteProperty) {
    const star = actButton('star', item.favorite ? '★' : '☆', msg(item.favorite ? 'actRemoveFav' : 'actAddFav'));
    star.setAttribute('aria-pressed', String(item.favorite));
    acts.append(star);
  }
  acts.append(actButton('edit', '✎', msg('actEdit')));
  const del = actButton('del', armed ? msg('deleteArmed') : '✕', msg(armed ? 'deleteArmedLabel' : 'actDelete'));
  if (armed) del.classList.add('armed');
  acts.append(del);
  if (state.select) {
    li.classList.add('picking');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'pick';
    box.checked = state.picked.has(itemKey(item));
    box.tabIndex = -1;
    li.append(box, icon(item.url), text, badge);
    return li;
  }
  li.append(icon(item.url), text, badge, acts);
  return li;
}

function groupRow(row) {
  const li = document.createElement('li');
  li.className = 'group';
  li.setAttribute('aria-expanded', String(row.open));
  const chev = document.createElement('span');
  chev.className = 'chev';
  chev.textContent = '▶';
  chev.setAttribute('aria-hidden', 'true');
  const name = document.createElement('span');
  name.className = 'title';
  name.textContent = row.name || msg('noCategory');
  const n = document.createElement('span');
  n.className = 'n';
  n.textContent = String(row.count);
  li.append(chev, name, n);
  return li;
}

function renderResults() {
  const list = $('results');
  const { rows, total, capped } = buildRows();
  state.rows = rows;
  state.active = Math.min(state.active, Math.max(0, rows.length - 1));
  list.replaceChildren(...rows.map((row, i) => {
    const li = row.kind === 'group' ? groupRow(row) : linkRow(row.item, row.nested);
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', String(i === state.active));
    li.dataset.index = String(i);
    return li;
  }));
  for (const b of document.querySelectorAll('.seg [data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === state.view));
  const dupes = $('dupes');
  dupes.hidden = state.dupes === 0 && state.view !== 'duplicates';
  dupes.textContent = state.view === 'duplicates' ? msg('dupesBack') : plural(state.dupes, 'dupesOne', 'dupesMany');
  dupes.setAttribute('aria-pressed', String(state.view === 'duplicates'));
  const filtered = $('q').value.trim() || state.group;
  $('empty').textContent = msg(!filtered && EMPTY[state.view] ? EMPTY[state.view] : 'noMatch');
  $('empty').hidden = rows.length > 0;
  $('count').textContent = capped ? msg('countCapped', MAX_ROWS, total) : plural(total, 'linkOne', 'linkMany');
}

function setActive(i) {
  const rows = [...$('results').children];
  if (!rows.length) return;
  state.active = (i + rows.length) % rows.length;
  rows.forEach((r, j) => r.setAttribute('aria-selected', String(j === state.active)));
  rows[state.active].scrollIntoView({ block: 'nearest' });
}

function toggleGroup(index, open) {
  const row = state.rows[index];
  if (row?.kind !== 'group' || row.fixed) return;
  const next = open ?? !row.open;
  if (next) state.open.add(row.name); else state.open.delete(row.name);
  state.active = index;
  renderResults();
  setActive(index);
}

async function openResult(index, background) {
  const row = state.rows[index];
  if (!row) return;
  if (row.kind === 'group') return toggleGroup(index);
  state.recent = recordOpen(state.recent, row.item.url);
  state.opens = bumpOpen(state.opens, row.item.url);
  await Promise.all([saveRecent(state.recent), saveOpens(state.opens)]).catch(() => {});
  await openUrl(row.item.url, !background);
  if (!background) closeSelf();
}

function findError(text) {
  $('find-error').textContent = text;
  $('find-error').hidden = !text;
}

async function toggleFavorite(index) {
  const item = state.rows[index]?.item;
  if (!item) return;
  findError('');
  try {
    await setFavorite(state.dir, item, state.settings, !item.favorite);
    item.favorite = !item.favorite;
  } catch (err) {
    findError(msg('errUpdate', item.title, err.message));
  }
  state.active = index;
  renderResults();
}

/** The first click arms the button, the second one deletes: the note is gone for good, there is no trash. */
async function askDelete(index) {
  const item = state.rows[index]?.item;
  if (!item) return;
  findError('');
  state.active = index;
  if (state.armed !== itemKey(item)) {
    disarm();
    state.armed = itemKey(item);
    armTimer = setTimeout(() => { disarm(); renderResults(); }, 4000);
    return renderResults();
  }
  disarm();
  await removeItem(item);
}

async function removeItem(item) {
  try {
    const text = await deleteNote(state.dir, item, state.settings);
    await reload();
    showUndo([{ item, text }]);
    return true;
  } catch (err) {
    findError(msg('errDelete', item.title, err.message));
    return false;
  } finally {
    renderResults();
  }
}

function setView(view) {
  disarm();
  state.view = view;
  state.active = 0;
  saveView(view === 'duplicates' ? 'all' : view);
  renderResults();
  $('q').focus();
}

function bindFind() {
  $('q').addEventListener('input', () => { disarm(); state.active = 0; renderResults(); });
  $('q').addEventListener('keydown', (e) => {
    const row = state.rows[state.active];
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(state.active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(state.active - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); openResult(state.active, e.metaKey || e.ctrlKey); }
    else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e' && row?.kind === 'link') { e.preventDefault(); openEdit(row.item); }
    else if (row?.kind === 'group' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) { e.preventDefault(); toggleGroup(state.active, e.key === 'ArrowRight'); }
  });
  $('results').addEventListener('click', (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    const index = Number(li.dataset.index);
    if (state.select) {
      const row = state.rows[index];
      if (row.kind === 'group') return toggleGroup(index);
      const key = itemKey(row.item);
      if (state.picked.has(key)) state.picked.delete(key); else state.picked.add(key);
      li.querySelector('.pick').checked = state.picked.has(key);
      return updateBulk();
    }
    const action = e.target.closest('.act')?.dataset.action;
    if (action === 'star') toggleFavorite(index);
    else if (action === 'edit') openEdit(state.rows[index].item);
    else if (action === 'del') askDelete(index);
    else { disarm(); openResult(index, e.metaKey || e.ctrlKey); }
  });
  for (const b of document.querySelectorAll('.seg [data-view]')) b.addEventListener('click', () => setView(b.dataset.view));
  $('dupes').addEventListener('click', () => setView(state.view === 'duplicates' ? 'all' : 'duplicates'));
  $('group-filter').addEventListener('change', () => {
    state.group = $('group-filter').value;
    state.active = 0;
    renderResults();
    $('q').focus();
  });
}

// ---- undo, select -----------------------------------------------------------------------

function toast(text, undoable) {
  clearTimeout(undoTimer);
  $('toast-text').textContent = text;
  $('toast-undo').hidden = !undoable;
  $('toast').hidden = false;
  undoTimer = setTimeout(hideToast, undoable ? 10000 : 3000);
}

function hideToast() {
  clearTimeout(undoTimer);
  undoList = [];
  $('toast').hidden = true;
}

/** A deleted note can be put back for ten seconds: its text is kept here, nowhere else. */
function showUndo(list) {
  undoList = list;
  toast(list.length === 1 ? msg('toastDeleted', list[0].item.title) : msg('toastDeletedMany', list.length), true);
}

async function undoDelete() {
  const list = undoList;
  hideToast();
  let failed = '';
  for (const { item, text } of list) {
    try { await restoreNote(state.dir, item, text); } catch (err) { failed = err.message; }
  }
  await reload();
  renderResults();
  if (failed) findError(msg('errRestore', failed)); else toast(msg('toastRestored'), false);
}

function armBulkDelete(on) {
  $('bulk-delete').classList.toggle('armed', on);
  $('bulk-delete').textContent = on ? msg('bulkDeleteArmed', state.picked.size) : msg('bulkDelete');
}

function updateBulk() {
  const links = state.rows.filter((r) => r.kind === 'link');
  $('bulk-count').textContent = msg('selectedN', state.picked.size);
  $('bulk-all').checked = links.length > 0 && links.every((r) => state.picked.has(itemKey(r.item)));
  for (const id of ['bulk-add-tag', 'bulk-set-cat', 'bulk-delete']) $(id).disabled = state.picked.size === 0;
  armBulkDelete(false);
}

function setSelect(on) {
  state.select = on;
  state.picked.clear();
  disarm();
  $('bulk').hidden = !on;
  $('select-toggle').textContent = msg(on ? 'selectDone' : 'selectToggle');
  $('select-toggle').setAttribute('aria-pressed', String(on));
  renderResults();
  updateBulk();
}

const pickedItems = () => state.items.filter((i) => state.picked.has(itemKey(i)));

async function bulkUpdate(change) {
  const items = pickedItems();
  if (!items.length) return;
  findError('');
  let ok = 0;
  let failed = 0;
  for (const item of items) {
    try { await updateNote(state.dir, item, change(item), state.settings); ok++; } catch { failed++; }
  }
  await reload();
  state.picked.clear();
  renderResults();
  updateBulk();
  toast(`${msg('bulkUpdated', ok)}${failed ? ` ${msg('bulkFailed', failed)}` : ''}`, false);
}

async function bulkDelete() {
  if (!$('bulk-delete').classList.contains('armed')) return armBulkDelete(true);
  findError('');
  const done = [];
  let failed = 0;
  for (const item of pickedItems()) {
    try { done.push({ item, text: await deleteNote(state.dir, item, state.settings) }); } catch { failed++; }
  }
  await reload();
  state.picked.clear();
  renderResults();
  updateBulk();
  if (done.length) showUndo(done);
  if (failed) findError(msg('bulkFailed', failed));
}

function bindSelect() {
  $('select-toggle').addEventListener('click', () => setSelect(!state.select));
  $('toast-undo').addEventListener('click', undoDelete);
  $('bulk-all').addEventListener('change', () => {
    for (const r of state.rows.filter((x) => x.kind === 'link')) {
      if ($('bulk-all').checked) state.picked.add(itemKey(r.item)); else state.picked.delete(itemKey(r.item));
    }
    renderResults();
    updateBulk();
  });
  $('bulk-add-tag').addEventListener('click', () => {
    const tag = sanitizeTag($('bulk-tag').value);
    if (!tag) return findError(msg('errTagBad'));
    $('bulk-tag').value = '';
    return bulkUpdate((item) => ({ tags: [...new Set([...item.groups, tag])] }));
  });
  $('bulk-set-cat').addEventListener('click', () => {
    const category = $('bulk-cat').value.trim();
    if (!category) return undefined;
    $('bulk-cat').value = '';
    return bulkUpdate(() => ({ category }));
  });
  $('bulk-delete').addEventListener('click', bulkDelete);
}

// ---- edit --------------------------------------------------------------------------------

const showEditError = (text) => { $('edit-error').textContent = text; $('edit-error').hidden = !text; };

function armEditDelete(on) {
  $('edit-delete').classList.toggle('armed', on);
  $('edit-delete').textContent = msg(on ? 'deleteArmed' : 'delete');
}

function buildCategoryList() {
  const cats = [...new Set(state.items.map((i) => i.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  $('categories').replaceChildren(...cats.map((c) => Object.assign(document.createElement('option'), { value: c })));
}

function openEdit(item) {
  const s = state.settings;
  state.editing = item;
  buildCategoryList();
  $('edit-file').textContent = msg('editFile', itemKey(item));
  $('e-title').value = item.title;
  $('e-url').value = item.url;
  $('e-field-category').hidden = !s.categoryProperty;
  $('e-category').value = item.folderCategory ? '' : item.category;
  $('e-field-description').hidden = !s.descriptionProperty;
  $('e-description').value = item.description;
  $('e-field-status').hidden = !s.statusProperty;
  $('e-status').replaceChildren(...[...new Set(['Active', 'Dead', item.status])].map((v) => new Option(v, v)));
  $('e-status').value = item.status;
  editTags.suggest(tagsByUse(state.items));
  editTags.set(item.groups);
  showEditError('');
  armEditDelete(false);
  $('edit-save').disabled = false;
  show('edit');
  $('e-title').select();
}

function closeEdit() {
  state.editing = null;
  show('find');
  $('q').focus();
}

function bindEdit() {
  $('edit-cancel').addEventListener('click', closeEdit);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.editing) closeEdit(); });
  $('edit-delete').addEventListener('click', async () => {
    const item = state.editing;
    if (!item) return;
    if (!$('edit-delete').classList.contains('armed')) return armEditDelete(true);
    $('edit-delete').disabled = true;
    await removeItem(item);
    $('edit-delete').disabled = false;
    armEditDelete(false);
    closeEdit();
  });
  for (const id of ['e-title', 'e-url', 'e-category', 'e-description']) $(id).addEventListener('input', () => armEditDelete(false));
  $('edit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const item = state.editing;
    if (!item) return;
    showEditError('');
    const title = $('e-title').value.trim();
    const url = $('e-url').value.trim();
    if (!title) return showEditError(msg('errTitleEmpty'));
    if (!URL_OK.test(url)) return showEditError(msg('errUrlBad'));
    if (!editTags.commit()) return showEditError(msg('errTagBad'));
    if (urlKey(url) !== urlKey(item.url) && state.items.some((i) => i !== item && urlKey(i.url) === urlKey(url))) return showEditError(msg('errUrlDup'));
    const s = state.settings;
    const change = {};
    if (title !== item.title) change.title = title;
    if (url !== item.url) change.url = url;
    if (s.categoryProperty && $('e-category').value.trim() !== (item.folderCategory ? '' : item.category)) change.category = $('e-category').value.trim();
    if (s.descriptionProperty && $('e-description').value.trim() !== item.description) change.description = $('e-description').value.trim();
    if (s.statusProperty && $('e-status').value !== item.status) change.status = $('e-status').value;
    const tags = editTags.get();
    if (tags.join('\n') !== item.groups.join('\n')) change.tags = tags;
    if (!Object.keys(change).length) return closeEdit();
    $('edit-save').disabled = true;
    try {
      await updateNote(state.dir, item, change, s);
      await reload();
      closeEdit();
      renderResults();
    } catch (err) {
      $('edit-save').disabled = false;
      showEditError(msg('errEditWrite', err.message));
    }
  });
}

// ---- save --------------------------------------------------------------------------------

function showSaveError(text) {
  $('save-error').textContent = text;
  $('save-error').hidden = !text;
}

let prepareToken = 0;

function prepareSave() {
  const token = ++prepareToken;
  const tab = state.tab;
  const url = tab?.url || '';
  const ok = URL_OK.test(url);
  $('field-category').hidden = !state.settings.categoryProperty;
  $('field-description').hidden = !state.settings.descriptionProperty;
  $('save-page-title').textContent = tab?.title || hostOf(url) || msg('noPage');
  $('save-page-url').textContent = url;
  $('save-button').disabled = !ok;
  showSaveError(ok ? '' : msg('errNotSavable'));
  prepareSaveAll();
  if (!ok) return;
  $('save-icon').replaceChildren(icon(url));
  buildCategoryList();
  saveTags.suggest(tagsByUse(state.items));
  const { existing, category, tag } = suggestFor(state.items, url);
  $('save-existing').hidden = !existing;
  if (existing) $('save-existing').textContent = existing.category ? msg('alreadySavedIn', existing.title, existing.category) : msg('alreadySaved', existing.title);
  $('save-button').disabled = Boolean(existing);
  $('save-button').textContent = msg('saveToFolder', state.dir.name);
  $('f-name').value = truncateName(sanitizeFilename(stripTitleCounter(tab.title) || hostOf(url))) || hostOf(url);
  $('f-category').value = state.settings.categoryProperty ? category : '';
  const wanted = category ? tagForCategory(state.items, category, tag) : tag;
  saveTags.set(wanted ? [wanted] : []);
  $('f-description').value = '';
  if (state.settings.descriptionProperty && !existing) {
    getPageDescription(tab).then((d) => { if (d && token === prepareToken && !$('f-description').value) $('f-description').value = d; });
  }
}

/** Every http(s) tab of the window that is not saved yet, the current one included. */
async function prepareSaveAll() {
  const btn = $('save-all');
  btn.hidden = true;
  $('save-all-note').hidden = true;
  let tabs = [];
  try { tabs = await getWindowTabs(); } catch { return; }
  const seen = new Set(state.items.map((i) => urlKey(i.url)));
  state.tabs = tabs.filter((t) => URL_OK.test(t.url || '') && !seen.has(urlKey(t.url)) && seen.add(urlKey(t.url)));
  btn.dataset.armed = '';
  btn.textContent = msg('saveAllN', state.tabs.length);
  btn.hidden = state.tabs.length < 2;
}

async function saveAllTabs() {
  const btn = $('save-all');
  if (btn.dataset.armed !== 'yes') {
    btn.dataset.armed = 'yes';
    btn.textContent = msg('saveAllConfirm', state.tabs.length);
    $('save-all-note').textContent = msg('saveAllHint');
    $('save-all-note').hidden = false;
    return;
  }
  btn.disabled = true;
  let saved = 0;
  let failed = 0;
  for (const tab of state.tabs) {
    try {
      const r = await saveLink({ dir: state.dir, settings: state.settings, items: state.items, url: tab.url, title: tab.title });
      if (r.status === 'saved') saved++;
    } catch { failed++; }
  }
  btn.disabled = false;
  await reload();
  prepareSave();
  $('save-all-note').textContent = `${plural(saved, 'savedOne', 'savedMany')}${failed ? `, ${msg('failedN', failed)}` : ''}.`;
  $('save-all-note').hidden = false;
}

function bindSave() {
  $('f-category').addEventListener('change', () => {
    const c = $('f-category').value.trim();
    if (!c || !state.items.some((i) => i.category === c)) return;
    const t = tagForCategory(state.items, c, '');
    if (t && !saveTags.get().includes(t)) saveTags.set([...saveTags.get(), t]);
  });
  $('save-all').addEventListener('click', saveAllTabs);
  $('save-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    showSaveError('');
    const url = state.tab?.url || '';
    const name = $('f-name').value.trim();
    const fileTitle = truncateName(sanitizeFilename(name));
    if (!fileTitle) return showSaveError(msg('errNameEmpty'));
    if (!saveTags.commit()) return showSaveError(msg('errTagBad'));
    const clash = state.items.some((i) => !i.folder && i.file.toLowerCase() === `${fileTitle}.md`.toLowerCase()) || (await noteExists(state.dir, `${fileTitle}.md`));
    if (clash) return showSaveError(msg('errNameClash', fileTitle));
    $('save-button').disabled = true;
    try {
      const content = formatNote({ fileTitle, name, url, category: $('f-category').value.trim(), tags: saveTags.get(), description: $('f-description').value.trim(), date: localDate() }, state.settings);
      await writeNote(state.dir, `${fileTitle}.md`, content);
      await reload();
      prepareSave();
      $('save-existing').hidden = false;
      $('save-existing').textContent = msg('savedAs', fileTitle);
      $('save-button').disabled = true;
    } catch (err) {
      $('save-button').disabled = false;
      showSaveError(msg('errWrite', err.message));
    }
  });
}

// ---- boot --------------------------------------------------------------------------------

async function boot() {
  localize();
  saveTags = tagPicker($('save-tags'));
  editTags = tagPicker($('edit-tags'));
  bindFind();
  bindSave();
  bindEdit();
  bindSelect();
  $('open-setup').addEventListener('click', async () => { await openSetup(); closeSelf(); });
  $('open-manage').addEventListener('click', async () => { await openManage(); closeSelf(); });
  $('tab-find').addEventListener('click', () => { if (state.dir) { state.editing = null; show('find'); $('q').focus(); } });
  $('tab-save').addEventListener('click', () => { if (state.dir) { state.editing = null; show('save'); $('f-name').select(); } });

  const handle = await loadHandle().catch(() => null);
  if (!handle) return message(msg('msgChoose'), msg('openSetup'), () => openSetup());
  if ((await permissionState(handle)) !== 'granted') {
    return message(msg('msgAllow'), msg('allowAccess'), () => openSetup());
  }
  state.dir = handle;
  state.settings = await loadSettings();
  state.sig = JSON.stringify(state.settings);
  state.cache = await loadIndexCache(state.sig);
  try {
    await reload();
  } catch (err) {
    return message(msg('msgFolderErr', err.name), msg('openSetup'), () => openSetup());
  }
  state.tab = await getActiveTab();
  state.recent = await loadRecent();
  state.opens = await loadOpens();
  const view = await loadView();
  state.view = ['recent', 'all', 'top'].includes(view) || (view === 'favorites' && state.settings.favoriteProperty) ? view : 'all';
  document.querySelector('.seg [data-view="favorites"]').hidden = !state.settings.favoriteProperty;
  $('bulk-cat-row').hidden = !state.settings.categoryProperty;
  prepareSave();
  show('find');
  renderResults();
  $('q').focus();
}

boot();
