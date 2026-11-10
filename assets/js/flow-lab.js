/* Flowchart & pseudocode lab: editor, live flowchart, step player, variables / trace table, practice checker. */
import { indentKey, pyNextIndent, $, esc, md, store, initTabs, installErrorHandlers, measureChar, mountLabNav, initPopover, toast } from './shared.js';
import { initDock } from './dock.js';
import { parse, PseudoError, KEYWORDS, FUNCTIONS } from './pseudo-parser.js';
import { pythonToPseudo, looksLikePython } from './python-to-pseudo.js';
import { buildChart, renderChart, paintChart, pathEdges } from './pseudo-flow.js';
import { run, parseInputs, fmtVal } from './pseudo-run.js';
import { EXAMPLES, PRACTICE, checkOutput } from './flow-exercises.js';

mountLabNav('flow');
initPopover($('inputBtn'), $('inputPop'));
const LH = 20, PAD = 8;

const S = { program: null, chart: null, els: null, result: null, steps: [], stepEdges: [], idx: 0, playT: null, scale: 1, auto: true,
            goal: null, hintShown: false, err: null, nodeText: new Map(), varNames: [], debounce: null, charW: 8 };

function setStatus(t, cls) { const s = $('status'); s.textContent = t; s.title = t; s.className = 'status ' + (cls || ''); }

/* ================================================================== run everything */
function recompute() {
  const src = $('code').value;
  S.err = null;
  if (!src.trim()) { reset(); $('lang').textContent = 'Pseudocode'; setStatus('Write some pseudocode or Python', ''); return; }
  let program;
  const py = looksLikePython(src);
  $('lang').textContent = py ? '🐍 Python' : 'Pseudocode';
  try { program = parse(py ? pythonToPseudo(src) : src); } catch (e) {
    if (!(e instanceof PseudoError)) { console.error(e); e = new PseudoError('Something unexpected went wrong while reading this code (is it extremely large or deeply nested?).', null); }
    S.err = { message: e.message, line: e.line, kind: 'syntax' };
    $('chart').classList.add('stale');
    renderOutput(); markError(); setStatus(`✗ Syntax error${e.line ? ' on line ' + e.line : ''}`, 'err'); $('tabOut').classList.add('dot');
    return;
  }
  $('chart').classList.remove('stale');
  let chart, res;
  try { chart = buildChart(program); res = run(program, { inputs: parseInputs($('inputs').value) }); }
  catch (e) {                                              // never leave the panes half-updated
    console.error(e);
    S.err = { message: 'Something unexpected went wrong while running this pseudocode: ' + (e && e.message || e), line: null, kind: 'runtime' };
    renderOutput(); setStatus('✗ Unexpected error', 'err'); $('tabOut').classList.add('dot');
    return;
  }
  Object.assign(S, { program, chart, result: res, steps: res.steps });
  S.nodeText = new Map(chart.nodes.map(n => [n.id, n.text]));
  S.stepEdges = res.steps.map((st, i) => (i === 0 ? [] : pathEdges(chart, res.steps[i - 1].node, st.node, res.steps[i - 1].taken)));
  const seen = new Set(); S.varNames = [];
  res.steps.forEach(st => Object.keys(st.vars).forEach(k => { if (!seen.has(k)) { seen.add(k); S.varNames.push(k); } }));
  $('chartEmpty').hidden = true;
  S.els = renderChart($('chart'), chart, gotoNode);
  applyScale();
  renderSteps(); buildTrace();
  S.err = res.error ? { message: res.error.message, line: res.error.line, kind: res.error.kind } : null;
  renderOutput();
  select(S.steps.length - 1);
  $('tabOut').classList.toggle('dot', !!res.error);
  $('bandErr').style.display = 'none'; if (res.error && res.error.line) markError();
  if (!res.error) setStatus(`✓ Ran fine · ${res.steps.length} steps`, 'ok');
  else setStatus(`✗ ${res.error.kind === 'infinite' ? 'Endless loop' : 'Error'}${res.error.line ? ' on line ' + res.error.line : ''}`, 'err');
  if (res.error && res.error.kind === 'infinite') toast('⚠ Endless loop detected – stopped', res.error.message);
}

