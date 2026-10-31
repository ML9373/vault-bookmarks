// The only file that touches chrome.* APIs, so the rest can run in a plain page under test.
const t = globalThis.__vbTest;

export async function getActiveTab() {
  if (t?.getActiveTab) return t.getActiveTab();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

export function openUrl(url, active = true) {
  return t?.openUrl ? t.openUrl(url, active) : chrome.tabs.create({ url, active });
}

export const openSetup = () => openUrl(t?.setupUrl ?? chrome.runtime.getURL('setup.html'));

/** Chrome's own favicon cache, served locally: no request leaves the machine for the icon. */
export function faviconUrl(pageUrl, size = 32) {
  if (t?.faviconUrl) return t.faviconUrl(pageUrl, size);
  const u = new URL(chrome.runtime.getURL('/_favicon/'));
  u.searchParams.set('pageUrl', pageUrl);
  u.searchParams.set('size', String(size));
  return u.toString();
}

export const closeSelf = () => { if (!t) window.close(); };

/** Every tab of the current window (their address and title need the `tabs` permission). */
export async function getWindowTabs() {
  if (t?.getWindowTabs) return t.getWindowTabs();
  return chrome.tabs.query({ currentWindow: true });
}

/** The page's own description (meta description, else Open Graph), read from the tab the user opened the popup on; empty when the page cannot be read. */
export async function getPageDescription(tab) {
  if (t?.getPageDescription) return t.getPageDescription(tab);
  if (!tab?.id) return '';
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => (document.querySelector('meta[name="description" i]') || document.querySelector('meta[property="og:description" i]'))?.content || '',
    });
    return String(res?.result || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  } catch { return ''; }
}

export const openManage = () => openUrl(t?.manageUrl ?? chrome.runtime.getURL('manage.html'));

// Permissions asked only when the user starts the feature that needs them.
const ORIGINS = { origins: ['http://*/*', 'https://*/*'] };
export const requestOrigins = () => (t?.requestOrigins ? t.requestOrigins() : chrome.permissions.request(ORIGINS));
export const requestBookmarks = () => (t?.requestBookmarks ? t.requestBookmarks() : chrome.permissions.request({ permissions: ['bookmarks'] }));
export const getBookmarkTree = () => (t?.getBookmarkTree ? t.getBookmarkTree() : chrome.bookmarks.getTree());
