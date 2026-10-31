// A small multi-tag field: tags are typed (Enter or comma adds one) or picked from the frequent ones.
import { sanitizeTag } from './note.js';

let counter = 0;

/** Builds the field inside `mount`. `get()` returns the tags; `commit()` adds what is still typed and returns false when that is not a valid tag. */
export function tagPicker(mount, { label = 'Tags', hint = 'optional, Enter or comma adds one' } = {}) {
  const id = `tp${++counter}`;
  mount.className = 'field';
  const lab = document.createElement('label');
  lab.htmlFor = `${id}-in`;
  lab.innerHTML = '<span></span> <span class="hint"></span>';
  lab.children[0].textContent = label;
  lab.children[1].textContent = hint;
  const picked = document.createElement('div');
  picked.className = 'chips picked';
  const input = document.createElement('input');
  input.id = `${id}-in`;
  input.setAttribute('list', `${id}-list`);
  input.maxLength = 60;
  input.placeholder = 'Pick or type a new one';
  const list = document.createElement('datalist');
  list.id = `${id}-list`;
  const frequent = document.createElement('div');
  frequent.className = 'chips';
  frequent.setAttribute('role', 'group');
  frequent.setAttribute('aria-label', 'Frequent tags');
  mount.replaceChildren(lab, picked, input, list, frequent);

  let tags = [];
  let suggestions = [];
  const same = (a, b) => a.toLowerCase() === b.toLowerCase();

  function render() {
    picked.replaceChildren(...tags.map((t) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip on';
      b.textContent = `${t} ×`;
      b.title = `Remove ${t}`;
      b.addEventListener('click', () => { tags = tags.filter((x) => x !== t); render(); });
      return b;
    }));
    frequent.replaceChildren(...suggestions.filter((t) => !tags.some((x) => same(x, t))).slice(0, 6).map((t) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = t;
      b.addEventListener('click', () => { add(t); });
      return b;
    }));
  }

  function add(raw) {
    const t = sanitizeTag(raw);
    if (t && !tags.some((x) => same(x, t))) tags.push(t);
    input.value = '';
    render();
    return Boolean(t);
  }

  input.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ',') && input.value.trim()) { e.preventDefault(); add(input.value); }
    else if (e.key === 'Backspace' && !input.value && tags.length) { tags.pop(); render(); }
  });
  // A pick from the datalist fires `input` without a key: a value that is exactly a known tag is added at once.
  input.addEventListener('input', (e) => {
    if (e.inputType === 'insertReplacementText' || (!e.inputType && input.value)) add(input.value);
  });
  input.addEventListener('blur', () => { if (input.value.trim()) add(input.value); });

  return {
    get: () => [...tags],
    set(next) { tags = [...new Set(next.map(sanitizeTag).filter(Boolean))]; input.value = ''; render(); },
    suggest(next) {
      suggestions = next;
      list.replaceChildren(...next.map((t) => Object.assign(document.createElement('option'), { value: t })));
      render();
    },
    commit() {
      const raw = input.value.trim();
      return raw ? add(raw) : true;
    },
    focus: () => input.focus(),
  };
}
