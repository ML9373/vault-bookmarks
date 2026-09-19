export const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function haystacks(item) {
  return {
    title: fold([item.title, ...item.aliases].join(' ')),
    meta: fold(`${item.category} ${item.groups.join(' ')} ${item.description}`),
    url: fold(item.url),
  };
}

/** Every token must match somewhere; a title hit outranks a category or description hit, then the URL. */
export function search(items, query, group = '') {
  const tokens = fold(query).split(/\s+/).filter(Boolean);
  const pool = group ? items.filter((i) => i.groups.includes(group)) : items;
  const byTitle = (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
  if (!tokens.length) return [...pool].sort(byTitle);
  const scored = [];
  for (const item of pool) {
    const h = haystacks(item);
    let score = 0;
    let all = true;
    for (const t of tokens) {
      if (h.title.startsWith(t)) score += 4;
      else if (h.title.includes(t)) score += 3;
      else if (h.meta.includes(t)) score += 2;
      else if (h.url.includes(t)) score += 1;
      else { all = false; break; }
    }
    if (all) scored.push({ item, score });
  }
  return scored.sort((a, b) => b.score - a.score || byTitle(a.item, b.item)).map((s) => s.item);
}