function reset() {
  stopPlay();
  Object.assign(S, { program: null, chart: null, els: null, result: null, steps: [], stepEdges: [], idx: 0, nodeText: new Map(), varNames: [] });
  $('chart').replaceChildren(); $('chartEmpty').hidden = false; $('chart').classList.remove('stale');
  $('steps').innerHTML = '<span class="empty">Each box of the flowchart that runs is explained here.</span>';
  $('vars').innerHTML = '<span class="empty">Variables will appear here.</span>'; $('trace').replaceChildren();
  $('count').textContent = '0 / 0'; $('slider').max = 0; $('bandCur').style.display = 'none'; $('bandErr').style.display = 'none';
  renderOutput(); updateBtns();
}

/* ================================================================== flowchart view */
function applyScale() {
  const c = S.chart; if (!c) return;
  const svg = $('chart');
  svg.style.width = Math.round(c.W * S.scale) + 'px'; svg.style.height = Math.round(c.H * S.scale) + 'px';
}
function fitWidth() { const c = S.chart; if (!c) return; S.scale = Math.max(0.4, Math.min(1, ($('chartBox').clientWidth - 16) / c.W)); applyScale(); }
function fitAll() { const c = S.chart; if (!c) return; const b = $('chartBox'); S.scale = Math.max(0.3, Math.min(1.5, (b.clientWidth - 16) / c.W, (b.clientHeight - 16) / c.H)); S.auto = false; applyScale(); }
function zoom(f) { S.auto = false; S.scale = Math.max(0.3, Math.min(2.5, S.scale * f)); applyScale(); centerOn(S.steps[S.idx] && S.steps[S.idx].node); }
$('zIn').onclick = () => zoom(1.2); $('zOut').onclick = () => zoom(1 / 1.2); $('zFit').onclick = () => { fitAll(); centerOn(S.steps[S.idx] && S.steps[S.idx].node); };
new ResizeObserver(() => { if (S.auto) fitWidth(); }).observe($('chartBox'));

function centerOn(id) {
  if (!id || !S.chart) return;
  const n = S.chart.nodes.find(x => x.id === id); if (!n) return;
  const box = $('chartBox'), cx = (n.x + n.w / 2) * S.scale, cy = (n.y + n.h / 2) * S.scale;
  const left = $('chart').offsetLeft;
  box.scrollTo({ top: Math.max(0, cy - box.clientHeight / 2), left: Math.max(0, left + cx - box.clientWidth / 2), behavior: 'smooth' });
}
function gotoNode(id) {
  const after = S.steps.findIndex((st, i) => st.node === id && i >= S.idx), any = S.steps.findIndex(st => st.node === id);
  const i = after >= 0 ? after : any;
  if (i >= 0) { stopPlay(); select(i); }
}

