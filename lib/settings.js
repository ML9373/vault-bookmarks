// What the extension needs to know about the notes it reads and writes. The defaults describe a
// common layout (`type: bookmark`, a `URL` property); every name can be changed on the setup page.

export const DEFAULTS = {
  markerProperty: 'type',       // property that says "this note is a bookmark"
  markerValue: 'bookmark',
  markerTag: 'Bookmark',        // tag written on every note; empty for none
  urlProperty: 'URL',
  categoryProperty: 'Category', // empty disables the field
  descriptionProperty: 'Description',
  statusProperty: 'BookmarkStatus',
  createdProperty: 'CreationDate',
  body: '',                     // text written under the properties of a new note
};

const PROPERTY = /^[A-Za-z_][\w-]*$/;
const OPTIONAL = ['categoryProperty', 'descriptionProperty', 'statusProperty', 'createdProperty'];
const PROPERTIES = ['markerProperty', 'urlProperty', ...OPTIONAL];

/** Stored values over defaults; anything that is not a string is ignored. */
export function resolve(stored) {
  const out = { ...DEFAULTS };
  for (const k of Object.keys(DEFAULTS)) if (typeof stored?.[k] === 'string') out[k] = stored[k];
  return out;
}

/** Returns the list of problems, empty when the settings can be used. */
export function validate(s) {
  const errors = [];
  for (const k of PROPERTIES) {
    const v = s[k].trim();
    if (!v && !OPTIONAL.includes(k)) errors.push(`${k}: required`);
    else if (v && !PROPERTY.test(v)) errors.push(`${k}: letters, digits, "_" and "-" only, not starting with a digit`);
  }
  if (!s.markerValue.trim() || /[\r\n]/.test(s.markerValue)) errors.push('markerValue: required, on one line');
  if (s.markerTag && !/^[^\s#]+$/.test(s.markerTag)) errors.push('markerTag: no spaces, no "#"');
  const names = PROPERTIES.map((k) => s[k].trim()).filter(Boolean);
  if (new Set(names.map((n) => n.toLowerCase())).size !== names.length) errors.push('each property name must be different');
  return errors;
}

export function normalize(s) {
  const out = { ...s };
  for (const k of PROPERTIES) out[k] = s[k].trim();
  out.markerValue = s.markerValue.trim();
  out.markerTag = s.markerTag.trim().replace(/^#+/, '');
  out.body = s.body.replace(/\s+$/, '');
  return out;
}
