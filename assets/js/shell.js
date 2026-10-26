/* Shell: keeps one iframe per lab alive (so each lab keeps its state) and shows the selected one.
 * Labs ask for a switch with postMessage({type:'practice-lab:nav', lab}); only same-origin messages are honoured. */
const LABS = { python: 'Python', sql: 'SQL', flow: 'Flowchart' };
const frames = Object.fromEntries(Object.keys(LABS).map(k => [k, document.getElementById('fr-' + k)]));
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// Served by the local bridge on 127.0.0.1? Then the Python lab runs from the 'localhost' origin instead: same server, but a
// different origin, so code you run in the Python lab can never reach the bridge API (see SECURITY.md).
const ALLOWED = new Set([location.origin]);
if (location.hostname === '127.0.0.1') {
  frames.python.dataset.src = `http://localhost:${location.port}/labs/python-lab.html`;
  ALLOWED.add(`http://localhost:${location.port}`);
}

function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { return null; } }

function show(lab) {
  if (!has(LABS, lab)) lab = 'python';
  for (const [k, f] of Object.entries(frames)) {
    const on = k === lab;
    f.classList.toggle('on', on);
    if (on && !f.getAttribute('src')) f.setAttribute('src', f.dataset.src);
  }
  document.title = `${LABS[lab]} lab · Practice Lab – @maduraigeorge`;
  store('lab.tab', lab);
  if (location.hash !== '#' + lab) history.replaceState(null, '', '#' + lab);
  const w = frames[lab].contentWindow; if (w) w.focus();
}

window.addEventListener('message', e => {
  if (!ALLOWED.has(e.origin) || !e.data || e.data.type !== 'practice-lab:nav' || typeof e.data.lab !== 'string' || !has(LABS, e.data.lab)) return;
  show(e.data.lab);
});
window.addEventListener('hashchange', () => show(location.hash.slice(1)));

let start = location.hash.slice(1);
if (!has(LABS, start)) start = store('lab.tab') || 'python';
show(start);
