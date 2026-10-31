// Context menu: save a link, or the page, without opening the popup. The result shows as a badge
// on the toolbar icon: a check mark (saved), "=" (already saved) or "!" (a problem: open the popup).
import { loadHandle, loadSettings, permissionState, readIndex } from './lib/vault.js';
import { saveLink } from './lib/quicksave.js';
import { titleFromUrl } from './lib/note.js';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'save-link', title: 'Save link to vault', contexts: ['link'] });
  chrome.contextMenus.create({ id: 'save-page', title: 'Save page to vault', contexts: ['page'] });
});

async function flash(text, color) {
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeText({ text });
  await new Promise((r) => setTimeout(r, 3000));
  await chrome.action.setBadgeText({ text: '' });
}

async function save(url, title) {
  const dir = await loadHandle();
  // A service worker cannot ask for the folder again: that needs the popup or the setup page.
  if (!dir || (await permissionState(dir)) !== 'granted') return { status: 'access' };
  const settings = await loadSettings();
  const items = await readIndex(dir, settings);
  return saveLink({ dir, settings, items, url, title });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const link = info.menuItemId === 'save-link';
  const url = link ? info.linkUrl : info.pageUrl || tab?.url;
  const title = link ? info.selectionText?.trim() || titleFromUrl(url) : tab?.title;
  try {
    const r = await save(url, title);
    if (r.status === 'saved') await flash('✓', '#1e7a46');
    else if (r.status === 'exists') await flash('=', '#5b45c9');
    else await flash('!', '#b3261e');
  } catch {
    await flash('!', '#b3261e');
  }
});
