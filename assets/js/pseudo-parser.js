/* Pseudocode tokenizer + parser. Pure functions, no DOM – unit-tested under tests/js.
 *
 * Supported (keywords are case-insensitive, blocks are closed with ENDIF / ENDWHILE / ENDFOR / UNTIL):
 *   BEGIN / END                       optional start/end markers
 *   INPUT x [, y]   READ x            read values (optionally INPUT "prompt", x)
 *   OUTPUT a, b     PRINT / DISPLAY   show values
 *   x = expr   x <- expr   x ← expr   x := expr   SET x = expr   a[i] = expr
 *   IF cond THEN … ELSE IF cond THEN … ELSE … ENDIF
 *   WHILE cond DO … ENDWHILE
 *   FOR i = a TO b [STEP s] DO … ENDFOR        FOR EACH x IN list DO … ENDFOR
 *   REPEAT … UNTIL cond
 *   APPEND(list, value)
 * Expressions: numbers, "text", TRUE/FALSE, [lists], a[i], + - * / DIV MOD ^ &, = != <> < > <= >=, AND OR NOT, functions.
 * Lists are 0-indexed. */

export class PseudoError extends Error {
  constructor(message, line) { super(message); this.line = line || null; }
}

/* ------------------------------------------------------------------ tokenizer */
const OPS2 = ['<-', '<=', '>=', '==', '!=', '<>', ':=', '**', '||', '&&'];
const OPS1 = '+-*/%^=<>()[],&!:←≤≥≠';

export function tokenizeLine(text, line) {
  const toks = []; let i = 0; const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
    if ((c === '/' && text[i + 1] === '/') || c === '#') break;                     // comment
    if (c === '"' || c === "'") {
      let j = i + 1, s = '';
      while (j < n && text[j] !== c) { if (text[j] === '\\' && j + 1 < n) { s += { n: '\n', t: '\t' }[text[j + 1]] ?? text[j + 1]; j += 2; } else s += text[j++]; }
      if (j >= n) throw new PseudoError('This text is missing its closing quote.', line);
      toks.push({ k: 'str', v: s, line }); i = j + 1; continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(text[i + 1] || ''))) {
      const m = /^(\d+(\.\d+)?|\.\d+)/.exec(text.slice(i));
      toks.push({ k: 'num', v: parseFloat(m[0]), line }); i += m[0].length; continue;
    }
    if (/[\p{L}_]/u.test(c)) {                                   // letters of any language: café, ñ, नाम ...
      const m = /^[\p{L}_][\p{L}\p{N}_]*/u.exec(text.slice(i));
      toks.push({ k: 'id', v: m[0], u: m[0].toUpperCase(), line }); i += m[0].length; continue;
    }
    const two = text.slice(i, i + 2);
    if (OPS2.includes(two)) { toks.push({ k: 'op', v: two, line }); i += 2; continue; }
    if (OPS1.includes(c)) { toks.push({ k: 'op', v: c, line }); i++; continue; }
    throw new PseudoError(`I don't understand the character "${c}".`, line);
  }
  return toks;
}

/* ------------------------------------------------------------------ parser */
const KW_OUTPUT = new Set(['OUTPUT', 'PRINT', 'DISPLAY', 'WRITE', 'SHOW']);
const KW_INPUT = new Set(['INPUT', 'READ', 'ACCEPT', 'GET']);
// Only the structural words are reserved. Words such as start, end, stop, next, show, read ... are "soft": they work as
// statements only when they begin a line (and are not followed by =), and are ordinary variable names everywhere else.
const RESERVED = new Set(['IF', 'THEN', 'ELSE', 'ELSEIF', 'ELIF', 'ENDIF', 'WHILE', 'DO', 'ENDWHILE', 'WEND', 'FOR', 'TO', 'STEP', 'EACH', 'IN',
  'ENDFOR', 'REPEAT', 'UNTIL', 'AND', 'OR', 'NOT', 'MOD', 'DIV', 'TRUE', 'FALSE', 'SET', 'LET', 'FROM']);
const ASSIGN_OPS = ['=', '<-', '←', ':='];
export const KEYWORDS = ['BEGIN', 'END', 'INPUT', 'OUTPUT', 'PRINT', 'IF', 'THEN', 'ELSE', 'ELSE IF', 'ENDIF', 'WHILE', 'DO', 'ENDWHILE', 'FOR', 'FOR EACH',
  'TO', 'STEP', 'IN', 'ENDFOR', 'REPEAT', 'UNTIL', 'AND', 'OR', 'NOT', 'MOD', 'DIV', 'TRUE', 'FALSE', 'APPEND'];
