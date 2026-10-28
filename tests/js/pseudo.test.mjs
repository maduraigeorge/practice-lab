// Unit tests for the pseudocode engine (parser, flowchart layout, interpreter, bundled exercises).
// Runs under Node (`node --test tests/js`) and in the browser harness (tests/js/harness.html).
import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, tokenizeLine, exprText, PseudoError } from '../../assets/js/pseudo-parser.js';
import { buildChart, pathEdges } from '../../assets/js/pseudo-flow.js';
import { run, parseInputs } from '../../assets/js/pseudo-run.js';
import { EXAMPLES, PRACTICE, checkOutput } from '../../assets/js/flow-exercises.js';
import { pythonToPseudo, looksLikePython } from '../../assets/js/python-to-pseudo.js';

const go = (src, input = '') => { const p = parse(looksLikePython(src) ? pythonToPseudo(src) : src); buildChart(p); return run(p, { inputs: parseInputs(input) }); };
const out = (src, input) => go(src, input).output.trim().split('\n').join(' | ');
const syntaxError = src => { try { parse(src); } catch (e) { return e; } return null; };

/* ------------------------------------------------------------ parser */
test('assignment spellings all work', () => {
  for (const line of ['x = 5', 'x <- 5', 'x ← 5', 'x := 5', 'SET x = 5', 'let x = 5']) assert.equal(go(line + '\nOUTPUT x').output.trim(), '5', line);
});

test('soft keywords (start, end, next, show, stop ...) work as variable names', () => {
  assert.equal(out('start = 1\nend = 5\nnext = start + 1\nshow = end - next\nOUTPUT start, end, next, show'), '1 5 2 3');
  assert.equal(out('BEGIN\nx = 1\nEND'), '');
  assert.equal(out('total = 0\nFOR i = 1 TO 3\ntotal = total + i\nNEXT\nOUTPUT total'), '6');
  assert.equal(out('FOR i = 1 TO 2\nOUTPUT i\nNEXT i'), '1 | 2');
});

test('keywords are case-insensitive and comments are ignored', () => {
  assert.equal(out('// hello\nx = 2 # two\noutput X\nPrint x * 3'), '2 | 6');
});

test('IF / ELSE IF / ELIF / ELSE chains', () => {
  const src = 'INPUT m\nIF m >= 90 THEN\nOUTPUT "A"\nELSE IF m >= 75 THEN\nOUTPUT "B"\nELIF m >= 50 THEN\nOUTPUT "C"\nELSE\nOUTPUT "F"\nENDIF';
  assert.deepEqual(['95', '80', '60', '10'].map(v => out(src, v)), ['A', 'B', 'C', 'F']);
});

test('syntax errors carry a line number and a friendly message', () => {
  let e = syntaxError('x = 1\nIF x > 0 THEN\nOUTPUT x\n');
  assert.ok(e instanceof PseudoError); assert.equal(e.line, 2); assert.match(e.message, /ENDIF/);
  e = syntaxError('x = \n'); assert.match(e.message, /value after the =/);
  e = syntaxError('FOR i = 1 10\nENDFOR'); assert.match(e.message, /TO/);
  e = syntaxError('ENDIF'); assert.match(e.message, /no matching block/);
  e = syntaxError('OUTPUT "abc'); assert.match(e.message, /closing quote/);
  e = syntaxError('x = 3 $ 4'); assert.match(e.message, /character/);
  e = syntaxError('WHILE x < 3 DO\nx = x + 1\n'); assert.match(e.message, /ENDWHILE/);
  e = syntaxError('REPEAT\nx = 1\n'); assert.match(e.message, /UNTIL/);
  e = syntaxError('5 = x'); assert.ok(e);
  e = syntaxError('IF THEN\nENDIF'); assert.match(e.message, /condition/);
});

test('tokenizer handles escapes, decimals and comments inside strings', () => {
  const t = tokenizeLine('x = "a // b" + 1.5 // trailing', 1);
  assert.deepEqual(t.map(k => k.k), ['id', 'op', 'str', 'op', 'num']);
  assert.equal(t[2].v, 'a // b');
});

test('exprText keeps needed parentheses', () => {
  const e = parse('x = (a + b) * c - d ^ 2').find(s => s.type === 'assign').expr;
  assert.equal(exprText(e), '(a + b) * c - d ^ 2');
});

