/* Pseudocode interpreter that records one "step" per flowchart node it passes through.
 * Pure functions (no DOM) so they can be unit-tested. The flowchart builder (pseudo-flow.js) must have run first: it
 * stores the flowchart node ids on every statement as `stmt.fc`, which the steps reference. */
import { PseudoError, exprText, fmtNum } from './pseudo-parser.js';

export class StopRun extends Error {}

/* ------------------------------------------------------------------ values */
export function fmtVal(v) {
  if (typeof v === 'number') return fmtNum(v);
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (Array.isArray(v)) return '[' + v.map(fmtVal).join(', ') + ']';
  return String(v);
}
export function fmtOut(v) { return typeof v === 'string' ? v : fmtVal(v); }
const typeName = v => Array.isArray(v) ? 'a list' : typeof v === 'string' ? 'text' : typeof v === 'number' ? 'a number' : 'a true/false value';
const near = (a, b) => a === b || Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));      // 0.1 + 0.2 = 0.3 is TRUE here
const same = (a, b) => (typeof a === 'number' && typeof b === 'number' ? near(a, b) : JSON.stringify(a) === JSON.stringify(b));

/** "3 4 5" or one value per line -> typed list (numbers where possible). */
export function parseInputs(text) {
  const t = String(text || '').trim();
  if (!t) return [];
  const parts = t.includes('\n') ? t.split('\n').map(s => s.trim()).filter(s => s !== '') : t.split(/\s+/);
  return parts.map(s => (/^-?\d+(\.\d+)?$/.test(s) ? Number(s) : s));       // plain decimals only: Infinity, 0x1A, 1e3 stay text
}

/* ------------------------------------------------------------------ expression evaluation */
const FUNC_DOC = {
  LEN: 'counts the items (or characters)', ABS: 'drops the minus sign', SQRT: 'square root', FLOOR: 'rounds down to a whole number',
  CEIL: 'rounds up to a whole number', ROUND: 'rounds to the nearest whole number (or n decimals)', MIN: 'the smallest value',
  MAX: 'the largest value', SUM: 'adds up all the numbers in the list', UPPER: 'CAPITAL letters', LOWER: 'small letters',
  STR: 'turns a value into text', INT: 'turns text/decimals into a whole number', FLOAT: 'turns text into a decimal number',
  SUBSTR: 'cuts a piece out of text: SUBSTR(text, start, length) – start counts from 0',
};

function fail(msg, line) { throw new PseudoError(msg, line); }

export function makeEnv() {
  const m = new Map(), dirty = new Set();
  return {
    get: name => { const e = m.get(name.toLowerCase()); return e ? e.value : undefined; },
    has: name => m.has(name.toLowerCase()),
    set(name, value) {
      const k = name.toLowerCase(), e = m.get(k);
      if (e) { if (!same(e.value, value) || typeof value === 'object') dirty.add(k); e.value = value; } else { m.set(k, { name, value }); dirty.add(k); }
    },
    touch(name) { dirty.add(name.toLowerCase()); },                               // a list was changed in place
    takeDirty() { const out = [...dirty].map(k => m.get(k).name); dirty.clear(); return out; },
    size() { let n = 0; for (const { value } of m.values()) n += Array.isArray(value) ? value.length + 1 : typeof value === 'string' ? Math.ceil(value.length / 8) + 1 : 1; return n; },
    signature() {
      let sg = '';
      for (const { name, value } of m.values()) sg += name + '=' + (Array.isArray(value) ? `[${value.length}:${JSON.stringify(value.slice(0, 4))}${JSON.stringify(value.slice(-4))}]` : typeof value === 'string' ? value.length + ':' + value.slice(0, 40) : String(value)) + ';';
      return sg;
    },
    snapshot() { const o = {}; for (const { name, value } of m.values()) o[name] = JSON.parse(JSON.stringify(value)); return o; },
    names: () => [...m.values()].map(e => e.name),
  };
}

function num(v, what, line) {
  if (typeof v !== 'number') fail(`${what} needs numbers, but got ${typeName(v)} ${fmtVal(v)}.`, line);
  return v;
}

