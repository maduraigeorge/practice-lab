/* Web Worker hosting SQLite (sql.js, WebAssembly, vendored in assets/vendor/sqljs).
 * Running the database off the main thread keeps the page responsive and lets the page stop runaway queries.
 *
 * Request : { id, type, ...payload }
 * Response: { id, ok: true, result } | { id, ok: false, error }
 * Types   : open {bytes?}, script {sql}, import {statements, csv, extra}, exec {sql, limit}, schema, export
 * A result that contains `bytes` is a fresh snapshot of the database (sent after changes) so the page can restore it if this
 * worker has to be terminated. Note: sql.js can only export by closing and re-opening the connection, which drops TEMP
 * tables and PRAGMA settings - so no snapshot is taken while TEMP objects exist. */
importScripts('../vendor/sqljs/sql-wasm.js');

let SQL = null, db = null, extra = { fks: [], pks: [] };
const ready = initSqlJs({ locateFile: f => new URL('../vendor/sqljs/' + f, self.location.href).href })
  .then(s => { SQL = s; db = new SQL.Database(); });

const quoteId = n => '"' + String(n).replace(/"/g, '""') + '"';
const stripSchema = n => String(n).replace(/^.*\./, '').replace(/["`]/g, '').toLowerCase();

function schema() {
  const tables = [], fks = [];
  const list = db.exec("SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name");
  (list[0] ? list[0].values : []).forEach(([name, type]) => {
    const cols = db.exec(`PRAGMA table_info(${quoteId(name)})`)[0];
    tables.push({ name, view: type === 'view', columns: cols.values.map(c => ({ name: c[1], type: c[2] || '', nullable: !c[3], pk: !!c[5] })) });
    const f = db.exec(`PRAGMA foreign_key_list(${quoteId(name)})`)[0];
    if (f) f.values.forEach(r => fks.push({ from: [name, r[3]], to: [r[2], r[4] || null] }));
  });
  fks.forEach(f => { if (!f.to[1]) { const t = tables.find(t => t.name === f.to[0]); const pk = t && t.columns.find(c => c.pk); f.to[1] = pk ? pk.name : ''; } });
  const find = n => tables.find(t => t.name.toLowerCase() === stripSchema(n));
  extra.pks.forEach(([t, c]) => { const T = find(t); const col = T && T.columns.find(x => x.name.toLowerCase() === c.toLowerCase()); if (col) col.pk = true; });
  extra.fks.forEach(f => { const a = find(f.from[0]), b = find(f.to[0]); if (a && b) fks.push({ from: [a.name, f.from[1]], to: [b.name, f.to[1]] }); });
  return { tables, fks };
}

const fingerprint = () => `${db.exec('SELECT total_changes()')[0].values[0][0]}/${db.exec('PRAGMA schema_version')[0].values[0][0]}`;
const hasTempObjects = () => db.exec('SELECT count(*) FROM sqlite_temp_master')[0].values[0][0] > 0;
const snapshot = () => db.export();
const replaceDb = nd => { if (db) db.close(); db = nd; };

const handlers = {
  open({ bytes }) {
    const nd = bytes ? new SQL.Database(bytes) : new SQL.Database();
    replaceDb(nd); extra = { fks: [], pks: [] };
    return { schema: schema() };
  },
  script({ sql }) {
    const nd = new SQL.Database();
    try { nd.exec(sql); } catch (e) { nd.close(); throw e; }
    replaceDb(nd); extra = { fks: [], pks: [] };
    return { schema: schema(), bytes: snapshot() };
  },
  import({ statements, csv, extra: ex }) {
    const nd = new SQL.Database();
    let ok = 0, failed = 0; const errors = [];
    nd.exec('PRAGMA foreign_keys = OFF; BEGIN');
    for (const st of statements) {
      try { nd.exec(st); ok++; } catch (e) { failed++; if (errors.length < 4) errors.push(`${e.message || e} – near: ${st.slice(0, 70).replace(/\s+/g, ' ')}…`); }
    }
    for (const t of csv) {
      try {
        nd.exec(`CREATE TABLE ${quoteId(t.name)} (${t.cols.map((c, i) => `${quoteId(c)} ${t.num[i] ? 'REAL' : 'TEXT'}`).join(', ')})`);
        const ins = nd.prepare(`INSERT INTO ${quoteId(t.name)} VALUES (${t.cols.map(() => '?').join(',')})`);
        t.rows.forEach(r => ins.run(r)); ins.free(); ok += t.rows.length;
      } catch (e) { failed++; if (errors.length < 4) errors.push(`CSV ${t.name}: ${e.message || e}`); }
    }
    try { nd.exec('COMMIT'); } catch { /* nothing open */ }
    replaceDb(nd); extra = ex || { fks: [], pks: [] };
    return { schema: schema(), ok, failed, errors, bytes: snapshot() };
  },
  exec({ sql, limit }) {
    const t0 = performance.now(), before = fingerprint(), sets = [];
    // Statement by statement and row by row, so a query that would return millions of rows never fills the memory.
    for (const st of db.iterateStatements(sql)) {
      const columns = st.getColumnNames();
      if (!columns.length) { st.step(); continue; }
      const rows = []; let truncated = false;
      while (st.step()) {
        if (rows.length >= limit) { truncated = true; break; }
        rows.push(st.get().map(v => (v instanceof Uint8Array ? '[blob]' : v)));
      }
      sets.push({ columns, rows, truncated });
    }
    if (!sets.length) sets.push({ columns: [], rows: [], rowcount: db.getRowsModified() });
    const out = { sets, ms: Math.round((performance.now() - t0) * 10) / 10, notices: [] };
    if (fingerprint() !== before) { out.schema = schema(); if (!hasTempObjects()) out.bytes = snapshot(); }
    return out;
  },
  schema() { return { schema: schema() }; },
  export() { return { bytes: snapshot() }; },
};

onmessage = async e => {
  const { id, type, ...payload } = e.data;
  try {
    await ready;
    const result = handlers[type](payload);
    postMessage({ id, ok: true, result }, result && result.bytes ? [result.bytes.buffer] : []);
  } catch (err) {
    postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};