export const FUNCTIONS = ['LEN', 'ABS', 'SQRT', 'FLOOR', 'CEIL', 'ROUND', 'MIN', 'MAX', 'SUM', 'UPPER', 'LOWER', 'STR', 'INT', 'FLOAT', 'SUBSTR', 'APPEND'];

/** `source` is the text, or – for translated code – an array of { text, line, src } so statements keep the line numbers (and the
 *  original wording, `src`) of what the user actually typed. */
export function parse(source) {
  const raw = Array.isArray(source) ? source : source.split('\n').map((text, i) => ({ text, line: i + 1 }));
  const lines = [];                                              // { toks, line, text }
  raw.forEach(r => { const toks = tokenizeLine(r.text, r.line); if (toks.length) lines.push({ toks, line: r.line, text: (r.src ?? r.text).trim() }); });
  let p = 0;

  const err = (msg, line) => { throw new PseudoError(msg, line); };
  const first = ln => ln.toks[0].k === 'id' ? ln.toks[0].u : null;
  const second = ln => ln.toks[1] && ln.toks[1].k === 'id' ? ln.toks[1].u : null;

  /* --- expression parser over a token array --- */
  function exprParser(toks, line) {
    let i = 0;
    const peek = () => toks[i];
    const isOp = v => toks[i] && toks[i].k === 'op' && toks[i].v === v;
    const isKw = u => toks[i] && toks[i].k === 'id' && toks[i].u === u;
    let depth = 0;
    const nest = f => { if (++depth > 100) err('This expression is nested too deeply.', line); try { return f(); } finally { depth--; } };
    const expect = (v, why) => { if (!isOp(v)) err(why || `Expected "${v}".`, line); i++; };
    function or() { return nest(() => { let l = and(); while (isKw('OR') || isOp('||')) { i++; l = { t: 'bin', op: 'OR', l, r: and() }; } return l; }); }
    function and() { let l = not(); while (isKw('AND') || isOp('&&')) { i++; l = { t: 'bin', op: 'AND', l, r: not() }; } return l; }
    function not() { return nest(() => { if (isKw('NOT') || isOp('!')) { i++; return { t: 'un', op: 'NOT', e: not() }; } return cmp(); }); }
    function cmp() {
      let l = add();
      for (;;) {
        const t = peek();
        if (t && t.k === 'op' && ['=', '==', '!=', '<>', '<', '>', '<=', '>=', '≤', '≥', '≠'].includes(t.v)) {
          i++; const op = { '==': '=', '<>': '≠', '!=': '≠', '<=': '≤', '>=': '≥' }[t.v] || t.v;
          l = { t: 'bin', op, l, r: add() };
        } else return l;
      }
    }
    function add() { let l = mul(); while (isOp('+') || isOp('-') || isOp('&')) { const op = toks[i++].v === '&' ? '+' : toks[i - 1].v; l = { t: 'bin', op, l, r: mul() }; } return l; }
    function mul() {
      let l = unary();
      for (;;) {
        if (isOp('*') || isOp('/') || isOp('%')) { const op = toks[i++].v === '%' ? 'MOD' : toks[i - 1].v; l = { t: 'bin', op, l, r: unary() }; }
        else if (isKw('MOD') || isKw('DIV')) { const op = toks[i++].u; l = { t: 'bin', op, l, r: unary() }; }
        else return l;
      }
    }
    function unary() { return nest(() => { if (isOp('-')) { i++; return { t: 'un', op: '-', e: unary() }; } if (isOp('+')) { i++; return unary(); } return power(); }); }
    function power() { const b = postfix(); if (isOp('^') || isOp('**')) { i++; return { t: 'bin', op: '^', l: b, r: unary() }; } return b; }
    function postfix() {
      let e = primary();
      while (isOp('[')) { i++; const idx = or(); expect(']', 'Missing "]" after the position.'); e = { t: 'index', base: e, idx }; }
      return e;
    }
    function primary() {
      const t = peek();
      if (!t) err('The expression ends too early.', line);
      if (t.k === 'num') { i++; return { t: 'num', v: t.v }; }
      if (t.k === 'str') { i++; return { t: 'str', v: t.v }; }
      if (t.k === 'op' && t.v === '(') { i++; const e = or(); expect(')', 'Missing ")".'); return { t: 'paren', e }; }
      if (t.k === 'op' && t.v === '[') {
        i++; const items = [];
        if (!isOp(']')) { items.push(or()); while (isOp(',')) { i++; items.push(or()); } }
        expect(']', 'Missing "]" at the end of the list.'); return { t: 'list', items };
      }
      if (t.k === 'id') {
        if (t.u === 'TRUE' || t.u === 'FALSE') { i++; return { t: 'bool', v: t.u === 'TRUE' }; }
        if (RESERVED.has(t.u) && !FUNCTIONS.includes(t.u)) err(`"${t.v}" is a keyword and can't be used here.`, line);
        i++;
        if (isOp('(')) {
          i++; const args = [];
          if (!isOp(')')) { args.push(or()); while (isOp(',')) { i++; args.push(or()); } }
          expect(')', 'Missing ")" after the function arguments.');
          return { t: 'call', name: t.u, args };
        }
        return { t: 'var', name: t.v };
      }
      return err(`Unexpected "${t.v}".`, line);
    }
    return { run() { const e = or(); if (i < toks.length) err(`Unexpected "${toks[i].v}" – is something missing before it?`, line); return e; }, pos: () => i, or, peek, isKw, isOp, advance: () => { i++; }, expect };
  }
  const parseExpr = (toks, line) => exprParser(toks, line).run();

  /* --- statements --- */
  const isCloser = ln => {
    const f = first(ln), s = second(ln);
    const assignment = ln.toks[1] && ln.toks[1].k === 'op' && ASSIGN_OPS.includes(ln.toks[1].v);      // "next = 5" is a variable
    if (assignment) return false;
    return ['ELSE', 'ELSEIF', 'ELIF', 'ENDIF', 'ENDWHILE', 'WEND', 'ENDFOR', 'UNTIL'].includes(f) ||
      (f === 'NEXT' && ln.toks.length <= 2) || (f === 'END' && ['IF', 'WHILE', 'FOR'].includes(s));
  };

  function parseBlock(stop) {
    const body = [];
    while (p < lines.length) {
      const ln = lines[p], f = first(ln);
      if (isCloser(ln)) { if (stop(ln)) return body; err(`Unexpected "${ln.toks[0].v}" – there is no matching block to close.`, ln.line); }
      body.push(parseStatement());
    }
    return body;
  }
  const endsIf = ln => ['ELSE', 'ELSEIF', 'ELIF', 'ENDIF'].includes(first(ln)) || (first(ln) === 'END' && second(ln) === 'IF');
  const endsWhile = ln => first(ln) === 'ENDWHILE' || first(ln) === 'WEND' || (first(ln) === 'END' && second(ln) === 'WHILE');
  const endsFor = ln => first(ln) === 'ENDFOR' || first(ln) === 'NEXT' || (first(ln) === 'END' && second(ln) === 'FOR');
  const endsRepeat = ln => first(ln) === 'UNTIL';

  /** Condition tokens between the keyword and an optional trailing THEN / DO. */
  function condTokens(ln, from, trailing) {
    let toks = ln.toks.slice(from);
    if (toks.length && toks[toks.length - 1].k === 'id' && toks[toks.length - 1].u === trailing) toks = toks.slice(0, -1);
    if (!toks.length) err(`Write a condition after ${ln.toks[0].u}.`, ln.line);
    return toks;
  }

  function parseStatement() {
    const ln = lines[p], line = ln.line, text = ln.text;
    const node = (o) => ({ line, text, ...o });
    // "start = 1", "end = 10", "show = 3" ... are assignments to ordinary variables, not statements
    const looksLikeAssign = ln.toks[0].k === 'id' && ln.toks[1] && ln.toks[1].k === 'op' && ASSIGN_OPS.includes(ln.toks[1].v) && !RESERVED.has(ln.toks[0].u);
    const f = looksLikeAssign ? null : first(ln);

    if ((f === 'BEGIN' || f === 'START') && ln.toks.length === 1) { p++; return node({ type: 'begin' }); }
    if ((f === 'END' || f === 'STOP') && ln.toks.length === 1) { p++; return node({ type: 'end' }); }

    if (f && KW_INPUT.has(f)) {
      p++; let toks = ln.toks.slice(1), prompt = null;
      if (toks[0] && toks[0].k === 'str' && toks[1] && toks[1].v === ',') { prompt = toks[0].v; toks = toks.slice(2); }
      if (!toks.length) err(`${f} needs a variable name, e.g. ${f} x`, line);
      const targets = [];
      const ep = exprParser(toks, line);
      for (;;) {
        const e = ep.or();
        if (e.t !== 'var' && e.t !== 'index') err(`${f} stores the value in a variable – "${ep.peek() ? ep.peek().v : 'this'}" is not a variable name.`, line);
        if (e.t === 'index' && e.base.t !== 'var') err('Only one level of [ ] can be changed, e.g. a[i]. For a list of lists, use a helper variable.', line);
        targets.push(e);
        if (ep.isOp(',')) ep.advance(); else break;
      }
      if (ep.peek()) err(`Unexpected "${ep.peek().v}" after the variable name.`, line);
      return node({ type: 'input', targets, prompt });
    }

    if (f && KW_OUTPUT.has(f)) {
      p++; const toks = ln.toks.slice(1), args = [];
      if (toks.length) {
        const ep = exprParser(toks, line);
        for (;;) { args.push(ep.or()); if (ep.isOp(',')) ep.advance(); else break; }
        if (ep.peek()) err(`Unexpected "${ep.peek().v}" – separate several values with commas.`, line);
      }
      return node({ type: 'output', args });
    }

    if (f === 'IF') {
      const branches = []; let orelse = null;
      let toks = condTokens(ln, 1, 'THEN'); p++;
      branches.push({ line, cond: parseExpr(toks, line), body: parseBlock(endsIf), text });
      for (;;) {
        if (p >= lines.length) err(`This IF has no ENDIF.`, line);
        const c = lines[p], cf = first(c), cs = second(c);
        if (cf === 'ENDIF' || (cf === 'END' && cs === 'IF')) { p++; break; }
        if (cf === 'ELSEIF' || cf === 'ELIF' || (cf === 'ELSE' && cs === 'IF')) {
          toks = condTokens(c, cf === 'ELSE' ? 2 : 1, 'THEN'); p++;
          branches.push({ line: c.line, cond: parseExpr(toks, c.line), body: parseBlock(endsIf), text: c.text });
        } else if (cf === 'ELSE') {
          p++; orelse = { line: c.line, body: parseBlock(endsIf) };
          if (p >= lines.length || !(first(lines[p]) === 'ENDIF' || (first(lines[p]) === 'END' && second(lines[p]) === 'IF'))) err('This ELSE has no ENDIF.', c.line);
        } else err('Expected ELSE, ELSE IF or ENDIF.', c.line);
      }
      return node({ type: 'if', branches, orelse });
    }

    if (f === 'WHILE') {
      const toks = condTokens(ln, 1, 'DO'); p++;
      const cond = parseExpr(toks, line), body = parseBlock(endsWhile);
      if (p >= lines.length) err('This WHILE has no ENDWHILE.', line);
      p++; return node({ type: 'while', cond, body });
    }

    if (f === 'REPEAT') {
      p++; const body = parseBlock(endsRepeat);
      if (p >= lines.length) err('This REPEAT has no UNTIL.', line);
      const u = lines[p]; p++;
      return node({ type: 'repeat', body, cond: parseExpr(u.toks.slice(1), u.line), untilLine: u.line, untilText: u.text });
    }

    if (f === 'FOR') {
      let toks = ln.toks.slice(1);
      if (toks.length && toks[toks.length - 1].k === 'id' && toks[toks.length - 1].u === 'DO') toks = toks.slice(0, -1);
      if (toks[0] && toks[0].k === 'id' && toks[0].u === 'EACH') {
        if (!(toks[1] && toks[1].k === 'id') || !(toks[2] && toks[2].k === 'id' && toks[2].u === 'IN')) err('Write it like:  FOR EACH item IN list', line);
        p++;
        const body = parseBlock(endsFor);
        if (p >= lines.length) err('This FOR EACH has no ENDFOR.', line);
        p++; return node({ type: 'foreach', varName: toks[1].v, iter: parseExpr(toks.slice(3), line), body });
      }
      if (!(toks[0] && toks[0].k === 'id')) err('Write it like:  FOR i = 1 TO 10', line);
      const name = toks[0].v;
      if (!(toks[1] && ((toks[1].k === 'op' && ['=', '<-', '←', ':='].includes(toks[1].v)) || (toks[1].k === 'id' && toks[1].u === 'FROM')))) err(`After "${name}" write = (or FROM), e.g.  FOR ${name} = 1 TO 10`, line);
      const rest = toks.slice(2);
      const toAt = rest.findIndex(t => t.k === 'id' && t.u === 'TO');
      if (toAt < 0) err(`A FOR loop needs TO, e.g.  FOR ${name} = 1 TO 10`, line);
      const stepAt = rest.findIndex(t => t.k === 'id' && t.u === 'STEP');
      const from = parseExpr(rest.slice(0, toAt), line);
      const to = parseExpr(rest.slice(toAt + 1, stepAt < 0 ? rest.length : stepAt), line);
      const step = stepAt < 0 ? null : parseExpr(rest.slice(stepAt + 1), line);
      p++;
      const body = parseBlock(endsFor);
      if (p >= lines.length) err('This FOR has no ENDFOR.', line);
      p++; return node({ type: 'for', varName: name, from, to, step, body });
    }

    if (f === 'APPEND' && ln.toks[1] && ln.toks[1].v === '(') {
      p++; const e = parseExpr(ln.toks, line);
      return node({ type: 'append', call: e });
    }

    // assignment: [SET|LET] target <op> expr
    let toks = ln.toks, from = 0;
    if ((f === 'SET' || f === 'LET') && ln.toks.length > 1) from = 1;
    toks = toks.slice(from);
    let opAt = -1, depth = 0;
    for (let k = 0; k < toks.length; k++) {
      const t = toks[k];
      if (t.k === 'op' && (t.v === '[' || t.v === '(')) depth++;
      else if (t.k === 'op' && (t.v === ']' || t.v === ')')) depth--;
      else if (depth === 0 && t.k === 'op' && ['=', '<-', '←', ':='].includes(t.v)) { opAt = k; break; }
    }
    if (opAt > 0 && toks[0].k === 'id' && !RESERVED.has(toks[0].u)) {
      const target = parseExpr(toks.slice(0, opAt), line);
      if (target.t !== 'var' && target.t !== 'index') err('The left side of = must be a variable (or a list item like a[i]).', line);
      if (target.t === 'index' && target.base.t !== 'var') err('Only one level of [ ] can be changed, e.g. a[i] = 5. For a list of lists, copy the inner list into a variable first.', line);
      if (opAt === toks.length - 1) err('Write a value after the = sign.', line);
      p++; return node({ type: 'assign', target, expr: parseExpr(toks.slice(opAt + 1), line) });
    }
    if (toks[0] && toks[0].k === 'id' && !RESERVED.has(toks[0].u) && toks.length >= 1) {
      err(`I don't understand "${ln.text}". Did you mean an assignment like  ${toks[0].v} = 5 ?`, line);
    }
    return err(`I don't understand "${ln.toks[0].v}" here. Statements start with INPUT, OUTPUT, IF, WHILE, FOR, REPEAT or a variable name.`, line);
  }

  const program = [];
  while (p < lines.length) {
    const ln = lines[p];
    if (isCloser(ln)) err(`Unexpected "${ln.toks[0].v}" – there is no matching block to close.`, ln.line);
    program.push(parseStatement());
  }
  return program;
}

