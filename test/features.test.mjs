// Edit, delete, tags, duplicates, cache, subfolders, link check, import: against an in-memory folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setProp } from '../lib/fm.js';
import { DEFAULTS } from '../lib/settings.js';
import { formatNote, applyChange, mergeTags, findDuplicates, titleFromUrl } from '../lib/note.js';
import { bumpOpen, topItems } from '../lib/recent.js';
import { flattenBookmarks } from '../lib/importer.js';
import { checkLink } from '../lib/linkcheck.js';
import { readIndex, updateNote, deleteNote, itemKey } from '../lib/vault.js';
import { saveLink } from '../lib/quicksave.js';

const S = { ...DEFAULTS };
const NOTE = '---\ntitle: "Docs"\ntags:\n  - Bookmark\n  - work\ntype: bookmark\nURL: "https://a.example/x"\nCategory: "Ref"\nDescription: ""\nBookmarkStatus: "Active"\naliases:\n  - "Docs"\n---\nbody stays\n';

/** A folder in memory with the parts of the File System Access API the extension uses. */
function folder(tree, stamp = { n: 1 }) {
  const dir = {
    kind: 'directory',
    tree,
    async *entries() { for (const [name, v] of Object.entries(tree)) yield [name, typeof v === 'string' ? fileHandle(tree, name, stamp) : folder(v, stamp)]; },
    async getFileHandle(name, opts) {
      if (typeof tree[name] !== 'string') {
        if (!opts?.create) throw Object.assign(new Error('nf'), { name: 'NotFoundError' });
        tree[name] = '';
      }
      return fileHandle(tree, name, stamp);
    },
    async getDirectoryHandle(name) {
      if (typeof tree[name] !== 'object') throw Object.assign(new Error('nf'), { name: 'NotFoundError' });
      return folder(tree[name], stamp);
    },
    async removeEntry(name) { delete tree[name]; },
  };
  return dir;
}
function fileHandle(tree, name, stamp) {
  return {
    kind: 'file',
    async getFile() { const t = tree[name]; return { size: t.length, lastModified: stamp.n, slice: (a, b) => ({ text: async () => t.slice(a, b) }), text: async () => t }; },
    async createWritable() { return { write: async (c) => { tree[name] = c; stamp.n++; }, close: async () => {} }; },
  };
}

test('setProp replaces, adds and removes one property and keeps every other byte', () => {
  const next = setProp(NOTE, 'Category', 'New "cat"');
  assert.equal(next, NOTE.replace('Category: "Ref"', 'Category: "New \\"cat\\""'));
  assert.equal(setProp(NOTE, 'Category', null), NOTE.replace('Category: "Ref"\n', ''));
  assert.equal(setProp(NOTE, 'Extra', 'x'), NOTE.replace('  - "Docs"\n---\nbody', '  - "Docs"\nExtra: "x"\n---\nbody'));
  const tags = setProp(NOTE, 'tags', ['Bookmark', 'a b', 'ok-1', 'true']);
  assert.match(tags, /tags:\n {2}- Bookmark\n {2}- "a b"\n {2}- ok-1\n {2}- "true"\ntype:/);
  assert.equal(setProp('no frontmatter', 'x', 'y'), null);
  const crlf = '---\r\nURL: u\r\n---\r\nbody\r\n';
  assert.equal(setProp(crlf, 'Category', 'c'), '---\r\nURL: u\r\nCategory: "c"\r\n---\r\nbody\r\n');
});

test('mergeTags keeps the marker tag and replaces the others', () => {
  assert.deepEqual(mergeTags(['Bookmark', 'work', 'old'], ['new', 'work'], S), ['Bookmark', 'new', 'work']);
  assert.deepEqual(mergeTags([], ['a'], S), ['a']);
  assert.deepEqual(mergeTags(['bookmark'], [], { ...S }), ['bookmark']);
  assert.deepEqual(mergeTags(['x', 'bookmark'], ['y'], { ...S, markerProperty: 'tags', markerValue: 'x' }), ['x', 'bookmark', 'y']);
});

test('applyChange touches only the named properties; settings that are off are not written', () => {
  const next = applyChange(NOTE, { title: 'Docs 2', status: 'Dead', tags: ['work', 'later'] }, S);
  assert.match(next, /title: "Docs 2"/);
  assert.match(next, /BookmarkStatus: "Dead"/);
  assert.match(next, /tags:\n {2}- Bookmark\n {2}- work\n {2}- later\ntype/);
  assert.ok(next.endsWith('---\nbody stays\n'));
  assert.equal(applyChange(NOTE, {}, S), NOTE);
  assert.equal(applyChange(NOTE, { category: 'x' }, { ...S, categoryProperty: '' }), NOTE);
  assert.equal(applyChange('plain', { title: 'x' }, S), null);
});

test('formatNote writes several tags once each', () => {
  const text = formatNote({ fileTitle: 'T', url: 'https://t.example/', tags: ['a', 'Bookmark', 'b'], tag: 'a', date: '2026-01-01' }, S);
  assert.match(text, /tags:\n {2}- Bookmark\n {2}- a\n {2}- b\ntype/);
});

