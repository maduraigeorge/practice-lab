/* Python lab: editor, worker control, step player and renderers. */
import { indentKey, pyNextIndent, $, esc, md, store, toast, initTabs, installErrorHandlers, measureChar, mountLabNav, initPopover } from './shared.js';
import { initDock } from './dock.js';

const LH = 20, PAD = 8;
let vizMode = store.get('pyLab.viz', 'tutor');
mountLabNav('python');
initPopover($('stdinBtn'), $('stdinPop'));

const EXAMPLES = {
  'Variables & maths': { code: 'price = 250\nqty = 3\ntotal = price * qty\ndiscount = total * 0.1\nfinal = total - discount\nprint("Total:", total)\nprint("You pay:", final)\n' },
  'Loop over a list': { code: 'nums = [4, 8, 15, 16]\nsquares = []\nfor n in nums:\n    squares.append(n * n)\nprint(squares)\nsum(squares)\n' },
  'Function & recursion': { code: 'def factorial(n):\n    if n <= 1:\n        return 1\n    return n * factorial(n - 1)\n\nprint(factorial(4))\n' },
  'Counting with a dict': { code: 'words = "to be or not to be".split()\ncount = {}\nfor w in words:\n    if w in count:\n        count[w] += 1\n    else:\n        count[w] = 1\nprint(count)\n' },
  'Two names, one list': { code: 'a = [1, 2, 3]\nb = a\nb.append(99)\nc = a.copy()\nc.append(5)\nprint(a, b, c)\n' },
  'while loop + input()': { code: 'name = input("Your name? ")\nn = 3\nwhile n > 0:\n    print(n)\n    n -= 1\nprint("Hi", name)\n', stdin: 'Asha' },
  'An error to debug': { code: 'nums = [1, 2, 3]\ntotal = 0\nfor i in range(4):\n    total += nums[i]\nprint(total)\n' },
};

/* ---------- state ---------- */
let worker = null, ready = false, busy = false, dirty = false, runId = 0, timeoutT = null, debounceT = null;
let data = null, idx = 0, playT = null;

/* ---------- worker ---------- */
function startWorker() {
  ready = false;
  worker = new Worker(new URL('./python-worker.js', import.meta.url));
  worker.onmessage = e => {
    const m = e.data;
    if (m.type === 'ready') { ready = true; setStatus('Ready', 'ok'); schedule(0); }
    else if (m.type === 'fail') setStatus('Could not load Python: ' + m.msg + ' (internet needed on first load)', 'err');
    else if (m.type === 'result' && m.id === runId) {
      endRun(); busy = false;
      let d;
      try { d = JSON.parse(m.data); } catch { d = { fatal: 'Unreadable result from the Python worker.' }; }
      handle(d);
      if (dirty) { dirty = false; send(); }
    }
  };
  worker.onerror = e => setStatus('Worker error: ' + (e.message || 'could not start') + ' (open this page through http(s), not file://)', 'err');
}
function setStatus(t, cls) { const s = $('status'); s.textContent = t; s.title = t; s.className = 'status ' + (cls || ''); }

function schedule(ms = 450) { clearTimeout(debounceT); debounceT = setTimeout(requestRun, ms); }
function requestRun() { if (!ready) return; if (busy) { dirty = true; return; } send(); }
let slowT = null;
function endRun() { clearTimeout(timeoutT); clearTimeout(slowT); $('stopBtn').hidden = true; }
function killRun(error) {
  worker.terminate(); busy = false; dirty = false; endRun();
  handle({ ok: false, steps: [], output: '', final: {}, error });
  startWorker();
}
$('stopBtn').onclick = () => killRun({ type: 'Stopped', msg: 'You stopped the program.', line: null, hint: 'If it was an infinite loop, check that something inside the loop changes the loop condition.' });
function send() {
  busy = true; runId++;
  setStatus('Running…', 'busy');
  worker.postMessage({ id: runId, code: $('code').value, stdin: $('stdin').value });
  endRun();
  // big calculations are allowed: after 4 s we just offer a Stop button, and only give up after 2 minutes
  slowT = setTimeout(() => {
    setStatus('Still running… a big calculation, or an infinite loop? Wait, or press Stop.', 'busy');
    $('stopBtn').hidden = false;
    toast('⏳ Still running…', 'This is fine for a big calculation. If you think it is an infinite loop, press Stop.', 7000);
  }, 4000);
  timeoutT = setTimeout(() => killRun({ type: 'TimeoutError', msg: 'The program ran for more than 2 minutes and was stopped.', line: null, hint: 'Does a loop never stop? Check the loop condition.' }), 120000);
}

