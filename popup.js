import { loadHandle, loadSettings, permissionState, readIndex, noteExists, writeNote, setFavorite, loadRecent, saveRecent, loadView, saveView } from './lib/vault.js';
import { recordOpen, recentItems, groupByCategory } from './lib/recent.js';
import { search } from './lib/search.js';
import { formatNote, sanitizeFilename, sanitizeTag, stripTitleCounter, truncateName, localDate, hostOf, suggestFor, tagForCategory, tagsByUse } from './lib/note.js';
import { getActiveTab, openUrl, openSetup, faviconUrl, closeSelf } from './lib/platform.js';

const $ = (id) => document.getElementById(id);
const MAX_ROWS = 60;
const MAX_CHIPS = 6;

const state = { dir: null, settings: null, items: [], group: '', rows: [], active: 0, tab: null, view: 'all', recent: [], open: new Set() };

// ---- views -------------------------------------------------------------------------------

function show(view) {
  $('count').hidden = view !== 'find';
  for (const v of ['message', 'find', 'save']) $(`view-${v}`).hidden = v !== view;
  $('tab-find').setAttribute('aria-selected', String(view === 'find'));
  $('tab-save').setAttribute('aria-selected', String(view === 'save'));
}

function message(text, actionLabel, action) {
  $('message-text').textContent = text;
  $('message-action').textContent = actionLabel;
  $('message-action').onclick = action;
  show('message');
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
  if (state.view === 'favorites') {
    const found = search(pool.filter((i) => i.favorite), q);
    return { rows: found.map((i) => link(i)), total: found.length };
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

function linkRow(item, nested) {
  const li = document.createElement('li');
  li.className = nested ? 'link nested' : 'link';
  if (item.status === 'Dead') li.classList.add('dead');
  const text = document.createElement('div');
  text.className = 'row-text';
  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = item.title;
  const sub = document.createElement('div');
  sub.className = 'sub';
  sub.textContent = [hostOf(item.url), nested ? '' : item.category, item.description].filter(Boolean).join(' · ');
  text.append(title, sub);
  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = item.groups[0] || '';
  badge.hidden = !item.groups[0];
  li.append(icon(item.url), text, badge);
  if (state.settings.favoriteProperty) {
    const star = document.createElement('button');
    star.type = 'button';
    star.className = 'star';
    star.tabIndex = -1;
    star.textContent = item.favorite ? '★' : '☆';
    star.setAttribute('aria-pressed', String(item.favorite));
    star.setAttribute('aria-label', item.favorite ? 'Remove from favorites' : 'Add to favorites');
    star.title = star.getAttribute('aria-label');
    li.append(star);
  }
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
  if (row?.kind !== 'group') return;
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
  await saveRecent(state.recent).catch(() => {});
  await openUrl(row.item.url, !background);
  if (!background) closeSelf();
}

async function toggleFavorite(index) {
  const item = state.rows[index]?.item;
  if (!item) return;
  $('find-error').hidden = true;
  try {
    await setFavorite(state.dir, item.file, item.url, state.settings, !item.favorite);
    item.favorite = !item.favorite;
  } catch (err) {
    $('find-error').textContent = `Could not update "${item.title}": ${err.message}`;
    $('find-error').hidden = false;
  }
  state.active = index;
  renderResults();
}

function setView(view) {
  state.view = view;
  state.active = 0;
  saveView(view);
  renderResults();
  $('q').focus();
}

function bindFind() {
  $('q').addEventListener('input', () => { state.active = 0; renderResults(); });
  $('q').addEventListener('keydown', (e) => {
    const row = state.rows[state.active];
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(state.active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(state.active - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); openResult(state.active, e.metaKey || e.ctrlKey); }
    else if (row?.kind === 'group' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) { e.preventDefault(); toggleGroup(state.active, e.key === 'ArrowRight'); }
  });
  $('results').addEventListener('click', (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    if (e.target.closest('.star')) toggleFavorite(Number(li.dataset.index));
    else openResult(Number(li.dataset.index), e.metaKey || e.ctrlKey);
  });
  for (const b of document.querySelectorAll('.seg [data-view]')) b.addEventListener('click', () => setView(b.dataset.view));
  $('group-filter').addEventListener('change', () => {
    state.group = $('group-filter').value;
    state.active = 0;
    renderResults();
    $('q').focus();
  });
}

// ---- save --------------------------------------------------------------------------------

function showSaveError(text) {
  $('save-error').textContent = text;
  $('save-error').hidden = !text;
}

function syncChips() {
  const current = $('f-tag').value.trim().toLowerCase();
  for (const chip of $('tag-chips').children) chip.setAttribute('aria-pressed', String(chip.textContent.toLowerCase() === current));
}

function setTag(tag) {
  $('f-tag').value = tag;
  syncChips();
}

function buildSaveChoices() {
  const cats = [...new Set(state.items.map((i) => i.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  $('categories').replaceChildren(...cats.map((c) => Object.assign(document.createElement('option'), { value: c })));
  const tags = tagsByUse(state.items);
  $('tags').replaceChildren(...tags.map((t) => Object.assign(document.createElement('option'), { value: t })));
  $('tag-chips').replaceChildren(...tags.slice(0, MAX_CHIPS).map((t) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = t;
    b.setAttribute('aria-pressed', 'false');
    return b;
  }));
}

function prepareSave() {
  const tab = state.tab;
  const url = tab?.url || '';
  const ok = /^https?:\/\//i.test(url);
  $('field-category').hidden = !state.settings.categoryProperty;
  $('field-description').hidden = !state.settings.descriptionProperty;
  $('save-page-title').textContent = tab?.title || hostOf(url) || 'No page';
  $('save-page-url').textContent = url;
  $('save-button').disabled = !ok;
  showSaveError(ok ? '' : 'This page cannot be saved: only http(s) links are kept.');
  if (!ok) return;
  $('save-icon').replaceChildren(icon(url));
  buildSaveChoices();
  const { existing, category, tag } = suggestFor(state.items, url);
  $('save-existing').hidden = !existing;
  if (existing) $('save-existing').textContent = `Already saved as "${existing.title}"${existing.category ? ` (${existing.category})` : ''}.`;
  $('save-button').disabled = Boolean(existing);
  $('save-button').textContent = `Save to "${state.dir.name}"`;
  $('f-name').value = truncateName(sanitizeFilename(stripTitleCounter(tab.title) || hostOf(url))) || hostOf(url);
  $('f-category').value = state.settings.categoryProperty ? category : '';
  setTag(category ? tagForCategory(state.items, category, tag) : tag);
  $('f-description').value = '';
}

function bindSave() {
  $('tag-chips').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (chip) setTag(chip.getAttribute('aria-pressed') === 'true' ? '' : chip.textContent);
  });
  $('f-tag').addEventListener('input', syncChips);
  $('f-category').addEventListener('change', () => {
    const c = $('f-category').value.trim();
    if (c && state.items.some((i) => i.category === c)) setTag(tagForCategory(state.items, c, $('f-tag').value.trim()));
  });
  $('save-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    showSaveError('');
    const url = state.tab?.url || '';
    const name = $('f-name').value.trim();
    const fileTitle = truncateName(sanitizeFilename(name));
    const rawTag = $('f-tag').value.trim();
    const tag = sanitizeTag(rawTag);
    if (!fileTitle) return showSaveError('The name is empty once forbidden characters are removed.');
    if (rawTag && !tag) return showSaveError('That tag is not valid: use letters, digits, "_", "-" or "/", and at least one non-digit.');
    const clash = state.items.some((i) => i.file.toLowerCase() === `${fileTitle}.md`.toLowerCase()) || (await noteExists(state.dir, `${fileTitle}.md`));
    if (clash) return showSaveError(`A note named "${fileTitle}" already exists. Choose another name.`);
    $('save-button').disabled = true;
    try {
      const content = formatNote({ fileTitle, name, url, category: $('f-category').value.trim(), tag, description: $('f-description').value.trim(), date: localDate() }, state.settings);
      await writeNote(state.dir, `${fileTitle}.md`, content);
      state.items = await readIndex(state.dir, state.settings);
      buildGroupFilter();
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
  bindFind();
  bindSave();
  $('open-setup').addEventListener('click', async () => { await openSetup(); closeSelf(); });
  $('tab-find').addEventListener('click', () => { if (state.dir) { show('find'); $('q').focus(); } });
  $('tab-save').addEventListener('click', () => { if (state.dir) { show('save'); $('f-name').select(); } });

  const handle = await loadHandle().catch(() => null);
  if (!handle) return message('Choose the folder that holds your bookmark notes.', 'Open setup', () => openSetup());
  if ((await permissionState(handle)) !== 'granted') {
    return message('Chrome needs you to allow access to the folder again.', 'Allow access', () => openSetup());
  }
  state.dir = handle;
  state.settings = await loadSettings();
  try {
    state.items = await readIndex(handle, state.settings);
  } catch (err) {
    return message(`The folder cannot be read (${err.name}). Choose it again.`, 'Open setup', () => openSetup());
  }
  state.tab = await getActiveTab();
  state.recent = await loadRecent();
  const view = await loadView();
  state.view = ['recent', 'all'].includes(view) || (view === 'favorites' && state.settings.favoriteProperty) ? view : 'all';
  document.querySelector('.seg [data-view="favorites"]').hidden = !state.settings.favoriteProperty;
  buildGroupFilter();
  prepareSave();
  show('find');
  renderResults();
  $('q').focus();
}

boot();