/* ================================================================== steps */
function stepLabel(st) { return st.kind === 'start' ? 'start' : st.kind === 'end' ? 'end' : 'L' + st.line; }
function renderSteps() {
  const box = $('steps'), st = S.steps;
  if (!st.length) { box.innerHTML = '<span class="empty">No steps.</span>'; return; }
  box.innerHTML = st.map((s, i) => `<div class="step k-${s.kind}" data-i="${i}"><span class="n">${i + 1}</span><span class="ln mono">${esc(stepLabel(s))}</span>` +
    `<span class="tx">${md(s.text)}<code class="src">${esc(S.nodeText.get(s.node) || '')}</code></span></div>`).join('') +
    (S.result.truncated ? '<div class="empty more-note">…more steps not shown (limit 4000).</div>' : '');
  $('slider').max = Math.max(0, st.length - 1);
}
function select(i) {
  const st = S.steps;
  if (!st.length) return;
  S.idx = Math.min(Math.max(0, i), st.length - 1);
  const cur = st[S.idx];
  document.querySelectorAll('.step.active').forEach(e => e.classList.remove('active'));
  const el = $('steps').querySelector(`.step[data-i="${S.idx}"]`);
  if (el) {
    el.classList.add('active');
    const b = $('steps');
    if (el.offsetTop < b.scrollTop || el.offsetTop + el.offsetHeight > b.scrollTop + b.clientHeight) b.scrollTop = el.offsetTop - b.clientHeight / 2 + el.offsetHeight / 2;
  }
  $('slider').value = S.idx; $('count').textContent = `${S.idx + 1} / ${st.length}`;
  const seenNodes = new Set(), seenEdges = new Set();
  for (let k = 0; k <= S.idx; k++) { seenNodes.add(st[k].node); S.stepEdges[k].forEach(e => seenEdges.add(e)); }
  if (S.els) paintChart(S.els, { activeNode: cur.node, seenNodes, seenEdges, lastEdges: new Set(S.stepEdges[S.idx]) });
  centerOn(cur.node);
  renderVars(cur); markTrace(); positionBands(); updateBtns();
}
function updateBtns() {
  const n = S.steps.length;
  $('first').disabled = $('prev').disabled = S.idx <= 0;
  $('next').disabled = $('last').disabled = S.idx >= n - 1;
  $('play').disabled = n < 2;
}
function stopPlay() { clearInterval(S.playT); S.playT = null; $('play').textContent = '▶ Play'; }
function togglePlay() {
  if (S.playT) return stopPlay();
  if (S.steps.length < 2) return;
  if (S.idx >= S.steps.length - 1) select(0);
  $('play').textContent = '⏸ Pause';
  S.playT = setInterval(() => { if (S.idx >= S.steps.length - 1) stopPlay(); else select(S.idx + 1); }, +$('speed').value);
}
$('play').onclick = togglePlay;
$('first').onclick = () => { stopPlay(); select(0); };
$('prev').onclick = () => { stopPlay(); select(S.idx - 1); };
$('next').onclick = () => { stopPlay(); select(S.idx + 1); };
$('last').onclick = () => { stopPlay(); select(1e9); };
$('slider').oninput = e => { stopPlay(); select(+e.target.value); };
$('speed').onchange = () => { if (S.playT) { stopPlay(); togglePlay(); } };
$('steps').addEventListener('click', e => { const s = e.target.closest('.step'); if (s) { stopPlay(); select(+s.dataset.i); } });
document.addEventListener('keydown', e => {
  if (/TEXTAREA|SELECT|INPUT/.test(document.activeElement.tagName) && document.activeElement.id !== 'slider') return;
  if (e.key === 'ArrowRight') { stopPlay(); select(S.idx + 1); }
  if (e.key === 'ArrowLeft') { stopPlay(); select(S.idx - 1); }
});

