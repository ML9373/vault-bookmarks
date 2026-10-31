// Turns Chrome's bookmark tree into a flat list of importable links.

/**
 * `tree` is what `chrome.bookmarks.getTree()` returns. Each link keeps the folder it sat in
 * (`folder`, the path from the bookmarks bar or "Other bookmarks") and `category`, the name of the
 * folder it sat in directly, empty for a link at the top of a root folder.
 */
export function flattenBookmarks(tree) {
  const out = [];
  const walk = (node, path) => {
    if (node.url) {
      if (/^https?:\/\/\S+$/i.test(node.url)) {
        out.push({ title: node.title || '', url: node.url, folder: path.join(' / '), category: path.length > 1 ? path[path.length - 1] : '', added: node.dateAdded || 0 });
      }
      return;
    }
    const next = node.title && node.parentId !== undefined ? [...path, node.title] : path;
    for (const child of node.children || []) walk(child, next);
  };
  for (const root of tree) walk(root, []);
  return out;
}

export function foldersOf(links) {
  const counts = new Map();
  for (const l of links) counts.set(l.folder, (counts.get(l.folder) || 0) + 1);
  return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
}
