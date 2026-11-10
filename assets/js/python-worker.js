/* Web Worker that hosts Pyodide (CPython compiled to WebAssembly) and runs lab_runner.py.
 * Messages in : { id, code, stdin }
 * Messages out: { type: 'ready' } | { type: 'fail', msg } | { type: 'result', id, data: <JSON string> }
 * Pyodide is loaded from jsDelivr at a pinned version. */
const PYODIDE_VERSION = '0.26.4';
importScripts(`https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/pyodide.js`);

let py, repl = null;
const ready = (async () => {
  const res = await fetch(new URL('../py/lab_runner.py', self.location.href));
  if (!res.ok) throw new Error('Could not load lab_runner.py (HTTP ' + res.status + ')');
  const source = await res.text();
  py = await loadPyodide();
  py.runPython(source);
  try {                                    // the interactive shell lives in its own namespace; the lab still works if it cannot load
    const r = await fetch(new URL('../py/repl.py', self.location.href));
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const g = py.globals.get('dict')();
    py.runPython(await r.text(), { globals: g });
    repl = { push: g.get('push'), complete: g.get('complete'), sigs: g.get('sigs'), reset: g.get('reset'), banner: g.get('banner') };
  } catch (err) { repl = null; }
  postMessage({ type: 'ready' });
})().catch(e => postMessage({ type: 'fail', msg: String(e && e.message || e) }));

onmessage = async e => {
  await ready;
  if (!py) return;
  if (e.data.type) {                       // shell request: { type: 'repl' | 'complete' | 'reset' | 'banner', rid, ... }
    const { type, rid } = e.data;
    let data;
    try {
      if (!repl) throw new Error('The shell could not be loaded.');
      data = type === 'repl' ? repl.push(String(e.data.line), String(e.data.stdin || ''))
        : type === 'complete' ? repl.complete(String(e.data.text))
        : type === 'sigs' ? repl.sigs(String(e.data.text))
        : type === 'reset' ? repl.reset() : repl.banner();
    } catch (err) { data = JSON.stringify({ fatal: String(err && err.message || err) }); }
    postMessage({ type: 'repl', rid, data });
    return;
  }
  const { id, code, stdin } = e.data;
  try {
    py.globals.set('_code', String(code));
    py.globals.set('_stdin', String(stdin || ''));
    postMessage({ type: 'result', id, data: py.runPython('run(_code, _stdin)') });
  } catch (err) {
    postMessage({ type: 'result', id, data: JSON.stringify({ fatal: String(err && err.message || err) }) });
  }
};