/* ================================================================== variables + trace table */
function valueHTML(v) {
  if (Array.isArray(v)) {
    const cells = v.map((x, i) => `<div class="cell"><div class="v mono">${esc(fmtVal(x))}</div><div class="ix">${i}</div></div>`).join('');
    return `<div class="cells">${cells || '<span class="empty">empty list</span>'}</div>`;
  }
  return `<span class="val mono">${esc(fmtVal(v))}</span>`;
}
function renderVars(st) {
  const names = Object.keys(st.vars);
  $('vars').innerHTML = names.length ? '<div class="vars">' + names.map(n => {
    const chg = st.changed.includes(n);
    return `<div class="var${chg ? ' chg' : ''}"><div class="hd"><span class="nm mono">${esc(n)}</span>${chg ? '<span class="bd">changed</span>' : ''}</div>${valueHTML(st.vars[n])}</div>`;
  }).join('') + '</div>' : '<span class="empty">No variables yet – they appear when the algorithm stores a value.</span>';
}
const TRACE_MAX = 600;
function buildTrace() {
  const tb = document.createElement('table'); tb.className = 'trace mono';
  const head = tb.createTHead().insertRow();
  ['#', 'Box', ...S.varNames, 'Output'].forEach(h => { const th = document.createElement('th'); th.textContent = h; head.appendChild(th); });
  const body = tb.createTBody();
  S.steps.slice(0, TRACE_MAX).forEach((st, i) => {
    const r = body.insertRow(); r.dataset.i = i;
    const cells = [String(i + 1), (S.nodeText.get(st.node) || '').slice(0, 26), ...S.varNames.map(n => (n in st.vars ? fmtVal(st.vars[n]) : '')), st.out.replace(/\n$/, '')];
    cells.forEach((t, k) => {
      const td = r.insertCell(); td.textContent = t; td.title = t;
      if (k === 0) td.className = 'n';
      else if (k >= 2 && k < 2 + S.varNames.length && st.changed.includes(S.varNames[k - 2])) td.className = 'chg';
    });
  });
  $('trace').replaceChildren(tb);
}
function markTrace() {
  const rows = $('trace').querySelectorAll('tbody tr');
  rows.forEach((r, i) => { r.hidden = i > S.idx; r.classList.toggle('cur', i === S.idx); });
  if ($('trace').hidden) return;
  const cur = rows[S.idx]; if (cur) cur.scrollIntoView({ block: 'nearest' });
}
document.querySelectorAll('.vtabs button').forEach(b => b.onclick = () => {
  document.querySelectorAll('.vtabs button').forEach(x => x.classList.toggle('on', x === b));
  $('vars').hidden = b.dataset.v !== 'vars'; $('trace').hidden = b.dataset.v !== 'trace'; markTrace();
});

/* ================================================================== output + practice goal */
function runTests(goal) {
  if (!S.program) return null;
  return goal.tests.map(t => {
    const r = run(S.program, { inputs: parseInputs(t.input), maxSteps: 1 });
    return { input: t.input, expected: t.expected, got: r.output.trim(), error: r.error, ok: !r.error && checkOutput(r.output, t.expected) };
  });
}
function goalBanner() {
  const g = S.goal; if (!g) return null;
  const box = document.createElement('div'); box.className = 'goal';
  const h = document.createElement('h3'); h.textContent = '🎯 ' + g.title; box.appendChild(h);
  const p = document.createElement('div'); p.textContent = g.prompt; box.appendChild(p);
  const res = S.err && S.err.kind === 'syntax' ? null : runTests(g);
  const st = document.createElement('div');
  if (!res) { st.textContent = 'Fix the syntax error first – then your program is checked against ' + g.tests.length + ' test(s).'; }
  else {
    const pass = res.filter(r => r.ok).length;
    st.className = pass === res.length ? 'pass' : 'fail';
    st.textContent = pass === res.length ? `✔ All ${res.length} tests pass – well done!` : `✗ ${pass} of ${res.length} tests pass`;
    $('goalState').textContent = pass === res.length ? '✔ solved' : `${pass}/${res.length} tests`;
    const bad = res.filter(r => !r.ok).slice(0, 3);
    if (bad.length) {
      const ul = document.createElement('ul');
      bad.forEach(r => { const li = document.createElement('li'); li.textContent = (r.input ? `Input ${r.input.trim()}: ` : 'No input: ') + `expected "${r.expected}", got "${r.error ? 'error – ' + r.error.message : r.got}"`; ul.appendChild(li); });
      st.appendChild(ul);
    }
  }
  box.appendChild(st);
  if (S.hintShown) { const hn = document.createElement('div'); hn.className = 'hint'; hn.textContent = '💡 ' + g.hint; box.appendChild(hn); }
  const row = document.createElement('div'); row.className = 'row';
  const mkBtn = (label, fn) => { const b = document.createElement('button'); b.className = 'mini'; b.textContent = label; b.onclick = fn; row.appendChild(b); };
  mkBtn('Hint', () => { S.hintShown = true; renderOutput(); });
  mkBtn('Show solution', () => { if (confirm('Replace your code with the solution?')) { $('code').value = g.solution; onEdit(); } });
  mkBtn('Close goal', () => { S.goal = null; $('goalState').textContent = ''; $('examples').value = ''; renderOutput(); });
  box.appendChild(row);
  return box;
}
function renderOutput() {
  const box = $('output'); box.replaceChildren();
  if (!S.goal) $('goalState').textContent = '';
  const banner = goalBanner(); if (banner) box.appendChild(banner);
  const out = S.result ? S.result.output : '';
  if (out) { const pre = document.createElement('pre'); pre.className = 'out mono'; pre.textContent = out; box.appendChild(pre); }
  if (S.err) {
    const d = document.createElement('div'); d.className = 'errbox';
    const b = document.createElement('b'); b.textContent = S.err.kind === 'syntax' ? 'Syntax error' : S.err.kind === 'infinite' ? 'Endless loop' : S.err.kind === 'input' ? 'Needs input' : 'Error';
    d.append(b, document.createTextNode((S.err.line ? ` on line ${S.err.line}` : '') + ': ' + S.err.message));
    if (S.err.kind === 'infinite') { const h = document.createElement('div'); h.className = 'hint'; h.textContent = '💡 Something inside the loop must change the thing the condition checks – for example n = n - 1.'; d.appendChild(h); }
    box.appendChild(d);
  }
  if (!out && !S.err && !banner) { const e = document.createElement('span'); e.className = 'empty'; e.textContent = S.program ? 'The algorithm ran but showed nothing. Try OUTPUT …' : 'Nothing shown yet.'; box.appendChild(e); }
}

