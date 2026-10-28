/* Small helpers shared by all labs. */

export const $ = id => document.getElementById(id);

const HTML_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Escape text for safe insertion into innerHTML (text AND attribute values). */
export const esc = s => String(s).replace(/[&<>"']/g, c => HTML_ESC[c]);
/** Escape, then turn `code` into <code>, **bold** into <strong> and newlines into <br>. Input is always escaped first. */
export const md = s => esc(s).replace(/`([^`]+)`/g, '<code class="i">$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');

/** localStorage that never throws (private mode, blocked storage, quota). */
export const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  remove(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

/** Show a transient message in the #toast element (text only, never HTML). */
export function toast(title, sub = '', ms = 9000) {
  const t = $('toast'); if (!t) return;
  t.replaceChildren(document.createTextNode(title));
  if (sub) { const s = document.createElement('small'); s.textContent = sub; t.appendChild(s); }
  t.style.display = 'block';
  clearTimeout(t._h); t._h = setTimeout(() => { t.style.display = 'none'; }, ms);
  t.onclick = () => { t.style.display = 'none'; };
}

/** Narrow-screen layout: the tab bar toggles boxes on and off, and every box that is on shares the screen (stacked, or side by side
 *  in landscape). Code + Output start on because they matter most; at least one box always stays on; double-tap a tab to show only that box.
 *  `map` is { tabName: panelId }. */
export function initTabs(map, onChange) {
  const nav = $('tabs'), main = document.querySelector('main'), names = Object.keys(map), key = 'tabs.' + location.pathname.split('/').pop();
  let on = [];
  try { on = JSON.parse(store.get(key, '[]')).filter(n => names.includes(n)); } catch { /* fall back to the default */ }
  if (!on.length) on = ['code', 'output'].filter(n => names.includes(n));
  const shown = new Set(on);
  function apply(changed) {
    for (const [name, id] of Object.entries(map)) $(id).classList.toggle('tab-on', shown.has(name));
    nav.querySelectorAll('button').forEach(b => { const v = shown.has(b.dataset.t); b.classList.toggle('on', v); b.setAttribute('aria-pressed', String(v)); });
    main.dataset.count = shown.size;
    store.set(key, JSON.stringify([...shown]));
    placeGutters();
    if (onChange) changed.forEach(t => onChange(t));
  }
  /* drag the bars between the visible boxes to resize them */
  const main = document.querySelector('main');
  function placeGutters() {
    main.querySelectorAll('.tab-gut').forEach(g => g.remove());
    const vis = Object.values(map).map($).filter(p => p.classList.contains('tab-on'));
    vis.forEach((p, i) => {
      if (!i) return;
      const a = vis[i - 1], g = document.createElement('div');
      g.className = 'tab-gut'; g.title = 'Drag to resize · double-click to share the space equally'; g.setAttribute('aria-hidden', 'true');
      g.addEventListener('pointerdown', e => {
        e.preventDefault(); g.setPointerCapture(e.pointerId); g.classList.add('on');
        const row = getComputedStyle(main).flexDirection === 'row', size = x => x.getBoundingClientRect()[row ? 'width' : 'height'];
        const sa = size(a), sb = size(p), tot = sa + sb, start = row ? e.clientX : e.clientY, min = Math.min(60, tot / 3);
        const move = ev => {
          const d = Math.max(min - sa, Math.min(sb - min, (row ? ev.clientX : ev.clientY) - start));
          a.style.flex = `${(sa + d) / tot} 1 0`; p.style.flex = `${(sb - d) / tot} 1 0`;
        };
        const up = () => { g.classList.remove('on'); g.removeEventListener('pointermove', move); g.removeEventListener('pointerup', up); g.removeEventListener('pointercancel', up); };
        g.addEventListener('pointermove', move); g.addEventListener('pointerup', up); g.addEventListener('pointercancel', up);
      });
      g.addEventListener('dblclick', () => vis.forEach(x => { x.style.flex = ''; }));
      p.before(g);
    });
  }
  matchMedia('(max-width:900px)').addEventListener('change', () => setTimeout(placeGutters, 0));
  nav.querySelectorAll('button').forEach(b => {
    b.title = 'Tap to show or hide · double-tap to show only this box';
    b.onclick = () => {
      const t = b.dataset.t;
      if (shown.has(t)) { if (shown.size === 1) return; shown.delete(t); apply([]); } else { shown.add(t); apply([t]); }
    };
    b.ondblclick = () => { const t = b.dataset.t; shown.clear(); shown.add(t); apply([t]); };
  });
  apply([...shown]);
  return t => { shown.add(t); apply([t]); };
}


/** Surface unexpected errors instead of failing silently. */
export function installErrorHandlers(setStatus) {
  window.addEventListener('error', e => { console.error(e.error || e.message); setStatus('Unexpected error – see the browser console', 'err'); });
  window.addEventListener('unhandledrejection', e => { console.error(e.reason); setStatus('Unexpected error – see the browser console', 'err'); });
}

/** Width of one character of the editor font (for placing the autocomplete popup). */
export function measureChar(textarea) {
  const c = document.createElement('canvas').getContext('2d'), cs = getComputedStyle(textarea);
  c.font = `${cs.fontSize} ${cs.fontFamily}`;
  return c.measureText('M'.repeat(50)).width / 50;
}

/* ---- lab switcher shown in every lab header ---- */
const LABS = [['python', '🐍', 'Python'], ['sql', '🗄️', 'SQL'], ['flow', '📐', 'Flowchart']];

/** Fill <nav class="labnav"> with links to the other labs. Inside the shell iframe the shell switches the visible lab
 *  (so every lab keeps its state); on a standalone page the links are plain navigation. */
export function mountLabNav(current) {
  const nav = document.querySelector('.labnav'); if (!nav) return;
  const embedded = window.parent !== window;
  for (const [id, icon, name] of LABS) {
    const a = document.createElement('a');
    a.href = `${id}-lab.html`; a.title = `${name} lab (Alt+${LABS.findIndex(l => l[0] === id) + 1})`;
    a.textContent = `${icon} `;
    const label = document.createElement('span'); label.textContent = name; a.appendChild(label);
    if (id === current) { a.className = 'on'; a.setAttribute('aria-current', 'page'); }
    a.addEventListener('click', e => {
      if (id === current) return e.preventDefault();
      if (embedded) { e.preventDefault(); window.parent.postMessage({ type: 'practice-lab:nav', lab: id }, '*'); }
    });
    nav.appendChild(a);
  }
  document.addEventListener('keydown', e => {
    if (!e.altKey || !/^[1-3]$/.test(e.key)) return;
    const id = LABS[+e.key - 1][0]; if (id === current) return;
    e.preventDefault();
    if (embedded) window.parent.postMessage({ type: 'practice-lab:nav', lab: id }, '*'); else location.href = `${id}-lab.html`;
  });
}

/** Small popover toggled by a button (closes on outside click / Escape). */
export function initPopover(button, pop) {
  const close = () => { pop.hidden = true; button.setAttribute('aria-expanded', 'false'); };
  button.setAttribute('aria-expanded', 'false');
  button.addEventListener('click', e => { e.stopPropagation(); pop.hidden = !pop.hidden; button.setAttribute('aria-expanded', String(!pop.hidden)); if (!pop.hidden) { const f = pop.querySelector('textarea,input'); if (f) f.focus(); } });
  pop.addEventListener('click', e => e.stopPropagation());
  document.addEventListener('click', close);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  return close;
}

/* ---- editor indentation (Tab / Shift+Tab / Enter) shared by the code editors ---- */
/** Indent for a new line after `line`. `python` adds one level after a trailing ":" and takes one back after pass / break / continue / return. */
export function pyNextIndent(line, w = 4) {
  const ind = line.match(/^[ \t]*/)[0], code = line.replace(/\s+#[^"']*$/, '');
  if (/:\s*$/.test(code)) return ind + ' '.repeat(w);
  if (/^\s*(pass|break|continue|return)\b/.test(code)) return ind.slice(0, Math.max(0, ind.length - w));
  return ind;
}
/** Tab indents (to the next multiple of `w`, or every selected line); Shift+Tab outdents. Returns true when the key was handled. */
export function indentKey(ta, e, w) {
  const { selectionStart: a, selectionEnd: b, value: v } = ta, multi = v.slice(a, b).includes('\n');
  const ls = v.lastIndexOf('\n', a - 1) + 1;
  if (!e.shiftKey && !multi) { ta.setRangeText(' '.repeat(w - ((a - ls) % w)), a, b, 'end'); return true; }
  let le = v.indexOf('\n', b > a && v[b - 1] === '\n' ? b - 1 : b); if (le < 0) le = v.length;
  const lines = v.slice(ls, le).split('\n');
  const out = lines.map(l => e.shiftKey ? l.replace(new RegExp(`^( {1,${w}}|\t)`), '') : ' '.repeat(w) + l);
  ta.setRangeText(out.join('\n'), ls, le, 'select');
  ta.setSelectionRange(ls, ls + out.join('\n').length);
  return true;
}
