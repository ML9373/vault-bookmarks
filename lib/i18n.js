// Texts come from `_locales/<lang>/messages.json`; Chrome picks the language of the browser and falls back to English.
const t = globalThis.__vbTest;

export const msg = (key, ...subs) => (t?.msg ? t.msg(key, subs) : globalThis.chrome?.i18n?.getMessage(key, subs.map(String))) || key;

const lang = () => t?.lang ?? globalThis.chrome?.i18n?.getUILanguage?.() ?? 'en';

/** `one` for 1 (and 0 in French), `other` otherwise; `other` receives the count as $1. */
export const plural = (n, one, other) => ((lang().startsWith('fr') ? n < 2 : n === 1) ? msg(one) : msg(other, n));

/** Fills the static texts of a page: `data-i18n` (text), `data-i18n-title`, `data-i18n-placeholder`, `data-i18n-aria` (attributes). */
export function localize(root = document) {
  document.documentElement.lang = lang();
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = msg(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-title]')) el.title = msg(el.dataset.i18nTitle);
  for (const el of root.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = msg(el.dataset.i18nPlaceholder);
  for (const el of root.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', msg(el.dataset.i18nAria));
}
