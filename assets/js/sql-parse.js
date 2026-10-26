/* Pure SQL text helpers: comment/string masking, statement splitting and the clause-by-clause explainer.
 * No DOM access, no database access – everything here is unit-testable. */

/* ================= SQL helpers ================= */
export const KW = new Set('select from where group by having order limit offset join inner left right full outer cross natural on as and or not in is null like ilike between exists case when then else end union all intersect except distinct insert into values update set delete create table drop alter add column primary key foreign references default unique index view with recursive asc desc using returning if true false cast over partition rows range explain analyze begin commit rollback'.split(' '));
export const FUNCS = 'count sum avg min max round coalesce nullif lower upper length substr substring concat trim replace now current_date current_timestamp date extract cast abs ceil floor row_number rank dense_rank lag lead string_agg group_concat ifnull strftime'.split(' ');

export function maskSQL(s) {
  let out = '', i = 0, depth = 0;
  const blank = (a, b, ch = ' ') => { let r = ''; for (let k = a; k < b; k++) r += s[k] === '\n' ? '\n' : ch; return r; };
  while (i < s.length) {
    const c = s[i], n = s[i + 1];
    if (c === '-' && n === '-') { let e = s.indexOf('\n', i); if (e < 0) e = s.length; out += blank(i, e); i = e; continue; }
    if (c === '/' && n === '*') { let e = s.indexOf('*/', i + 2); e = e < 0 ? s.length : e + 2; out += blank(i, e); i = e; continue; }
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < s.length) { if (s[j] === c) { if (s[j + 1] === c) { j += 2; continue; } break; } j++; }
      const e = Math.min(j + 1, s.length);
      out += blank(i, e, c === "'" ? ' ' : '_'); i = e; continue;
    }
    if (c === '(') { depth++; out += c; i++; continue; }
    if (c === ')') { depth = Math.max(0, depth - 1); out += c; i++; continue; }
    out += depth > 0 ? (c === '\n' ? '\n' : ' ') : c; i++;
  }
  return out;
}
export function splitStatements(sql) {
  const m = maskSQL(sql), parts = []; let start = 0;
  for (let i = 0; i < m.length; i++) if (m[i] === ';') { parts.push(sql.slice(start, i)); start = i + 1; }
  parts.push(sql.slice(start));
  return parts.map(p => p.trim()).filter(p => maskSQL(p).trim());
}
function topLevelCommas(text) {
  const m = maskSQL(text), out = []; let start = 0;
  for (let i = 0; i < m.length; i++) if (m[i] === ',') { out.push(text.slice(start, i).trim()); start = i + 1; }
  out.push(text.slice(start).trim()); return out.filter(Boolean);
}
const CLAUSE_RE = /\b(select|from|where|group\s+by|having|order\s+by|limit|offset|union(?:\s+all)?|intersect|except|(?:(?:inner|left|right|full|cross|natural)\s+(?:outer\s+)?)?join)\b/gi;
function segmentsOf(sql) {
  const m = maskSQL(sql), hits = []; let x; CLAUSE_RE.lastIndex = 0;
  while ((x = CLAUSE_RE.exec(m))) hits.push({ kw: x[1].toLowerCase().replace(/\s+/g, ' '), start: x.index, kwEnd: x.index + x[1].length });
  return hits.map((h, i) => ({ kw: h.kw, start: h.start, text: sql.slice(h.kwEnd, i + 1 < hits.length ? hits[i + 1].start : sql.length).trim() }));
}

