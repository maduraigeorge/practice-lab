// Regression tests for crashes, freezes and semantic surprises found in review of the pseudocode engine.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, PseudoError } from '../../assets/js/pseudo-parser.js';
import { buildChart } from '../../assets/js/pseudo-flow.js';
import { run, parseInputs } from '../../assets/js/pseudo-run.js';

const go = (src, input = '', opt = {}) => { const p = parse(src); buildChart(p); return run(p, { inputs: parseInputs(input), ...opt }); };
const out = (src, input) => go(src, input).output.trim().split('\n').join(' | ');
const perr = src => { try { parse(src); } catch (e) { return e; } return null; };

test('nested index targets give a friendly parse error instead of crashing', () => {
  for (const src of ['a = [[1, 2], [3, 4]]\na[0][1] = 9', 'INPUT a[0][1]']) {
    const e = perr(src); assert.ok(e instanceof PseudoError, src); assert.match(e.message, /one level of \[ \]/);
  }
  assert.equal(out('a = [[1, 2], [3, 4]]\nOUTPUT a[1][0]'), '3');             // reading nested lists is fine
});

test('extremely nested expressions are rejected politely', () => {
  const e = perr('x = ' + '('.repeat(5000) + '1' + ')'.repeat(5000));
  assert.ok(e instanceof PseudoError); assert.match(e.message, /nested too deeply/);
  assert.ok(perr('x = ' + 'NOT '.repeat(5000) + 'TRUE') instanceof PseudoError);
});

test('a list that grows forever stops quickly with a friendly message', () => {
  const t0 = performance.now();
  const r = go('a = []\nWHILE TRUE DO\n  APPEND(a, 1)\nENDWHILE');
  assert.ok(r.error && ['toolong', 'runtime'].includes(r.error.kind), JSON.stringify(r.error));
  assert.ok(performance.now() - t0 < 6000, 'took ' + (performance.now() - t0) + ' ms');
});

test('a string that doubles forever hits the size limit', () => {
  const r = go('s = "ab"\nWHILE TRUE DO\n  s = s + s\nENDWHILE');
  assert.ok(r.error && /too big|too many/.test(r.error.message), JSON.stringify(r.error));
});

test('decimal numbers compare sensibly (0.1 + 0.2 = 0.3)', () => {
  assert.equal(out('OUTPUT 0.1 + 0.2 = 0.3, 0.1 + 0.2 <= 0.3, 0.1 + 0.2 < 0.3, 1 < 2'), 'TRUE TRUE FALSE TRUE');
  assert.equal(out('FOR x = 0 TO 0.3 STEP 0.1\nOUTPUT x\nENDFOR'), '0 | 0.1 | 0.2 | 0.3');
});

test('INT / FLOAT only accept plain numbers', () => {
  assert.equal(out('OUTPUT INT("42"), INT(3.9), FLOAT("2.5")'), '42 3 2.5');
  for (const src of ['OUTPUT INT("")', 'OUTPUT INT("0x10")', 'OUTPUT FLOAT("abc")']) assert.ok(go(src).error, src);
});

test('input parsing keeps odd words as text', () => {
  assert.deepEqual(parseInputs('Infinity 0x1A 1e3 hello 7 -2.5'), ['Infinity', '0x1A', '1e3', 'hello', 7, -2.5]);
});

test('variable names may use any letters', () => {
  assert.equal(out('café = 2\nnamé = café * 3\nOUTPUT namé'), '6');
});

test('lists changed in place show up as changed variables', () => {
  const r = go('a = [1, 2]\na[0] = 9\nAPPEND(a, 3)');
  assert.ok(r.steps[2].changed.includes('a') && r.steps[3].changed.includes('a'));
});