export function ev(e, env, line) {
  switch (e.t) {
    case 'num': case 'str': case 'bool': return e.v;
    case 'paren': return ev(e.e, env, line);
    case 'var': {
      const v = env.get(e.name);
      if (v === undefined) fail(`The variable "${e.name}" has no value yet. Give it one (with INPUT or =) before using it.`, line);
      return v;
    }
    case 'list': return e.items.map(x => ev(x, env, line));
    case 'index': {
      const b = ev(e.base, env, line), i = ev(e.idx, env, line);
      if (typeof b !== 'string' && !Array.isArray(b)) fail(`Only lists and text can be indexed with [ ], but ${exprText(e.base)} is ${typeName(b)}.`, line);
      if (!Number.isInteger(i)) fail(`A position must be a whole number, but got ${fmtVal(i)}.`, line);
      if (i < 0 || i >= b.length) fail(`Position ${i} is outside ${exprText(e.base)} – it has ${b.length} item(s), so valid positions are 0 to ${b.length - 1}.`, line);
      return b[i];
    }
    case 'un':
      if (e.op === 'NOT') return !truthy(ev(e.e, env, line), line);
      return -num(ev(e.e, env, line), 'The minus sign', line);
    case 'bin': return binary(e, env, line);
    case 'call': return call(e, env, line);
    default: return fail('Unknown expression.', line);
  }
}
const truthy = (v, line) => { if (typeof v !== 'boolean') fail(`A condition must be true or false, but got ${typeName(v)} ${fmtVal(v)}.`, line); return v; };

function binary(e, env, line) {
  if (e.op === 'AND') { const l = truthy(ev(e.l, env, line), line); return l ? truthy(ev(e.r, env, line), line) : false; }
  if (e.op === 'OR') { const l = truthy(ev(e.l, env, line), line); return l ? true : truthy(ev(e.r, env, line), line); }
  const a = ev(e.l, env, line), b = ev(e.r, env, line);
  switch (e.op) {
    case '=': return same(a, b);
    case '≠': return !same(a, b);
    case '<': case '>': case '≤': case '≥': {
      if (!((typeof a === 'number' && typeof b === 'number') || (typeof a === 'string' && typeof b === 'string')))
        fail(`Can't compare ${typeName(a)} ${fmtVal(a)} with ${typeName(b)} ${fmtVal(b)} using ${e.op}.`, line);
      if (typeof a === 'number') return e.op === '<' ? a < b && !near(a, b) : e.op === '>' ? a > b && !near(a, b) : e.op === '≤' ? a < b || near(a, b) : a > b || near(a, b);
      return e.op === '<' ? a < b : e.op === '>' ? a > b : e.op === '≤' ? a <= b : a >= b;
    }
    case '+':
      if (typeof a === 'string' || typeof b === 'string') return fmtOut(a) + fmtOut(b);
      if (Array.isArray(a) && Array.isArray(b)) return a.concat(b);
      return num(a, '+', line) + num(b, '+', line);
    case '-': return num(a, '-', line) - num(b, '-', line);
    case '*': return num(a, '*', line) * num(b, '*', line);
    case '/': { const d = num(b, '/', line); if (d === 0) fail('Division by zero – the divisor is 0.', line); return num(a, '/', line) / d; }
    case 'DIV': { const d = num(b, 'DIV', line); if (d === 0) fail('Division by zero – the divisor is 0.', line); return Math.floor(num(a, 'DIV', line) / d); }
    case 'MOD': { const d = num(b, 'MOD', line); if (d === 0) fail('MOD by zero – the divisor is 0.', line); const x = num(a, 'MOD', line); return x - d * Math.floor(x / d); }
    case '^': { const r = Math.pow(num(a, '^', line), num(b, '^', line)); if (!Number.isFinite(r)) fail('That power is too large (or undefined).', line); return r; }
    default: return fail(`Unknown operator ${e.op}.`, line);
  }
}