/* ================= explanation ================= */
const JOIN_TXT = {
  'join': 'keeps only the row pairs where the ON condition is true', 'inner join': 'keeps only the row pairs where the ON condition is true',
  'left join': 'keeps ALL rows from the left side; where nothing matches, the right-side columns become NULL',
  'left outer join': 'keeps ALL rows from the left side; where nothing matches, the right-side columns become NULL',
  'right join': 'keeps ALL rows from the right side; where nothing matches, the left-side columns become NULL',
  'right outer join': 'keeps ALL rows from the right side; where nothing matches, the left-side columns become NULL',
  'full join': 'keeps ALL rows from both sides, filling NULLs where there is no match', 'full outer join': 'keeps ALL rows from both sides, filling NULLs where there is no match',
  'cross join': 'pairs EVERY row with EVERY row (rows × rows)', 'natural join': 'joins on all columns that share a name',
};
export function analyze(sqlAll) {
  const stmts = splitStatements(sqlAll);
  if (!stmts.length) return null;
  const sql = stmts[stmts.length - 1].replace(/;\s*$/, '');
  const mk = maskSQL(sql).trim().toLowerCase();
  const first = (mk.match(/^[a-z]+/) || [''])[0];
  const out = { sql, first, steps: [], note: stmts.length > 1 ? `Your text has ${stmts.length} statements – explaining the last one.` : '' };
  const T = (key, title, text, extra = {}) => out.steps.push({ key, title, text, ...extra });

  if (first === 'select' || first === 'with') {
    const segs = segmentsOf(sql);
    const idxSel = segs.findIndex(s => s.kw === 'select');
    const withText = first === 'with' && segs.length ? sql.slice(0, segs[Math.max(idxSel, 0)].start).trim() : '';   // "WITH x AS (...)"
    const prefix = withText ? withText + '\n' : '';
    const body = segs.slice(Math.max(idxSel, 0));
    const complex = body.some(s => /^(union|intersect|except)/.test(s.kw));
    const get = k => body.find(s => s.kw === k), all = k => body.filter(s => s.kw === k);
    const sel = get('select'), from = get('from'), where = get('where'), grp = get('group by'), hav = get('having'),
          ord = get('order by'), lim = get('limit'), off = get('offset');
    const joins = body.filter(s => /join$/.test(s.kw));
    if (prefix) T('cte', 'WITH (CTEs)', 'First defines named temporary results (`WITH ... AS (...)`) that the main query can use like tables.');
    if (complex) T('set', 'UNION / INTERSECT / EXCEPT', 'Runs each SELECT separately and then combines the results (UNION adds them, INTERSECT keeps common rows, EXCEPT removes rows).');
    const base = from ? `FROM ${from.text} ${joins.map(j => `${j.kw.toUpperCase()} ${j.text}`).join(' ')}`.trim() : '';
    const wh = where ? ` WHERE ${where.text}` : '', gb = grp ? ` GROUP BY ${grp.text}` : '', hv = hav ? ` HAVING ${hav.text}` : '';
    const cnt = inner => `${prefix}SELECT COUNT(*) FROM (${inner} LIMIT 100001) q`;
    const doCounts = !complex && sel && from;
    if (from) {
      const tbl = from.text.replace(/\s+/g, ' ');
      let t = `Starts with the rows of \`${tbl}\`.`;
      joins.forEach(j => {
        const [tab, cond] = j.text.split(/\bON\b/i);
        t += `\nThen \`${j.kw.toUpperCase()}\` with \`${tab.trim()}\`${cond ? ` on \`${cond.trim().replace(/\s+/g, ' ')}\`` : ''}: ${JOIN_TXT[j.kw] || 'combines rows'}.`;
      });
      T('from', joins.length ? 'FROM + JOIN' : 'FROM', t, doCounts ? { count: cnt(`SELECT 1 ${base}`), unit: 'rows', peek: `${prefix}SELECT * ${base} LIMIT 5` } : {});
    } else if (sel) T('from', 'FROM', 'No table is used – the query just computes values.');
    if (where) T('where', 'WHERE', `Keeps only the rows where \`${where.text.replace(/\s+/g, ' ')}\` is true; all other rows are thrown away.`,
      doCounts ? { count: cnt(`SELECT 1 ${base}${wh}`), unit: 'rows', peek: `${prefix}SELECT * ${base}${wh} LIMIT 5` } : {});
    const selText = sel ? sel.text : '';
    const distinct = /^distinct\b/i.test(selText.replace(/^all\b/i, '').trim());
    const items = sel ? topLevelCommas(selText.replace(/^distinct\b/i, '').trim()) : [];
    const hasAgg = /\b(count|sum|avg|min|max|string_agg|group_concat|array_agg)\s*\(/i.test(maskSQL(selText)) && !/\bover\s*\(/i.test(maskSQL(selText));
    if (grp) T('group', 'GROUP BY', `Puts rows that share the same \`${grp.text.replace(/\s+/g, ' ')}\` into one group. From here on, each group is one row.`,
      doCounts ? { count: cnt(`SELECT 1 ${base}${wh}${gb}`), unit: 'groups' } : {});
    else if (hasAgg) T('group', 'AGGREGATE', 'Aggregate functions (COUNT, SUM, AVG…) with no GROUP BY collapse all remaining rows into a single row.', { fixed: 1, unit: 'row' });
    if (hav) T('having', 'HAVING', `Keeps only the groups where \`${hav.text.replace(/\s+/g, ' ')}\` is true (like WHERE, but applied to groups).`,
      doCounts ? { count: cnt(`SELECT 1 ${base}${wh}${gb}${hv}`), unit: 'groups' } : {});
    if (sel) {
      const shown = items.slice(0, 6).map(i => `\`${i.replace(/\s+/g, ' ')}\``).join(', ') + (items.length > 6 ? ` … (+${items.length - 6})` : '');
      T('select', 'SELECT', `Chooses/computes ${items.length === 1 && items[0] === '*' ? 'all columns' : items.length + ' output column' + (items.length === 1 ? '' : 's')}: ${shown}.${hasAgg ? ' Aggregates produce one value per group.' : ''}`);
    }
    if (distinct) T('distinct', 'DISTINCT', 'Removes duplicate rows so each distinct combination appears once.',
      doCounts ? { count: cnt(`SELECT DISTINCT ${selText.replace(/^distinct\b/i, '').trim()} ${base}${wh}${gb}${hv}`), unit: 'rows' } : {});
    if (ord) T('order', 'ORDER BY', `Sorts the result by \`${ord.text.replace(/\s+/g, ' ')}\` (ASC = smallest first, DESC = largest first). Only now does order matter.`);
    if (lim || off) T('limit', 'LIMIT / OFFSET', `Returns only ${lim ? 'the first `' + lim.text + '` rows' : 'the rows'}${off ? ', after skipping `' + off.text + '`' : ''}.`);
    out.final = true;
  } else if (first === 'update') {
    const m = sql.match(/^\s*update\s+([\s\S]+?)\s+set\s+([\s\S]+?)(?:\s+where\s+([\s\S]+))?$/i);
    if (m) {
      const [, tbl, set, cond] = m;
      T('find', 'FIND ROWS', cond ? `Finds the rows of \`${tbl}\` where \`${cond.replace(/\s+/g, ' ')}\`.` : `No WHERE – EVERY row of \`${tbl}\` will change!`,
        { count: `SELECT COUNT(*) FROM (SELECT 1 FROM ${tbl}${cond ? ' WHERE ' + cond : ''} LIMIT 100001) q`, unit: 'rows', peek: `SELECT * FROM ${tbl}${cond ? ' WHERE ' + cond : ''} LIMIT 5` });
      T('set', 'SET', `Changes those rows: \`${set.replace(/\s+/g, ' ')}\`.`);
    } else T('x', 'UPDATE', 'Changes existing rows.');
  } else if (first === 'delete') {
    const m = sql.match(/^\s*delete\s+from\s+(\S+)(?:\s+where\s+([\s\S]+))?$/i);
    if (m) {
      const [, tbl, cond] = m;
      T('find', 'FIND ROWS', cond ? `Finds the rows of \`${tbl}\` where \`${cond.replace(/\s+/g, ' ')}\`.` : `No WHERE – EVERY row of \`${tbl}\` will be deleted!`,
        { count: `SELECT COUNT(*) FROM (SELECT 1 FROM ${tbl}${cond ? ' WHERE ' + cond : ''} LIMIT 100001) q`, unit: 'rows', peek: `SELECT * FROM ${tbl}${cond ? ' WHERE ' + cond : ''} LIMIT 5` });
      T('del', 'DELETE', 'Removes those rows permanently (unless the transaction is rolled back).');
    } else T('x', 'DELETE', 'Removes rows.');
  } else if (first === 'insert') {
    const m = sql.match(/^\s*insert\s+into\s+(\S+)/i);
    T('ins', 'INSERT', `Adds new row(s) to \`${m ? m[1] : 'the table'}\`. Columns not listed get their default (or NULL).`);
  } else if (first === 'create' || first === 'drop' || first === 'alter') {
    T('ddl', first.toUpperCase(), { create: 'Creates a new database object (table, view, index…).', drop: 'Deletes a database object and everything in it.', alter: 'Changes the structure of an existing object.' }[first]);
  } else if (first === 'explain') {
    T('x', 'EXPLAIN', 'Shows the plan the database would use (which indexes, join order, estimated costs) instead of running the query.');
  } else T('x', first ? first.toUpperCase() : 'STATEMENT', 'Runs this statement.');
  return out;
}

