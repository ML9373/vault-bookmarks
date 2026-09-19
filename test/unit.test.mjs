// Node built-in runner: `node --test "test/*.test.mjs"`. Fixtures are synthetic.
// Optional parity check on a real folder: VB_NOTES=<folder> VB_YAML=<json of each note parsed by a real YAML
// parser> [VB_BODY=<text under the properties>] node --test "test/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseFrontmatter } from '../lib/fm.js';
import { DEFAULTS, resolve, validate, normalize } from '../lib/settings.js';
import { sanitizeFilename, sanitizeTag, stripTitleCounter, truncateName, formatNote, urlKey, suggestFor, tagForCategory, tagsByUse } from '../lib/note.js';
import { search } from '../lib/search.js';
import { toItem, writeNote } from '../lib/vault.js';

const S = { ...DEFAULTS };
const fields = { fileTitle: 'Docs', name: 'Docs: home', url: 'https://example.com/a?b=1#x', category: 'Reference', tag: 'work', description: 'say "hi"', date: '2026-01-02' };

test('defaults write a bare note: properties only, no body, no vault-specific link', () => {
  const text = formatNote(fields, S);
  assert.ok(text.endsWith('aliases:\n  - "Docs"\n  - "Docs: home"\n---\n'));
  assert.ok(!text.includes('[['));
  const fm = parseFrontmatter(text);
  assert.deepEqual(fm.tags, ['Bookmark', 'work']);
  assert.equal(fm.type, 'bookmark');
  assert.equal(fm.URL, 'https://example.com/a?b=1#x');
  assert.equal(fm.Description, 'say "hi"');
  assert.equal(fm.BookmarkStatus, 'Active');
  assert.equal(fm.CreationDate, '2026-01-02');
});

test('settings rename properties, drop fields and add a body', () => {
  const s = { ...S, markerProperty: 'kind', markerValue: 'link', markerTag: '', urlProperty: 'source', categoryProperty: '', statusProperty: '', createdProperty: 'created', body: '> up: [[Links]]' };
  const text = formatNote({ ...fields, tag: '' }, s);
  assert.ok(text.includes('kind: link\nsource: "https://example.com/a?b=1#x"\nDescription:'));
  assert.ok(!/tags:|Category|BookmarkStatus/.test(text));
  assert.ok(text.endsWith('---\n> up: [[Links]]\n\n'));
  assert.equal(toItem('n.md', text, s).url, 'https://example.com/a?b=1#x');
  assert.equal(toItem('n.md', text, S), null, 'not recognised under the default names');
});

test('a bookmark can be marked by a tag instead of a property', () => {
  const s = { ...S, markerProperty: 'tags', markerValue: 'bookmark', markerTag: '' };
  const text = formatNote({ ...fields, tag: 'work' }, s);
  assert.ok(!text.includes('type:'));
  assert.deepEqual(parseFrontmatter(text).tags, ['bookmark', 'work']);
  assert.deepEqual(toItem('n.md', text, s).groups, ['work']);
});

test('parser reads plain scalars, empty values, inline lists', () => {
  const old = '---\ntitle: T\ntags:\n  - Bookmark\n  - work\ntype: bookmark\nURL: https://a.b/c?d=1&e=2\nCategory: Ref\nDescription: ""\nCreationDate: 2026-01-01\n---\nbody\n';
  const fm = parseFrontmatter(old);
  assert.equal(fm.URL, 'https://a.b/c?d=1&e=2');
  assert.equal(fm.Description, '');
  assert.equal(parseFrontmatter('---\ntype: bookmark\nURL:\n---\nsecret\n').URL, '');
  assert.deepEqual(parseFrontmatter('---\ntags: [a, "b c"]\n---\n').tags, ['a', 'b c']);
  assert.equal(parseFrontmatter('no frontmatter'), null);
});

