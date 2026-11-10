/* Interactive Python shell box (>>> prompt). The Python side is assets/py/repl.py, running in the same Pyodide worker as the
 * lab, so variables live between lines and Tab completion is taken from the real objects (t = (1, 2) then t. offers count and index).
 * api = { call(type, payload) -> Promise<string>, getStdin() -> string, stop() } */
import { $, esc, pyNextIndent, store, measureChar } from './shared.js';

export function initShell(api) {
  const log = $('shLog'), inp = $('shIn'), prompt = $('shPrompt'), ac = $('shAc'), stopBtn = $('shStop');
  const acs = { items: [], i: 0, start: 0, open: false, nav: false };
  let more = false, busy = false, first = true, reqId = 0, slowT = null, escTab = false;
  let hist = store.get('pyLab.shHist', []); if (!Array.isArray(hist)) hist = [];
  let hi = hist.length, draft = '';

  const scroll = () => { const b = $('sh'); b.scrollTop = b.scrollHeight; };
  function add(cls, html) {
    if (log.querySelector('.empty')) log.textContent = '';
    const d = document.createElement('div'); if (cls) d.className = cls; d.innerHTML = html; log.appendChild(d); scroll();
  }
  const note = t => add('sh-note', esc(t));
  const setPrompt = () => { prompt.textContent = more ? '...' : '>>>'; };
  function fit() { inp.style.height = 'auto'; inp.style.height = inp.scrollHeight + 'px'; }

  /* ---- running a line ---- */
  async function run(line) {
    add('', `<span class="sh-p">${esc(prompt.textContent)}</span> ${esc(line)}`);
    if (line.trim() && hist[hist.length - 1] !== line) { hist.push(line); if (hist.length > 200) hist.shift(); store.set('pyLab.shHist', hist); }
    hi = hist.length; draft = '';
    busy = true; clearTimeout(slowT); slowT = setTimeout(() => { stopBtn.hidden = false; }, 3000);
    let r;
    try { r = JSON.parse(await api.call('repl', { line, stdin: api.getStdin() })); }
    catch (e) { r = { fatal: String(e && e.message || e) }; }
    busy = false; clearTimeout(slowT); stopBtn.hidden = true;
    if (r.fatal) { if (r.fatal !== 'restarted') add('sh-err', esc(r.fatal)); more = false; }
    else {
      if (r.out) add('', esc(r.out.replace(/\n$/, '')));
      if (r.err) add('sh-err', esc(r.err.replace(/\n$/, '')));
      more = r.more;
    }
    setPrompt();
    inp.value = more ? pyNextIndent(line) : ''; fit(); inp.focus();
  }
  async function submit(text) {
    for (const line of text.split('\n')) await run(line);
  }

  /* ---- completion ---- */
  function hide() { acs.open = false; ac.style.display = 'none'; reqId++; }
  async function update() {
    const pos = inp.selectionStart; if (inp.selectionEnd !== pos) return hide();
    const before = inp.value.slice(0, pos), m = before.match(/[A-Za-z_][A-Za-z0-9_]*$/), word = m ? m[0] : '';
    if (!word && !before.endsWith('.')) return hide();
    const id = ++reqId;
    let items;
    try { items = JSON.parse(await api.call('complete', { text: before })); } catch (e) { return; }
    if (id !== reqId) return;
    if (!Array.isArray(items) || !items.length) return hide();
    acs.items = items; acs.i = 0; acs.start = pos - word.length; acs.open = true; acs.nav = false;
    const lines = before.split('\n'), col = lines[lines.length - 1].length - word.length, cw = measureChar(inp);
    ac.style.left = Math.max(0, Math.min(prompt.offsetWidth + 6 + col * cw, $('sh').clientWidth - 220)) + 'px';
    render(); ac.style.display = 'block';
  }
  /** "1 required + 1 optional argument", "no arguments", ... from the counts repl.py worked out. */
  function argText(d) {
    if (!d || d.req == null) return '';
    const p = [];
    if (d.req) p.push(`${d.req} required`);
    if (d.opt) p.push(`${d.opt} optional`);
    if (d.var) p.push('any number of extra');
    return p.length ? p.join(' + ') + (d.req + d.opt > 1 || d.var ? ' arguments' : ' argument') : 'no arguments';
  }
  function render() {
    ac.innerHTML = acs.items.map(([n, k, d], i) => `<div class="${i === acs.i ? 'on' : ''}" data-i="${i}"><span>${esc(n)}${d && d.sig ? `<i>${esc(d.sig)}</i>` : ''}</span><small>${esc(k)}</small></div>`).join('')
      + (() => {                                                   // help line for the highlighted item: syntax, argument count, what it does
        const [n, , d] = acs.items[acs.i];
        if (!d) return '';
        const a = argText(d);
        return `<p class="tip"><b>${esc(n + (d.sig || '(...)'))}</b>${a ? ' · ' + esc(a) : ''}${d.doc ? `<br>${esc(d.doc)}` : ''}</p>`;
      })();
    const on = ac.querySelector('.on'); if (on) on.scrollIntoView({ block: 'nearest' });
  }
  function accept(i = acs.i) {
    inp.setRangeText(acs.items[i][0], acs.start, inp.selectionStart, 'end'); hide(); fit(); inp.focus();
  }
  ac.addEventListener('mousedown', e => { const d = e.target.closest('[data-i]'); if (d) { e.preventDefault(); accept(+d.dataset.i); } });

  /* ---- keyboard ---- */
  inp.addEventListener('input', () => { fit(); update(); });
  inp.addEventListener('blur', hide);
  inp.addEventListener('keydown', e => {
    if (acs.open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); acs.nav = true; acs.i = (acs.i + (e.key === 'ArrowDown' ? 1 : -1) + acs.items.length) % acs.items.length; return render(); }
      if (e.key === 'Tab' || (e.key === 'Enter' && acs.nav)) { e.preventDefault(); return accept(); }
      if (e.key === 'Escape') { e.preventDefault(); return hide(); }
    }
    const leave = escTab; if (e.key !== 'Tab' && e.key !== 'Shift') escTab = false;
    if (e.key === 'Escape') { escTab = true; return; }
    if (e.key === ' ' && e.ctrlKey) { e.preventDefault(); return update(); }
    if (e.key === 'Tab' && !e.shiftKey && !leave) {
      e.preventDefault();
      if (inp.value.slice(0, inp.selectionStart).trim() === '' ) { inp.setRangeText('    ', inp.selectionStart, inp.selectionEnd, 'end'); fit(); } else update();   // Tab on a word asks for completions
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!busy) { const t = inp.value; inp.value = ''; fit(); submit(t); } return; }
    if (e.key === 'l' && e.ctrlKey) { e.preventDefault(); log.textContent = ''; return; }
    if (e.key === 'ArrowUp' && !inp.value.slice(0, inp.selectionStart).includes('\n') && hi > 0) {
      e.preventDefault(); if (hi === hist.length) draft = inp.value; hi--; inp.value = hist[hi]; fit(); inp.setSelectionRange(inp.value.length, inp.value.length);
    } else if (e.key === 'ArrowDown' && hi < hist.length) {
      e.preventDefault(); hi++; inp.value = hi === hist.length ? draft : hist[hi]; fit(); inp.setSelectionRange(inp.value.length, inp.value.length);
    }
  });
  inp.addEventListener('paste', e => {                               // pasting several lines runs them one after another, like a real shell
    const t = (e.clipboardData || window.clipboardData).getData('text').replace(/\r\n?/g, '\n');
    if (t.indexOf('\n') < 0) return;
    e.preventDefault();
    const lines = (inp.value.slice(0, inp.selectionStart) + t + inp.value.slice(inp.selectionEnd)).split('\n'), tail = lines.pop();
    inp.value = tail; fit(); submit(lines.join('\n'));
  });
  $('sh').addEventListener('click', e => { if (!window.getSelection().toString() && !e.target.closest('.ac')) inp.focus(); });

  $('shClear').onclick = () => { log.textContent = ''; inp.focus(); };
  $('shReset').onclick = async () => {
    try { const r = JSON.parse(await api.call('reset')); log.textContent = ''; more = false; setPrompt(); inp.value = ''; fit(); note(r.text || 'Shell reset.'); note('All variables were cleared.'); }
    catch (e) { note('Could not reset the shell: ' + (e && e.message || e)); }
    inp.focus();
  };
  stopBtn.onclick = () => api.stop();

  setPrompt(); fit();
  return {
    /** The Python worker (re)started: show the banner. */
    async ready() {
      const again = !first; first = false; more = false; busy = false; setPrompt();
      if (again) { note('(Python was restarted, so earlier variables are gone.)'); return; }
      try { const r = JSON.parse(await api.call('banner')); log.textContent = ''; note(r.text); }
      catch (e) { log.textContent = ''; note('The shell is not available: ' + (e && e.message || e)); }
    },
  };
}