/* ------------------------------------------------------------------ expression -> text */
const PREC = { OR: 1, AND: 2, '=': 4, '≠': 4, '<': 4, '>': 4, '≤': 4, '≥': 4, '+': 5, '-': 5, '*': 6, '/': 6, DIV: 6, MOD: 6, '^': 8 };

/** Readable text for an expression. `lookup(name)` may replace variables by their values (used for explanations). */
export function exprText(e, lookup = null) {
  switch (e.t) {
    case 'num': return fmtNum(e.v);
    case 'str': return JSON.stringify(e.v);
    case 'bool': return e.v ? 'TRUE' : 'FALSE';
    case 'var': { if (lookup) { const r = lookup(e.name); if (r !== undefined) return r; } return e.name; }
    case 'paren': return '(' + exprText(e.e, lookup) + ')';
    case 'list': return '[' + e.items.map(x => exprText(x, lookup)).join(', ') + ']';
    case 'index': return exprText(e.base, null) + '[' + exprText(e.idx, lookup) + ']';
    case 'call': return e.name + '(' + e.args.map(x => exprText(x, lookup)).join(', ') + ')';
    case 'un': return (e.op === 'NOT' ? 'NOT ' : '-') + exprText(e.e, lookup);
    case 'bin': {
      const wrap = (x, right) => { const t = exprText(x, lookup); return x.t === 'bin' && (PREC[x.op] < PREC[e.op] || (right && PREC[x.op] === PREC[e.op])) ? '(' + t + ')' : t; };
      return wrap(e.l, false) + ' ' + e.op + ' ' + wrap(e.r, true);
    }
    default: return '?';
  }
}

export function fmtNum(v) {
  if (Number.isInteger(v)) return String(v);
  if (!Number.isFinite(v)) return String(v);
  return String(parseFloat(v.toPrecision(12)));
}