/* ---------- handle result ---------- */
function handle(d) {
  if (d.fatal) { setStatus('Internal error: ' + d.fatal, 'err'); return; }
  data = d; stopPlay();
  idx = Math.max(0, d.steps.length - 1);
  renderOutput(); renderResult(); renderSteps(); select(idx);
  $('tabOut').classList.toggle('dot', !d.ok);
  if (d.ok) setStatus(`✓ Ran fine · ${d.steps.length} steps${d.trunc ? ' (first ' + d.steps.length + ' shown)' : ''}`, 'ok');
  else setStatus(`✗ ${d.error.type}${d.error.line ? ' on line ' + d.error.line : ''}`, 'err');
  if (d.error && d.error.type === 'InfiniteLoop') toast('⚠ Infinite loop detected – stopped', d.error.msg + (d.error.line ? ` (line ${d.error.line})` : ''));
}

/* ---------- renderers ---------- */
function renderOutput() {
  const d = data; let h = '';
  if (d.output) h += `<pre class="out mono">${esc(d.output)}</pre>`;
  if (d.error) {
    h += `<div class="errbox"><b>${esc(d.error.type)}</b>${d.error.line ? ` on line ${d.error.line}` : ''}: ${esc(d.error.msg)}` +
         (d.error.hint ? `<div class="hint">💡 ${esc(d.error.hint)}</div>` : '') + '</div>';
  }
  $('output').innerHTML = h || '<span class="empty">The program ran but printed nothing. Try print(...)</span>';
  const eb = $('bandErr');
  if (d.error && d.error.line) { eb.style.display = 'block'; positionBands(); } else eb.style.display = 'none';
}
function renderResult() {
  const d = data; let h = '';
  if (d.last) h += `<div class="lastval">Last expression value: <b class="mono">${esc(d.last.r)}</b> <span class="ty">(${esc(d.last.t)})</span></div>`;
  const names = Object.keys(d.final).filter(n => d.final[n].k !== 'fn');
  if (names.length) {
    h += '<table class="res-table mono">' + names.map(n => `<tr><td>${esc(n)}</td><td>${esc(d.final[n].r)}</td><td>${esc(d.final[n].t)}</td></tr>`).join('') + '</table>';
  } else if (!d.last) h = '<span class="empty">No variables yet. Try  x = 5</span>';
  $('result').innerHTML = h;
  $('resMeta').textContent = d.ok ? 'final values' : 'values before the error';
}
function renderSteps() {
  const box = $('steps'), st = data.steps;
  if (!st.length) { box.innerHTML = '<span class="empty">No lines ran.</span>'; }
  else box.innerHTML = st.map((s, i) => {
    const cls = s.kind === 'line' ? '' : ' k-' + s.kind;
    const err = s.exc && s.fatal ? ' k-err' : '';
    return `<div class="step${cls}${err}" data-i="${i}"><span class="n">${i + 1}</span><span class="ln mono">${s.kind === 'call' ? 'call' : s.kind === 'return' ? 'ret' : s.kind === 'end' ? 'end' : 'L' + s.line}</span>` +
           `<span class="tx">${md(s.text)}<code class="src">${esc(s.src.trim())}</code></span></div>`;
  }).join('') + (data.trunc ? '<div class="empty more-note">…more steps not shown (limit 600).</div>' : '');
  const sl = $('slider'); sl.max = Math.max(0, st.length - 1);
}
function select(i) {
  const st = data ? data.steps : [];
  if (!st.length) { idx = 0; $('count').textContent = '0 / 0'; $('visual').innerHTML = '<span class="empty">Variables will appear here.</span>'; $('bandCur').style.display = 'none'; updateBtns(); return; }
  idx = Math.min(Math.max(0, i), st.length - 1);
  document.querySelectorAll('.step.active').forEach(e => e.classList.remove('active'));
  const el = $('steps').querySelector(`.step[data-i="${idx}"]`);
  if (el) {
    el.classList.add('active');
    const b = $('steps');
    if (el.offsetTop < b.scrollTop || el.offsetTop + el.offsetHeight > b.scrollTop + b.clientHeight)
      b.scrollTop = el.offsetTop - b.clientHeight / 2 + el.offsetHeight / 2;
  }
  $('slider').value = idx;
  $('count').textContent = `${idx + 1} / ${st.length}`;
  renderVisual(st[idx]); positionBands(); updateBtns();
}
function updateBtns() {
  const n = data ? data.steps.length : 0;
  $('first').disabled = $('prev').disabled = idx <= 0;
  $('next').disabled = $('last').disabled = idx >= n - 1;
  $('play').disabled = n < 2;
}
function valueHTML(o) {
  if (o.k === 'seq') {
    const cells = o.items.map((x, i) => `<div class="cell"><div class="v mono">${esc(x.r)}</div>${o.ordered ? `<div class="ix">${i}</div>` : ''}</div>`).join('');
    return `<div class="cells">${cells || '<span class="empty">empty</span>'}${o.more ? `<span class="more">+${o.more} more</span>` : ''}</div>`;
  }
  if (o.k === 'map') {
    if (!o.items.length) return '<span class="empty">empty</span>';
    return `<table class="kv mono">${o.items.map(([k, v]) => `<tr><td class="k">${esc(k.r)}</td><td>${esc(v.r)}</td></tr>`).join('')}</table>` + (o.more ? `<span class="more">+${o.more} more</span>` : '');
  }
  if (o.k === 'fn') return '<span class="val mono">ƒ function / class</span>';
  return `<span class="val mono">${esc(o.r)}</span>`;
}
function varsHTML(vars, changed, hideFn) {
  const ids = {};
  for (const [n, o] of Object.entries(vars)) if (o.id) (ids[o.id] = ids[o.id] || []).push(n);
  const cards = Object.entries(vars).filter(([, o]) => !(hideFn && o.k === 'fn')).map(([n, o]) => {
    const chg = changed.includes(n);
    const same = o.id && ids[o.id].length > 1 ? ids[o.id].filter(x => x !== n) : null;
    return `<div class="var${chg ? ' chg' : ''}"><div class="hd"><span class="nm mono">${esc(n)}</span><span class="ty">${esc(o.t)}</span>${chg ? '<span class="bd">changed</span>' : ''}</div>` +
           valueHTML(o) + (same ? `<div class="al">🔗 same object as ${same.map(esc).join(', ')}</div>` : '') + '</div>';
  });
  return cards.length ? `<div class="vars">${cards.join('')}</div>` : '<span class="empty">no variables yet</span>';
}
function renderCards(s) {
  const label = f => f === '<module>' ? 'main program' : f;
  let h = '<div class="stack"><span class="label">Call stack:</span>' +
    s.stack.map((f, i) => `<span class="frame${i === s.stack.length - 1 ? ' top' : ''} mono">${esc(label(f))}</span>`).join('<span class="arrow">→</span>') + '</div>';
  const inFn = s.fn !== '<module>';
  h += `<div class="sec">${inFn ? 'Local variables of ' + esc(s.fn) : 'Variables'}</div>` + varsHTML(s.after, s.changed, true);
  if (inFn && s.glob && Object.values(s.glob).some(o => o.k !== 'fn')) h += '<div class="sec">Global variables</div>' + varsHTML(s.glob, [], true);
  $('visual').innerHTML = h;
}
function renderVisual(s) { if (vizMode === 'tutor') renderTutor(s); else renderCards(s); }

