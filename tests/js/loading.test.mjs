// makeLoading (assets/js/shared.js): spinner placeholders that can be shown twice and never wipe real content.
import test from 'node:test';
import assert from 'node:assert/strict';

// a tiny stand-in for the DOM parts makeLoading uses
class El {
  constructor(html = '') { this.kids = []; this.text = html; this.hidden = false; this.className = ''; this.parent = null; this._html = html; }
  get innerHTML() { return this.kids.length ? this.kids.map(k => k.outer).join('') : this._html; }
  set innerHTML(v) { this.kids = []; this._html = v; this.text = v; }
  get outer() { return `<${this.tag}>`; }
  get firstElementChild() { return this.kids[0] || null; }
  get textContent() { return this.kids.length ? this.kids.map(k => k.textContent).join('') : this._html; }
  append(...n) { for (const x of n) { if (typeof x === 'string') { this._html += x; this.text += x; } else { x.parent = this; this.kids.push(x); } } }
  replaceChildren(...n) { this.kids = []; this._html = ''; this.text = ''; this.append(...n); }
  setAttribute() {}
  querySelector(sel) { return sel === ':scope > .loading' ? this.kids.find(k => k.className === 'loading') || null : null; }
  remove() { this.parent.kids = this.parent.kids.filter(k => k !== this); }
}
globalThis.document = { createElement: tag => Object.assign(new El(), { tag }) };
const { makeLoading } = await import('../../assets/js/shared.js');

test('show puts a spinner in, hide puts the old content back', () => {
  const box = new El('Nothing yet.'), l = makeLoading();
  l.show([box], 'Loading…');
  assert.equal(box.querySelector(':scope > .loading') !== null, true);
  l.hide();
  assert.equal(box.innerHTML, 'Nothing yet.');
});

test('showing twice does not turn the spinner into the saved content', () => {
  const box = new El('Original'), l = makeLoading();
  l.show([box], 'Loading…'); l.show([box], 'Loading…');
  l.hide();
  assert.equal(box.innerHTML, 'Original');
});

test('content drawn while loading is kept, only the spinner goes away', () => {
  const box = new El('Original'), l = makeLoading();
  l.show([box], 'Loading…');
  const line = document.createElement('div'); line.className = 'log'; box.append(line);
  l.hide();
  assert.equal(box.kids.length, 1);
  assert.equal(box.kids[0], line);
});

test('a box replaced by real content is left alone, and a hidden box stays hidden if the page hid it meanwhile', () => {
  const real = new El('Chart'), l = makeLoading();
  l.show([real], 'Loading…');
  real.innerHTML = '<svg>';                                     // rendered over the spinner
  l.hide();
  assert.equal(real.innerHTML, '<svg>');
  const ph = new El('The flowchart appears here.'); ph.hidden = true;
  l.show([ph], 'Loading…');
  assert.equal(ph.hidden, false);                                // shown while loading
  ph.hidden = true;                                              // a chart was drawn: the page hides the placeholder again
  l.hide();
  assert.equal(ph.hidden, true);
});

test('an empty placeholder that was hidden before loading is hidden again afterwards', () => {
  const ph = new El('The flowchart appears here.'); ph.hidden = true;
  const l = makeLoading();
  l.show([ph], 'Loading…'); l.hide();
  assert.equal(ph.hidden, true);
  assert.equal(ph.innerHTML, 'The flowchart appears here.');
});
