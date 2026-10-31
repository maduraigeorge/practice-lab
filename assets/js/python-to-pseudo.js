/* Translate a small, beginner-level subset of Python into the pseudocode the flowchart lab understands.
 * Pure function (unit-tested under tests/js). The result is a list of { text, line, src } for parse(), so line numbers and the
 * original wording of every statement survive the translation.
 *
 * Supported: x = expr, x += expr, a[i] = expr, input() (also wrapped in int / float / str, and a, b = map(int, input().split())),
 * print(...), if / elif / else, while, for i in range(...), for x in list, lst.append(v), pass, import (ignored), # comments.
 * Not supported (explained to the user): def, class, break, continue, try, with, f-strings, one-line blocks such as "if x: y". */
import { PseudoError, parse } from './pseudo-parser.js';

const STR = /("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')/;
const CLOSER = { if: 'ENDIF', while: 'ENDWHILE', for: 'ENDFOR' };
const BAD = {
  def: 'Functions (def) are not drawn in the flowchart yet – write the steps directly.',
  class: 'Classes are not drawn in the flowchart.',
  break: '"break" is not supported in the flowchart yet – put the exit test in the while condition.',
  continue: '"continue" is not supported in the flowchart yet – use an if instead.',
  try: 'try / except is not supported in the flowchart.',
  with: '"with" is not supported in the flowchart.',
  return: '"return" is not supported in the flowchart.',
};

/** Does this text look like Python rather than pseudocode? (a block header ending in ":", print( or input( ) */
export function looksLikePython(src) {
  return /^\s*(if|elif|else|while|for|def)\b[^\n]*:\s*(#.*)?$/m.test(src) || /^\s*\w+\s*=\s*(int\(|float\()?input\(/m.test(src) || /^\s*print\(/m.test(src);
}

/** Apply `f` to the parts of `s` that are not inside quotes. */
const outsideStrings = (s, f) => s.split(STR).map((part, i) => (i % 2 ? part : f(part))).join('');

/** Split on commas that are not inside brackets or quotes. */
function splitTop(s) {
  const out = []; let depth = 0, cur = '', q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { cur += c; if (c === '\\') cur += s[++i] ?? ''; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if ('([{'.includes(c)) depth++; else if (')]}'.includes(c)) depth--;
    if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += c;
  }
  if (cur.trim() || out.length) out.push(cur.trim());
  return out;
}

/** `lenient` (used by the Python lab's flowchart): lines that cannot be drawn - bare expressions, def / class / try / with
 *  blocks, return / break / continue, f-strings, statements the pseudocode parser rejects - are left out instead of failing. */
export function pythonToPseudo(source, { lenient = false } = {}) {
  const out = [], stack = [];
  let skipInd = -1;                                              // lenient: inside a skipped block whose header had this indent                                    // stack: { ind, kind }
  const raw = source.split('\n');
  const fail = (msg, line) => { throw new PseudoError(msg, line); };
  const expr = (s, line) => {
    if (lenient) s = s.replace(/(^|[^\w"'])[fF](?=["'])/g, '$1');
    if (s.split(STR).some((part, i) => i % 2 && /(^|[^\w])[fF]$/.test(s.split(STR)[i - 1]))) fail('f-strings are not supported in the flowchart – use print("Total:", total) instead.', line);
    if (/\blambda\b/.test(s)) fail('lambda is not supported in the flowchart.', line);
    if (lenient) s = outsideStrings(s, x => x.replace(/([\w.]+(?:\[[^\]]*\])?)\s+(not\s+)?in\s+([\w.]+(?:\[[^\]]*\])?)/g, (_, k, n, c) => `${n ? 'NOT ' : ''}CONTAINS(${k}, ${c})`));
    return outsideStrings(s, x => x.replace(/\/\//g, ' DIV ').replace(/\bTrue\b/g, 'TRUE').replace(/\bFalse\b/g, 'FALSE'));
  };
  const isInput = rhs => {
    let r = rhs.trim(), g;
    while ((g = /^(int|float|str)\((.*)\)$/.exec(r))) r = g[2].trim();
    return /^input\(.*\)$/.test(r) || /^(list\()?map\(\s*(int|float|str)\s*,\s*input\(.*\)\.split\(.*\)\)\)?$/.test(r) || /^input\(.*\)\.split\(.*\)$/.test(r);
  };

  for (let i = 0; i < raw.length; i++) {
    const line = i + 1, rawText = raw[i], t = rawText.trim();
    if (!t || t.startsWith('#')) continue;
    const ind = rawText.match(/^[ \t]*/)[0].replace(/\t/g, '    ').length;
    if (skipInd >= 0) { if (ind > skipInd) continue; skipInd = -1; }
    const word = (/^[A-Za-z_]+/.exec(t) || [''])[0], isElse = word === 'elif' || word === 'else';
    while (stack.length && stack[stack.length - 1].ind >= ind) {
      const top = stack[stack.length - 1];
      if (isElse && top.ind === ind && top.kind === 'if') break;
      out.push({ text: CLOSER[top.kind], line, src: '' }); stack.pop();
    }
    const emit = text => out.push({ text, line, src: t });
    const simple = text => {                                     // a statement that is not a block header
      if (lenient) { try { parse([{ text, line, src: t }]); } catch { return; } }
      emit(text);
    };
    const header = (kind, text) => { emit(text); stack.push({ ind, kind }); };
    const body = t.replace(/\s+#[^"']*$/, '');                   // trailing comment (when no quote follows it)

    if (BAD[word] && !/^\w+\s*=[^=]/.test(body)) {
      if (!lenient) fail(BAD[word], line);
      if (/:$/.test(body)) skipInd = ind;                        // def / class / try / with: leave the whole block out
      continue;
    }
    if (/^(import|from)\s/.test(body) || body === 'pass') continue;

    let m;
    if ((m = /^if\s+(.+):$/.exec(body))) { header('if', `IF ${expr(m[1], line)} THEN`); continue; }
    if ((m = /^elif\s+(.+):$/.exec(body))) {
      if (!stack.length || stack[stack.length - 1].kind !== 'if') fail('This "elif" has no matching "if".', line);
      emit(`ELSE IF ${expr(m[1], line)} THEN`); continue;
    }
    if (/^else\s*:$/.test(body)) {
      if (!stack.length || stack[stack.length - 1].kind !== 'if') fail('This "else" has no matching "if".', line);
      emit('ELSE'); continue;
    }
    if ((m = /^while\s+(.+):$/.exec(body))) { header('while', `WHILE ${expr(m[1], line)} DO`); continue; }
    if ((m = /^for\s+(\w+)\s+in\s+range\((.*)\)\s*:$/.exec(body))) {
      const a = splitTop(m[2]).map(x => expr(x, line));
      if (a.length < 1 || a.length > 3 || a.some(x => !x)) fail('range() needs one, two or three numbers.', line);
      const shift = (x, d) => {                                  // the last value is one before range()'s stop
        if (/^-?\d+$/.test(x)) return String(+x + d);
        const w = (d < 0 ? /^(.+?)\s*\+\s*1$/ : /^(.+?)\s*-\s*1$/).exec(x);
        return w ? w[1] : `${x} ${d < 0 ? '-' : '+'} 1`;
      };
      const step = a[2] === undefined ? '1' : a[2], neg = /^-/.test(step);
      const from = a.length === 1 ? '0' : a[0], to = a.length === 1 ? a[0] : a[1];
      header('for', `FOR ${m[1]} = ${from} TO ${shift(to, neg ? 1 : -1)}${a.length === 3 ? ` STEP ${step}` : ''}`); continue;
    }
    if ((m = /^for\s+(\w+)\s+in\s+(.+):$/.exec(body))) { header('for', `FOR EACH ${m[1]} IN ${expr(m[2], line)} DO`); continue; }
    if (/^(if|elif|while|for|else)\b/.test(body)) {
      fail(body.includes(':') ? 'Put the body of this block on the next lines (indented) so the flowchart can draw it.' : 'This line should end with ":".', line);
    }

    if ((m = /^(.+?)\s*=\s*(.+)$/.exec(body)) && !/^[=!<>]/.test(m[2]) && isInput(m[2])) {
      simple(`INPUT ${splitTop(m[1].replace(/^\((.*)\)$/, '$1')).join(', ')}`); continue;
    }
    if ((m = /^print\((.*)\)$/.exec(body))) {
      const args = splitTop(m[1]).filter(a => !/^(sep|end|file|flush)\s*=/.test(a));
      simple(args.length ? `OUTPUT ${args.map(a => expr(a, line)).join(', ')}` : 'OUTPUT ""'); continue;
    }
    if ((m = /^(\w+)\.append\((.*)\)$/.exec(body))) { simple(`APPEND(${m[1]}, ${expr(m[2], line)})`); continue; }
    if ((m = /^(\w+(?:\[.+\])?)\s*(\+|-|\*\*|\*|\/\/|\/|%)=\s*(.+)$/.exec(body))) {
      const r = expr(m[3], line); simple(`${m[1]} = ${m[1]} ${m[2] === '//' ? 'DIV' : m[2]} ${/^[\w.]+$/.test(r) ? r : `(${r})`}`); continue;
    }
    if ((m = /^(\w+(?:\[.+\])?)\s*=\s*(.+)$/.exec(body)) && !/^=/.test(m[2])) { simple(`${expr(m[1], line)} = ${expr(m[2], line)}`); continue; }
    if (!lenient) fail(`The flowchart can't draw this Python line yet: ${t}`, line);
  }
  while (stack.length) out.push({ text: CLOSER[stack.pop().kind], line: raw.length, src: '' });
  return out;
}
