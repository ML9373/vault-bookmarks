import { loadHandle, loadSettings, permissionState, readIndex, noteExists, writeNote } from './lib/vault.js';
import { search } from './lib/search.js';
import { formatNote, sanitizeFilename, sanitizeTag, stripTitleCounter, truncateName, localDate, hostOf, suggestFor, tagForCategory, tagsByUse } from './lib/note.js';
import { getActiveTab, openUrl, openSetup, faviconUrl, closeSelf } from './lib/platform.js';

const $ = (id) => document.getElementById(id);
const MAX_ROWS = 60;
const MAX_CHIPS = 6;

const state = { dir: null, settings: null, items: [], group: '', results: [], active: 0, tab: null };

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

function renderResults() {
  const list = $('results');
  state.results = search(state.items, $('q').value, state.group);
  state.active = Math.min(state.active, Math.max(0, state.results.length - 1));
  list.replaceChildren();
  state.results.slice(0, MAX_ROWS).forEach((item, i) => {
    const li = document.createElement('li');
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', String(i === state.active));
    li.dataset.index = String(i);
    if (item.status === 'Dead') li.classList.add('dead');
    const text = document.createElement('div');
    text.className = 'row-text';
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = item.title;
    const sub = document.createElement('div');
    sub.className = 'sub';
    sub.textContent = [hostOf(item.url), item.category, item.description].filter(Boolean).join(' · ');
    text.append(title, sub);
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = item.groups[0] || '';
    badge.hidden = !item.groups[0];
    li.append(icon(item.url), text, badge);
    list.append(li);
  });
  $('empty').hidden = state.results.length > 0;
  const n = state.results.length;
  $('count').textContent = n > MAX_ROWS ? `${MAX_ROWS} of ${n} links` : `${n} link${n === 1 ? '' : 's'}`;
}

function setActive(i) {
  const rows = [...$('results').children];
  if (!rows.length) return;
  state.active = (i + rows.length) % rows.length;
  rows.forEach((r, j) => r.setAttribute('aria-selected', String(j === state.active)));
  rows[state.active].scrollIntoView({ block: 'nearest' });
}

async function openResult(index, background) {
  const item = state.results[index];
  if (!item) return;
  await openUrl(item.url, !background);
  if (!background) closeSelf();
}

function bindFind() {
  $('q').addEventListener('input', () => { state.active = 0; renderResults(); });
  $('q').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(state.active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(state.active - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); openResult(state.active, e.metaKey || e.ctrlKey); }
  });
  $('results').addEventListener('click', (e) => {
    const li = e.target.closest('li');
    if (li) openResult(Number(li.dataset.index), e.metaKey || e.ctrlKey);
  });
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
  buildGroupFilter();
  prepareSave();
  show('find');
  renderResults();
  $('q').focus();
}

boot();