test('toItem: marker tag left out of groups (any case), non-bookmarks and non-http links skipped', () => {
  const note = (extra, url = 'https://a.example/') => `---\ntype: bookmark\ntags:\n  - bookmark\n${extra}URL: ${JSON.stringify(url)}\n---\nbody\n`;
  assert.deepEqual(toItem('a.md', note('  - Work\n'), S).groups, ['Work']);
  assert.equal(toItem('a.md', '---\ntype: hub\nURL: "https://a.example/"\n---\n', S), null);
  for (const bad of ['javascript:alert(1)', 'file:///etc/passwd', 'chrome://extensions', 'data:text/html,x', '']) assert.equal(toItem('b.md', note('', bad), S), null, bad);
  assert.equal(toItem('c.md', '---\ntype: bookmark\nCategory: X\nURL:\n---\nsecret\n', S), null);
});

test('settings: stored values over defaults, validation, normalisation', () => {
  assert.deepEqual(resolve(null), DEFAULTS);
  assert.equal(resolve({ urlProperty: 'src', markerValue: 3 }).urlProperty, 'src');
  assert.equal(resolve({ markerValue: 3 }).markerValue, 'bookmark');
  assert.deepEqual(validate(S), []);
  assert.ok(validate({ ...S, urlProperty: '' }).length);
  assert.ok(validate({ ...S, urlProperty: '1x' }).length);
  assert.ok(validate({ ...S, categoryProperty: 'URL' }).some((e) => /different/.test(e)));
  assert.ok(validate({ ...S, markerTag: 'two words' }).length);
  assert.deepEqual(validate({ ...S, categoryProperty: '', statusProperty: '', createdProperty: '' }), []);
  assert.equal(normalize({ ...S, markerTag: '#Link ', body: 'x \n\n' }).markerTag, 'Link');
  assert.equal(normalize({ ...S, body: 'x \n\n' }).body, 'x');
});

test('naming rules', () => {
  assert.equal(sanitizeFilename('GitHub: a/b | c?'), 'GitHub - a - b - c-');
  assert.equal(sanitizeFilename('Foo — Bar – Baz'), 'Foo - Bar - Baz');
  assert.equal(sanitizeFilename('é'), 'é');
  assert.equal(truncateName('a'.repeat(150)).length, 100);
  assert.equal(truncateName('word '.repeat(30)).endsWith(' '), false);
  assert.equal(sanitizeTag('#My tag!'), 'My-tag');
  assert.equal(sanitizeTag('2024'), '');
  assert.equal(sanitizeTag('a/b_c-d'), 'a/b_c-d');
  assert.equal(sanitizeTag('  '), '');
  assert.equal(stripTitleCounter('(488) Video - Site'), 'Video - Site');
  assert.equal(stripTitleCounter('(9+) Inbox'), 'Inbox');
  assert.equal(stripTitleCounter('(Draft) Notes'), '(Draft) Notes');
  assert.equal(stripTitleCounter('Top 10 (2024)'), 'Top 10 (2024)');
});

test('urlKey ignores www, trailing slash, fragment and tracking parameters but keeps the query', () => {
  assert.equal(urlKey('https://www.a.com/x/#f'), urlKey('https://a.com/x'));
  assert.notEqual(urlKey('https://a.com/x?p=1'), urlKey('https://a.com/x?p=2'));
  assert.equal(urlKey('https://a.com/x?utm_source=mail&p=1&fbclid=z'), urlKey('https://a.com/x?p=1'));
  assert.equal(urlKey('https://a.com/x?utm_source=a'), urlKey('https://a.com/x?utm_source=b'));
  assert.equal(urlKey('https://a.com/x?utm_source=a'), urlKey('https://a.com/x'));
  assert.notEqual(urlKey('https://a.com/x?ref=1'), urlKey('https://a.com/x'), 'ref can select content, so it counts');
});

const it = (title, url, category, groups = [], extra = {}) => ({ file: `${title}.md`, title, url, category, groups, description: '', status: 'Active', aliases: [], ...extra });
const items = [
  it('Docs home', 'https://docs.example.com/', 'Reference', ['work']),
  it('Symbols', 'https://docs.example.com/x', 'Reference', ['work']),
  it('Bank', 'https://bank.example.org/', 'Money', ['home'], { description: 'Banque en ligne', aliases: ['Trading Board'] }),
  it('Clinic', 'https://clinic.example.org/', 'Health', ['home']),
  it('Shared', 'https://x.io/', 'Both', ['home']),
  it('Shared 2', 'https://y.io/', 'Both', ['work']),
  it('Untagged', 'https://z.io/', '', []),
];

