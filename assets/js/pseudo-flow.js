/* Flowchart builder, layout and SVG renderer for the pseudocode AST.
 *
 * buildChart(program) lays the structured program out as nested blocks (sequence / if / while / repeat) so arrows never
 * cross, and stores the flowchart node ids on every statement as `stmt.fc` (the interpreter uses them to say which
 * node is running). renderChart() turns the result into SVG with DOM calls only (no innerHTML), so user text is safe. */
import { exprText } from './pseudo-parser.js';

const CHAR_W = 6.9, LINE_H = 15, GAP = 28, JR = 4;
let uid = 0;
const nid = () => 'n' + (++uid);

/* ------------------------------------------------------------------ measuring */
function wrap(text, max) {
  const words = String(text).split(' '), lines = []; let cur = '';
  for (const w of words) {
    if (cur && (cur + ' ' + w).length > max) { lines.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines.slice(0, 4).map((l, i, a) => (i === 3 && words.join(' ').length > max * 4 ? l.slice(0, max - 1) + '…' : l)) : [''];
}

function measure(kind, text) {
  if (kind === 'join') return { w: 2 * JR, h: 2 * JR, lines: [] };
  const lines = wrap(text, kind === 'decision' ? 22 : 30), tw = Math.max(...lines.map(l => l.length)) * CHAR_W;
  switch (kind) {
    case 'start': case 'end': return { w: Math.max(tw + 36, 84), h: 32, lines };
    case 'io': return { w: Math.max(tw + 56, 96), h: lines.length * LINE_H + 18, lines };
    case 'decision': return { w: Math.max(tw * 1.5 + 34, 112), h: Math.max(lines.length * LINE_H * 1.5 + 22, 58), lines };
    default: return { w: Math.max(tw + 28, 84), h: lines.length * LINE_H + 18, lines };
  }
}

function nodeBlock(kind, text, line) {
  const m = measure(kind, text), n = { id: nid(), kind, text, lines: m.lines, line: line ?? null, x: 0, y: 0, w: m.w, h: m.h };
  return { nodes: [n], edges: [], W: m.w, H: m.h, axis: m.w / 2, entry: n.id, exit: n.id, decId: n.id };
}

/* ------------------------------------------------------------------ block helpers */
function shift(b, dx, dy) {
  for (const n of b.nodes) { n.x += dx; n.y += dy; }
  for (const e of b.edges) { e.pts = e.pts.map(([x, y]) => [x + dx, y + dy]); if (e.labelAt) e.labelAt = [e.labelAt[0] + dx, e.labelAt[1] + dy]; }
  return b;
}
const absorb = (out, b, dx, dy) => { shift(b, dx, dy); out.nodes.push(...b.nodes); out.edges.push(...b.edges); };
const node = (b, id) => b.nodes.find(n => n.id === id);

function seq(blocks) {
  blocks = blocks.filter(Boolean);
  if (!blocks.length) return null;
  if (blocks.length === 1) return blocks[0];
  const left = Math.max(...blocks.map(b => b.axis)), right = Math.max(...blocks.map(b => b.W - b.axis));
  const out = { nodes: [], edges: [], W: left + right, H: 0, axis: left, entry: blocks[0].entry, exit: blocks[blocks.length - 1].exit };
  let y = 0, prev = null;
  for (const b of blocks) {
    if (prev) out.edges.push({ from: prev.exit, to: b.entry, pts: [[left, y - GAP], [left, y]], label: '' });
    absorb(out, b, left - b.axis, y);
    y += b.H + GAP; prev = b;
  }
  out.H = y - GAP;
  return out;
}

function ifBlock(text, line, thenB, elseB) {
  const d = nodeBlock('decision', text, line), dn = d.nodes[0], jb = nodeBlock('join', '', null), jn = jb.nodes[0];
  const DY = dn.h + 34, side = 44, minSpan = dn.w + 40;
  let xL, xR, lx = 0, rx = 0;
  if (thenB && elseB) { xL = thenB.axis; rx = Math.max(thenB.W + side, xL + minSpan - elseB.axis); xR = rx + elseB.axis; }
  else if (thenB) { xL = thenB.axis; xR = Math.max(thenB.W + side, xL + minSpan); }
  else if (elseB) { xL = 0; rx = Math.max(side, minSpan - elseB.axis); xR = rx + elseB.axis; }
  else { xL = 0; xR = minSpan; }
  const A = (xL + xR) / 2, bh = Math.max(thenB ? thenB.H : 0, elseB ? elseB.H : 0), yJ = DY + bh + 30;
  const out = { nodes: [], edges: [], axis: A, entry: dn.id, exit: jn.id, decId: dn.id, W: 0, H: yJ + JR };
  const dl = [A - dn.w / 2, dn.h / 2], dr = [A + dn.w / 2, dn.h / 2];
  out.nodes.push(dn); dn.x = A - dn.w / 2; dn.y = 0;
  if (thenB) { absorb(out, thenB, lx, DY); out.edges.push({ from: dn.id, to: thenB.entry, label: 'Yes', labelAt: [xL - 26, DY - 8], pts: [dl, [xL, dl[1]], [xL, DY]] }); out.edges.push({ from: thenB.exit, to: jn.id, label: '', pts: [[xL, DY + thenB.H], [xL, yJ], [A - JR, yJ]] }); }
  else out.edges.push({ from: dn.id, to: jn.id, label: 'Yes', labelAt: [dl[0] - 28, dl[1] - 6], pts: [dl, [xL, dl[1]], [xL, yJ], [A - JR, yJ]] });
  if (elseB) { absorb(out, elseB, rx, DY); out.edges.push({ from: dn.id, to: elseB.entry, label: 'No', labelAt: [xR + 10, DY - 8], pts: [dr, [xR, dr[1]], [xR, DY]] }); out.edges.push({ from: elseB.exit, to: jn.id, label: '', pts: [[xR, DY + elseB.H], [xR, yJ], [A + JR, yJ]] }); }
  else out.edges.push({ from: dn.id, to: jn.id, label: 'No', labelAt: [dr[0] + 8, dr[1] - 6], pts: [dr, [xR, dr[1]], [xR, yJ], [A + JR, yJ]] });
  jn.x = A - JR; jn.y = yJ - JR; out.nodes.push(jn);
  out.W = Math.max(thenB ? lx + thenB.W : 0, elseB ? rx + elseB.W : 0, xR + 30, A + dn.w / 2);
  return out;
}

function whileBlock(text, line, bodyB) {
  const d = nodeBlock('decision', text, line), dn = d.nodes[0], jb = nodeBlock('join', '', null), jn = jb.nodes[0];
  const lane = 36, bodyW = bodyB ? bodyB.W : 0, bodyAxis = bodyB ? bodyB.axis : 0;
  const leftExt = Math.max(dn.w / 2, bodyAxis) + lane, rightExt = Math.max(dn.w / 2, bodyW - bodyAxis) + lane;
  const A = leftExt, W = leftExt + rightExt, yBody = dn.h + 30, bodyBottom = yBody + (bodyB ? bodyB.H : 0);
  const yLoop = bodyB ? bodyBottom + 18 : dn.h + 26, yJ = yLoop + 30, xLane = 10, xNo = W - 10;
  const out = { nodes: [dn], edges: [], axis: A, entry: dn.id, exit: jn.id, decId: dn.id, W, H: yJ + JR };
  dn.x = A - dn.w / 2; dn.y = 0;
  const back = [[A, bodyB ? bodyBottom : dn.h], [A, yLoop], [xLane, yLoop], [xLane, dn.h / 2], [A - dn.w / 2, dn.h / 2]];
  if (bodyB) {
    absorb(out, bodyB, A - bodyAxis, yBody);
    out.edges.push({ from: dn.id, to: bodyB.entry, label: 'Yes', labelAt: [A + 8, dn.h + 14], pts: [[A, dn.h], [A, yBody]] });
    out.edges.push({ from: bodyB.exit, to: dn.id, label: '', pts: back });
  } else out.edges.push({ from: dn.id, to: dn.id, label: 'Yes', labelAt: [A + 8, dn.h + 14], pts: back });
  out.edges.push({ from: dn.id, to: jn.id, label: 'No', labelAt: [A + dn.w / 2 + 8, dn.h / 2 - 6], pts: [[A + dn.w / 2, dn.h / 2], [xNo, dn.h / 2], [xNo, yJ], [A + JR, yJ]] });
  jn.x = A - JR; jn.y = yJ - JR; out.nodes.push(jn);
  return out;
}

function repeatBlock(text, line, bodyB) {
  const d = nodeBlock('decision', text, line), dn = d.nodes[0], jb = nodeBlock('join', '', null), jn = jb.nodes[0];
  const lane = 36, leftExt = Math.max(dn.w / 2, bodyB.axis) + lane, rightExt = Math.max(dn.w / 2, bodyB.W - bodyB.axis) + lane;
  const A = leftExt, W = leftExt + rightExt, yD = bodyB.H + 30, yJ = yD + dn.h + 34, xLane = 10;
  const out = { nodes: [], edges: [], axis: A, entry: bodyB.entry, exit: jn.id, decId: dn.id, W, H: yJ + JR };
  absorb(out, bodyB, A - bodyB.axis, 0);
  const en = node(out, bodyB.entry);
  dn.x = A - dn.w / 2; dn.y = yD; out.nodes.push(dn);
  out.edges.push({ from: bodyB.exit, to: dn.id, label: '', pts: [[A, bodyB.H], [A, yD]] });
  const midY = yD + dn.h / 2, entryMid = en.y + en.h / 2;
  out.edges.push({ from: dn.id, to: bodyB.entry, label: 'No', labelAt: [dn.x - 30, midY - 6], pts: [[dn.x, midY], [xLane, midY], [xLane, entryMid], [en.x, entryMid]] });
  out.edges.push({ from: dn.id, to: jn.id, label: 'Yes', labelAt: [A + 8, yD + dn.h + 14], pts: [[A, yD + dn.h], [A, yJ - JR]] });
  jn.x = A - JR; jn.y = yJ - JR; out.nodes.push(jn);
  return out;
}

/* ------------------------------------------------------------------ AST -> blocks */
const T = e => exprText(e);

function blockOf(stmts) { return seq(stmts.map(blockFor).filter(Boolean)); }

function blockFor(s) {
  switch (s.type) {
    case 'begin': case 'end': return null;
    case 'assign': { const b = nodeBlock('process', `${T(s.target)} ← ${T(s.expr)}`, s.line); s.fc = { main: b.entry }; return b; }
    case 'append': { const [l, v] = s.call.args; const b = nodeBlock('process', `Append ${v ? T(v) : '?'} to ${l ? T(l) : '?'}`, s.line); s.fc = { main: b.entry }; return b; }
    case 'input': { const b = nodeBlock('io', 'Input ' + s.targets.map(T).join(', '), s.line); s.fc = { main: b.entry }; return b; }
    case 'output': { const b = nodeBlock('io', 'Output ' + (s.args.length ? s.args.map(T).join(', ') : '(blank line)'), s.line); s.fc = { main: b.entry }; return b; }
    case 'if': {
      const chain = i => {
        if (i >= s.branches.length) return s.orelse ? blockOf(s.orelse.body) : null;
        const br = s.branches[i], elseB = chain(i + 1), thenB = blockOf(br.body);
        const b = ifBlock(T(br.cond) + '?', br.line, thenB, elseB);
        br.fc = { cond: b.decId };
        return b;
      };
      const b = chain(0); s.fc = { cond: s.branches[0].fc.cond }; return b;
    }
    case 'while': { const b = whileBlock(T(s.cond) + '?', s.line, blockOf(s.body)); s.fc = { cond: b.decId }; return b; }
    case 'repeat': {
      const body = blockOf(s.body) || nodeBlock('process', 'Do nothing', s.line);
      const b = repeatBlock(T(s.cond) + '?', s.untilLine, body); s.fc = { cond: b.decId }; return b;
    }
    case 'for': {
      const neg = s.step && ((s.step.t === 'un' && s.step.op === '-') || (s.step.t === 'num' && s.step.v < 0));
      const init = nodeBlock('process', `${s.varName} ← ${T(s.from)}`, s.line);
      const incr = nodeBlock('process', `${s.varName} ← ${s.varName} + ${s.step ? (s.step.t === 'un' ? '(' + T(s.step) + ')' : T(s.step)) : '1'}`, s.line);
      const loop = whileBlock(`${s.varName} ${neg ? '≥' : '≤'} ${T(s.to)}?`, s.line, seq([blockOf(s.body), incr]));
      s.fc = { init: init.entry, cond: loop.decId, incr: incr.entry };
      return seq([init, loop]);
    }
    case 'foreach': {
      const next = nodeBlock('process', `${s.varName} ← next item`, s.line);
      const loop = whileBlock(`More items in ${T(s.iter)}?`, s.line, seq([next, blockOf(s.body)]));
      s.fc = { cond: loop.decId, next: next.entry };
      return loop;
    }
    default: return null;
  }
}

/** Build the whole chart. Returns { nodes, edges, W, H, startId, endId }; sets program.fc = { start, end }. */
export function buildChart(program) {
  uid = 0;
  const start = nodeBlock('start', 'Start', null), end = nodeBlock('end', 'End', null);
  const body = blockOf(program);
  const all = seq([start, body, end]);
  const M = 24;
  shift(all, M, M - 6);
  program.fc = { start: start.entry, end: end.entry };
  return { nodes: all.nodes, edges: all.edges, W: all.W + 2 * M, H: all.H + 2 * M - 6, startId: start.entry, endId: end.entry };
}

/* ------------------------------------------------------------------ edges that were walked */
/** Edge indexes walked when execution moves from node `from` to node `to` (following the Yes/No arrow `label`). */
export function pathEdges(chart, from, to, label) {
  const kind = Object.fromEntries(chart.nodes.map(n => [n.id, n.kind]));
  const found = [];
  (function dfs(cur, trail, first, depth) {
    if (depth > 12) return;
    chart.edges.forEach((e, i) => {
      if (e.from !== cur) return;
      if (first && label && e.label && e.label !== label) return;
      if (e.to === to && (e.to !== cur || trail.length === 0)) { if (!found.length) found.push(...trail, i); return; }
      if (kind[e.to] === 'join' && !trail.includes(i)) dfs(e.to, [...trail, i], false, depth + 1);
    });
  })(from, [], true, 0);
  return found;
}

/* ------------------------------------------------------------------ SVG */
const NS = 'http://www.w3.org/2000/svg';
const el = (name, attrs = {}, text) => {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (text !== undefined) n.textContent = text;
  return n;
};

/** Draw the chart into `svg`. Returns { nodeEls, edgeEls } for highlighting. `onNode(id)` is called when a node is clicked. */
export function renderChart(svg, chart, onNode) {
  svg.replaceChildren();
  svg.setAttribute('viewBox', `0 0 ${chart.W} ${chart.H}`);
  const defs = el('defs'), mk = el('marker', { id: 'fc-arrow', viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' });
  mk.appendChild(el('path', { d: 'M0,0 L10,5 L0,10 z', class: 'fc-arrowhead' })); defs.appendChild(mk); svg.appendChild(defs);

  const eg = el('g', { class: 'fc-edges' }), ng = el('g', { class: 'fc-nodes' }), edgeEls = [], nodeEls = new Map();
  chart.edges.forEach(e => {
    const g = el('g', { class: 'fc-edge' });
    const intoJoin = chart.nodes.find(n => n.id === e.to && n.kind === 'join');         // merge points get no arrowhead
    const line = el('path', { d: 'M' + e.pts.map(p => p.map(v => v.toFixed(1)).join(' ')).join(' L'), class: 'fc-line' });
    if (!intoJoin) line.setAttribute('marker-end', 'url(#fc-arrow)');
    g.appendChild(line);
    if (e.label && e.labelAt) g.appendChild(el('text', { x: e.labelAt[0], y: e.labelAt[1], class: 'fc-label' }, e.label));
    eg.appendChild(g); edgeEls.push(g);
  });
  chart.nodes.forEach(n => {
    const g = el('g', { class: `fc-node ${n.kind}`, 'data-id': n.id, tabindex: n.kind === 'join' ? '-1' : '0' });
    const cx = n.x + n.w / 2, cy = n.y + n.h / 2;
    switch (n.kind) {
      case 'start': case 'end': g.appendChild(el('rect', { x: n.x, y: n.y, width: n.w, height: n.h, rx: n.h / 2 })); break;
      case 'io': { const s = 14; g.appendChild(el('polygon', { points: `${n.x + s},${n.y} ${n.x + n.w},${n.y} ${n.x + n.w - s},${n.y + n.h} ${n.x},${n.y + n.h}` })); break; }
      case 'decision': g.appendChild(el('polygon', { points: `${cx},${n.y} ${n.x + n.w},${cy} ${cx},${n.y + n.h} ${n.x},${cy}` })); break;
      case 'join': g.appendChild(el('circle', { cx, cy, r: JR })); break;
      default: g.appendChild(el('rect', { x: n.x, y: n.y, width: n.w, height: n.h, rx: 7 }));
    }
    if (n.kind !== 'join') {
      const t = el('text', { x: cx, y: cy - ((n.lines.length - 1) * LINE_H) / 2, class: 'fc-text' });
      n.lines.forEach((ln, i) => t.appendChild(el('tspan', { x: cx, dy: i === 0 ? '0.35em' : LINE_H }, ln)));
      g.appendChild(t);
      const title = el('title', {}, n.text); g.appendChild(title);
      g.addEventListener('click', () => onNode && onNode(n.id));
      g.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onNode && onNode(n.id); } });
    }
    ng.appendChild(g); nodeEls.set(n.id, g);
  });
  svg.append(eg, ng);
  return { nodeEls, edgeEls };
}

/** Colour the chart for one step: `seenNodes` already ran, `seenEdges` were walked, `activeNode` is running now. */
export function paintChart(els, { activeNode, seenNodes, seenEdges, lastEdges }) {
  els.nodeEls.forEach((g, id) => { g.classList.toggle('active', id === activeNode); g.classList.toggle('seen', seenNodes.has(id) && id !== activeNode); });
  els.edgeEls.forEach((g, i) => { g.classList.toggle('seen', seenEdges.has(i)); g.classList.toggle('last', lastEdges.has(i)); });
}