test('duplicates are grouped by link identity; titleFromUrl names a bare link', () => {
  const items = [
    { title: 'A', url: 'https://a.example/x?utm_source=z' }, { title: 'B', url: 'https://www.a.example/x/' }, { title: 'C', url: 'https://c.example/' },
  ];
  const d = findDuplicates(items);
  assert.equal(d.length, 1);
  assert.deepEqual(d[0].links.map((i) => i.title), ['A', 'B']);
  assert.equal(titleFromUrl('https://docs.example.com/guide/getting-started.html'), 'docs.example.com - getting started');
  assert.equal(titleFromUrl('https://example.com/'), 'example.com');
});

test('open counts rank the notes, ties by title, never-opened notes left out', () => {
  let opens = bumpOpen({}, 'https://a.example/');
  opens = bumpOpen(opens, 'https://b.example/?utm_source=x');
  opens = bumpOpen(opens, 'https://b.example/');
  const items = [{ title: 'A', url: 'https://a.example/' }, { title: 'B', url: 'https://b.example/' }, { title: 'C', url: 'https://c.example/' }];
  assert.deepEqual(topItems(items, opens).map((i) => i.title), ['B', 'A']);
});

test('readIndex: subfolders only when asked, folder name as category, unchanged notes not read again', async () => {
  const tree = { 'a.md': NOTE, '.hidden': { 'h.md': NOTE }, sub: { 'b.md': NOTE.replace('"Docs"', '"B"').replace('Category: "Ref"', 'Category: ""').replace('x"', 'y"') } };
  const root = folder(tree);
  assert.deepEqual((await readIndex(root, S)).map(itemKey), ['a.md']);
  const deep = { ...S, subfolders: 'yes' };
  const cache = new Map();
  const items = await readIndex(root, deep, cache);
  assert.deepEqual(items.map(itemKey).sort(), ['a.md', 'sub/b.md']);
  const b = items.find((i) => i.folder === 'sub');
  assert.equal(b.category, 'sub');
  assert.equal(b.folderCategory, true);
  let reads = 0;
  const spy = folder(tree);
  const orig = spy.entries;
  spy.entries = async function* () { for await (const [n, h] of orig()) { if (h.kind === 'file') { const g = h.getFile; h.getFile = async () => { const f = await g(); const t = f.slice; f.slice = (...a) => { reads++; return t(...a); }; return f; }; } yield [n, h]; } };
  await readIndex(spy, S, cache);
  assert.equal(reads, 0, 'cache hit: no note body read');
  tree['a.md'] += 'more';
  await readIndex(folder(tree), deep, cache);
  assert.equal(cache.get('a.md').item.url, 'https://a.example/x');
});

test('updateNote edits in place and refuses a note whose link changed; deleteNote removes the file', async () => {
  const tree = { 'a.md': NOTE, sub: { 'b.md': NOTE.replace('a.example', 'b.example') } };
  const root = folder(tree);
  const deep = { ...S, subfolders: 'yes' };
  const items = await readIndex(root, deep);
  const a = items.find((i) => i.file === 'a.md');
  await updateNote(root, a, { status: 'Dead', url: 'https://a.example/moved' }, deep);
  assert.match(tree['a.md'], /BookmarkStatus: "Dead"/);
  assert.match(tree['a.md'], /URL: "https:\/\/a.example\/moved"/);
  await assert.rejects(updateNote(root, a, { status: 'Active' }, deep), /changed on disk/);
  const b = items.find((i) => i.folder === 'sub');
  await deleteNote(root, b, deep);
  assert.deepEqual(Object.keys(tree.sub), []);
  await assert.rejects(deleteNote(root, b, deep));
  await assert.rejects(deleteNote(root, { ...a, url: 'https://stale.example/' }, deep), /changed on disk/);
  assert.ok('a.md' in tree, 'a stale item is never deleted');
});

test('saveLink saves once, names a clash, and reports a duplicate', async () => {
  const tree = {};
  const root = folder(tree);
  const items = [];
  const r1 = await saveLink({ dir: root, settings: S, items, url: 'https://x.example/a', title: '(3) Page: one' });
  assert.deepEqual(r1, { status: 'saved', title: 'Page - one' });
  assert.equal((await saveLink({ dir: root, settings: S, items, url: 'https://x.example/a?utm_source=q', title: 'again' })).status, 'exists');
  const r2 = await saveLink({ dir: root, settings: S, items, url: 'https://y.example/b', title: 'Page: one', tags: ['t'], category: '' });
  assert.equal(r2.title, 'Page - one 2');
  assert.equal((await saveLink({ dir: root, settings: S, items, url: 'chrome://settings', title: 'x' })).status, 'invalid');
  assert.match(tree['Page - one 2.md'], /tags:\n {2}- Bookmark\n {2}- t\n/);
});

