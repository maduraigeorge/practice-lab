/* Docking layout manager.
 * Drag a title bar to dock a box next to (or swap it with) another one, drag the gutters to resize,
 * minimise / maximise with the buttons, pick a preset from the Layout menu. State is saved per lab.
 *
 * cfg = { key, def, panels: [ids], presets: { name: spec } }
 * spec = panel id | { d: 'h' | 'v', k: [[weight, spec], ...] }
 */
export function initDock(cfg) {
  const main = document.querySelector('main'), mq = matchMedia('(max-width:900px)');
  const panels = {}; cfg.panels.forEach(id => { panels[id] = document.getElementById(id); });
  const elOf = new WeakMap();
  const B = s => typeof s === 'string' ? { t: 'p', id: s } : { t: 's', dir: s.d, kids: s.k.map(([w, x]) => Object.assign(B(x), { w })) };
  const fresh = name => ({ preset: name, tree: B(cfg.presets[name]), hidden: [], solo: null });
  const ids = (n, o = []) => { if (n.t === 'p') o.push(n.id); else n.kids.forEach(k => ids(k, o)); return o; };
  const valid = t => { const a = ids(t).sort().join(), b = cfg.panels.slice().sort().join(); return a === b; };
  let st = null;
  try { const s = JSON.parse(localStorage.getItem(cfg.key)); if (s && s.tree && valid(s.tree)) st = s; } catch (e) {}
  if (!st) st = fresh(cfg.def);
  st.hidden = st.hidden || []; st.solo = st.solo || null;
  const save = () => { try { localStorage.setItem(cfg.key, JSON.stringify(st)); } catch (e) {} };
  const vis = n => n.t === 'p' ? (st.solo ? n.id === st.solo : !st.hidden.includes(n.id)) : n.kids.some(vis);

  const hold = document.createElement('div'); hold.id = 'dkhold'; main.appendChild(hold);
  const tray = document.createElement('div'); tray.id = 'dktray'; main.appendChild(tray);
  let root = null;
  const label = id => { const c = panels[id].querySelector('h2').cloneNode(true); c.querySelectorAll('.num,.right,.wc').forEach(x => x.remove()); return c.textContent.trim(); };

  function build(n) {
    if (n.t === 'p') { const el = panels[n.id]; el.style.flex = `${n.w || 1} 1 0`; elOf.set(n, el); return el; }
    const el = document.createElement('div'); el.className = 'dk-split ' + n.dir; el.style.flex = `${n.w || 1} 1 0`; elOf.set(n, el);
    const kids = n.kids.filter(vis);
    kids.forEach((k, i) => { if (i) el.appendChild(gutter(n, kids[i - 1], k)); el.appendChild(build(k)); });
    return el;
  }
  function render() {
    if (mq.matches) {
      main.classList.remove('dk'); if (root) { root.remove(); root = null; }
      cfg.panels.forEach(id => { panels[id].style.flex = ''; main.insertBefore(panels[id], hold); });
      return;
    }
    main.classList.add('dk');
    cfg.panels.forEach(id => hold.appendChild(panels[id]));
    const r = build(st.tree); r.style.flex = '1 1 0'; r.style.minHeight = '0';
    if (root) root.remove(); root = r; main.insertBefore(r, tray);
    tray.innerHTML = '';
    st.hidden.filter(id => !st.solo).forEach(id => { const b = document.createElement('button'); b.textContent = '▢ ' + label(id); b.title = 'Restore this box'; b.onclick = () => { st.hidden = st.hidden.filter(x => x !== id); save(); render(); }; tray.appendChild(b); });
    if (st.solo) { const b = document.createElement('button'); b.className = 'primary'; b.textContent = '⤡ Back to layout'; b.onclick = () => { st.solo = null; save(); render(); }; tray.appendChild(b); }
    tray.classList.toggle('on', tray.children.length > 0);
    cfg.panels.forEach(id => { const m = panels[id].querySelector('[data-a=max]'); if (m) m.textContent = st.solo === id ? '⤡' : '⛶'; });
    sel.title = 'Layout: ' + (st.preset || 'custom');
  }

  function gutter(node, a, b) {
    const g = document.createElement('div'); g.className = 'dk-gut ' + node.dir; g.title = 'Drag to resize · double-click to reset the layout';
    g.addEventListener('pointerdown', e => {
      e.preventDefault(); g.setPointerCapture(e.pointerId); g.classList.add('on'); document.body.classList.add('dragging');
      const horiz = node.dir === 'h', A = elOf.get(a), Bn = elOf.get(b), size = x => horiz ? x.getBoundingClientRect().width : x.getBoundingClientRect().height;
      const sa = size(A), sb = size(Bn), ws = (a.w || 1) + (b.w || 1), start = horiz ? e.clientX : e.clientY, min = 80;
      const move = ev => {
        let d = (horiz ? ev.clientX : ev.clientY) - start; d = Math.max(min - sa, Math.min(sb - min, d));
        a.w = ws * (sa + d) / (sa + sb); b.w = ws - a.w; A.style.flex = `${a.w} 1 0`; Bn.style.flex = `${b.w} 1 0`;
      };
      const up = () => { g.classList.remove('on'); document.body.classList.remove('dragging'); g.removeEventListener('pointermove', move); g.removeEventListener('pointerup', up); g.removeEventListener('pointercancel', up); st.preset = st.preset || 'custom'; save(); };
      g.addEventListener('pointermove', move); g.addEventListener('pointerup', up); g.addEventListener('pointercancel', up);
    });
    g.addEventListener('dblclick', () => { const h = st.hidden; st = fresh(cfg.presets[st.preset] ? st.preset : cfg.def); st.hidden = h; save(); render(); });
    return g;
  }

  /* ---- tree surgery ---- */
  const find = (n, id, parent = null) => { if (n.t === 'p') return n.id === id ? { n, parent } : null; for (const k of n.kids) { const r = find(k, id, n); if (r) return r; } return null; };
  const parentOf = (n, t = st.tree) => { if (t.t === 'p') return null; if (t.kids.includes(n)) return t; for (const k of t.kids) { const r = parentOf(n, k); if (r) return r; } return null; };
  function detach(id) {
    const { n, parent } = find(st.tree, id); parent.kids.splice(parent.kids.indexOf(n), 1);
    if (parent.kids.length === 1) { const only = parent.kids[0], gp = parentOf(parent); only.w = parent.w; if (!gp) st.tree = only; else gp.kids[gp.kids.indexOf(parent)] = only; }
    return n;
  }
  function dock(src, tgt, zone) {
    if (zone === 'center') { const a = find(st.tree, src).n, b = find(st.tree, tgt).n; [a.id, b.id] = [b.id, a.id]; }
    else {
      const n = detach(src), { n: t, parent } = find(st.tree, tgt), dir = zone === 'left' || zone === 'right' ? 'h' : 'v', first = zone === 'left' || zone === 'top', tw = t.w || 1;
      if (parent && parent.dir === dir) { t.w = tw / 2; n.w = tw / 2; parent.kids.splice(parent.kids.indexOf(t) + (first ? 0 : 1), 0, n); }
      else { const s = { t: 's', dir, w: tw, kids: first ? [n, t] : [t, n] }; n.w = 1; t.w = 1; if (!parent) st.tree = s; else parent.kids[parent.kids.indexOf(t)] = s; }
    }
    st.preset = 'custom'; save(); render();
  }

  /* ---- drag a title bar to dock ---- */
  const zoneEl = document.createElement('div'); zoneEl.className = 'dk-zone'; document.body.appendChild(zoneEl);
  function targetAt(x, y, self) {
    for (const el of document.elementsFromPoint(x, y)) {
      const p = el.closest && el.closest('.panel'); if (!p || p.id === self || !panels[p.id]) continue;
      const r = p.getBoundingClientRect(), fx = (x - r.left) / r.width, fy = (y - r.top) / r.height;
      let zone = 'center';
      if (!(fx > .28 && fx < .72 && fy > .28 && fy < .72)) { const d = { left: fx, right: 1 - fx, top: fy, bottom: 1 - fy }; zone = Object.keys(d).sort((a, b) => d[a] - d[b])[0]; }
      return { id: p.id, zone, r };
    }
    return null;
  }
  function showZone(t) {
    if (!t) { zoneEl.style.display = 'none'; return; }
    const { r, zone } = t; let L = r.left, T = r.top, W = r.width, H = r.height;
    if (zone === 'left') W /= 2; else if (zone === 'right') { L += W / 2; W /= 2; } else if (zone === 'top') H /= 2; else if (zone === 'bottom') { T += H / 2; H /= 2; }
    Object.assign(zoneEl.style, { display: 'block', left: L + 'px', top: T + 'px', width: W + 'px', height: H + 'px' });
  }
  document.addEventListener('pointerdown', e => {
    if (e.button !== 0 || mq.matches) return;
    const h2 = e.target.closest('.panel > h2'); if (!h2 || e.target.closest('button,input,select,label,a,textarea')) return;
    const pid = h2.parentElement.id; if (!panels[pid] || st.solo) return;
    const sx = e.clientX, sy = e.clientY; let active = false, ghost = null, over = null;
    const mv = ev => {
      if (!active) { if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return; active = true; document.body.classList.add('dragging'); ghost = document.createElement('div'); ghost.className = 'dk-ghost'; ghost.textContent = '⠿ ' + label(pid); document.body.appendChild(ghost); }
      ghost.style.left = ev.clientX + 12 + 'px'; ghost.style.top = ev.clientY + 12 + 'px';
      over = targetAt(ev.clientX, ev.clientY, pid); showZone(over);
    };
    const up = () => {
      window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
      if (!active) return; document.body.classList.remove('dragging'); ghost.remove(); showZone(null);
      if (over) dock(pid, over.id, over.zone);
    };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  });

  /* ---- minimise / maximise buttons ---- */
  cfg.panels.forEach(id => {
    const h2 = panels[id].querySelector('h2'), wc = document.createElement('span'); wc.className = 'wc';
    wc.innerHTML = '<button class="wb" data-a="min" title="Minimise (restore from the bar below)">▁</button><button class="wb" data-a="max" title="Maximise / restore">⛶</button>';
    h2.appendChild(wc);
    wc.addEventListener('click', e => {
      const a = e.target.closest('button'); if (!a) return;
      if (a.dataset.a === 'min') { if (cfg.panels.filter(x => !st.hidden.includes(x)).length <= 1) return; st.hidden.push(id); }
      else st.solo = st.solo === id ? null : id;
      save(); render();
    });
    h2.addEventListener('dblclick', e => { if (!e.target.closest('button,input,select,label')) { st.solo = st.solo === id ? null : id; save(); render(); } });
  });

  /* ---- layout menu ---- */
  const sel = document.createElement('select'); sel.id = 'layoutSel'; sel.setAttribute('aria-label', 'Layout');
  sel.innerHTML = '<option value="">▦ Layout</option>' + Object.keys(cfg.presets).map(k => `<option value="p:${k}">${k}</option>`).join('') + '<option value="restore">▢ Restore all boxes</option><option value="reset">⟲ Reset layout</option>';
  sel.onchange = () => {
    const v = sel.value; sel.value = '';
    if (v.startsWith('p:')) st = fresh(v.slice(2));
    else if (v === 'restore') { st.hidden = []; st.solo = null; }
    else if (v === 'reset') st = fresh(cfg.def);
    else return;
    save(); render();
  };
  const sp = document.querySelector('header .spacer'); if (sp) sp.after(sel);
  mq.addEventListener('change', render);
  render();
}
