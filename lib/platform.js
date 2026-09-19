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
