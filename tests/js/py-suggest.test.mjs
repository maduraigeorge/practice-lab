// Unit tests for the code editor's suggestion popup logic (assets/js/py-suggest.js): help box, brackets, placeholders, Tab jumping.
import test from 'node:test';
import assert from 'node:assert/strict';
import { argNotes, argText, acTip, acHtml, isCallContext, buildCall, closeOf, snipValid, snipNext } from '../../assets/js/py-suggest.js';

const req = n => ({ n, k: 'req' });
const detail = (args, extra = {}) => ({
  sig: '(' + args.map(a => a.k === 'opt' ? `${a.n}=${a.dv}` : a.n).join(', ') + ')', args,
  req: args.filter(a => a.k === 'req').length, opt: args.filter(a => a.k === 'opt').length, var: args.some(a => a.k === 'var'), doc: 'Does a thing.', ...extra,
});
const ADD = detail([{ ...req('element'), posonly: true }]);
const INDEX = detail([req('value'), { n: 'start', k: 'opt', dv: '0', posonly: true }, { n: 'stop', k: 'opt', dv: '9', posonly: true }]);

test('argText counts required and optional arguments', () => {
  assert.equal(argText(ADD), '1 required argument');
  assert.equal(argText(INDEX), '1 required + 2 optional arguments');
  assert.equal(argText(detail([])), 'no arguments');
  assert.equal(argText(detail([{ n: '*others', k: 'var' }])), 'any number of extra arguments');
  assert.equal(argText({ sig: '(x)', req: null }), '');
});

test('argNotes explain every argument, including position-only and keyword-only ones', () => {
  const n = Object.fromEntries(argNotes(INDEX));
  assert.equal(n.value, 'required');
  assert.match(n.start, /optional \(default 0\), pass it by position \(not start=\.\.\.\)/);
  const kw = Object.fromEntries(argNotes(detail([{ n: 'key', k: 'opt', dv: 'None', kwonly: true }, { n: '**opts', k: 'var' }])));
  assert.match(kw.key, /give it by name: key=/);
  assert.match(kw['**opts'], /extra name=value/);
});

test('acTip shows the syntax, the counts, each argument and the description, and escapes HTML', () => {
  const html = acTip('add', ADD);
  assert.match(html, /<b>add\(element\)<\/b> · 1 required argument/);
  assert.match(html, /<code>element<\/code> required, pass it by position/);
  assert.match(html, /Does a thing\./);
  assert.equal(acTip('x', null), '');
  assert.ok(!acTip('<b>', { sig: '(<i>)', args: [], req: 0, opt: 0, doc: '<script>' }).includes('<script>'));
});

test('acHtml: syntax beside every name, a help box only for the highlighted row, no per-row tooltips', () => {
  const html = acHtml([['add', 'set method', ADD], ['x', 'yours', null]], 0);
  assert.match(html, /<div class="on" data-i="0"><span>add<i>\(element\)<\/i><\/span><small>set method<\/small><\/div>/);
  assert.match(html, /<div class="" data-i="1"><span>x<\/span>/);
  assert.equal((html.match(/class="tip"/g) || []).length, 1);
  assert.ok(!html.includes('title='));
  assert.ok(!acHtml([['x', 'yours', null]], 0).includes('tip'));
});

test('isCallContext: brackets only where the name is being called', () => {
  for (const yes of ['', 'x = ', 'print(', 'print(1, ', 's.', 'for i in ', 'if ', 'return ', 'sorted(xs, reverse=True, key=len)\ny = ']) {
    assert.equal(isCallContext(yes.split('\n').pop()), true, JSON.stringify(yes));
  }
  for (const no of ['from math import ', 'import ', 'def ', 'def f(x: ', 'class A(', 'except ', 'sorted(xs, key=', 'f(a, flag=', 'isinstance(x, ', 'isinstance(x, (int, ', 'x: ']) {
    assert.equal(isCallContext(no), false, JSON.stringify(no));
  }
});

test('buildCall: required arguments become placeholders, optional ones are left out', () => {
  const c = buildCall('index', INDEX);
  assert.equal(c.text, 'index(value)');
  assert.deepEqual(c.sel, [6, 11]);                                   // "value" is selected
  const none = buildCall('copy', detail([]));
  assert.equal(none.text, 'copy()');
  assert.deepEqual(none.sel, [5, 5]);                                 // cursor between the brackets
  assert.equal(buildCall('x', null), null);
  assert.equal(buildCall('x', { sig: null, args: null }), null);
  const two = buildCall('f', detail([req('a'), req('b')]));
  assert.equal(two.text, 'f(a, b)');
  assert.deepEqual(two.sel, [2, 3]);
});

test('buildCall: a required keyword-only argument is written name=name, never positionally', () => {
  const c = buildCall('f', detail([req('a'), { n: 'b', k: 'req', kwonly: true }]));
  assert.equal(c.text, 'f(a, b=b)');
  assert.equal(c.parts[1].off, 2);
  assert.equal(buildCall('g', detail([{ n: 'b', k: 'req', kwonly: true }])).sel[0], 4);   // g(b=b): selection starts on the value
});

test('closeOf finds the matching bracket, skipping strings and nested calls', () => {
  assert.equal(closeOf('f(a, g(b))', 2), 9);
  assert.equal(closeOf('f(")", x)', 2), 8);
  assert.equal(closeOf('f(a', 2), -1);
  assert.equal(closeOf('f(a,\nb)', 2), -1);                           // a call being filled in stays on one line
  assert.equal(closeOf('xf', 1), -1);                                 // not preceded by "("
});

test('placeholders: Tab moves through them and then past the closing bracket', () => {
  const text = 'f(a, b)', snip = { open: 2, parts: [{ t: 'a', v: 'a', off: 0 }, { t: 'b', v: 'b', off: 0 }], idx: 0 };
  assert.equal(snipValid(text, snip, 2), true);
  let r = snipNext(text, 3, snip);                                    // "a" selected, user presses Tab
  assert.deepEqual(r.sel, [5, 6]);
  assert.equal(r.snip.idx, 1);
  r = snipNext(text, 6, r.snip);
  assert.deepEqual(r.sel, [7, 7]);
  assert.equal(r.snip, null);
});

test('placeholders: edited text and a caret outside the call end the session instead of jumping elsewhere', () => {
  const snip = { open: 2, parts: [{ t: 'a', v: 'a', off: 0 }, { t: 'b', v: 'b', off: 0 }], idx: 0 };
  assert.equal(snipValid('f(a, b)\nx = 1', snip, 12), false);        // caret moved to a later line
  assert.equal(snipValid('f(a, b) + 1', snip, 10), false);           // typed past the closing bracket
  assert.equal(snipValid('fx a, b)', snip, 3), false);               // the "(" is gone
  const later = 'f(1)\nprint(b)';                                     // user replaced both placeholders; an unrelated "b" exists below
  const r = snipNext(later, 3, snip);
  assert.deepEqual(r.sel, [4, 4]);                                    // finishes after the call, does not jump to line 2
  assert.equal(r.snip, null);
});

test('required keyword-only placeholder selects only the value', () => {
  const text = 'f(a, b=b)', snip = { open: 2, parts: [{ t: 'a', v: 'a', off: 0 }, { t: 'b=b', v: 'b', off: 2 }], idx: 0 };
  assert.deepEqual(snipNext(text, 3, snip).sel, [7, 8]);
});
