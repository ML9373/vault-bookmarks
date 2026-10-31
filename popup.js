import { loadHandle, loadSettings, permissionState, readIndex, noteExists, writeNote, setFavorite, updateNote, deleteNote, itemKey, loadRecent, saveRecent, loadOpens, saveOpens, loadView, saveView, loadIndexCache, saveIndexCache } from './lib/vault.js';
import { recordOpen, recentItems, groupByCategory, bumpOpen, topItems, opensOf } from './lib/recent.js';
import { search } from './lib/search.js';
import { formatNote, sanitizeFilename, stripTitleCounter, truncateName, localDate, hostOf, urlKey, suggestFor, tagForCategory, tagsByUse, findDuplicates } from './lib/note.js';
import { tagPicker } from './lib/tagpicker.js';
import { saveLink } from './lib/quicksave.js';
import { getActiveTab, getWindowTabs, getPageDescription, openUrl, openSetup, openManage, faviconUrl, closeSelf } from './lib/platform.js';

const $ = (id) => document.getElementById(id);
const MAX_ROWS = 60;
const URL_OK = /^https?:\/\/\S+$/i;

const state = { dir: null, settings: null, items: [], dupes: 0, group: '', rows: [], active: 0, tab: null, view: 'all', recent: [], opens: {}, open: new Set(), armed: null, editing: null, cache: null, sig: '', tabs: [] };
let saveTags;
let editTags;
let armTimer;

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
}