test('flattenBookmarks keeps http(s) links with their folder and category', () => {
  const tree = [{ id: '0', title: '', children: [
    { id: '1', parentId: '0', title: 'Bookmarks bar', children: [
      { id: '5', parentId: '1', title: 'Top', url: 'https://top.example/', dateAdded: 5 },
      { id: '2', parentId: '1', title: 'Dev', children: [{ id: '3', parentId: '2', title: 'Docs', url: 'https://docs.example/', dateAdded: 9 }, { id: '4', parentId: '2', title: 'Local', url: 'file:///x' }] },
    ] },
  ] }];
  const out = flattenBookmarks(tree);
  assert.deepEqual(out.map((l) => [l.url, l.folder, l.category]), [['https://top.example/', 'Bookmarks bar', ''], ['https://docs.example/', 'Bookmarks bar / Dev', 'Dev']]);
});

test('checkLink: 404 is broken (also by GET), HEAD-only refusal is ok, silence is broken, timeouts are unknown', async () => {
  const res = (status) => async () => ({ status, body: null });
  assert.equal((await checkLink('u', { fetchFn: res(200) })).verdict, 'ok');
  assert.equal((await checkLink('u', { fetchFn: res(404) })).verdict, 'broken');
  assert.equal((await checkLink('u', { fetchFn: res(403) })).verdict, 'unknown');
  const headRefused = async (_u, { method }) => ({ status: method === 'HEAD' ? 405 : 200, body: null });
  assert.equal((await checkLink('u', { fetchFn: headRefused })).verdict, 'ok');
  const down = async () => { throw new TypeError('Failed to fetch'); };
  assert.deepEqual(await checkLink('u', { fetchFn: down }), { verdict: 'broken', detail: 'no answer' });
  const slow = async (_u, { signal }) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(Object.assign(new Error('a'), { name: 'AbortError' }))));
  assert.equal((await checkLink('u', { fetchFn: slow, timeout: 10 })).verdict, 'unknown');
});

test('locales: same keys everywhere, every key used in the code exists, placeholders match', async () => {
  const fs = await import('node:fs');
  const load = (l) => JSON.parse(fs.readFileSync(new URL(`../_locales/${l}/messages.json`, import.meta.url), 'utf8'));
  const en = load('en');
  const fr = load('fr');
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  for (const k of Object.keys(en)) assert.deepEqual(Object.keys(fr[k].placeholders || {}).sort(), Object.keys(en[k].placeholders || {}).sort(), `placeholders of ${k}`);
  const files = ['popup.html', 'popup.js', 'manage.html', 'manage.js', 'setup.html', 'setup.js', 'background.js', 'manifest.json', 'lib/tagpicker.js'];
  const used = new Set();
  for (const f of files) {
    const text = fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    for (const m of text.matchAll(/(?:msg|plural|getMessage)\(\s*(?:[^'"()]*,\s*)?'(\w+)'/g)) used.add(m[1]);
    for (const m of text.matchAll(/data-i18n(?:-\w+)?="(\w+)"/g)) used.add(m[1]);
    for (const m of text.matchAll(/__MSG_(\w+)__/g)) used.add(m[1]);
    for (const m of text.matchAll(/'(?:e|h|f|s)[A-Z]\w+'/g)) used.add(m[0].slice(1, -1));
  }
  for (const m of fs.readFileSync(new URL('../popup.js', import.meta.url), 'utf8').matchAll(/(?:recent|favorites|top|duplicates): '(empty\w+)'/g)) used.add(m[1]);
  for (const key of used) if (!(key in en)) assert.fail(`missing message: ${key}`);
  const source = files.map((f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')).join('\n');
  const unused = Object.keys(en).filter((k) => !new RegExp(`['"]${k}['"]|__MSG_${k}__`).test(source));
  assert.deepEqual(unused, [], 'keys never used');
});

test('exportBookmarksHtml: folders by category, tags kept, Dead left out unless asked, text escaped', async () => {
  const { exportBookmarksHtml } = await import('../lib/exporter.js');
  const items = [
    { title: 'A & B', url: 'https://a.example/?x=1&y="2"', category: 'Ref', groups: ['t1', 't2'], status: 'Active' },
    { title: 'Loose', url: 'https://l.example/', category: '', groups: [], status: 'Active' },
    { title: 'Gone', url: 'https://g.example/', category: 'Ref', groups: [], status: 'Dead' },
  ];
  const html = exportBookmarksHtml(items);
  assert.match(html, /<DT><H3>Ref<\/H3>/);
  assert.match(html, /<A HREF="https:\/\/a.example\/\?x=1&amp;y=&quot;2&quot;" TAGS="t1,t2">A &amp; B<\/A>/);
  assert.match(html, /<DT><A HREF="https:\/\/l.example\/">Loose<\/A>/);
  assert.doesNotMatch(html, /Gone/);
  assert.match(exportBookmarksHtml(items, { includeDead: true }), /Gone/);
});

test('restoreNote puts a deleted note back and refuses to replace one', async () => {
  const { restoreNote } = await import('../lib/vault.js');
  const tree = { 'a.md': NOTE };
  const root = folder(tree);
  const items = await readIndex(root, S);
  const text = await deleteNote(root, items[0], S);
  assert.equal(text, NOTE);
  await restoreNote(root, items[0], text);
  assert.equal(tree['a.md'], NOTE);
  await assert.rejects(restoreNote(root, items[0], 'other'), /already exists/);
});
