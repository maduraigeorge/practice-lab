// Browser stand-in for `node:test` so the same test files run in tests/js/harness.html.
export const results = [];
const pending = [];
export default function test(name, fn) {
  pending.push((async () => {
    try { await fn(); results.push({ name, ok: true }); }
    catch (e) { results.push({ name, ok: false, error: String(e && e.message || e) }); }
  })());
}
export const done = () => Promise.all(pending).then(() => results);