/* ================================================================== editor */
const KW_SET = new Set([...KEYWORDS.flatMap(k => k.split(' ')), 'SET', 'LET', 'READ', 'DISPLAY', 'WRITE', 'SHOW', 'START', 'STOP', 'ELIF', 'ELSEIF', 'END', 'EACH', 'FROM', 'NEXT', 'WEND']);
function highlight(src) {
  const re = /(\/\/[^\n]*|#[^\n]*)|("(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z_0-9]*)(\s*\()?/g;
  let out = '', last = 0, m;
  while ((m = re.exec(src))) {
    out += esc(src.slice(last, m.index)); last = re.lastIndex;
    if (m[1]) out += `<span class="t-cmt">${esc(m[1])}</span>`;
    else if (m[2]) out += `<span class="t-str">${esc(m[2])}</span>`;
    else if (m[3]) out += `<span class="t-num">${m[3]}</span>`;
    else { const up = m[4].toUpperCase(); out += KW_SET.has(up) ? `<span class="t-kw">${esc(m[4])}</span>${esc(m[5] || '')}` : m[5] && FUNCTIONS.includes(up) ? `<span class="t-fn">${esc(m[4])}</span>${esc(m[5])}` : esc(m[4]) + esc(m[5] || ''); }
  }
  return out + esc(src.slice(last)) + '\n ';
}
function updateEditor() {
  const ta = $('code'); $('hl').innerHTML = highlight(ta.value);
  const n = ta.value.split('\n').length; $('gut').textContent = Array.from({ length: n }, (_, i) => i + 1).join('\n');
  syncScroll();
}
function syncScroll() {
  const ta = $('code'); $('hl').scrollTop = ta.scrollTop; $('hl').scrollLeft = ta.scrollLeft;
  $('gut').style.transform = `translateY(${-ta.scrollTop}px)`; positionBands();
}
function positionBands() {
  const ta = $('code'), place = (el, line) => { el.style.top = (PAD + (line - 1) * LH - ta.scrollTop) + 'px'; };
  const cur = $('bandCur'), st = S.steps[S.idx];
  if (st && st.line && !(S.err && S.err.kind === 'syntax')) { cur.style.display = 'block'; place(cur, st.line); } else cur.style.display = 'none';
  const eb = $('bandErr'); if (eb.style.display === 'block' && S.err && S.err.line) place(eb, S.err.line);
}
function markError() { const eb = $('bandErr'); if (S.err && S.err.line) { eb.style.display = 'block'; positionBands(); } else eb.style.display = 'none'; }

function onEdit() {
  updateEditor(); store.set('flowLab.code', $('code').value); store.set('flowLab.inputs', $('inputs').value);
  $('bandErr').style.display = 'none'; setStatus('Typing…', 'busy');
  clearTimeout(S.debounce); S.debounce = setTimeout(() => { stopPlay(); recompute(); }, 300);
}
$('code').addEventListener('scroll', () => { syncScroll(); acHide(); });
$('inputs').addEventListener('input', onEdit);

/* autocomplete */
const ac = { items: [], i: 0, start: 0, open: false, nav: false };
let escTab = false;         // Esc, then Tab, moves focus out of the editor (Tab otherwise indents)
function acHide() { ac.open = false; $('ac').style.display = 'none'; }
function acUpdate() {
  const ta = $('code'), pos = ta.selectionStart; if (ta.selectionEnd !== pos) return acHide();
  const before = ta.value.slice(0, pos), m = before.match(/[A-Za-z_][A-Za-z_0-9]*$/), word = m ? m[0] : '';
  if (word.length < 1) return acHide();
  const own = [...new Set(ta.value.match(/[A-Za-z_][A-Za-z_0-9]*/g) || [])].filter(n => n !== word && !KW_SET.has(n.toUpperCase()));
  const pool = [...own.map(n => [n, 'yours']), ...KEYWORDS.map(n => [n, 'keyword']), ...FUNCTIONS.map(n => [n, 'function'])];
  const seen = new Set(), lw = word.toLowerCase();
  const items = pool.filter(([n]) => !seen.has(n) && seen.add(n) && n.toLowerCase() !== lw && n.toLowerCase().startsWith(lw)).slice(0, 24);
  if (!items.length) return acHide();
  Object.assign(ac, { items, i: 0, start: pos - word.length, open: true, nav: false });
  const lines = before.split('\n'), row = lines.length - 1, col = lines[row].length - word.length, el = $('ac');
  el.style.left = Math.max(48, Math.min(46 + 10 + col * S.charW - ta.scrollLeft, ta.clientWidth - 150)) + 'px';
  el.style.top = (PAD + (row + 1) * LH - ta.scrollTop) + 'px'; acRender(); el.style.display = 'block';
}
function acRender() {
  const el = $('ac');
  el.innerHTML = ac.items.map(([n, k], i) => `<div class="${i === ac.i ? 'on' : ''}" data-i="${i}"><span>${esc(n)}</span><small>${esc(k)}</small></div>`).join('');
  const on = el.querySelector('.on'); if (on) on.scrollIntoView({ block: 'nearest' });
}
function acAccept(i = ac.i) { const ta = $('code'); ta.setRangeText(ac.items[i][0], ac.start, ta.selectionStart, 'end'); acHide(); onEdit(); }
$('ac').addEventListener('mousedown', e => { const d = e.target.closest('[data-i]'); if (d) { e.preventDefault(); acAccept(+d.dataset.i); } });
$('code').addEventListener('blur', acHide); $('code').addEventListener('click', acHide);
$('code').addEventListener('input', () => { onEdit(); acUpdate(); });
$('code').addEventListener('keydown', e => {
  const ta = e.target;
  if (ac.open) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); ac.nav = true; ac.i = (ac.i + (e.key === 'ArrowDown' ? 1 : -1) + ac.items.length) % ac.items.length; return acRender(); }
    if (e.key === 'Tab' || (e.key === 'Enter' && ac.nav)) { e.preventDefault(); return acAccept(); }       // Enter only accepts after you moved in the list
    if (e.key === 'Escape') { e.preventDefault(); return acHide(); }
  }
  const leave = escTab; if (e.key !== 'Tab' && e.key !== 'Shift') escTab = false;
  if (e.key === 'Escape') { escTab = true; return; }
  const py = looksLikePython(ta.value);
  if (e.key === 'Tab' && !leave) { e.preventDefault(); indentKey(ta, e, py ? 4 : 2); onEdit(); }
  else if (e.key === 'Enter') {
    e.preventDefault();
    const pos = ta.selectionStart, line = ta.value.slice(0, pos).split('\n').pop();
    let ind = line.match(/^\s*/)[0];
    if (py) ind = pyNextIndent(line);
    else if (/^\s*(ELSE|REPEAT)\b|\b(THEN|DO)\s*$|^\s*(FOR|WHILE)\b/i.test(line) && !/^\s*(ENDIF|ENDWHILE|ENDFOR)/i.test(line)) ind += '  ';
    ta.setRangeText('\n' + ind, pos, ta.selectionEnd, 'end'); onEdit();
  }
});