test('search folds accents, needs every token, ranks title over category over url, filters by tag', () => {
  assert.equal(search(items, 'banque')[0].title, 'Bank');
  assert.deepEqual(search(items, 'trading BOARD').map((i) => i.title), ['Bank']);
  assert.deepEqual(search(items, 'docs').map((i) => i.title), ['Docs home', 'Symbols']);
  assert.equal(search(items, '', 'work').length, 3);
  assert.equal(search(items, 'zzz').length, 0);
  assert.equal(search(items, '').length, items.length);
});

test('suggestions come from the notes, never from a fixed list', () => {
  assert.deepEqual(tagsByUse(items), ['home', 'work']);
  const s = suggestFor(items, 'https://docs.example.com/new/page');
  assert.equal(s.category, 'Reference');
  assert.equal(s.tag, 'work');
  assert.equal(s.existing, null);
  assert.equal(suggestFor(items, 'https://www.bank.example.org').existing.title, 'Bank');
  assert.deepEqual([suggestFor(items, 'https://unknown.example/').category, suggestFor(items, 'https://unknown.example/').tag], ['', '']);
  assert.equal(tagForCategory(items, 'Money', 'work'), 'home');
  assert.equal(tagForCategory(items, 'Both', 'work'), 'work');
  assert.equal(tagForCategory(items, 'Nothing', ''), '');
});

test('writeNote creates a note and refuses to replace an existing one', async () => {
  const files = new Map();
  const dir = {
    async getFileHandle(name, opts) {
      if (!files.has(name)) {
        if (!opts?.create) throw Object.assign(new Error('nf'), { name: 'NotFoundError' });
        files.set(name, '');
      }
      return { createWritable: async () => ({ write: async (c) => files.set(name, c), close: async () => {} }) };
    },
  };
  await writeNote(dir, 'x.md', 'one');
  assert.equal(files.get('x.md'), 'one');
  await assert.rejects(() => writeNote(dir, 'x.md', 'two'), /already exists/);
  assert.equal(files.get('x.md'), 'one');
});

test('parity with a real folder (optional)', { skip: !process.env.VB_NOTES }, () => {
  const s = { ...DEFAULTS, body: process.env.VB_BODY || '' };
  const truth = JSON.parse(fs.readFileSync(process.env.VB_YAML, 'utf8'));
  let n = 0;
  let rewritten = 0;
  for (const [file, ref] of Object.entries(truth)) {
    if (ref._error) throw new Error(`${file}: ${ref._error}`);
    const text = fs.readFileSync(path.join(process.env.VB_NOTES, file), 'utf8');
    const fm = parseFrontmatter(text);
    for (const k of ['title', 'type', 'URL', 'Category', 'Description', 'BookmarkStatus']) {
      if (ref[k] !== undefined) assert.equal(String(fm[k] ?? ''), String(ref[k] ?? ''), `${file}: ${k}`);
    }
    for (const k of ['tags', 'aliases']) if (ref[k]) assert.deepEqual(fm[k], ref[k], `${file}: ${k}`);
    const item = toItem(file, text, s);
    if (item && fm.aliases.length <= 2 && fm.BookmarkStatus === 'Active' && typeof fm.CreationDate === 'string' && text.startsWith('---\ntitle: "')) {
      const rebuilt = formatNote({ fileTitle: item.title, name: fm.aliases[1] ?? item.title, url: item.url, category: item.category, tag: item.groups[0] || '', description: item.description, date: fm.CreationDate }, s);
      if (rebuilt === text) rewritten++;
    }
    n++;
  }
  assert.ok(n > 0);
  console.log(`# parity: ${n} notes parsed as the YAML parser does, ${rewritten} rewritten byte for byte`);
});
