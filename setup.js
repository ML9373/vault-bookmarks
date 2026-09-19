import { saveHandle, loadHandle, saveSettings, loadSettings, permissionState, requestPermission, readIndex, looksLikeVaultRoot } from './lib/vault.js';
import { DEFAULTS, validate, normalize } from './lib/settings.js';

const $ = (id) => document.getElementById(id);
const say = (text, cls = '') => { $('status').textContent = text; $('status').className = cls; };

// Chrome shares only the name of a picked folder, never its path: show what identifies it instead.
async function showCurrent(handle, access) {
  $('cur-name').textContent = handle.name;
  $('current').classList.remove('problem');
  const problem = (text) => { $('cur-detail').textContent = text; $('current').classList.add('problem'); };
  if (access !== 'granted') {
    $('regrant').hidden = false;
    return problem('Access has expired: press "Allow access again".');
  }
  $('regrant').hidden = true;
  try {
    const items = await readIndex(handle, await loadSettings());
    const sample = items.map((i) => i.title).sort((a, b) => a.localeCompare(b)).slice(0, 3).join(', ');
    $('cur-detail').textContent = items.length
      ? `${items.length} bookmark notes read, access allowed (for example: ${sample}). Chrome shares only the folder name, not its path.`
      : 'Access allowed, but no bookmark note found yet: saved links will appear here.';
  } catch (e) {
    problem(`The folder cannot be read (${e.name}). Choose it again.`);
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
    return e.name === 'AbortError' ? undefined : say(`Could not open the folder: ${e.message}`, 'error');
  }
  if (await looksLikeVaultRoot(handle)) return say('That looks like the whole vault (it holds .obsidian). Pick its bookmarks folder instead.', 'error');
  await saveHandle(handle);
  say('');
  await showCurrent(handle, 'granted');
});

$('regrant').addEventListener('click', async () => {
  const handle = await loadHandle();
  if ((await requestPermission(handle)) === 'granted') { say(''); await showCurrent(handle, 'granted'); }
  else say('Access was not granted.', 'error');
});

init().catch((e) => say(`Could not read the saved folder: ${e.message}`, 'error'));

// ---- note format -------------------------------------------------------------------------

const FIELDS = [
  ['markerProperty', 'Marker property', 'The property that says a note is a bookmark'],
  ['markerValue', 'Marker value', 'The value of the marker property'],
  ['urlProperty', 'Link property', 'The property that holds the address'],
  ['markerTag', 'Tag on every note', 'Written on each new note; empty for none'],
  ['categoryProperty', 'Category property', 'Empty turns the category field off'],
  ['descriptionProperty', 'Description property', 'Empty turns the description field off'],
  ['statusProperty', 'Status property', 'Empty turns it off; a value of Dead greys a link out'],
  ['createdProperty', 'Creation date property', 'Empty turns it off'],
];

const inputs = {};
for (const [key, label, hint] of FIELDS) {
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
}

function read() {
  const value = { body: $('s-body').value };
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
  $('settings-status').textContent = 'Saved. Reopen the popup to use it.';
});

$('settings-reset').addEventListener('click', () => {
  fill(DEFAULTS);
  $('settings-status').textContent = 'Defaults restored: press "Save format" to keep them.';
});

loadSettings().then(fill);