/* ------------------------------------------------------------ interpreter */
test('loops: FOR (incl. STEP and negative STEP), WHILE, REPEAT, FOR EACH', () => {
  assert.equal(out('t = 0\nFOR i = 1 TO 10\nt = t + i\nENDFOR\nOUTPUT t'), '55');
  assert.equal(out('FOR i = 10 TO 1 STEP -3\nOUTPUT i\nENDFOR'), '10 | 7 | 4 | 1');
  assert.equal(out('n = 3\nWHILE n > 0 DO\nOUTPUT n\nn = n - 1\nENDWHILE'), '3 | 2 | 1');
  assert.equal(out('x = 1\nREPEAT\nx = x * 2\nUNTIL x >= 50\nOUTPUT x'), '64');
  assert.equal(out('FOR EACH c IN "abc" DO\nOUTPUT c\nENDFOR'), 'a | b | c');
  assert.equal(out('FOR i = 5 TO 1\nOUTPUT i\nENDFOR\nOUTPUT "done"'), 'done');
});

test('operators: DIV, MOD (floored), power, text, precedence, AND/OR short circuit', () => {
  assert.equal(out('OUTPUT 17 DIV 5, 17 MOD 5, -7 MOD 3, 2 ^ 10, 7 / 2'), '3 2 2 1024 3.5');
  assert.equal(out('OUTPUT "a" + "b" + 1, 2 + 3 * 4, (2 + 3) * 4'), 'ab1 14 20');
  assert.equal(out('x = 0\nIF x <> 0 AND 10 / x > 1 THEN\nOUTPUT "no"\nELSE\nOUTPUT "safe"\nENDIF'), 'safe');
  assert.equal(out('OUTPUT NOT (1 = 2), 1 < 2 OR 1 / 0 > 0'), 'TRUE TRUE');
});

test('lists, indexing, built-in functions', () => {
  assert.equal(out('a = [4, 8, 15]\nAPPEND(a, 16)\na[0] = 99\nOUTPUT a, LEN(a), a[3], SUM(a), MIN(a), MAX(3, 9, 2)'), '[99, 8, 15, 16] 4 16 138 8 9');
  assert.equal(out('OUTPUT UPPER("hi"), LOWER("HI"), SQRT(16), FLOOR(2.7), CEIL(2.1), ROUND(2.5), ABS(-4), SUBSTR("hello", 1, 3), STR(5) + "!", INT("42") + 1'), 'HI hi 4 2 3 3 4 ell 5! 43');
});

test('INPUT converts numbers, accepts several values, and reports when values run out', () => {
  assert.equal(out('INPUT a, b\nOUTPUT a + b', '3 4'), '7');
  assert.equal(out('INPUT name\nOUTPUT "Hi " + name', 'Asha'), 'Hi Asha');
  assert.equal(out('INPUT a\nINPUT b\nOUTPUT a * b', '6\n7'), '42');
  const r = go('INPUT n\nOUTPUT n');
  assert.equal(r.error.kind, 'input'); assert.equal(r.error.line, 1);
});

test('runtime errors are friendly and have a line number', () => {
  const cases = [
    ['x = 1\nOUTPUT y', /no value yet/, 2], ['OUTPUT 10 / 0', /Division by zero/, 1], ['a = [1, 2]\nOUTPUT a[5]', /outside/, 2],
    ['OUTPUT "a" - 1', /needs numbers/, 1], ['IF 5 THEN\nOUTPUT 1\nENDIF', /true or false/, 1], ['OUTPUT FOO(1)', /don't know a function/, 1],
    ['FOR i = 1 TO 5 STEP 0\nENDFOR', /cannot be 0/, 1], ['a = 5\nOUTPUT a[0]', /Only lists and text/, 2], ['OUTPUT SQRT(-1)', /negative/, 1],
  ];
  for (const [src, re, line] of cases) { const e = go(src).error; assert.ok(e, src); assert.match(e.message, re, src); assert.equal(e.line, line, src); }
});

test('endless loops are detected, not hung', () => {
  const r = go('x = 1\nWHILE x > 0 DO\ny = 1\nENDWHILE');
  assert.equal(r.error.kind, 'infinite');
  const r2 = go('i = 0\nWHILE i >= 0 DO\ni = i + 1\nENDWHILE');            // state keeps changing: stopped by the step budget instead
  assert.ok(r2.error && ['toolong', 'infinite'].includes(r2.error.kind));
});

test('every step points at a real flowchart node and consecutive steps are connected', () => {
  const p = parse('INPUT n\nIF n MOD 2 = 0 THEN\nOUTPUT "even"\nELSE\nOUTPUT "odd"\nENDIF\nFOR i = 1 TO 2\nOUTPUT i\nENDFOR\nWHILE n > 5 DO\nn = n - 4\nENDWHILE\nREPEAT\nn = n + 1\nUNTIL n > 8');
  const chart = buildChart(p), r = run(p, { inputs: [7] });
  const ids = new Set(chart.nodes.map(n => n.id));
  assert.ok(!r.error, r.error && r.error.message);
  r.steps.forEach(s => assert.ok(ids.has(s.node), 'unknown node ' + s.node));
  for (let i = 1; i < r.steps.length; i++) assert.ok(pathEdges(chart, r.steps[i - 1].node, r.steps[i].node, r.steps[i - 1].taken).length > 0, `no edge between step ${i} and ${i + 1}`);
});

test('explanations substitute real values', () => {
  const r = go('x = 4\ny = x * 3 + 1\nIF y > 10 THEN\nOUTPUT y\nENDIF');
  assert.match(r.steps[2].text, /4 \* 3 \+ 1/); assert.match(r.steps[2].text, /13/);
  assert.match(r.steps[3].text, /13 > 10/); assert.match(r.steps[3].text, /TRUE/);
});

/* ------------------------------------------------------------ flowchart layout */
test('layout: all nodes inside the drawing, decisions have Yes and No exits', () => {
  const p = parse(EXAMPLES.map(e => e.code).join('\n'));
  const chart = buildChart(p);
  for (const n of chart.nodes) { assert.ok(n.x >= 0 && n.y >= 0 && n.x + n.w <= chart.W + 0.5 && n.y + n.h <= chart.H + 0.5, `${n.text} outside`); }
  for (const d of chart.nodes.filter(n => n.kind === 'decision')) {
    const labels = chart.edges.filter(e => e.from === d.id).map(e => e.label).sort();
    assert.deepEqual(labels, ['No', 'Yes'], d.text);
  }
  for (const e of chart.edges) for (const [x, y] of e.pts) assert.ok(x >= -0.5 && y >= -0.5 && x <= chart.W + 0.5 && y <= chart.H + 0.5, 'edge point outside');
});

test('layout: nodes do not overlap each other', () => {
  const chart = buildChart(parse('INPUT n\nWHILE n > 0 DO\nIF n MOD 2 = 0 THEN\nOUTPUT "e"\nELSE\nIF n > 5 THEN\nOUTPUT "big"\nENDIF\nENDIF\nn = n - 1\nENDWHILE'));
  const real = chart.nodes.filter(n => n.kind !== 'join');
  for (let i = 0; i < real.length; i++) for (let j = i + 1; j < real.length; j++) {
    const a = real[i], b = real[j];
    assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `${a.text} overlaps ${b.text}`);
  }
});

