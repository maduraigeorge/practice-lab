/* Web Worker that hosts Pyodide (CPython compiled to WebAssembly) and runs lab_runner.py.
 * Messages in : { id, code, stdin }
 * Messages out: { type: 'ready' } | { type: 'fail', msg } | { type: 'result', id, data: <JSON string> }
 * Pyodide is loaded from jsDelivr at a pinned version. */
const PYODIDE_VERSION = '0.26.4';
importScripts(`https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/pyodide.js`);

let py;
const ready = (async () => {
  const res = await fetch(new URL('../py/lab_runner.py', self.location.href));
  if (!res.ok) throw new Error('Could not load lab_runner.py (HTTP ' + res.status + ')');
  const source = await res.text();
  py = await loadPyodide();
  py.runPython(source);
  postMessage({ type: 'ready' });
})().catch(e => postMessage({ type: 'fail', msg: String(e && e.message || e) }));

onmessage = async e => {
  await ready;
  if (!py) return;
  const { id, code, stdin } = e.data;
  try {
    py.globals.set('_code', String(code));
    py.globals.set('_stdin', String(stdin || ''));
    postMessage({ type: 'result', id, data: py.runPython('run(_code, _stdin)') });
  } catch (err) {
    postMessage({ type: 'result', id, data: JSON.stringify({ fatal: String(err && err.message || err) }) });
  }
};
