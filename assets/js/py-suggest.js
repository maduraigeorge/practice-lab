/* Pure logic of the code editor's suggestion popup (no DOM access, so it is unit-tested in tests/js/py-suggest.test.mjs):
 *  - the help box for a suggestion (syntax, argument count, one line per argument, description)
 *  - whether accepting a suggestion should add brackets, and the text + placeholders to insert
 *  - Tab-through-the-placeholders bookkeeping
 * A suggestion is [name, kind, detail]; detail comes from assets/py/completer.py: { sig, args: [{ n, k: 'req'|'opt'|'var', dv, kwonly, posonly }], req, opt, var, doc } */
import { esc } from './shared.js';

/** What each argument means: [[name, 'required' | 'optional (default 0)' | ...], ...]. */
export function argNotes(d) {
  return ((d && d.args) || []).map(a => {
    if (a.k === 'var') return [a.n, a.n.startsWith('**') ? 'any number of extra name=value arguments' : 'any number of extra values'];
    let t = a.k === 'req' ? 'required' : `optional (default ${a.dv})`;
    if (a.kwonly) t += `, give it by name: ${a.n}=...`;
    else if (a.posonly) t += `, pass it by position (not ${a.n}=...)`;
    return [a.n, t];
  });
}

/** "1 required + 1 optional argument", "no arguments", ... ('' when the counts are unknown). */
export function argText(d) {
  if (!d || d.req == null) return '';
  const p = [];
  if (d.req) p.push(`${d.req} required`);
  if (d.opt) p.push(`${d.opt} optional`);
  if (d.var) p.push('any number of extra');
  return p.length ? p.join(' + ') + (d.req + d.opt > 1 || d.var ? ' arguments' : ' argument') : 'no arguments';
}

/** The help box for one suggestion. */
export function acTip(name, d) {
  if (!d) return '';
  const a = argText(d);
  return `<p class="tip"><b>${esc(name + (d.sig || '(...)'))}</b>${a ? ' · ' + esc(a) : ''}`
    + argNotes(d).map(([n, t]) => `<span class="ar"><code>${esc(n)}</code> ${esc(t)}</span>`).join('')
    + (d.doc ? `<span class="dc">${esc(d.doc)}</span>` : '') + '</p>';
}

/** The rows (name, syntax beside it, kind) and the help box of the highlighted row. */
export function acHtml(items, active) {
  const rows = items.map(([n, k, d], i) => `<div class="${i === active ? 'on' : ''}" data-i="${i}"><span>${esc(n)}${d && d.sig ? `<i>${esc(d.sig)}</i>` : ''}</span><small>${esc(k)}</small></div>`).join('');
  const it = items[active];
  return rows + (it ? acTip(it[0], it[2]) : '');
}

/** Should accepting a function / class suggestion add `(...)`? `before` is the current line up to the word being completed.
 *  No for places where the name is used as a value or a type: imports, def / class / except lines, keyword values (key=len),
 *  the class argument of isinstance(), annotations. */
export function isCallContext(before) {
  if (/^\s*(from|import|def|class|except)\b/.test(before)) return false;
  if (/[(,]\s*[A-Za-z_]\w*\s*=\s*$/.test(before)) return false;                         // sorted(xs, key=len)
  if (/\b(isinstance|issubclass)\s*\([^()]*,\s*\(?\s*(?:[\w.]+\s*,\s*)*$/.test(before)) return false;   // isinstance(x, str)
  if (/^\s*[A-Za-z_]\w*\s*:\s*$/.test(before)) return false;                             // x: int
  return true;
}

/** The text to insert for a function or method and where to put the selection. Required arguments become placeholders
 *  (positional ones by name, required keyword-only ones as name=name). null when there is nothing to add brackets to. */
export function buildCall(name, d) {
  if (!(d && d.sig)) return null;
  const parts = (d.args || []).filter(a => a.k === 'req').map(a => a.kwonly ? { t: `${a.n}=${a.n}`, v: a.n, off: a.n.length + 1 } : { t: a.n, v: a.n, off: 0 });
  const open = name.length + 1;
  const first = parts[0];
  return { text: `${name}(${parts.map(p => p.t).join(', ')})`, open, parts, sel: first ? [open + first.off, open + first.off + first.v.length] : [open, open] };
}

/** Index of the `)` that closes the `(` just before `open`, or -1 (strings are skipped). */
export function closeOf(value, open) {
  if (value[open - 1] !== '(') return -1;
  let depth = 1, q = '';
  for (let i = open; i < value.length; i++) {
    const c = value[i];
    if (q) { if (c === '\\') i++; else if (c === q) q = ''; continue; }
    if (c === '"' || c === "'") q = c;
    else if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') { if (--depth === 0) return c === ')' ? i : -1; }
    else if (c === '\n' && depth === 1) return -1;                                       // a call being filled in stays on one line
  }
  return -1;
}

/** Is the placeholder session still meaningful: the brackets are intact and the caret is inside them? */
export function snipValid(value, snip, caret) {
  if (!snip) return false;
  const close = closeOf(value, snip.open);
  return close >= 0 && caret >= snip.open && caret <= close;
}

/** Tab pressed inside a placeholder session. Returns { sel: [start, end], snip } (snip null when finished). */
export function snipNext(value, caret, snip) {
  const close = closeOf(value, snip.open);
  if (close < 0) return { sel: [caret, caret], snip: null };
  for (let i = snip.idx + 1; i < snip.parts.length; i++) {
    const p = snip.parts[i], at = value.indexOf(p.t, caret);
    if (at >= 0 && at + p.t.length <= close) return { sel: [at + p.off, at + p.off + p.v.length], snip: { ...snip, idx: i } };
  }
  return { sel: [close + 1, close + 1], snip: null };                                    // done: continue after the closing bracket
}
