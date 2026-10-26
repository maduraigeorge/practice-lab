/* File import for the SQL sandbox. Turns an uploaded file into a "plan" the SQLite worker can execute:
 *   { kind: 'sqlite', bytes }                                   – a ready-made SQLite database
 *   { kind: 'script', statements, csv, extra, skipped, notes }  – SQL statements (+ CSV tables) to run in a fresh database
 * Supported: .sql (PostgreSQL / MySQL dumps are cleaned up for SQLite), PostgreSQL custom (-Fc) and tar (-Ft) backups,
 * .tar / .tar.gz / .zip archives, .csv and .sqlite files. Everything happens in the browser. */
import { splitStatements } from './sql-parse.js';

export const MAX_FILE_BYTES = 60 * 1024 * 1024;

/* ================= file import (.sql / .tar / .zip / .csv / .sqlite) ================= */
const SKIP_RE = /^(set|select\s+(pg_catalog|setval)|create\s+extension|comment\s+on|grant|revoke|alter\s+(sequence|schema|function|type|domain|database)\b|alter\s+(table|view)\s+(only\s+)?\S+\s+owner\s+to|alter\s+table\s+\S+\s+(enable|disable)\s+keys|create\s+(or\s+replace\s+)?(function|procedure|trigger|type|domain|sequence|schema|extension|rule|policy|publication|subscription)|drop\s+(schema|extension|sequence|function|type)|lock\s+tables|unlock\s+tables|use\s|delimiter|start\s+transaction|begin|commit|\\connect|create\s+database|alter\s+default)/i;
export function pgCopyToInserts(text) {
  return text.replace(/^COPY\s+(\S+)\s*(\([^)]*\))?\s+FROM\s+stdin;?[^\n]*\n([\s\S]*?)^\\\.\s*$/gim, (m, tbl, cols, body) => {
    const q1 = s => s === '\\N' ? 'NULL' : "'" + s.replace(/\\t/g, '\t').replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\\\/g, '\\').replace(/'/g, "''") + "'";
    return body.split('\n').filter(l => l.length).map(l => `INSERT INTO ${tbl} ${cols || ''} VALUES (${l.split('\t').map(q1).join(', ')});`).join('\n');
  });
}
export function cleanStatement(st, mysql, ctx) {
  let s = st.trim();
  const low = s.replace(/^(\s*(--[^\n]*|\/\*[\s\S]*?\*\/)\s*)+/, '');
  s = low;
  if (!s || SKIP_RE.test(s)) return null;
  s = s.replace(/\b"?public"?\./gi, '');
  let m;
  if ((m = /^alter\s+table\s+(?:only\s+)?(\S+)\s+add\s+(?:constraint\s+\S+\s+)?primary\s+key\s*\(([^)]*)\)/i.exec(s))) { m[2].split(',').forEach(c => ctx.extra.pks.push([m[1], c.trim().replace(/["`]/g, '')])); return null; }
  if ((m = /^alter\s+table\s+(?:only\s+)?(\S+)\s+add\s+(?:constraint\s+\S+\s+)?foreign\s+key\s*\(([^)]*)\)\s*references\s+(\S+?)\s*\(([^)]*)\)/i.exec(s))) {
    const fc = m[2].split(',').map(x => x.trim().replace(/["`]/g, '')), tc = m[4].split(',').map(x => x.trim().replace(/["`]/g, ''));
    fc.forEach((c, i) => ctx.extra.fks.push({ from: [m[1], c], to: [m[3], tc[i] || tc[0]] })); return null;
  }
  if (/^alter\s+table/i.test(s)) { ctx.notes.add('some ALTER TABLE constraints (SQLite cannot add them afterwards)'); return null; }
  if (/^create\s+(unique\s+)?index/i.test(s)) return s.replace(/\susing\s+\w+/i, '').replace(/\s+(with|where)\s*\([^)]*\)\s*$/i, '');
  if (/^create\s+table/i.test(s)) {
    s = s.replace(/\bONLY\s/i, '').replace(/::[a-z_ ]+(\([^)]*\))?(\[\])?/gi, '').replace(/\s+DEFAULT\s+nextval\([^)]*\)(?:::\w+)?/gi, '').replace(/\s+DEFAULT\s+(now|current_timestamp|localtimestamp)\s*\(\s*\)/gi, ' DEFAULT CURRENT_TIMESTAMP').replace(/\s+DEFAULT\s+\w+\([^)]*\)/gi, '')
      .replace(/\)\s*(ENGINE|TYPE)\s*=[^;]*$/i, ')').replace(/\s+AUTO_INCREMENT(\s*=\s*\d+)?/gi, '').replace(/\s+UNSIGNED/gi, '')
      .replace(/\s+(CHARACTER SET|CHARSET)\s+\w+/gi, '').replace(/\s+COLLATE\s+[\w.]+/gi, '').replace(/\s+COMMENT\s+'(?:[^']|'')*'/gi, '')
      .replace(/\s+ON UPDATE CURRENT_TIMESTAMP(\(\))?/gi, '').replace(/\bUNIQUE KEY\s+\S+\s*\(/gi, 'UNIQUE (')
      .replace(/,\s*\n?\s*(FULLTEXT\s+|SPATIAL\s+)?KEY\s+\S+\s*\([^)]*\)/gi, '').replace(/\b(tiny|small|medium|big)?int\(\d+\)/gi, 'INTEGER')
      .replace(/\s+WITH(OUT)?\s+TIME ZONE/gi, '').replace(/\b(timestamp|time)\(\d\)/gi, '$1')
      .replace(/\b(\w+)\s+(?:big)?serial\b/gi, '$1 INTEGER').replace(/\)\s*(INHERITS|PARTITION BY|WITH|TABLESPACE)\b[^;]*$/i, ')');
    return s;
  }
  if (/^insert\s/i.test(s) && mysql) s = s.replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\\\/g, '\\');
  if (/^insert\s/i.test(s)) s = s.replace(/^insert\s+into\s+(?:only\s+)?/i, 'INSERT INTO ');
  return s;
}
export async function collectStatements(text, ctx) {
  const mysql = /ENGINE\s*=|mysqldump|phpMyAdmin|`\w+`/i.test(text.slice(0, 200000));
  text = pgCopyToInserts(text.replace(/\r\n/g, '\n')).replace(/^\\(?!\.).*$/gm, '');
  if (mysql) text = text.replace(/\\\\/g, '\u0001').replace(/\\'/g, "''").replace(/\u0001/g, '\\\\');
  const stmts = splitStatements(text), out = [];
  for (let i = 0; i < stmts.length; i++) {
    const c = cleanStatement(stmts[i], mysql, ctx);
    if (c === null) ctx.skipped++; else out.push(c);
    if (i % 2000 === 1999) await new Promise(r => setTimeout(r));
  }
  return out;
}
export function parseCSV(t) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f.length || row.length) { row.push(f); rows.push(row); }
  return rows.filter(r => r.length > 1 || r[0] !== '');
}
function csvTable(name, text) {
  const rows = parseCSV(text.replace(/^\uFEFF/, '')); if (rows.length < 1) return null;
  const tn = name.replace(/^.*[\\/]/, '').replace(/\.csv$/i, '').replace(/[^\w]+/g, '_').replace(/^(\d)/, '_$1') || 'data';
  const cols = rows[0].map((c, i) => (c.trim().replace(/[^\w]+/g, '_') || 'col' + (i + 1)));
  const body = rows.slice(1);
  const num = cols.map((_, i) => body.length > 0 && body.every(r => r[i] === undefined || r[i] === '' || (r[i].trim() !== '' && !isNaN(+r[i]))));
  return { name: tn, cols, num, rows: body.map(r => cols.map((_, i) => (r[i] === undefined || r[i] === '' ? null : num[i] ? +r[i] : r[i]))) };
}
const MAX_UNPACKED = 200 * 1024 * 1024;
async function inflate(u8, format) {
  const reader = new Blob([u8]).stream().pipeThrough(new DecompressionStream(format)).getReader();
  const parts = []; let total = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    total += value.length;
    if (total > MAX_UNPACKED) { reader.cancel(); throw new Error('The file expands to more than 200 MB, which is too large for the browser.'); }
    parts.push(value);
  }
  const out = new Uint8Array(total); let o = 0; parts.forEach(p => { out.set(p, o); o += p.length; });
  return out;
}
const gunzip = u8 => inflate(u8, 'gzip');
function readTar(u8) {
  const out = [], dec = new TextDecoder(); let off = 0;
  const str = (a, b) => dec.decode(u8.subarray(off + a, off + b)).replace(/\0.*$/s, '');
  while (off + 512 <= u8.length) {
    const name = str(0, 100); if (!name) break;
    const size = parseInt(str(124, 136).trim() || '0', 8), type = str(156, 157), prefix = str(345, 500);
    if (type === '0' || type === '' ) out.push({ name: (prefix ? prefix + '/' : '') + name, data: u8.subarray(off + 512, off + 512 + size) });
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}
async function readZip(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), dec = new TextDecoder(); let e = u8.length - 22;
  while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('Not a valid zip file.');
  const n = Math.min(dv.getUint16(e + 10, true), 5000); let p = dv.getUint32(e + 16, true); const out = [];
  for (let i = 0; i < n; i++) {
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nl)); p += 46 + nl + el + cl;
    if (name.endsWith('/')) continue;
    const ds = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true), raw = u8.subarray(ds, ds + csize);
    let data = raw;
    if (method === 8) data = await inflate(raw, 'deflate-raw');
    else if (method !== 0) continue;
    out.push({ name, data });
  }
  return out;
}

/* ===== PostgreSQL pg_dump archive reader (custom -Fc and tar -Ft formats), fully in the browser ===== */
const inflateZlib = u8 => inflate(u8, 'deflate');
function pgReadToc(u8) {
  const dec = new TextDecoder(); let p = 0, isz = 4, osz = 8;
  const byte = () => u8[p++];
  const int = () => { const neg = byte(); let v = 0; for (let i = 0; i < isz; i++) v += byte() * 2 ** (8 * i); return neg ? -v : v; };
  const off = () => { const flag = byte(); let v = 0; for (let i = 0; i < osz; i++) v += byte() * 2 ** (8 * i); return { flag, pos: v }; };
  const str = () => { const n = int(); if (n < 0) return null; const s = dec.decode(u8.subarray(p, p + n)); p += n; return s; };
  if (dec.decode(u8.subarray(0, 5)) !== 'PGDMP') throw new Error('Not a PostgreSQL archive.');
  p = 5; const vmaj = byte(), vmin = byte(), vrev = byte(), ver = vmaj * 10000 + vmin * 100 + vrev;
  isz = byte(); osz = byte(); const format = byte();
  let algo = 0;
  if (ver >= 11500) algo = byte(); else { const lvl = int(); algo = lvl === 0 ? 0 : 1; }
  if (ver >= 10400) { for (let i = 0; i < 7; i++) int(); str(); }
  if (ver >= 11000) { str(); str(); }
  const n = int(), toc = [];
  for (let i = 0; i < n; i++) {
    const e = { id: int() }; int();
    if (ver >= 10800) { str(); str(); } else { str(); }
    e.tag = str(); e.desc = str(); if (ver >= 11100) int();
    e.defn = str(); str(); e.copy = str();
    if (ver >= 10300) e.ns = str();
    if (ver >= 11000) str();
    if (ver >= 11400) str();
    if (ver >= 11600) int();
    str(); if (ver >= 10900) str();
    if (ver >= 10500) { while (str() !== null) { /* dependencies */ } }
    if (format === 1) e.off = off(); else e.file = str();
    toc.push(e);
  }
  return { toc, algo, format, ver, endPos: p };
}
async function pgCustomToSQL(u8) {
  const { toc, algo } = pgReadToc(u8);
  if (algo > 1) throw new Error('This backup uses lz4/zstd compression, which the browser cannot unpack. Re-export with:  pg_dump -Fc --compress=gzip  (or plain SQL).');
  const dec = new TextDecoder(); let out = '';
  for (const e of toc) {
    if (e.desc === 'TABLE DATA' && e.copy && e.off && e.off.flag === 2) {
      let p = e.off.pos; p++; /* block type */
      const isz = 4, rdInt = () => { const neg = u8[p++]; let v = 0; for (let i = 0; i < isz; i++) v += u8[p++] * 2 ** (8 * i); return neg ? -v : v; };
      rdInt(); const chunks = []; let total = 0;
      for (;;) { const len = rdInt(); if (len <= 0) break; chunks.push(u8.subarray(p, p + len)); p += len; total += len; }
      let raw = new Uint8Array(total), o = 0; chunks.forEach(c => { raw.set(c, o); o += c.length; });
      if (algo === 1) raw = await inflateZlib(raw);
      out += e.copy + dec.decode(raw) + '\n';
    } else if (e.defn) out += e.defn + '\n';
  }
  return out;
}
async function pgTarToSQL(files) {
  const tocF = files.find(f => /(^|\/)toc\.dat$/.test(f.name)); const { toc } = pgReadToc(tocF.data), dec = new TextDecoder(); let out = '';
  for (const e of toc) {
    if (e.desc === 'TABLE DATA' && e.copy) {
      const f = files.find(x => x.name.replace(/^.*\//, '') === (e.file || e.id + '.dat'));
      out += e.copy + (f ? dec.decode(f.data) : '\\.\n') + '\n';
    } else if (e.defn) out += e.defn + '\n';
  }
  return out;
}

const td = new TextDecoder();
export async function prepareImport(file, onStatus = () => {}) {
  if (file.size > MAX_FILE_BYTES) throw new Error('File is larger than 60 MB – please upload a smaller dump.');
  let u8 = new Uint8Array(await file.arrayBuffer());
  if (u8[0] === 0x1f && u8[1] === 0x8b) u8 = await gunzip(u8);
  const looksSqlite = td.decode(u8.subarray(0, 15)) === 'SQLite format 3';
  if (looksSqlite) return { kind: 'sqlite', bytes: u8 };

  const looksTar = u8.length > 512 && td.decode(u8.subarray(257, 262)) === 'ustar';
  const looksZip = u8[0] === 0x50 && u8[1] === 0x4b;
  const isPgCustom = u8.length > 5 && td.decode(u8.subarray(0, 5)) === 'PGDMP';
  let files = looksTar ? readTar(u8) : looksZip ? await readZip(u8) : [{ name: file.name.replace(/\.gz$/i, ''), data: u8 }];
  const ctx = { skipped: 0, notes: new Set(), extra: { fks: [], pks: [] } };

  if (isPgCustom || files.some(f => /(^|\/)toc\.dat$/.test(f.name))) {
    onStatus('PostgreSQL backup detected – reading it in your browser…');
    const sqlText = isPgCustom ? await pgCustomToSQL(u8) : await pgTarToSQL(files);
    files = [{ name: 'restored.sql', data: new TextEncoder().encode(sqlText) }];
  } else if (!looksTar && !looksZip && u8.subarray(0, 4096).includes(0)) {
    throw new Error('This file is binary and is not a tar, zip, SQLite or PostgreSQL backup, so it cannot be read. Export your database as plain SQL (.sql) and upload that.');
  }

  const usable = files.filter(f => /\.(sql|txt|csv|sqlite3?|db)$/i.test(f.name) && !/(^|\/)(\.|__MACOSX)/.test(f.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  if (!usable.length) throw new Error('No .sql, .csv or SQLite files found inside.' + (files.length ? ' Found: ' + files.slice(0, 5).map(f => f.name).join(', ') : ''));
  if (usable.length === 1 && /\.(sqlite3?|db)$/i.test(usable[0].name)) return { kind: 'sqlite', bytes: usable[0].data };

  const statements = [], csv = [];
  for (const f of usable) {
    if (/\.(sqlite3?|db)$/i.test(f.name)) continue;
    const text = td.decode(f.data);
    if (/\.csv$/i.test(f.name)) { const t = csvTable(f.name, text); if (t) csv.push(t); }
    else statements.push(...await collectStatements(text, ctx));
  }
  return { kind: 'script', statements, csv, extra: ctx.extra, skipped: ctx.skipped, notes: [...ctx.notes] };
}