/* ---------- Frames & Objects view (in the spirit of Python Tutor): frames on the left, heap objects on the right, arrows between ---------- */
const SVGNS = 'http://www.w3.org/2000/svg';
const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const isRef = o => o && ['seq', 'map', 'o', 'fn'].includes(o.k) && o.id;
let tutorRO = null;

function objLabel(o) {
  if (o.k === 'fn') { const m = /^<(?:function|class) '?([\w.<>]+)/.exec(o.r); return (o.t === 'type' ? 'class ' : 'function ') + (m ? m[1].replace('__main__.', '') : ''); }
  if (o.k === 'o') return o.t === 'type' ? 'class' : 'instance of ' + o.t;
  return o.t;
}

function renderTutor(s) {
  const frames = s.frames && s.frames.length ? s.frames
    : [{ name: 'Global frame', vars: s.fn === '<module>' ? s.after : (s.glob || {}), cur: s.fn === '<module>' }].concat(s.fn !== '<module>' ? [{ name: s.fn, vars: s.after, cur: true }] : []);
  const root = mk('div', 'tutor'), colF = mk('div', 'tcol'), colO = mk('div', 'tcol');
  colF.appendChild(mk('h3', '', 'Frames')); colO.appendChild(mk('h3', '', 'Objects'));
  const svg = document.createElementNS(SVGNS, 'svg'); svg.setAttribute('class', 'tarrows');
  svg.innerHTML = '<defs><marker id="tarrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" class="tarrowhead"/></marker></defs>';
  const heap = new Map(), order = [], links = [];
  const addObj = o => { if (isRef(o) && !heap.has(o.id)) { heap.set(o.id, o); order.push(o.id); } };
  const valueCell = (o, td, fromObj) => {
    if (isRef(o)) { const d = mk('span', 'tdot'); td.appendChild(d); links.push({ from: d, to: o.id, inHeap: fromObj }); addObj(o); }
    else td.appendChild(mk('span', 'tval mono', o.r));
  };

  frames.forEach(fr => {
    const box = mk('div', 'tframe' + (fr.cur ? ' cur' : '')), tbl = mk('table');
    box.appendChild(mk('div', 'tname', fr.name));
    const entries = Object.entries(fr.vars);
    entries.forEach(([n, o]) => {
      const tr = tbl.insertRow(); if (fr.cur && s.changed.includes(n)) tr.className = 'chg';
      tr.insertCell().textContent = n; valueCell(o, tr.insertCell(), false);
    });
    if (s.kind === 'return' && fr.cur && s.value) { const tr = tbl.insertRow(); tr.className = 'ret'; tr.insertCell().textContent = 'Return value'; valueCell(s.value, tr.insertCell(), false); }
    if (!entries.length && !(s.kind === 'return' && fr.cur)) { const tr = tbl.insertRow(); const td = tr.insertCell(); td.colSpan = 2; td.className = 'empty'; td.textContent = 'no variables yet'; }
    box.appendChild(tbl); colF.appendChild(box);
  });

  for (let i = 0; i < order.length; i++) {          // objects discovered while drawing others are appended to `order`
    const o = heap.get(order[i]), box = mk('div', 'tobj'); box.dataset.id = o.id;
    box.appendChild(mk('div', 'ty', objLabel(o)));
    if (o.k === 'seq') {
      const cells = mk('div', 'cells');
      o.items.forEach((x, k) => { const c = mk('div', 'cell'); if (o.ordered) c.appendChild(mk('div', 'ix', String(k))); const v = mk('div', 'v mono'); valueCell(x, v, true); c.appendChild(v); cells.appendChild(c); });
      if (!o.items.length) cells.appendChild(mk('span', 'empty pad', 'empty'));
      if (o.more) cells.appendChild(mk('span', 'more', `+${o.more} more`));
      box.appendChild(cells);
    } else if (o.k === 'map') {
      const tb = mk('table', 'kv mono');
      o.items.forEach(([k, v]) => { const tr = tb.insertRow(); const tk = tr.insertCell(); tk.className = 'k'; valueCell(k, tk, true); valueCell(v, tr.insertCell(), true); });
      if (!o.items.length) { const td = tb.insertRow().insertCell(); td.className = 'empty'; td.textContent = 'empty'; }
      box.appendChild(tb);
    } else {
      const nm = (/^<(?:function|class) '?([\w.<>]+)/.exec(o.r) || [, ''])[1].replace('__main__.', '');
      box.appendChild(mk('div', 'tval mono pad', o.k === 'fn' ? (o.t === 'type' ? `class ${nm}` : `def ${nm}(…)`) : o.r));
    }
    colO.appendChild(box);
  }
  if (!order.length) colO.appendChild(mk('div', 'empty', 'Lists, dictionaries, functions … appear here.'));

  root.append(svg, colF, colO);
  $('visual').replaceChildren(root);
  const draw = () => {
    svg.querySelectorAll('path.tarrow').forEach(p => p.remove());
    const base = root.getBoundingClientRect();
    for (const l of links) {
      const target = root.querySelector(`.tobj[data-id="${l.to}"]`); if (!target) continue;
      const a = l.from.getBoundingClientRect(), b = target.getBoundingClientRect();
      const x1 = a.left + a.width / 2 - base.left, y1 = a.top + a.height / 2 - base.top;
      let d;
      if (l.inHeap) { const x2 = b.left - base.left + 14, y2 = b.top - base.top; d = `M${x1},${y1} C${x1},${y1 + 34} ${x2},${y2 - 34} ${x2},${y2}`; }
      else { const x2 = b.left - base.left, y2 = b.top - base.top + Math.min(14, b.height / 2); const dx = Math.max(30, (x2 - x1) / 2); d = `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`; }
      const p = document.createElementNS(SVGNS, 'path'); p.setAttribute('d', d); p.setAttribute('class', 'tarrow'); p.setAttribute('marker-end', 'url(#tarrow)'); svg.appendChild(p);
    }
  };
  draw();
  if (tutorRO) tutorRO.disconnect();
  tutorRO = new ResizeObserver(draw); tutorRO.observe(root);
}

document.querySelectorAll('.vtabs button').forEach(b => {
  b.classList.toggle('on', b.dataset.v === vizMode);
  b.onclick = () => { vizMode = b.dataset.v; store.set('pyLab.viz', vizMode); document.querySelectorAll('.vtabs button').forEach(x => x.classList.toggle('on', x === b)); if (data && data.steps.length) renderVisual(data.steps[idx]); };
});

function positionBands() {
  const ta = $('code');
  const place = (el, line) => { el.style.top = (PAD + (line - 1) * LH - ta.scrollTop) + 'px'; };
  const cur = $('bandCur');
  const s = data && data.steps[idx];
  if (s && s.line) { cur.style.display = 'block'; place(cur, s.line); } else cur.style.display = 'none';
  if (data && data.error && data.error.line) place($('bandErr'), data.error.line);
}

/* ---------- editor ---------- */
function updateGutter() {
  const n = $('code').value.split('\n').length;
  $('gut').textContent = Array.from({ length: n }, (_, i) => i + 1).join('\n');
}
function onEdit() {
  updateGutter(); syncScroll();
  store.set('pyLab.code', $('code').value); store.set('pyLab.stdin', $('stdin').value);
  if (ready) setStatus('Typing…', 'busy');
  schedule();
}
function syncScroll() { $('gut').style.transform = `translateY(${-$('code').scrollTop}px)`; positionBands(); }
/* ---------- autocomplete ---------- */
const KEYWORDS = 'False None True and as assert break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield'.split(' ');
const BUILTINS = 'abs all any bin bool chr dict dir divmod enumerate filter float format input int isinstance len list map max min next oct ord pow print range repr reversed round set sorted str sum tuple type zip open'.split(' ');
const METHODS = {
  str: 'capitalize count endswith find format index isalpha isdigit join lower lstrip replace rstrip split startswith strip title upper'.split(' '),
  list: 'append clear copy count extend index insert pop remove reverse sort'.split(' '),
  dict: 'clear copy get items keys pop setdefault update values'.split(' '),
};
const ALL_METHODS = [...new Set([].concat(...Object.values(METHODS)))].sort();
const ac = { items: [], i: 0, start: 0, open: false, nav: false };
let escTab = false;         // Esc, then Tab, moves focus out of the editor (Tab otherwise indents)
let charW = 8.4;
function acHide() { ac.open = false; $('ac').style.display = 'none'; }
function acUpdate() {
  const ta = $('code'), pos = ta.selectionStart;
  if (ta.selectionEnd !== pos) return acHide();
  const before = ta.value.slice(0, pos);
  const m = before.match(/[A-Za-z_][A-Za-z0-9_]*$/);
  const word = m ? m[0] : '', dotted = before.slice(0, before.length - word.length).endsWith('.');
  if (!word && !dotted) return acHide();
  if (!dotted && word.length < 1) return acHide();
  let pool;
  if (dotted) pool = ALL_METHODS.map(n => [n, 'method']);
  else {
    const own = [...new Set(ta.value.match(/[A-Za-z_][A-Za-z0-9_]*/g) || [])].filter(n => n !== word);
    pool = [...own.map(n => [n, 'yours']), ...BUILTINS.map(n => [n, 'built-in']), ...KEYWORDS.map(n => [n, 'keyword'])];
  }
  const seen = new Set(), lw = word.toLowerCase();
  const items = pool.filter(([n]) => !seen.has(n) && seen.add(n) && n !== word && n.toLowerCase().startsWith(lw)).slice(0, 30);
  if (!items.length) return acHide();
  ac.items = items; ac.i = 0; ac.start = pos - word.length; ac.open = true; ac.nav = false;
  const lines = before.split('\n'), row = lines.length - 1, col = lines[row].length - word.length;
  const el = $('ac');
  el.style.left = Math.min(46 + 10 + col * charW - ta.scrollLeft, ta.clientWidth - 150) + 'px';
  el.style.top = (PAD + (row + 1) * LH - ta.scrollTop) + 'px';
  acRender(); el.style.display = 'block';
}
function acRender() {
  const el = $('ac');
  el.innerHTML = ac.items.map(([n, k], i) => `<div class="${i === ac.i ? 'on' : ''}" data-i="${i}"><span>${esc(n)}</span><small>${esc(k)}</small></div>`).join('');
  const on = el.querySelector('.on'); if (on) on.scrollIntoView({ block: 'nearest' });
}
function acAccept(i = ac.i) {
  const ta = $('code'), name = ac.items[i][0];
  ta.setRangeText(name, ac.start, ta.selectionStart, 'end');
  acHide(); onEdit();
}
$('ac').addEventListener('mousedown', e => { const d = e.target.closest('[data-i]'); if (d) { e.preventDefault(); acAccept(+d.dataset.i); } });
$('code').addEventListener('blur', acHide);
$('code').addEventListener('click', acHide);

$('code').addEventListener('input', () => { onEdit(); acUpdate(); });
$('code').addEventListener('scroll', () => { syncScroll(); acHide(); });
$('stdin').addEventListener('input', onEdit);
$('code').addEventListener('keydown', e => {
  const ta = e.target;
  if (ac.open) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); ac.nav = true; ac.i = (ac.i + (e.key === 'ArrowDown' ? 1 : -1) + ac.items.length) % ac.items.length; return acRender();
    }
    if (e.key === 'Tab' || (e.key === 'Enter' && ac.nav)) { e.preventDefault(); return acAccept(); }       // Enter only accepts after you moved in the list
    if (e.key === 'Escape') { e.preventDefault(); return acHide(); }
  }
  const leave = escTab; if (e.key !== 'Tab' && e.key !== 'Shift') escTab = false;
  if (e.key === 'Escape') { escTab = true; return; }
  if (e.key === 'Tab' && !leave) { e.preventDefault(); indentKey(ta, e, 4); onEdit(); }
  else if (e.key === 'Enter') {
    e.preventDefault();
    const pos = ta.selectionStart, line = ta.value.slice(0, pos).split('\n').pop();
    ta.setRangeText('\n' + pyNextIndent(line), pos, ta.selectionEnd, 'end'); onEdit();
  }
});

