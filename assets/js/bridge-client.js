/* Optional local "bridge" (bridge/server.py): lets the SQL lab talk to a real PostgreSQL / MySQL server.
 * A hosted page cannot open database connections, so on GitHub Pages detect() simply returns null. */
let session = null;

/** Returns { token, postgres, mysql, hasKey } when the page is served by the bridge, otherwise null. */
export async function detect() {
  // Only a locally run bridge can answer; skipping other hosts avoids a pointless 404 on GitHub Pages.
  if (!location.protocol.startsWith('http') || !['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname)) return null;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 2500);
    const r = await fetch(new URL('../api/session', location.href), { cache: 'no-store', signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) return null;
    const j = await r.json();
    session = j && typeof j.token === 'string' ? j : null;
  } catch { session = null; }
  return session;
}

export const hasBridge = () => session !== null;
export const bridgeInfo = () => session;

/** POST JSON to the bridge. Always resolves; failures are { ok:false, error:{message} }. */
export async function api(path, body) {
  if (!session) return { ok: false, error: { message: 'The local bridge is not running.' } };
  try {
    const r = await fetch(new URL('../api/' + path, location.href), {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-bridge-token': session.token }, body: JSON.stringify(body),
    });
    return await r.json();
  } catch { return { ok: false, error: { message: 'Cannot reach the bridge server. Is "start.bat" / "python server.py" still running?' } }; }
}
