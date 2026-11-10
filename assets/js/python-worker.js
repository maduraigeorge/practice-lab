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
  try {                                    // code suggestions; the lab still works if this cannot load
    const r = await fetch(new URL('../py/completer.py', self.location.href));
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const g = py.globals.get('dict')();
    g.set('_lab', py.globals);                // lets completer.py see the variables of the last run
    py.runPython(await r.text(), { globals: g });
    repl = { complete: g.get('complete'), sigs: g.get('sigs') };
  } catch (err) { repl = null; }
  postMessage({ type: 'ready' });
})().catch(e => postMessage({ type: 'fail', msg: String(e && e.message || e) }));

onmessage = async e => {
  await ready;
  if (!py) return;
  if (e.data.type) {                       // suggestion request: { type: 'complete' | 'sigs', rid, text }
    const { type, rid } = e.data;
    let data;
    try {
      if (!repl) throw new Error('Suggestions are not available.');
      data = type === 'sigs' ? repl.sigs(String(e.data.text)) : repl.complete(String(e.data.text));
    } catch (err) { data = JSON.stringify(type === 'sigs' ? {} : []); }
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