/* ================================================================== examples, practice, boot */
const sel = $('examples');
sel.innerHTML = '<option value="">Examples &amp; practice…</option>' +
  '<optgroup label="Examples">' + EXAMPLES.map(x => `<option value="e:${esc(x.id)}">${esc(x.title)}</option>`).join('') + '</optgroup>' +
  '<optgroup label="Practice – your program is checked">' + PRACTICE.map(x => `<option value="p:${esc(x.id)}">🎯 ${esc(x.title)}</option>`).join('') + '</optgroup>';
sel.onchange = () => {
  const [kind, id] = sel.value.split(':'); if (!id) return;
  S.hintShown = false;
  if (kind === 'e') { const x = EXAMPLES.find(e => e.id === id); S.goal = null; $('code').value = x.code; $('inputs').value = x.input; }
  else { const x = PRACTICE.find(e => e.id === id); S.goal = x; $('code').value = x.starter; $('inputs').value = ''; }
  onEdit();
};
$('reset').onclick = () => { $('code').value = ''; $('inputs').value = ''; S.goal = null; sel.value = ''; onEdit(); $('code').focus(); };

const setTab = initTabs({ code: 'p-code', flow: 'p-flow', steps: 'p-steps', visual: 'p-visual', output: 'p-output' }, t => {
  if (t === 'code') syncScroll();
  if (t === 'flow') { if (S.auto) fitWidth(); centerOn(S.steps[S.idx] && S.steps[S.idx].node); }
});

