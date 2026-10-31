// Is a link still alive? Needs host permission for the page that runs it (the manage page asks for it).

/**
 * Asks the server with HEAD, then with GET when HEAD is refused or says "not found" (some servers
 * answer 404 or 405 to HEAD only). Returns `{ verdict, detail }`: `broken` (404, 410, or no server
 * answers), `ok`, or `unknown` (a timeout, a login wall, a rate limit, a server error: not proof of anything).
 */
export async function checkLink(url, { fetchFn = fetch, timeout = 8000 } = {}) {
  const attempt = async (method) => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeout);
    try {
      const r = await fetchFn(url, { method, redirect: 'follow', credentials: 'omit', cache: 'no-store', signal: ac.signal });
      r.body?.cancel?.().catch(() => {});
      return { status: r.status };
    } catch (e) {
      return { error: e.name === 'AbortError' ? 'timeout' : 'unreachable' };
    } finally { clearTimeout(timer); }
  };
  let r = await attempt('HEAD');
  if (r.status === undefined ? r.error === 'unreachable' : r.status >= 400) r = await attempt('GET');
  if (r.error === 'unreachable') return { verdict: 'broken', detail: 'no answer' };
  if (r.error) return { verdict: 'unknown', detail: r.error };
  if (r.status === 404 || r.status === 410) return { verdict: 'broken', detail: String(r.status) };
  if (r.status < 400) return { verdict: 'ok', detail: String(r.status) };
  return { verdict: 'unknown', detail: String(r.status) };
}

/** Runs `worker` over `list` with at most `limit` in flight; `stop()` (returns true) ends the run early. */
export async function pool(list, limit, worker, stop = () => false) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (next < list.length && !stop()) await worker(list[next++]);
  }));
}