/* ---------- controls ---------- */
function stopPlay() { clearInterval(playT); playT = null; $('play').textContent = '▶ Play'; }
function togglePlay() {
  if (playT) return stopPlay();
  if (!data || data.steps.length < 2) return;
  if (idx >= data.steps.length - 1) select(0);
  $('play').textContent = '⏸ Pause';
  playT = setInterval(() => { if (idx >= data.steps.length - 1) stopPlay(); else select(idx + 1); }, +$('speed').value);
}
$('play').onclick = togglePlay;
$('first').onclick = () => { stopPlay(); select(0); };
$('prev').onclick = () => { stopPlay(); select(idx - 1); };
$('next').onclick = () => { stopPlay(); select(idx + 1); };
$('last').onclick = () => { stopPlay(); select(1e9); };
$('slider').oninput = e => { stopPlay(); select(+e.target.value); };
$('speed').onchange = () => { if (playT) { stopPlay(); togglePlay(); } };
$('steps').addEventListener('click', e => { const s = e.target.closest('.step'); if (s) { stopPlay(); select(+s.dataset.i); } });
document.addEventListener('keydown', e => {
  if (/TEXTAREA|SELECT|INPUT/.test(document.activeElement.tagName) && document.activeElement.id !== 'slider') return;
  if (e.key === 'ArrowRight') { stopPlay(); select(idx + 1); }
  if (e.key === 'ArrowLeft') { stopPlay(); select(idx - 1); }
});
$('reset').onclick = () => { $('code').value = ''; $('stdin').value = ''; $('examples').value = ''; onEdit(); $('code').focus(); };