const EMPTY = {
  recent: 'Links you open from here show up here.',
  favorites: 'No favorite yet: click the star next to a link.',
  top: 'Links you open from here are counted: the most opened come first.',
  duplicates: 'No duplicate: every link is saved once.',
};

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
    const star = actButton('star', item.favorite ? '★' : '☆', item.favorite ? 'Remove from favorites' : 'Add to favorites');
    star.setAttribute('aria-pressed', String(item.favorite));
    acts.append(star);
  }
  acts.append(actButton('edit', '✎', 'Edit (Ctrl or Cmd+E)'));
  const del = actButton('del', armed ? 'Delete for good?' : '✕', armed ? 'Click again to delete this note for good' : 'Delete');
  if (armed) del.classList.add('armed');
  acts.append(del);
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
  name.textContent = row.name || 'No category';
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
  dupes.textContent = state.view === 'duplicates' ? 'Back to all' : `${state.dupes} duplicate${state.dupes === 1 ? '' : 's'}`;
  dupes.setAttribute('aria-pressed', String(state.view === 'duplicates'));
  const filtered = $('q').value.trim() || state.group;
  $('empty').textContent = !filtered && EMPTY[state.view] ? EMPTY[state.view] : 'No link matches.';
  $('empty').hidden = rows.length > 0;
  $('count').textContent = capped ? `${MAX_ROWS} of ${total} links` : `${total} link${total === 1 ? '' : 's'}`;
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
    findError(`Could not update "${item.title}": ${err.message}`);
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
    await deleteNote(state.dir, item, state.settings);
    await reload();
    return true;
  } catch (err) {
    findError(`Could not delete "${item.title}": ${err.message}`);
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

// ---- edit --------------------------------------------------------------------------------

const showEditError = (text) => { $('edit-error').textContent = text; $('edit-error').hidden = !text; };

function armEditDelete(on) {
  $('edit-delete').classList.toggle('armed', on);
  $('edit-delete').textContent = on ? 'Delete for good?' : 'Delete';
}

function buildCategoryList() {
  const cats = [...new Set(state.items.map((i) => i.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  $('categories').replaceChildren(...cats.map((c) => Object.assign(document.createElement('option'), { value: c })));
}

function openEdit(item) {
  const s = state.settings;
  state.editing = item;
  buildCategoryList();
  $('edit-file').textContent = `${itemKey(item)}: the file keeps its name, so links to it keep working.`;
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
    if (!title) return showEditError('The title is empty.');
    if (!URL_OK.test(url)) return showEditError('The link must be an http(s) address.');
    if (!editTags.commit()) return showEditError('That tag is not valid: use letters, digits, "_", "-" or "/", and at least one non-digit.');
    if (urlKey(url) !== urlKey(item.url) && state.items.some((i) => i !== item && urlKey(i.url) === urlKey(url))) return showEditError('Another note already holds this link.');
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
      showEditError(`Could not update the note: ${err.message}`);
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
  $('save-page-title').textContent = tab?.title || hostOf(url) || 'No page';
  $('save-page-url').textContent = url;
  $('save-button').disabled = !ok;
  showSaveError(ok ? '' : 'This page cannot be saved: only http(s) links are kept.');
  prepareSaveAll();
  if (!ok) return;
  $('save-icon').replaceChildren(icon(url));
  buildCategoryList();
  saveTags.suggest(tagsByUse(state.items));
  const { existing, category, tag } = suggestFor(state.items, url);
  $('save-existing').hidden = !existing;
  if (existing) $('save-existing').textContent = `Already saved as "${existing.title}"${existing.category ? ` (${existing.category})` : ''}.`;
  $('save-button').disabled = Boolean(existing);
  $('save-button').textContent = `Save to "${state.dir.name}"`;
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
  btn.textContent = `Save all ${state.tabs.length} open tabs`;
  btn.hidden = state.tabs.length < 2;
}

async function saveAllTabs() {
  const btn = $('save-all');
  if (btn.dataset.armed !== 'yes') {
    btn.dataset.armed = 'yes';
    btn.textContent = `Write ${state.tabs.length} notes? Click again`;
    $('save-all-note').textContent = 'Each tab gets the category and tag the notes of its site already use.';
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
  $('save-all-note').textContent = `Saved ${saved} note${saved === 1 ? '' : 's'}${failed ? `, ${failed} failed` : ''}.`;
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
    if (!fileTitle) return showSaveError('The name is empty once forbidden characters are removed.');
    if (!saveTags.commit()) return showSaveError('That tag is not valid: use letters, digits, "_", "-" or "/", and at least one non-digit.');
    const clash = state.items.some((i) => !i.folder && i.file.toLowerCase() === `${fileTitle}.md`.toLowerCase()) || (await noteExists(state.dir, `${fileTitle}.md`));
    if (clash) return showSaveError(`A note named "${fileTitle}" already exists. Choose another name.`);
    $('save-button').disabled = true;
    try {
      const content = formatNote({ fileTitle, name, url, category: $('f-category').value.trim(), tags: saveTags.get(), description: $('f-description').value.trim(), date: localDate() }, state.settings);
      await writeNote(state.dir, `${fileTitle}.md`, content);
      await reload();
      prepareSave();
      $('save-existing').hidden = false;
      $('save-existing').textContent = `Saved as "${fileTitle}".`;
      $('save-button').disabled = true;
    } catch (err) {
      $('save-button').disabled = false;
      showSaveError(`Could not write the note: ${err.message}`);
    }
  });
}

// ---- boot --------------------------------------------------------------------------------

async function boot() {
  saveTags = tagPicker($('save-tags'));
  editTags = tagPicker($('edit-tags'));
  bindFind();
  bindSave();
  bindEdit();
  $('open-setup').addEventListener('click', async () => { await openSetup(); closeSelf(); });
  $('open-manage').addEventListener('click', async () => { await openManage(); closeSelf(); });
  $('tab-find').addEventListener('click', () => { if (state.dir) { state.editing = null; show('find'); $('q').focus(); } });
  $('tab-save').addEventListener('click', () => { if (state.dir) { state.editing = null; show('save'); $('f-name').select(); } });

  const handle = await loadHandle().catch(() => null);
  if (!handle) return message('Choose the folder that holds your bookmark notes.', 'Open setup', () => openSetup());
  if ((await permissionState(handle)) !== 'granted') {
    return message('Chrome needs you to allow access to the folder again.', 'Allow access', () => openSetup());
  }
  state.dir = handle;
  state.settings = await loadSettings();
  state.sig = JSON.stringify(state.settings);
  state.cache = await loadIndexCache(state.sig);
  try {
    await reload();
  } catch (err) {
    return message(`The folder cannot be read (${err.name}). Choose it again.`, 'Open setup', () => openSetup());
  }
  state.tab = await getActiveTab();
  state.recent = await loadRecent();
  state.opens = await loadOpens();
  const view = await loadView();
  state.view = ['recent', 'all', 'top'].includes(view) || (view === 'favorites' && state.settings.favoriteProperty) ? view : 'all';
  document.querySelector('.seg [data-view="favorites"]').hidden = !state.settings.favoriteProperty;
  prepareSave();
  show('find');
  renderResults();
  $('q').focus();
}

boot();