initDock({
  key: 'flowLab.dock1', def: 'Classic', panels: ['p-code', 'p-flow', 'p-steps', 'p-visual', 'p-output'],
  presets: {
    'Classic': { d: 'h', k: [[1, { d: 'v', k: [[1.5, 'p-code'], [.8, 'p-output']] }], [1.35, 'p-flow'], [1.1, { d: 'v', k: [[1, 'p-steps'], [1, 'p-visual']] }]] },
    'Chart focus': { d: 'h', k: [[.8, { d: 'v', k: [[1.4, 'p-code'], [.9, 'p-output']] }], [2.3, 'p-flow'], [1, { d: 'v', k: [[1, 'p-steps'], [1, 'p-visual']] }]] },
    'Stacked': { d: 'v', k: [[1.3, { d: 'h', k: [[1, 'p-code'], [1.3, 'p-flow']] }], [1, { d: 'h', k: [[1.2, 'p-steps'], [1, 'p-visual'], [.9, 'p-output']] }]] },
    'Code + chart': { d: 'h', k: [[1, { d: 'v', k: [[2, 'p-code'], [1, 'p-output']] }], [1.7, { d: 'v', k: [[2, 'p-flow'], [1.1, { d: 'h', k: [[1, 'p-steps'], [1, 'p-visual']] }]] }]] },
    'Wide chart': { d: 'v', k: [[1.8, 'p-flow'], [1, { d: 'h', k: [[1, 'p-code'], [1, 'p-steps'], [1, 'p-visual'], [.8, 'p-output']] }]] },
  },
});
installErrorHandlers(setStatus);

(function boot() {
  const first = EXAMPLES.find(e => e.id === 'sum');
  $('code').value = store.get('flowLab.code', first.code);
  $('inputs').value = store.get('flowLab.inputs', first.input);
  updateEditor(); S.charW = measureChar($('code'));
  recompute();
})();