function call(e, env, line) {
  const args = e.args.map(x => ev(x, env, line));
  const need = (n, name = e.name) => { if (args.length !== n) fail(`${name} needs ${n} value(s) in the brackets, e.g. ${name}(${Array(n).fill('x').join(', ')}).`, line); };
  switch (e.name) {
    case 'LEN': need(1); if (typeof args[0] !== 'string' && !Array.isArray(args[0])) fail('LEN needs a list or text.', line); return args[0].length;
    case 'ABS': need(1); return Math.abs(num(args[0], 'ABS', line));
    case 'SQRT': { need(1); const x = num(args[0], 'SQRT', line); if (x < 0) fail('SQRT of a negative number is not possible here.', line); return Math.sqrt(x); }
    case 'FLOOR': need(1); return Math.floor(num(args[0], 'FLOOR', line));
    case 'CEIL': need(1); return Math.ceil(num(args[0], 'CEIL', line));
    case 'ROUND': {
      if (args.length === 1) return Math.round(num(args[0], 'ROUND', line));
      need(2); const f = Math.pow(10, num(args[1], 'ROUND', line)); return Math.round(num(args[0], 'ROUND', line) * f) / f;
    }
    case 'MIN': case 'MAX': {
      const list = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
      if (!list.length) fail(`${e.name} needs at least one value.`, line);
      list.forEach(v => num(v, e.name, line));
      return e.name === 'MIN' ? Math.min(...list) : Math.max(...list);
    }
    case 'SUM': { need(1); if (!Array.isArray(args[0])) fail('SUM needs a list.', line); return args[0].reduce((s, v) => s + num(v, 'SUM', line), 0); }
    case 'UPPER': need(1); return fmtOut(args[0]).toUpperCase();
    case 'LOWER': need(1); return fmtOut(args[0]).toLowerCase();
    case 'STR': need(1); return fmtOut(args[0]);
    case 'INT': case 'FLOAT': {
      need(1); const v = args[0];
      const n = typeof v === 'number' ? v : typeof v === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(v) ? Number(v) : NaN;
      if (isNaN(n)) fail(`${e.name} can't turn ${fmtVal(v)} into a number.`, line);
      return e.name === 'INT' ? Math.trunc(n) : n;
    }
    case 'SUBSTR': {
      need(3); if (typeof args[0] !== 'string') fail('SUBSTR needs text as the first value.', line);
      return args[0].substr(num(args[1], 'SUBSTR', line), num(args[2], 'SUBSTR', line));
    }
    case 'APPEND': fail('APPEND changes a list, so write it as its own line:  APPEND(list, value)', line); break;
    default: fail(`I don't know a function called ${e.name}. Available: ${Object.keys(FUNC_DOC).join(', ')}.`, line);
  }
  return undefined;
}

/* ------------------------------------------------------------------ explanations */
function substitute(e, env) {
  return exprText(e, name => { const v = env.get(name); return v === undefined ? undefined : fmtVal(v); });
}
const isTrivial = e => ['num', 'str', 'bool', 'var'].includes(e.t) || (e.t === 'paren' && isTrivial(e.e));

