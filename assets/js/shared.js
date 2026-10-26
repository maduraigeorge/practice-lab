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

/** Phone layout: show one box at a time. `map` is { tabName: panelId }. */
export function initTabs(map, onChange) {
  const nav = $('tabs'), main = document.querySelector('main');
  function setTab(t) {
    main.dataset.tab = t;
    for (const [name, id] of Object.entries(map)) $(id).classList.toggle('tab-on', name === t);
    nav.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
    if (onChange) onChange(t);
  }
  nav.querySelectorAll('button').forEach(b => { b.onclick = () => setTab(b.dataset.t); });
  setTab(Object.keys(map)[0]);
  return setTab;
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
      if (embedded) { e.preventDefault(); window.parent.postMessage({ type: 'practice-lab:nav', lab: id }, location.origin); }
    });
    nav.appendChild(a);
  }
  document.addEventListener('keydown', e => {
    if (!e.altKey || !/^[1-3]$/.test(e.key)) return;
    const id = LABS[+e.key - 1][0]; if (id === current) return;
    e.preventDefault();
    if (embedded) window.parent.postMessage({ type: 'practice-lab:nav', lab: id }, location.origin); else location.href = `${id}-lab.html`;
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
