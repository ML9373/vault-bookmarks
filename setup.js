import { saveHandle, loadHandle, saveSettings, loadSettings, permissionState, requestPermission, readIndex, looksLikeVaultRoot } from './lib/vault.js';
import { DEFAULTS, validate, normalize } from './lib/settings.js';
import { msg, localize } from './lib/i18n.js';

localize();

const $ = (id) => document.getElementById(id);
const say = (text, cls = '') => { $('status').textContent = text; $('status').className = cls; };

// Chrome shares only the name of a picked folder, never its path: show what identifies it instead.
async function showCurrent(handle, access) {
  $('cur-name').textContent = handle.name;
  $('current').classList.remove('problem');
  const problem = (text) => { $('cur-detail').textContent = text; $('current').classList.add('problem'); };
  if (access !== 'granted') {
    $('regrant').hidden = false;
    return problem(msg('sExpired'));
  }
  $('regrant').hidden = true;
  try {
    const items = await readIndex(handle, await loadSettings());
    const sample = items.map((i) => i.title).sort((a, b) => a.localeCompare(b)).slice(0, 3).join(', ');
    $('cur-detail').textContent = items.length ? msg('sRead', items.length, sample) : msg('sEmpty');
  } catch (e) {
    problem(msg('sUnreadable', e.name));
  }
}

async function init() {
  const handle = await loadHandle().catch(() => null);
  if (!handle) return;
  await showCurrent(handle, await permissionState(handle));
}

$('pick').addEventListener('click', async () => {
  let handle;
  try {
    handle = await showDirectoryPicker({ id: 'vault-bookmarks', mode: 'readwrite' });
  } catch (e) {
    return e.name === 'AbortError' ? undefined : say(msg('sCouldNotOpen', e.message), 'error');
  }
  if (await looksLikeVaultRoot(handle)) return say(msg('sVaultRoot'), 'error');
  await saveHandle(handle);
  say('');
  await showCurrent(handle, 'granted');
});

$('regrant').addEventListener('click', async () => {
  const handle = await loadHandle();
  if ((await requestPermission(handle)) === 'granted') { say(''); await showCurrent(handle, 'granted'); }
  else say(msg('mDenied'), 'error');
});

init().catch((e) => say(msg('sReadErr', e.message), 'error'));

// ---- note format -------------------------------------------------------------------------

const FIELDS = [
  ['markerProperty', 'fMarker', 'hMarker'],
  ['markerValue', 'fMarkerValue', 'hMarkerValue'],
  ['urlProperty', 'fUrl', 'hUrl'],
  ['markerTag', 'fMarkerTag', 'hMarkerTag'],
  ['categoryProperty', 'fCategory', 'hCategory'],
  ['descriptionProperty', 'fDescription', 'hDescription'],
  ['statusProperty', 'fStatus', 'hStatus'],
  ['createdProperty', 'fCreated', 'hCreated'],
  ['favoriteProperty', 'fFavorite', 'hFavorite'],
];

const inputs = {};
for (const [key, labelKey, hintKey] of FIELDS) {
  const label = msg(labelKey);
  const hint = msg(hintKey);
  const wrap = document.createElement('label');
  wrap.className = 's-field';
  wrap.title = hint;
  const span = document.createElement('span');
  span.textContent = label;
  const input = document.createElement('input');
  input.spellcheck = false;
  input.setAttribute('aria-label', `${label}. ${hint}`);
  wrap.append(span, input);
  inputs[key] = input;
  $('settings-fields').append(wrap);
}
$('settings-fields').className = 's-grid';

function fill(values) {
  for (const key of Object.keys(inputs)) inputs[key].value = values[key];
  $('s-body').value = values.body;
  $('s-subfolders').checked = values.subfolders === 'yes';
}

function read() {
  const value = { body: $('s-body').value, subfolders: $('s-subfolders').checked ? 'yes' : 'no' };
  for (const key of Object.keys(inputs)) value[key] = inputs[key].value;
  return value;
}

$('settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errors = validate(read());
  $('settings-error').hidden = errors.length === 0;
  $('settings-error').textContent = errors.join(' ');
  if (errors.length) return;
  const value = normalize(read());
  await saveSettings(value);
  fill(value);
  $('settings-status').textContent = msg('sSaved');
});

$('settings-reset').addEventListener('click', () => {
  fill(DEFAULTS);
  $('settings-status').textContent = msg('sDefaultsRestored');
});

loadSettings().then(fill);