const sel = $('examples');
sel.innerHTML = '<option value="">Choose…</option>' + Object.keys(EXAMPLES).map(k => `<option>${esc(k)}</option>`).join('');
sel.onchange = () => {
  const ex = EXAMPLES[sel.value]; if (!ex) return;
  $('code').value = ex.code; $('stdin').value = ex.stdin || ''; onEdit();
};
window.addEventListener('resize', positionBands);
initTabs({ code: 'p-code', result: 'p-result', steps: 'p-steps', visual: 'p-visual', output: 'p-output' }, t => {
  if (t === 'code') { positionBands(); syncScroll(); }
  if (t === 'steps') { const a = $('steps').querySelector('.step.active'); if (a) $('steps').scrollTop = a.offsetTop - $('steps').clientHeight / 2; }
});

/* ---------- boot ---------- */
(function boot() {
  let code = EXAMPLES['Loop over a list'].code, stdin = '';
  code = store.get('pyLab.code', code); stdin = store.get('pyLab.stdin', '');
  $('code').value = code; $('stdin').value = stdin;
  updateGutter(); syncScroll(); charW = measureChar($('code')); startWorker();
})();

/* ---------- dockable layout ---------- */
initDock({
  key: 'pyLab.dock2', def: 'Classic', panels: ['p-code', 'p-steps', 'p-visual', 'p-result', 'p-output'],
  presets: {
    'Classic': { d: 'v', k: [[1.75, { d: 'h', k: [[1.05, 'p-code'], [1, { d: 'v', k: [[1, 'p-steps'], [1, 'p-visual']] }]] }], [.72, { d: 'h', k: [[1.05, 'p-result'], [1, 'p-output']] }]] },
    'Code focus': { d: 'h', k: [[2, 'p-code'], [1, { d: 'v', k: [[1, 'p-steps'], [1, 'p-visual'], [.7, 'p-result'], [.7, 'p-output']] }]] },
    'Stacked': { d: 'v', k: [[1.2, 'p-code'], [1.2, { d: 'h', k: [[1, 'p-steps'], [1, 'p-visual']] }], [.8, { d: 'h', k: [[1, 'p-result'], [1, 'p-output']] }]] },
    'Three columns': { d: 'h', k: [[1, { d: 'v', k: [[2, 'p-code'], [1, 'p-output']] }], [1, 'p-steps'], [1, { d: 'v', k: [[1.3, 'p-visual'], [1, 'p-result']] }]] },
    'Editor on top': { d: 'v', k: [[1, 'p-code'], [1.4, { d: 'h', k: [[1, 'p-steps'], [1, 'p-visual'], [1, { d: 'v', k: [[1, 'p-result'], [1, 'p-output']] }]] }]] },
    'Side by side': { d: 'h', k: [[1, { d: 'v', k: [[2, 'p-code'], [1, 'p-result'], [1, 'p-output']] }], [1, { d: 'v', k: [[1, 'p-steps'], [1, 'p-visual']] }]] },
  },
});
installErrorHandlers(setStatus);