/** Bullet points explaining the less obvious operators inside an expression (max 3). */
export function exprNotes(e, env, line) {
  const out = [];
  const val = x => { try { return fmtVal(ev(x, env, line)); } catch { return null; } };
  (function walk(n) {
    if (!n || typeof n !== 'object') return;
    if (n.t === 'bin') {
      const l = val(n.l), r = val(n.r), res = val(n), shown = l !== null && r !== null && res !== null ? ` → ${l} ${n.op} ${r} = ${res}` : '';
      const me = exprText(n);
      if (n.op === 'MOD') out.push(`\`${me}\` (MOD) is the remainder left after dividing${shown}`);
      else if (n.op === 'DIV') out.push(`\`${me}\` (DIV) is whole-number division – the decimals are dropped${shown}`);
      else if (n.op === '/') out.push(`\`${me}\` is normal division – it can give decimals${shown}`);
      else if (n.op === '^') out.push(`\`${me}\` raises the left number to the power of the right one${shown}`);
      else if (n.op === '=') out.push(`\`${me}\` asks "are they equal?" (it does not store anything)${res !== null ? ' → ' + res : ''}`);
      else if (n.op === 'AND') out.push(`\`${me}\` is TRUE only when BOTH sides are TRUE${res !== null ? ' → ' + res : ''}`);
      else if (n.op === 'OR') out.push(`\`${me}\` is TRUE when AT LEAST ONE side is TRUE${res !== null ? ' → ' + res : ''}`);
      else if (n.op === '+' && res !== null && /^"/.test(res)) out.push(`\`${me}\` joins the pieces of text together → ${res}`);
    } else if (n.t === 'un' && n.op === 'NOT') out.push(`\`${exprText(n)}\` flips TRUE to FALSE and FALSE to TRUE`);
    else if (n.t === 'index') { const i = val(n.idx), r = val(n); out.push(`\`${exprText(n)}\` takes the item at position ${i ?? exprText(n.idx)} (positions start at 0)${r !== null ? ' → ' + r : ''}`); }
    else if (n.t === 'call' && FUNC_DOC[n.name]) { const r = val(n); out.push(`\`${exprText(n)}\` ${FUNC_DOC[n.name]}${r !== null ? ' → ' + r : ''}`); }
    for (const k of ['l', 'r', 'e', 'base', 'idx']) if (n[k]) walk(n[k]);
    (n.args || n.items || []).forEach(walk);
  })(e);
  return [...new Set(out)].slice(0, 3);
}

const withNotes = (text, notes) => notes.length ? text + notes.map(n => '\n• ' + n).join('') : text;

/* ------------------------------------------------------------------ the run */
/**
 * run(program, { inputs, maxSteps, maxExec })
 * -> { steps, output, error, vars, truncated, inputsUsed }
 *    step  = { node, line, kind, text, vars, changed, out, taken }
 *    error = { message, line, kind: 'runtime' | 'infinite' | 'toolong' | 'input' } | null
 */
export function run(program, { inputs = [], maxSteps = 4000, maxExec = 60000, budgetMs = 2000 } = {}) {
  const env = makeEnv(), steps = [], visits = new Map();
  let output = '', exec = 0, truncated = false, inputPos = 0, error = null;

  const t0 = performance.now();
  let snapCost = 0;
  function record(node, line, kind, text, extra = {}) {
    exec++;
    if (exec > maxExec || (exec % 128 === 0 && performance.now() - t0 > budgetMs)) { const e = new PseudoError('The algorithm ran for too many steps (or too long) – it probably never stops.', line); e.kind = 'toolong'; throw e; }
    if (kind === 'decision') {
      const key = node + '|' + env.signature(), c = (visits.get(key) || 0) + 1; visits.set(key, c);
      if (c > 150) { const e = new PseudoError('This loop repeats forever: the same check is reached again and again with exactly the same values.', line); e.kind = 'infinite'; throw e; }
    }
    const changed = env.takeDirty();
    snapCost += env.size();
    if (steps.length < maxSteps && snapCost < 3_000_000) steps.push({ node, line, kind, text, vars: env.snapshot(), changed, out: extra.out || '', taken: extra.taken || null });
    else truncated = true;                                   // beyond this the run continues, but steps are no longer stored
  }

  function nextInput(line) {
    if (inputPos >= inputs.length) { const e = new PseudoError('INPUT needs a value, but the Input box has no more values. Type the value(s) in the Input box (header).', line); e.kind = 'input'; throw e; }
    return inputs[inputPos++];
  }

  const MAX_LIST = 200000, MAX_TEXT = 1000000;
  function checkSize(v, line) {
    if ((Array.isArray(v) && v.length > MAX_LIST) || (typeof v === 'string' && v.length > MAX_TEXT)) fail('That value became too big for this playground (over 200 000 list items or 1 000 000 characters).', line);
    return v;
  }
  function assign(target, value, line) {
    checkSize(value, line);
    if (target.t === 'var') { env.set(target.name, value); return; }
    const arr = env.get(target.base.name);
    if (arr === undefined) fail(`The list "${target.base.name}" doesn't exist yet.`, line);
    const i = ev(target.idx, env, line);
    if (!Array.isArray(arr)) fail(`${target.base.name} is not a list, so ${exprText(target)} can't be changed.`, line);
    if (!Number.isInteger(i) || i < 0 || i >= arr.length) fail(`Position ${fmtVal(i)} is outside the list ${target.base.name} (valid positions: 0 to ${arr.length - 1}).`, line);
    arr[i] = value; env.touch(target.base.name);
  }

  function cond(e, line) { return truthy(ev(e, env, line), line); }

  function block(stmts) { for (const s of stmts) stmt(s); }

  function stmt(s) {
    const fc = s.fc || {};
    switch (s.type) {
      case 'begin': return;
      case 'end': throw new StopRun();
      case 'input': {
        const parts = [];
        for (const t of s.targets) { const v = nextInput(s.line); assign(t, v, s.line); parts.push(`\`${fmtVal(v)}\` in \`${exprText(t)}\``); }
        record(fc.main, s.line, 'input', `Reads ${s.targets.length > 1 ? 'values' : 'the next value'} from the Input box and stores ${parts.join(' and ')}.` + (s.prompt ? ` (Prompt: "${s.prompt}")` : ''));
        return;
      }
      case 'output': {
        const vals = s.args.map(a => ev(a, env, s.line)), line = vals.map(fmtOut).join(' ');
        output += line + '\n';
        const notes = s.args.flatMap(a => exprNotes(a, env, s.line)).slice(0, 3);
        record(fc.main, s.line, 'output', withNotes(`Shows \`${line}\` in the Output box.`, notes), { out: line + '\n' });
        return;
      }
      case 'assign': {
        const notes = exprNotes(s.expr, env, s.line), shown = substitute(s.expr, env);
        const v = ev(s.expr, env, s.line);
        assign(s.target, v, s.line);
        const tgt = exprText(s.target);
        const how = isTrivial(s.expr) ? `Stores \`${fmtVal(v)}\` in \`${tgt}\`.` : `Works out \`${exprText(s.expr)}\` = \`${shown}\` = \`${fmtVal(v)}\` and stores it in \`${tgt}\`.`;
        record(fc.main, s.line, 'assign', withNotes(how, s.expr.t === 'bin' || s.expr.t === 'call' || s.expr.t === 'index' ? notes : []));
        return;
      }
      case 'append': {
        const [listE, valE] = s.call.args;
        if (!listE || !valE || s.call.args.length !== 2) fail('APPEND needs a list and a value:  APPEND(list, value)', s.line);
        const arr = ev(listE, env, s.line), v = ev(valE, env, s.line);
        if (!Array.isArray(arr) || listE.t !== 'var') fail('APPEND needs the name of a list as its first value.', s.line);
        env.get(listE.name).push(v); env.touch(listE.name); checkSize(arr, s.line);
        record(fc.main, s.line, 'assign', `Adds \`${fmtVal(v)}\` to the END of the list \`${listE.name}\`.`);
        return;
      }
      case 'if': {
        for (let bi = 0; bi < s.branches.length; bi++) {
          const b = s.branches[bi], r = cond(b.cond, b.line);
          const shown = substitute(b.cond, env), notes = exprNotes(b.cond, env, b.line);
          record(b.fc.cond, b.line, 'decision',
            withNotes(`Checks \`${exprText(b.cond)}\`: ${isTrivial(b.cond) ? '' : `\`${shown}\` is `}**${r ? 'TRUE' : 'FALSE'}** → follows the ${r ? 'Yes' : 'No'} arrow.`, notes), { taken: r ? 'Yes' : 'No' });
          if (r) { block(b.body); return; }
        }
        if (s.orelse) block(s.orelse.body);
        return;
      }
      case 'while': {
        for (;;) {
          const r = cond(s.cond, s.line), shown = substitute(s.cond, env), notes = exprNotes(s.cond, env, s.line);
          record(fc.cond, s.line, 'decision', withNotes(`Loop check \`${exprText(s.cond)}\`: ${isTrivial(s.cond) ? '' : `\`${shown}\` is `}**${r ? 'TRUE' : 'FALSE'}** → ${r ? 'run the loop body again (Yes).' : 'leave the loop (No).'}`, notes), { taken: r ? 'Yes' : 'No' });
          if (!r) return;
          block(s.body);
        }
      }
      case 'repeat': {
        for (;;) {
          block(s.body);
          const r = cond(s.cond, s.untilLine), shown = substitute(s.cond, env), notes = exprNotes(s.cond, env, s.untilLine);
          record(fc.cond, s.untilLine, 'decision', withNotes(`UNTIL \`${exprText(s.cond)}\`: ${isTrivial(s.cond) ? '' : `\`${shown}\` is `}**${r ? 'TRUE' : 'FALSE'}** → ${r ? 'the condition is met, so the loop ends (Yes).' : 'not met yet, so repeat the body (No).'}`, notes), { taken: r ? 'Yes' : 'No' });
          if (r) return;
        }
      }
      case 'for': {
        const from = ev(s.from, env, s.line), to = ev(s.to, env, s.line), step = s.step ? ev(s.step, env, s.line) : 1;
        [['start', from], ['end', to], ['STEP', step]].forEach(([n, v]) => num(v, `The ${n} value of a FOR loop`, s.line));
        if (step === 0) fail('The STEP of a FOR loop cannot be 0 – it would never end.', s.line);
        env.set(s.varName, from);
        record(fc.init, s.line, 'assign', `Starts the loop: sets the counter \`${s.varName}\` to \`${fmtVal(from)}\`.`);
        for (;;) {
          const cur = env.get(s.varName), r = step > 0 ? (cur < to || near(cur, to)) : (cur > to || near(cur, to));
          record(fc.cond, s.line, 'decision', `Loop check: is \`${s.varName}\` ${step > 0 ? '≤' : '≥'} \`${fmtVal(to)}\`? \`${fmtVal(cur)} ${step > 0 ? '≤' : '≥'} ${fmtVal(to)}\` is **${r ? 'TRUE' : 'FALSE'}** → ${r ? 'run the loop body (Yes).' : 'leave the loop (No).'}`, { taken: r ? 'Yes' : 'No' });
          if (!r) return;
          block(s.body);
          const nv = env.get(s.varName) + step;
          env.set(s.varName, nv);
          record(fc.incr, s.line, 'assign', `End of the body: \`${s.varName}\` goes up by \`${fmtVal(step)}\` and becomes \`${fmtVal(nv)}\`.`);
        }
      }
      case 'foreach': {
        const list = ev(s.iter, env, s.line);
        if (!Array.isArray(list) && typeof list !== 'string') fail('FOR EACH needs a list (or text) after IN.', s.line);
        const items = Array.from(list);
        for (let i = 0; ; i++) {
          const more = i < items.length;
          record(fc.cond, s.line, 'decision', `Are there more items in \`${exprText(s.iter)}\`? ${more ? `Yes – item ${i + 1} of ${items.length} is next.` : 'No – every item has been used.'}`, { taken: more ? 'Yes' : 'No' });
          if (!more) return;
          env.set(s.varName, items[i]);
          record(fc.next, s.line, 'assign', `Takes the next item: \`${s.varName}\` becomes \`${fmtVal(items[i])}\`.`);
          block(s.body);
        }
      }
      default: fail('Unknown statement.', s.line);
    }
  }

  try {
    record(program.fc && program.fc.start, null, 'start', 'The algorithm starts here.');
    block(program);
    record(program.fc && program.fc.end, null, 'end', 'The algorithm ends here. Everything it showed is in the Output box.');
  } catch (e) {
    if (e instanceof StopRun) { record(program.fc && program.fc.end, null, 'end', 'END reached – the algorithm stops here.'); }
    else if (e instanceof PseudoError) error = { message: e.message, line: e.line, kind: e.kind || (e.line ? 'runtime' : 'runtime') };
    else throw e;
  }
  return { steps, output, error, vars: env.snapshot(), truncated, inputsUsed: inputPos };
}