/* ------------------------------------------------------------ bundled content */
test('every bundled example runs without errors', () => {
  for (const ex of EXAMPLES) { const r = go(ex.code, ex.input); assert.equal(r.error, null, `${ex.title}: ${r.error && r.error.message}`); assert.ok(r.steps.length > 1); }
});

test('every practice solution passes all of its tests (and the starter does not)', () => {
  for (const ex of PRACTICE) {
    for (const t of ex.tests) {
      const r = go(ex.solution, t.input);
      assert.equal(r.error, null, `${ex.title}: ${r.error && r.error.message}`);
      assert.ok(checkOutput(r.output, t.expected), `${ex.title} (input "${t.input}"): got "${r.output.trim()}" expected "${t.expected}"`);
    }
    const starter = go(ex.starter || '', ex.tests[0].input);
    assert.ok(!checkOutput(starter.output, ex.tests[0].expected), `${ex.title}: starter already passes`);
  }
});

/* ------------------------------------------------------------ Python in the flowchart */
test('python: input, range loop, if / elif / else, print', () => {
  assert.equal(out('n = int(input())\ntotal = 0\nfor i in range(1, n + 1):\n    total += i\nprint("Sum is", total)\n', '4'), 'Sum is 10');
  const g = 'm = int(input())\nif m >= 90:\n    print("A")\nelif m >= 60:\n    print("B")\nelse:\n    print("C")\n';
  assert.equal(out(g, '95'), 'A'); assert.equal(out(g, '70'), 'B'); assert.equal(out(g, '10'), 'C');
});
test('python: // and % , while, append, descending range', () => {
  assert.equal(out('n = 7\nwhile n != 1:\n    if n % 2 == 0:\n        n = n // 2\n    else:\n        n = 3 * n + 1\n    print(n)\n'), '22 | 11 | 34 | 17 | 52 | 26 | 13 | 40 | 20 | 10 | 5 | 16 | 8 | 4 | 2 | 1');
  assert.equal(out('xs = []\nfor i in range(10, 0, -4):\n    xs.append(i)\nprint(len(xs), xs[2])\n'), '3 2');
});
test('python: statements keep their own line numbers', () => {
  const p = parse(pythonToPseudo('x = 1\n\nif x > 0:\n    print("hi")\n'));
  assert.equal(p.find(s => s.type === 'if').line, 3);
});
test('python: unsupported code gets a friendly error with the right line', () => {
  for (const [src, line] of [['x = 1\ndef f():\n    pass\n', 2], ['x = 1\nprint(f"a{x}")\n', 2], ['if x: y = 1\n', 1], ['while True:\n    break\n', 2]]) {
    try { pythonToPseudo(src); assert.fail('should throw'); } catch (e) { assert.ok(e instanceof PseudoError); assert.equal(e.line, line); }
  }
});
