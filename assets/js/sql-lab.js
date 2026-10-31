/* SQL lab: connection dialog, editor, runner, explainer UI, schema diagram, file import UI. */
import { $, esc, md, store, toast, initTabs, installErrorHandlers, measureChar, mountLabNav } from './shared.js';
import { initDock } from './dock.js';
import { maskSQL, splitStatements, analyze, KW, FUNCS } from './sql-parse.js';
import { prepareImport } from './sql-import.js';
import { buildER } from './sql-er.js';
import { SqliteClient, SqliteTimeout } from './sqlite-client.js';
import { detect as detectBridge, hasBridge, bridgeInfo, api } from './bridge-client.js';

const ROW_LIMIT = 500, LH = 20, PAD = 8;
mountLabNav('sql');
const show = (el, on = true) => { el.hidden = !on; };

/* ================= state ================= */
const S = { kind: 'none', dbType: null, token: null, label: '', schema: { tables: [], fks: [] },
            result: null, active: 0, runId: 0, lastSteps: null, busy: false, imgData: null, imgType: null };

/* ================= samples ================= */
const SAMPLE_DDL = `CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL, city TEXT, signup_date TEXT);
CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT, price REAL);
CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER REFERENCES customers(id), order_date TEXT, status TEXT);
CREATE TABLE order_items (order_id INTEGER REFERENCES orders(id), product_id INTEGER REFERENCES products(id), quantity INTEGER, PRIMARY KEY (order_id, product_id));
`;
function sampleData() {
  let seed = 7; const rnd = n => (seed = (seed * 1103515245 + 12345) % 2147483648, seed % n);
  const names = ['Asha','Ravi','Meena','Karthik','Divya','Imran','Sneha','Arjun','Priya','Vikram','Neha','Suresh'];
  const cities = ['Chennai','Mumbai','Delhi','Pune'];
  const prods = [['Notebook','Stationery',45],['Pen set','Stationery',120],['Backpack','Bags',899],['Laptop sleeve','Bags',650],['Python Basics','Books',350],
                 ['SQL in 10 Minutes','Books',420],['Desk lamp','Home',799],['Mug','Home',199],['Headphones','Electronics',1499],['Mouse','Electronics',599]];
  const status = ['shipped','shipped','pending','cancelled','delivered'];
  let s = '';
  names.forEach((n, i) => s += `INSERT INTO customers VALUES (${i + 1},'${n}','${cities[rnd(4)]}','2024-0${1 + rnd(9)}-${10 + rnd(18)}');\n`);
  prods.forEach((p, i) => s += `INSERT INTO products VALUES (${i + 1},'${p[0]}','${p[1]}',${p[2]});\n`);
  for (let o = 1; o <= 30; o++) {
    s += `INSERT INTO orders VALUES (${o},${1 + rnd(10)},'2025-0${1 + rnd(9)}-${10 + rnd(18)}','${status[rnd(5)]}');\n`;
    const used = new Set();
    for (let k = 0, n = 1 + rnd(3); k < n; k++) { const p = 1 + rnd(10); if (used.has(p)) continue; used.add(p); s += `INSERT INTO order_items VALUES (${o},${p},${1 + rnd(4)});\n`; }
  }
  return s;
}
const EXAMPLES = {
  'Everything in customers': 'SELECT * FROM customers;',
  'Filter and sort': "SELECT name, city\nFROM customers\nWHERE city = 'Chennai'\nORDER BY name;",
  'Join two tables': "SELECT c.name, o.id AS order_id, o.status\nFROM customers c\nJOIN orders o ON o.customer_id = c.id\nWHERE o.status = 'shipped'\nORDER BY c.name;",
  'Group and aggregate': 'SELECT category, COUNT(*) AS items, ROUND(AVG(price), 2) AS avg_price\nFROM products\nGROUP BY category\nHAVING COUNT(*) >= 2\nORDER BY avg_price DESC;',
  'Revenue per customer': 'SELECT c.name, SUM(oi.quantity * p.price) AS revenue\nFROM customers c\nJOIN orders o ON o.customer_id = c.id\nJOIN order_items oi ON oi.order_id = o.id\nJOIN products p ON p.id = oi.product_id\nGROUP BY c.name\nORDER BY revenue DESC\nLIMIT 5;',
  'LEFT JOIN: no orders': 'SELECT c.name, COUNT(o.id) AS orders\nFROM customers c\nLEFT JOIN orders o ON o.customer_id = c.id\nGROUP BY c.name\nHAVING COUNT(o.id) = 0;',
  'Subquery': 'SELECT name, price\nFROM products\nWHERE price > (SELECT AVG(price) FROM products);',
  'CTE': 'WITH totals AS (\n  SELECT order_id, SUM(quantity) AS qty\n  FROM order_items\n  GROUP BY order_id\n)\nSELECT * FROM totals WHERE qty > 4 ORDER BY qty DESC;',
  'UPDATE (try it!)': "UPDATE products\nSET price = price * 1.1\nWHERE category = 'Books';",
};

const q = (name) => /^[a-z_][a-z0-9_]*$/.test(name) ? name : (S.dbType === 'mysql' ? '`' + name + '`' : '"' + name.replace(/"/g, '""') + '"');
const fmtN = n => n >= 100001 ? '100,000+' : Number(n).toLocaleString();

function renderSteps(a) {
  const box = $('steps');
  if (!a) { box.innerHTML = '<span class="empty">Type a query – each clause is explained here, in the order the database actually runs it.</span>'; return; }
  let h = '';
  if (a.first === 'select' || a.first === 'with') h += '<p class="order-note">Runs in this order: FROM → JOIN → WHERE → GROUP BY → HAVING → SELECT → ORDER BY → LIMIT</p>';
  if (a.note) h += `<p class="note">${esc(a.note)}</p>`;
  h += a.steps.map((s, i) => `<div class="step${s.peek ? ' clickable' : ''}" data-i="${i}"><div class="hd"><span class="no">${i + 1}</span><span class="tt">${esc(s.title)}</span><span class="cnt" id="cnt${i}">${s.fixed ? `<b>${s.fixed}</b> ${s.unit}` : ''}</span></div>` +
    `<p>${md(s.text)}</p>${s.count || s.fixed ? `<div class="bar"><i id="bar${i}"></i></div>` : ''}<div id="peek${i}"></div></div>`).join('');
  if (a.final) h += '<div class="step"><div class="hd"><span class="no">✓</span><span class="tt">RESULT</span><span class="cnt" id="cntFinal"></span></div></div>';
  box.innerHTML = h;
  a.steps.forEach((s, i) => { const bar = $('bar' + i); if (bar) bar.style.width = (s.fixed ? 8 : 0) + '%'; });
}
async function fillCounts(a, runId) {
  if (!a || !$('counts').checked || S.kind === 'none') return;
  const withCount = a.steps.map((s, i) => [s, i]).filter(([s]) => s.count);
  let max = 1; const vals = {};
  for (const [s, i] of withCount) {
    if (runId !== S.runId) return;
    const c = $('cnt' + i); if (c) c.innerHTML = '…';
    const r = await execSQL(s.count, { mode: 'readonly' });
    if (runId !== S.runId) return;
    if (!r.ok || !r.sets[0] || !r.sets[0].rows[0]) { if (c) c.textContent = '–'; continue; }
    const n = Number(r.sets[0].rows[0][0]); vals[i] = n; max = Math.max(max, n);
    const prevKey = Object.keys(vals).map(Number).filter(k => k < i).pop();
    const delta = prevKey !== undefined && s.unit === 'rows' && n < vals[prevKey] ? ` <span class="neg">−${fmtN(vals[prevKey] - n)}</span>` : '';
    if (c) c.innerHTML = `<b>${fmtN(n)}</b> ${s.unit}${delta}`;
    Object.keys(vals).forEach(k => { const b = $('bar' + k); if (b) b.style.width = Math.max(3, vals[k] / max * 100) + '%'; });
  }
  if (S.result && S.result.ok && $('cntFinal')) {
    const set = S.result.sets[S.result.sets.length - 1];
    $('cntFinal').innerHTML = `<b>${set.rows.length}${set.truncated ? '+' : ''}</b> rows × <b>${set.columns.length}</b> columns`;
  }
}
$('steps').addEventListener('click', async e => {
  const el = e.target.closest('.step.clickable'); if (!el || !S.lastSteps) return;
  const i = +el.dataset.i, s = S.lastSteps.steps[i], slot = $('peek' + i);
  if (slot.innerHTML) { slot.innerHTML = ''; return; }
  slot.innerHTML = '<div class="note peek-note">loading…</div>';
  const r = await execSQL(s.peek, { mode: 'readonly' });
  slot.innerHTML = r.ok && r.sets[0] ? `<div class="peek">${gridHTML(r.sets[0])}</div>` : `<div class="note peek-note">${esc(r.error ? r.error.message : 'no rows')}</div>`;
});

/* ================= backend (live bridge / sandbox) ================= */
const sqlite = new SqliteClient();
const TIMEOUT_MSG = 'The query ran for more than 15 seconds and was stopped. Check your joins and add a WHERE / LIMIT.';
async function execSQL(sql, opt = {}) {
  if (S.kind === 'live') return api('query', { token: S.token, sql, mode: opt.mode || $('mode').value });
  if (S.kind === 'sandbox') {
    try {
      const r = await sqlite.call('exec', { sql, limit: ROW_LIMIT });
      if (r.schema) { S.schema = r.schema; setConn(); renderSchema(); refreshHighlights(); }
      return { ok: true, ...r };
    } catch (e) { return { ok: false, error: { message: e instanceof SqliteTimeout ? TIMEOUT_MSG : String(e.message || e) } }; }
  }
  return { ok: false, error: { message: 'Not connected. Click the database badge at the top to connect or open the sandbox.' } };
}
async function applyDDL(ddl) {
  const r = await sqlite.call('script', { sql: ddl }, { timeout: 30000 });
  S.kind = 'sandbox'; S.dbType = 'sqlite'; S.token = null; S.schema = r.schema;
  store.set('sqlLab.ddl', ddl.length < 400000 ? ddl : '');
  setConn(); renderSchema(); refreshHighlights();
}

function setStatus(t, cls) { const s = $('status'); s.textContent = t; s.title = t; s.className = 'status ' + (cls || ''); }
function setConn() {
  const c = $('conn'), commit = S.kind === 'live' && $('mode').value === 'commit';
  c.className = 'chip ' + (S.kind === 'live' ? 'live' : S.kind === 'sandbox' ? 'sand' : '') + (commit ? ' danger' : '');
  $('connTxt').textContent = S.kind === 'live' ? `${S.dbType === 'mysql' ? 'MySQL' : 'PostgreSQL'} · ${S.label}` : S.kind === 'sandbox' ? `Sandbox · ${S.schema.tables.length} tables` : 'Not connected – click to choose';
  show($('mode'), S.kind === 'live');
  show($('disc'), S.kind === 'live');
  c.title = S.kind === 'sandbox' ? 'Database: a SQLite database that lives in this browser tab – click to change (connect, upload, create)' : 'Database – click to change';
  $('schemaMeta').textContent = S.schema.tables.length ? `${S.schema.tables.length} tables` : '';
  show($('examples'), S.kind === 'sandbox' && store.get('sqlLab.sample', '') === '1');
}
const dlg = $('dlg');
const DTABS = ['live', 'file', 'schema'];
function openDlg(tab) { showTab(tab || (S.kind === 'live' ? 'live' : 'file')); if (!dlg.open) dlg.showModal(); }
function showTab(t) {
  document.querySelectorAll('.dtabs button').forEach(b => b.classList.toggle('on', b.dataset.d === t));
  DTABS.forEach(k => show($('d-' + k), k === t));
  show($('dConnect'), t === 'live' && hasBridge());
}

$('conn').onclick = () => openDlg();
$('conn').onkeydown = e => { if (e.key === 'Enter') openDlg(); };
$('dClose').onclick = $('dCancel').onclick = () => dlg.close();
document.querySelectorAll('.dtabs button').forEach(b => b.onclick = () => showTab(b.dataset.d));
document.querySelectorAll('input[name=dbt]').forEach(r => r.onchange = () => {
  const p = $('f-port'); if (!p.value || p.value === '5432' || p.value === '3306') p.value = '';
  p.placeholder = r.value === 'mysql' ? '3306' : '5432';
  $('f-url').placeholder = r.value === 'mysql' ? 'mysql://user:password@host:3306/dbname' : 'postgresql://user:password@host:5432/dbname';
});
$('f-url').oninput = () => {
  const v = $('f-url').value.trim(); if (!/^[a-z]+:\/\//i.test(v)) return;
  try {
    const u = new URL(v), proto = u.protocol.replace(':', '');
    const my = /^(mysql|mariadb)/.test(proto); document.querySelector(`input[name=dbt][value=${my ? 'mysql' : 'postgres'}]`).checked = true;
    $('f-host').value = u.hostname || 'localhost'; $('f-port').value = u.port || ''; $('f-db').value = decodeURIComponent(u.pathname.slice(1));
    $('f-user').value = decodeURIComponent(u.username); $('f-pass').value = decodeURIComponent(u.password);
    if (/sslmode=require|ssl=true/i.test(u.search)) $('f-ssl').checked = true;
  } catch (e) {}
};
function checkBridge() {
  const w = $('bridgeWarn'), info = bridgeInfo();
  show(document.querySelector('.dtabs [data-d=live]'), !!info);       // the Connect tab only exists when the local bridge runs
  if (!info) return;
  const miss = [!info.postgres && 'PostgreSQL: pip install "psycopg[binary]"', !info.mysql && 'MySQL: pip install pymysql'].filter(Boolean);
  if (miss.length) { show(w, true); w.textContent = 'Missing driver – ' + miss.join(' · '); }
  if (info.hasKey) $('apiKey').placeholder = "Using the server's ANTHROPIC_API_KEY (or paste another)";
}

$('dConnect').onclick = async () => {
  const msg = $('liveMsg'); msg.className = 'msg'; msg.textContent = 'Connecting…';
  if (!hasBridge()) { msg.className = 'msg err'; msg.textContent = 'Start the bridge server first (python server.py).'; return; }
  const type = document.querySelector('input[name=dbt]:checked').value;
  const body = { type, host: $('f-host').value, port: $('f-port').value, database: $('f-db').value, user: $('f-user').value, password: $('f-pass').value, ssl: $('f-ssl').checked };
  $('dConnect').disabled = true;
  const r = await api('connect', body);
  $('dConnect').disabled = false;
  if (!r.ok) { msg.className = 'msg err'; msg.textContent = r.error.message; return; }
  if (S.token) api('disconnect', { token: S.token });
  S.kind = 'live'; S.dbType = type; S.token = r.token; S.label = r.label; S.schema = r.schema;
  $('auto').checked = false; store.set('sqlLab.auto', '0');   // never auto-run queries against a real server
  $('f-pass').value = ''; $('f-url').value = '';
  ['host', 'port', 'db', 'user'].forEach(k => store.set('sqlLab.f-' + k, $('f-' + k).value)); store.set('sqlLab.type', type);
  store.set('sqlLab.sample', '');
  msg.className = 'msg ok'; msg.textContent = 'Connected – ' + r.server;
  setConn(); renderSchema(); refreshHighlights(); fillExamples(); setStatus('Connected', 'ok'); dlg.close(); schedule(0);
  log('info', 'Connected', `${r.label}\n${r.server}`);
};
$('disc').onclick = async () => {
  if (S.token) await api('disconnect', { token: S.token });
  S.kind = 'none'; S.token = null; S.schema = { tables: [], fks: [] }; setConn(); renderSchema(); setStatus('Disconnected'); dlg.close();
};
$('mode').onchange = () => { setConn(); store.set('sqlLab.mode', $('mode').value); };

/* sandbox tab */
$('loadSample').onclick = async () => {
  const m = $('sandMsg'); m.className = 'msg'; m.textContent = 'Loading…';
  try { const ddl = SAMPLE_DDL + sampleData(); $('ddl').value = ddl; await applyDDL(ddl); store.set('sqlLab.sample', '1');
    m.className = 'msg ok'; m.textContent = 'Sample database ready.'; fillExamples(); setConn(); setStatus('Sandbox ready', 'ok'); dlg.close(); schedule(0);
  } catch (e) { m.className = 'msg err'; m.textContent = e.message; }
};
$('applyDDL').onclick = async () => {
  const m = $('sandMsg'); m.className = 'msg'; m.textContent = 'Applying…';
  try { await applyDDL($('ddl').value); store.set('sqlLab.sample', ''); m.className = 'msg ok'; m.textContent = `Done – ${S.schema.tables.length} table(s) created.`; fillExamples(); setConn(); setStatus('Sandbox ready', 'ok'); schedule(0); }
  catch (e) { m.className = 'msg err'; m.textContent = e.message; }
};
const drop = $('drop');
drop.onclick = () => $('imgFile').click();
for (const z of [drop, $('fdrop')]) z.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); z.click(); } });
drop.ondragover = e => { e.preventDefault(); drop.classList.add('drag'); };
drop.ondragleave = () => drop.classList.remove('drag');
drop.ondrop = e => { e.preventDefault(); drop.classList.remove('drag'); if (e.dataTransfer.files[0]) loadImage(e.dataTransfer.files[0]); };
$('imgFile').onchange = e => e.target.files[0] && loadImage(e.target.files[0]);
document.addEventListener('paste', e => { if (!dlg.open) return; const f = [...(e.clipboardData?.files || [])].find(f => f.type.startsWith('image/')); if (f) loadImage(f); });
function loadImage(file) {
  const url = URL.createObjectURL(file), img = new Image();
  img.onload = () => {
    const max = 1800, k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas');
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
    let data = c.toDataURL('image/png'), type = 'image/png';
    if (data.length > 5.2e6) { data = c.toDataURL('image/jpeg', 0.85); type = 'image/jpeg'; }
    S.imgData = data.split(',')[1]; S.imgType = type;
    const prev = new Image(); prev.src = data; prev.alt = 'schema preview'; drop.replaceChildren(prev); $('readImg').disabled = false; URL.revokeObjectURL(url);
  };
  img.onerror = () => { $('sandMsg').className = 'msg err'; $('sandMsg').textContent = 'That file is not a readable image.'; };
  img.src = url;
}
async function useAIText(text) {
  const m = $('sandMsg');
  try {
    const txt = text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
    const j = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1));
    const ddl = `${j.ddl || ''}\n\n${j.sample_data || ''}`.trim();
    $('ddl').value = ddl; await applyDDL(ddl); store.set('sqlLab.sample', '');
    m.className = 'msg ok'; m.textContent = `Created ${S.schema.tables.length} table(s). You can edit the SQL in the "Create schema" tab.`;
    fillExamples(); setConn(); setStatus('Sandbox ready', 'ok'); log('info', 'Schema created', ddl); schedule(0);
  } catch (e) { m.className = 'msg err'; m.textContent = 'Could not use the result: ' + e.message + ' – the raw reply is in the Create schema box; fix it and press Create tables.'; if (text) $('ddl').value = text; }
}
const SCHEMA_SPEC = `Reply with ONLY one JSON object, no markdown fences, with these keys:
  "tables": [{"name": str, "columns": [{"name": str, "type": str, "pk": bool, "nullable": bool}]}],
  "fks": [{"from_table": str, "from_column": str, "to_table": str, "to_column": str}],
  "ddl": a string of SQLite-compatible CREATE TABLE statements (PRIMARY KEY and FOREIGN KEY clauses included, parent tables first),
  "sample_data": a string of SQLite-compatible INSERT statements with 6-10 realistic rows per table, consistent with the foreign keys.`;
const VISION_PROMPT = 'This image shows a database schema (an ER diagram, a table list or a screenshot of table structures).\nExtract it faithfully - do not invent tables or columns that are not visible. If a column type is unreadable, guess a sensible one.\n' + SCHEMA_SPEC;
const DESCRIBE_PROMPT = t => `Design a small, sensible relational database (3-6 tables, proper primary and foreign keys) for this request:\n${t}\n` + SCHEMA_SPEC;
async function claudeDirect(key, content) {
  let r;
  try {
    r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: 'claude-sonnet-5-5', max_tokens: 8000, messages: [{ role: 'user', content }] }) });
  } catch (e) { return { ok: false, error: { message: 'Could not reach the Anthropic API (check your internet connection).' } }; }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, error: { message: 'Anthropic API error: ' + ((j.error && j.error.message) || r.status) } };
  return { ok: true, text: (j.content || []).map(b => b.text || '').join('') };
}
async function askAI(path, body, btn, wait) {
  const m = $('sandMsg'); m.className = 'msg';
  const key = $('apiKey').value.trim();
  if (!key && !hasBridge()) { m.className = 'msg err'; m.textContent = 'Paste your Anthropic API key above first (console.anthropic.com). It is used only from your browser to call Claude.'; return; }
  m.textContent = wait; btn.disabled = true;
  let r;
  if (key) {
    r = path === 'vision'
      ? await claudeDirect(key, [{ type: 'image', source: { type: 'base64', media_type: body.media_type || 'image/png', data: body.image } }, { type: 'text', text: VISION_PROMPT }])
      : await claudeDirect(key, [{ type: 'text', text: DESCRIBE_PROMPT(body.text) }]);
  } else r = await api(path, body);
  btn.disabled = false;
  if (!r.ok) { m.className = 'msg err'; m.textContent = r.error.message; return; }
  useAIText(r.text);
}
$('readImg').onclick = () => askAI('vision', { image: S.imgData, media_type: S.imgType }, $('readImg'), 'Reading the schema with Claude… (10–40 s)');
$('descBtn').onclick = () => { const t = $('descText').value.trim(); if (!t) { $('sandMsg').className = 'msg err'; $('sandMsg').textContent = 'Describe the tables first.'; return; } askAI('describe', { text: t }, $('descBtn'), 'Designing the schema with Claude… (10–30 s)'); };
$('tmpl').onclick = () => { $('ddl').value = "CREATE TABLE students (\n  id INTEGER PRIMARY KEY,\n  name TEXT NOT NULL,\n  course_id INTEGER REFERENCES courses(id)\n);\nCREATE TABLE courses (\n  id INTEGER PRIMARY KEY,\n  title TEXT NOT NULL\n);\nINSERT INTO courses VALUES (1,'Python'),(2,'SQL');\nINSERT INTO students VALUES (1,'Asha',1),(2,'Ravi',2),(3,'Meena',1);\n"; };


/* ================= file import (.sql / .tar / .zip / .csv / .sqlite) ================= */
async function importFile(file) {
  const m = $('fileMsg'); m.className = 'msg'; m.textContent = `Reading ${file.name}…`;
  try {
    const plan = await prepareImport(file, t => { m.textContent = t; });
    let r, stats = { ok: 0, failed: 0, errors: [] };
    if (plan.kind === 'sqlite') r = await sqlite.call('open', { bytes: plan.bytes }, { timeout: 30000 });
    else { r = await sqlite.call('import', { statements: plan.statements, csv: plan.csv, extra: plan.extra }, { timeout: 120000 }); stats = r; }
    S.kind = 'sandbox'; S.dbType = 'sqlite'; S.token = null; S.schema = r.schema;
    store.set('sqlLab.sample', ''); store.set('sqlLab.ddl', '');
    if (!S.schema.tables.length) throw new Error('Nothing could be loaded – no tables were created. ' + (stats.errors[0] || ''));
    const skipped = plan.skipped || 0;
    let t = `✓ Loaded ${S.schema.tables.length} table(s) from ${file.name}.`;
    if (stats.failed || skipped) t += ` ${stats.ok} statement(s) ran, ${skipped} server-only ones skipped${stats.failed ? `, ${stats.failed} failed` : ''}.`;
    m.className = 'msg ok'; m.textContent = t;
    log('info', 'File imported: ' + file.name, [t, ...(plan.notes || []).map(n => 'Skipped: ' + n), ...stats.errors.map(e => 'Failed: ' + e)].join('\n'));
    fillExamples(); setConn(); renderSchema(); refreshHighlights(); setStatus('Sandbox ready', 'ok'); schedule(0);
    if (!stats.failed) setTimeout(() => dlg.close(), 900);
    if (S.schema.tables[0] && /^\s*SELECT \* FROM customers;?\s*$/.test($('sql').value) && !S.schema.tables.some(x => x.name === 'customers')) { $('sql').value = `SELECT * FROM ${q(S.schema.tables[0].name)} LIMIT 20;`; onEdit(); }
  } catch (e) { m.className = 'msg err'; m.textContent = e instanceof SqliteTimeout ? 'Loading took too long and was stopped – try a smaller file.' : String(e.message || e); }
}
const fdrop = $('fdrop');
fdrop.onclick = () => $('dbFile').click();
fdrop.ondragover = e => { e.preventDefault(); fdrop.classList.add('drag'); };
fdrop.ondragleave = () => fdrop.classList.remove('drag');
fdrop.ondrop = e => { e.preventDefault(); fdrop.classList.remove('drag'); if (e.dataTransfer.files[0]) importFile(e.dataTransfer.files[0]); };
$('dbFile').onchange = e => { if (e.target.files[0]) importFile(e.target.files[0]); e.target.value = ''; };


/* ================= results ================= */
function gridHTML(set) {
  const numeric = set.columns.map((_, ci) => set.rows.length && set.rows.every(r => r[ci] === null || typeof r[ci] === 'number' || (typeof r[ci] === 'string' && /^-?\d+(\.\d+)?$/.test(r[ci]))));
  return `<table class="grid"><thead><tr><th></th>${set.columns.map((c, i) => `<th class="${numeric[i] ? 'n' : ''}">${esc(c)}</th>`).join('')}</tr></thead><tbody>` +
    set.rows.map((r, ri) => `<tr><td class="rn">${ri + 1}</td>${r.map((v, i) => v === null ? `<td class="null${numeric[i] ? ' n' : ''}">NULL</td>` : `<td class="${numeric[i] ? 'n' : ''}" title="${esc(String(v))}">${esc(typeof v === 'object' ? JSON.stringify(v) : v)}</td>`).join('')}</tr>`).join('') +
    '</tbody></table>';
}
function renderResult() {
  const r = S.result, box = $('result'), meta = $('rmeta'), tabs = $('rtabs');
  $('csv').disabled = true;
  if (!r) { box.innerHTML = '<div class="pad empty">Run a query to see rows here.</div>'; show(meta, false); show(tabs, false); return; }
  if (!r.ok) { box.innerHTML = '<div class="pad empty">The query failed – see the Output box.</div>'; show(meta, false); show(tabs, false); return; }
  const sets = r.sets.filter(s => s.columns.length), set = sets[S.active] || sets[0];
  show(tabs, sets.length > 1);
  tabs.innerHTML = sets.map((s, i) => `<button class="${i === S.active ? 'on' : ''}" data-i="${i}">Result ${i + 1}</button>`).join('');
  show(meta, true);
  if (!set) {
    const rc = r.sets.map(s => s.rowcount).find(n => n >= 0);
    box.innerHTML = `<div class="pad"><b class="good">✓ Statement ran.</b>${rc !== undefined ? ` ${rc} row(s) affected.` : ''}${r.rolledBack ? ' <span class="note">(rolled back – nothing was saved)</span>' : ''}</div>`;
    meta.textContent = `${r.ms} ms`; return;
  }
  box.innerHTML = set.rows.length ? gridHTML(set) : '<div class="pad empty">The query ran but returned no rows.</div>';
  meta.innerHTML = `<span><b>${set.rows.length}</b> row${set.rows.length === 1 ? '' : 's'}${set.truncated ? ` (showing first ${ROW_LIMIT})` : ''} · <b>${set.columns.length}</b> column${set.columns.length === 1 ? '' : 's'}</span><span>${r.ms} ms</span>`;
  $('csv').disabled = !set.rows.length;
}
$('rtabs').onclick = e => { const b = e.target.closest('button'); if (b) { S.active = +b.dataset.i; renderResult(); } };
$('csv').onclick = () => {
  const sets = S.result.sets.filter(s => s.columns.length), set = sets[S.active] || sets[0]; if (!set) return;
  const cell = v => v === null ? '' : `"${(typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? "'" : '') + String(v).replace(/"/g, '""')}"`;   // a leading ' stops Excel running cells as formulas
  const blob = new Blob([[set.columns.map(cell).join(','), ...set.rows.map(r => r.map(cell).join(','))].join('\n')], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'result.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
let autoLog = null;
function log(kind, title, body, hint, auto = false) {
  const box = $('log'); if (box.querySelector('.empty')) box.innerHTML = '';
  if (auto && autoLog && box.firstChild === autoLog) autoLog.remove();
  const t = new Date().toLocaleTimeString();
  const el = document.createElement('div'); el.className = 'log ' + kind;
  el.innerHTML = `<div class="t">${t}</div><div>${kind === 'err' ? `<b class="e">${esc(title)}</b>` : `<b>${esc(title)}</b>`}</div>${body ? `<pre>${esc(body)}</pre>` : ''}${hint ? `<div class="h">💡 ${esc(hint)}</div>` : ''}`;
  box.prepend(el); autoLog = auto ? el : null; while (box.children.length > 25) box.lastChild.remove();
}
$('clearLog').onclick = () => { $('log').innerHTML = '<span class="empty">Messages, timings and errors appear here.</span>'; };

/* ================= running ================= */
const READ_RE = /^\s*(select|with|explain|show|values|table|pragma|describe|desc)\b/i;
let debounceT = null;
function schedule(ms = 800) { clearTimeout(debounceT); debounceT = setTimeout(() => { analyzeNow(); if ($('auto').checked && S.kind !== 'none' && isReadOnly()) run(false); }, ms); }
const WRITE_RE = /\b(insert|update|delete|merge|replace|into|create|drop|alter|truncate|attach|detach|vacuum|reindex|grant|revoke|call|exec|copy|pragma)\b/i;
function isReadOnly() { const t = splitStatements(currentSQL()); return t.length > 0 && t.every(st => { const m = maskSQL(st, true); return READ_RE.test(m) && !WRITE_RE.test(m); }); }
function currentSQL() { const ta = $('sql'); return ta.selectionStart !== ta.selectionEnd ? ta.value.slice(ta.selectionStart, ta.selectionEnd) : ta.value; }
function analyzeNow() { S.lastSteps = analyze(currentSQL()); renderSteps(S.lastSteps); refreshHighlights(); }

async function run(explicit, prefix = '') {
  const sql = prefix + currentSQL();
  if (!sql.trim()) return;
  if (S.kind === 'none') { if (explicit) openDlg(); return; }
  if (explicit && S.kind === 'live' && $('mode').value === 'commit' && !isReadOnly() && !confirm('Commit mode: this will PERMANENTLY change the database. Run it?')) return;
  const ta = $('sql'), lineOffset = ta.selectionStart !== ta.selectionEnd ? ta.value.slice(0, ta.selectionStart).split('\n').length - 1 : 0;   // a selection is run on its own
  const id = ++S.runId; setStatus('Running…', 'busy'); $('bandErr').style.display = 'none';
  const r = await execSQL(sql); if (id !== S.runId) return;
  S.result = r; S.active = 0;
  renderResult();
  if (r.ok) {
    const last = r.sets[r.sets.length - 1];
    const what = last.columns.length ? `${last.rows.length}${last.truncated ? '+' : ''} row(s)` : `${last.rowcount >= 0 ? last.rowcount : 0} row(s) affected`;
    setStatus(`✓ ${what} · ${r.ms} ms`, 'ok');
    log('ok', `✓ ${what} in ${r.ms} ms`, (r.notices || []).join('\n') || (r.committed ? 'Changes were committed.' : r.rolledBack ? 'Changes were rolled back (try-it mode).' : ''), '', !explicit);
    $('tabOut').classList.remove('dot');
    if (/^\s*(create|drop|alter)\b/im.test(maskSQL(sql)) ) refreshSchema();
    if (explicit && matchMedia('(max-width:900px)').matches) setTab('result');
    fillCounts(S.lastSteps, id);
  } else {
    const e = r.error; setStatus('✗ Error', 'err'); $('tabOut').classList.add('dot');
    log('err', 'Error', e.message, e.hint || friendlyHint(e.message), !explicit);
    markError(e, sql, lineOffset);
    if (explicit && matchMedia('(max-width:900px)').matches) setTab('output');
  }
}
function friendlyHint(m) {
  m = m.toLowerCase();
  if (/no such table|does not exist|doesn't exist/.test(m)) return 'Check the table name – the Schema box lists every table.';
  if (/no such column|unknown column|column .* does not exist/.test(m)) return 'Check the column name and which table it belongs to (use alias.column).';
  if (/syntax error|you have an error in your sql/.test(m)) return 'Look near the highlighted spot: missing comma, quote, bracket or keyword?';
  if (/ambiguous/.test(m)) return 'Two tables have a column with that name – write table.column.';
  if (/read-only/.test(m)) return 'Read-only mode blocks changes. Switch to "Try writes (rolled back)" in the header to experiment safely.';
  if (/must appear in the group by|not in group by|nonaggregated/.test(m)) return 'Every selected column must be in GROUP BY or wrapped in an aggregate like COUNT/SUM.';
  if (/timeout|canceling statement/.test(m)) return 'The query took too long. Add a WHERE/LIMIT or check your join conditions.';
  return '';
}
function markError(e, sql, offset) {
  let line = null;
  if (e.position) line = sql.slice(0, e.position).split('\n').length;
  else { const m = /line (\d+)/i.exec(e.message); if (m) line = +m[1]; }
  if (line) { line += offset; const b = $('bandErr'); b.style.display = 'block'; b.dataset.line = line; positionBands(); }
}
async function refreshSchema() {
  if (S.kind === 'live') { const r = await api('schema', { token: S.token }); if (r.ok) S.schema = r.schema; }
  else if (S.kind === 'sandbox') { const r = await sqlite.call('schema'); S.schema = r.schema; }
  setConn(); renderSchema(); refreshHighlights();
}
$('run').onclick = () => run(true);
$('explainBtn').onclick = () => {
  if (S.kind === 'none') return openDlg();
  const sql = currentSQL().trim().replace(/;\s*$/, ''); if (!sql) return;
  run(true, S.kind === 'sandbox' ? 'EXPLAIN QUERY PLAN ' : S.dbType === 'mysql' ? 'EXPLAIN ' : 'EXPLAIN ').then(() => {});
};
$('auto').onchange = () => store.set('sqlLab.auto', $('auto').checked ? '1' : '0');
$('counts').onchange = () => { analyzeNow(); if (S.result && S.result.ok) fillCounts(S.lastSteps, S.runId); };

/* ================= schema diagram ================= */
const posStore = {};
let erMode = store.get('sqlLab.viz', 'tables') === 'er';        // Tables (physical schema) or ER (entities + relationships)
const posKey = n => (erMode ? 'er|' : 't|') + n;
let usedT = new Set(), usedC = new Set();
function usedNames() {
  const text = currentSQL() || $('sql').value;
  const clean = text.replace(/--[^\n]*|\/\*[\s\S]*?\*\/|'(?:[^']|'')*'/g, ' ');
  const words = new Set((clean.match(/[A-Za-z_][\w$]*/g) || []).map(w => w.toLowerCase()));
  usedT = new Set(); usedC = new Set();
  S.schema.tables.forEach(t => {
    const base = t.name.split('.').pop().toLowerCase();
    if (words.has(base)) { usedT.add(t.name); t.columns.forEach(c => { if (words.has(c.name.toLowerCase())) usedC.add(t.name + '\u0000' + c.name); }); }
  });
}
function refreshHighlights() {
  usedNames();
  document.querySelectorAll('.tb').forEach(el => {
    const n = el.dataset.t; el.classList.toggle('used', usedT.has(n));
    el.querySelectorAll('.cr').forEach(r => r.classList.toggle('used', usedC.has(n + '\u0000' + r.dataset.c)));
  });
  drawLines();
}
function renderSchema() {
  const box = $('visual'), tabs = S.schema.tables;
  if (!tabs.length) { box.innerHTML = '<span class="empty">' + (S.kind === 'none' ? 'Connect to a database or load a sandbox to see its tables.' : 'No tables found in this database.') + '</span>'; return; }
  S.er = buildER(S.schema);
  const shown = erMode ? S.er.entities : tabs;
  const hint = erMode ? 'Drag entities · ◇ = relationship (its foreign-key column) · 1 / N = how many rows can match · highlighted = used by your query' : 'Drag tables to move · highlighted = used by your query · double-click to query';
  box.innerHTML = `<div class="legend"><span class="vtabs"><button class="mini${erMode ? '' : ' on'}" data-v="tables" title="Tables with their foreign-key lines">Tables</button><button class="mini${erMode ? ' on' : ''}" data-v="er" title="Entity-relationship diagram">ER diagram</button></span> ${hint}</div>` + '<div class="er" id="er"><svg id="erSvg"><defs><marker id="ar" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="currentColor"/></marker></defs></svg></div>';
  const er = $('er');
  box.querySelectorAll('.vtabs button').forEach(b => { b.onclick = () => { erMode = b.dataset.v === 'er'; store.set('sqlLab.viz', erMode ? 'er' : 'tables'); renderSchema(); }; });
  shown.forEach(t => {
    const el = document.createElement('div'); el.className = 'tb' + (erMode ? ' en' : ''); el.dataset.t = t.name;
    const fkCols = new Set(S.schema.fks.filter(f => f.from[0] === t.name).map(f => f.from[1]));
    el.innerHTML = `<div class="th" title="Double-click to query"><span>${t.view ? '👁 ' : '▦ '}${esc(t.name)}</span><em>${t.columns.length} cols</em></div>` +
      t.columns.map(c => `<div class="cr" data-c="${esc(c.name)}"><span class="k">${c.pk ? '🔑' : fkCols.has(c.name) ? '🔗' : ''}</span><span class="mono${c.pk ? ' pkc' : ''}">${esc(c.name)}</span><span class="ty">${esc(c.type)}</span></div>`).join('');
    er.appendChild(el);
    const th = el.querySelector('.th');
    th.ondblclick = () => { $('sql').value = `SELECT * FROM ${q(t.name)} LIMIT 20;`; onEdit(); run(true); };
    let drag = null;
    th.onpointerdown = e => { drag = { x: e.clientX - el.offsetLeft, y: e.clientY - el.offsetTop }; th.setPointerCapture(e.pointerId); th.style.cursor = 'grabbing'; };
    th.onpointermove = e => { if (!drag) return; el.style.left = Math.max(0, e.clientX - drag.x) + 'px'; el.style.top = Math.max(0, e.clientY - drag.y) + 'px'; posStore[posKey(t.name)] = [el.offsetLeft, el.offsetTop]; sizeEr(); drawLines(); };
    th.onpointerup = () => { drag = null; th.style.cursor = ''; };
  });
  layoutEr(); refreshHighlights();
}
function layoutEr() {
  const er = $('er'); if (!er) return;
  const W = 200, G = erMode ? 110 : 26, cols = Math.max(1, Math.floor(($('visual').clientWidth - 24 + G) / (W + G))), heights = new Array(cols).fill(0);
  [...er.querySelectorAll('.tb')].forEach(el => {
    const p = posStore[posKey(el.dataset.t)];
    if (p) { el.style.left = p[0] + 'px'; el.style.top = p[1] + 'px'; return; }
    const c = heights.indexOf(Math.min(...heights));
    el.style.left = c * (W + G) + 'px'; el.style.top = heights[c] + 'px'; heights[c] += el.offsetHeight + (erMode ? 70 : 22);
  });
  sizeEr();
}
function sizeEr() {
  const er = $('er'); if (!er) return; let w = 0, h = 0;
  er.querySelectorAll('.tb').forEach(el => { w = Math.max(w, el.offsetLeft + el.offsetWidth); h = Math.max(h, el.offsetTop + el.offsetHeight); });
  er.style.height = (h + 12) + 'px'; er.style.minWidth = (w + (erMode ? 90 : 4)) + 'px';
}
function drawLines() {
  const svg = $('erSvg'); if (!svg) return;
  svg.querySelectorAll('path.fkline, .erx').forEach(p => p.remove());
  const er = $('er');
  if (erMode) return drawER(svg, er);
  S.schema.fks.forEach(f => {
    const a = er.querySelector(`.tb[data-t="${CSS.escape(f.from[0])}"]`), b = er.querySelector(`.tb[data-t="${CSS.escape(f.to[0])}"]`);
    if (!a || !b) return;
    const rowY = (box, col) => { const r = [...box.querySelectorAll('.cr')].find(x => x.dataset.c === col); return box.offsetTop + (r ? r.offsetTop + r.offsetHeight / 2 : 14); };
    const y1 = rowY(a, f.from[1]), y2 = rowY(b, f.to[1]);
    const aRight = a.offsetLeft + a.offsetWidth / 2 < b.offsetLeft + b.offsetWidth / 2;
    const x1 = aRight ? a.offsetLeft + a.offsetWidth : a.offsetLeft, x2 = aRight ? b.offsetLeft : b.offsetLeft + b.offsetWidth;
    const dx = Math.max(30, Math.abs(x2 - x1) / 2) * (aRight ? 1 : -1);
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', a === b ? `M${x1},${y1} C${x1 + 40},${y1} ${x1 + 40},${y2} ${x1},${y2}` : `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`);
    const used = usedT.has(f.from[0]) && usedT.has(f.to[0]);
    path.setAttribute('class', 'fkline' + (used ? ' used' : '')); path.setAttribute('marker-end', 'url(#ar)'); path.style.color = used ? 'var(--accent)' : 'var(--muted)';
    svg.appendChild(path);
  });
}
/* ER view: a diamond per relationship, placed between its entities, with 1 / N at each end. A link table is drawn as one N : N diamond. */
function drawER(svg, er) {
  const NS = 'http://www.w3.org/2000/svg';
  const mkE = (name, attrs, text) => { const e = document.createElementNS(NS, name); for (const k in attrs) e.setAttribute(k, attrs[k]); if (text !== undefined) e.textContent = text; return e; };
  const rect = c => ({ x: c.offsetLeft, y: c.offsetTop, w: c.offsetWidth, h: c.offsetHeight });
  const toward = (r, tx, ty) => {                                   // where the line from the box centre to (tx, ty) leaves the box
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2, dx = tx - cx, dy = ty - cy;
    if (!dx && !dy) return [cx, cy];
    const k = Math.min(dx ? r.w / 2 / Math.abs(dx) : Infinity, dy ? r.h / 2 / Math.abs(dy) : Infinity);
    return [cx + dx * k, cy + dy * k];
  };
  (S.er ? S.er.rels : []).forEach(rel => {
    const parts = rel.parts.map(p => ({ p, c: er.querySelector(`.tb[data-t="${CSS.escape(p.entity)}"]`) })).filter(x => x.c);
    if (parts.length < 2) return;
    const rs = parts.map(x => rect(x.c)), self = parts.every(x => x.c === parts[0].c);
    const cx = self ? rs[0].x + rs[0].w + 80 : rs.reduce((a, r) => a + r.x + r.w / 2, 0) / rs.length, cy = self ? rs[0].y + rs[0].h / 2 : rs.reduce((a, r) => a + r.y + r.h / 2, 0) / rs.length;
    const label = rel.label.length > 16 ? rel.label.slice(0, 15) + '…' : rel.label, w = Math.max(76, label.length * 6.6 + 34), h = 42;
    const used = parts.every(x => usedT.has(x.p.entity)) && (!rel.junction || usedT.has(rel.junction));
    const g = mkE('g', { class: 'erx errel' + (used ? ' used' : '') });
    g.appendChild(mkE('title', {}, rel.junction ? `${rel.junction} links these tables (many-to-many)` : `foreign key ${rel.label}`));
    parts.forEach((x, i) => {
      const r = rs[i];
      const P = self ? [r.x + r.w, r.y + r.h / 2 + (i ? 14 : -14)] : toward(r, cx, cy);
      const vx = P[0] - cx, vy = P[1] - cy, k = 1 / (Math.abs(vx) / (w / 2) + Math.abs(vy) / (h / 2) || 1), D = [cx + vx * k, cy + vy * k];
      g.appendChild(mkE('path', { d: `M${P[0].toFixed(1)},${P[1].toFixed(1)} L${D[0].toFixed(1)},${D[1].toFixed(1)}`, class: 'erline' }));
      const len = Math.hypot(D[0] - P[0], D[1] - P[1]) || 1, ux = (D[0] - P[0]) / len, uy = (D[1] - P[1]) / len;
      g.appendChild(mkE('text', { x: (P[0] + ux * 13 - uy * 9).toFixed(1), y: (P[1] + uy * 13 + ux * 9 + 4).toFixed(1), class: 'ercard', 'text-anchor': 'middle' }, x.p.card));
    });
    g.appendChild(mkE('polygon', { points: `${cx - w / 2},${cy} ${cx},${cy - h / 2} ${cx + w / 2},${cy} ${cx},${cy + h / 2}`, class: 'erdia' }));
    g.appendChild(mkE('text', { x: cx, y: cy + 4, class: 'ertxt', 'text-anchor': 'middle' }, label));
    if (rel.attrs.length) g.appendChild(mkE('text', { x: cx, y: cy + h / 2 + 12, class: 'erattr', 'text-anchor': 'middle' }, rel.attrs.slice(0, 3).join(', ') + (rel.attrs.length > 3 ? '…' : '')));
    svg.appendChild(g);
  });
}
new ResizeObserver(() => { layoutEr(); drawLines(); }).observe($('visual'));

/* ================= editor ================= */
function highlight(src) {
  const re = /(--[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|('(?:[^']|'')*'?)|("(?:[^"]|"")*"?|`[^`]*`?)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][\w$]*)(\s*\()?/g;
  let out = '', last = 0, m;
  while ((m = re.exec(src))) {
    out += esc(src.slice(last, m.index)); last = re.lastIndex;
    if (m[1]) out += `<span class="t-cmt">${esc(m[1])}</span>`;
    else if (m[2]) out += `<span class="t-str">${esc(m[2])}</span>`;
    else if (m[3]) out += esc(m[3]);
    else if (m[4]) out += `<span class="t-num">${m[4]}</span>`;
    else { const w = m[5], lw = w.toLowerCase(); out += KW.has(lw) ? `<span class="t-kw">${w}</span>${esc(m[6] || '')}` : m[6] ? `<span class="t-fn">${w}</span>${esc(m[6])}` : w; }
  }
  return out + esc(src.slice(last)) + '\n ';
}
function updateEditor() {
  const ta = $('sql'); $('hl').innerHTML = highlight(ta.value);
  const n = ta.value.split('\n').length; $('gut').textContent = Array.from({ length: n }, (_, i) => i + 1).join('\n');
  syncScroll();
}
function syncScroll() {
  const ta = $('sql'); $('hl').scrollTop = ta.scrollTop; $('hl').scrollLeft = ta.scrollLeft;
  $('gut').style.transform = `translateY(${-ta.scrollTop}px)`; positionBands();
}
function positionBands() { const b = $('bandErr'); if (b.style.display === 'block') b.style.top = (PAD + (+b.dataset.line - 1) * LH - $('sql').scrollTop) + 'px'; }
function onEdit() {
  updateEditor(); store.set('sqlLab.sql', $('sql').value); $('bandErr').style.display = 'none';
  setStatus(S.kind === 'none' ? 'Not connected' : 'Typing…', 'busy'); schedule();
}
$('sql').addEventListener('scroll', () => { syncScroll(); acHide(); });
$('sql').addEventListener('select', () => {}); document.addEventListener('selectionchange', () => { if (document.activeElement === $('sql')) { clearTimeout(window._selT); window._selT = setTimeout(analyzeNow, 250); } });

/* autocomplete */
let charW = 8.4;
const ac = { items: [], i: 0, start: 0, open: false, nav: false };
let escTab = false;
function acHide() { ac.open = false; $('ac').style.display = 'none'; }
function aliasMap(text) {
  const map = {}, re = /\b(?:from|join)\s+([\w."`]+)(?:\s+(?:as\s+)?(?!on\b|where\b|join\b|inner\b|left\b|right\b|full\b|cross\b|group\b|order\b|limit\b|having\b|union\b|using\b)(\w+))?/gi; let m;
  while ((m = re.exec(text))) { const t = m[1].replace(/["`]/g, ''); map[(m[2] || t).toLowerCase()] = t; map[t.toLowerCase()] = t; }
  return map;
}
function acUpdate() {
  const ta = $('sql'), pos = ta.selectionStart; if (ta.selectionEnd !== pos) return acHide();
  const before = ta.value.slice(0, pos), m = before.match(/[A-Za-z_][\w$]*$/), word = m ? m[0] : '';
  const pre = before.slice(0, before.length - word.length), dotted = pre.endsWith('.');
  if (!word && !dotted) return acHide();
  let pool = [];
  if (dotted) {
    const owner = (pre.slice(0, -1).match(/[\w"`]+$/) || [''])[0].replace(/["`]/g, '').toLowerCase();
    const real = aliasMap(ta.value)[owner] || owner;
    const t = S.schema.tables.find(t => t.name.toLowerCase() === real.toLowerCase() || t.name.split('.').pop().toLowerCase() === real.toLowerCase());
    pool = t ? t.columns.map(c => [c.name, c.type || 'column']) : S.schema.tables.flatMap(t => t.columns.map(c => [c.name, t.name]));
  } else {
    if (word.length < 1) return acHide();
    pool = [...S.schema.tables.map(t => [t.name, 'table']), ...[...new Map(S.schema.tables.flatMap(t => t.columns.map(c => [c.name, [c.name, t.name]]))).values()],
            ...KW_LIST.map(k => [k.toUpperCase(), 'keyword']), ...FUNCS.map(f => [f.toUpperCase(), 'function'])];
  }
  const seen = new Set(), lw = word.toLowerCase();
  const items = pool.filter(([n]) => n.toLowerCase().startsWith(lw) && n !== word && !seen.has(n) && seen.add(n)).slice(0, 30);
  if (!items.length) return acHide();
  Object.assign(ac, { items, i: 0, start: pos - word.length, open: true, nav: false });
  const lines = before.split('\n'), row = lines.length - 1, col = lines[row].length - word.length, el = $('ac');
  el.style.left = Math.max(48, Math.min(46 + 10 + col * charW - ta.scrollLeft, ta.clientWidth - 120)) + 'px';
  el.style.top = (PAD + (row + 1) * LH - ta.scrollTop) + 'px'; acRender(); el.style.display = 'block';
}
const KW_LIST = [...KW];
function acRender() {
  const el = $('ac');
  el.innerHTML = ac.items.map(([n, k], i) => `<div class="${i === ac.i ? 'on' : ''}" data-i="${i}"><span>${esc(n)}</span><small>${esc(k)}</small></div>`).join('');
  const on = el.querySelector('.on'); if (on) on.scrollIntoView({ block: 'nearest' });
}
function acAccept(i = ac.i) { const ta = $('sql'); ta.setRangeText(ac.items[i][0], ac.start, ta.selectionStart, 'end'); acHide(); onEdit(); }
$('ac').addEventListener('mousedown', e => { const d = e.target.closest('[data-i]'); if (d) { e.preventDefault(); acAccept(+d.dataset.i); } });
$('sql').addEventListener('blur', acHide); $('sql').addEventListener('click', acHide);
$('sql').addEventListener('input', () => { onEdit(); acUpdate(); });
$('sql').addEventListener('keydown', e => {
  const ta = e.target;
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); acHide(); return run(true); }
  if (ac.open) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); ac.nav = true; ac.i = (ac.i + (e.key === 'ArrowDown' ? 1 : -1) + ac.items.length) % ac.items.length; return acRender(); }
    if (e.key === 'Tab' || (e.key === 'Enter' && ac.nav)) { e.preventDefault(); return acAccept(); }
    if (e.key === 'Escape') { e.preventDefault(); return acHide(); }
  }
  const leave = escTab; if (e.key !== 'Tab' && e.key !== 'Shift') escTab = false;
  if (e.key === 'Escape') { escTab = true; return; }                                  // Esc, then Tab, moves focus out of the editor
  if (e.key === 'Tab' && !e.shiftKey && !leave) { e.preventDefault(); ta.setRangeText('  ', ta.selectionStart, ta.selectionEnd, 'end'); onEdit(); }
  else if (e.key === 'Enter') {
    e.preventDefault(); const pos = ta.selectionStart, line = ta.value.slice(0, pos).split('\n').pop();
    ta.setRangeText('\n' + line.match(/^\s*/)[0], pos, ta.selectionEnd, 'end'); onEdit();
  }
});
$('fmt').onclick = () => {
  const ta = $('sql');
  const parts = ta.value.split(/('(?:[^']|'')*'|"(?:[^"]|"")*"|`[^`]*`|--[^\n]*|\/\*[\s\S]*?\*\/)/);       // odd entries are strings / comments: left exactly as typed
  const KW_RE = /\b(select|from|where|group by|having|order by|limit|offset|join|inner join|left join|right join|full join|cross join|on|and|or|as|in|not|null|is|like|between|distinct|asc|desc|union|all|case|when|then|else|end)\b/gi;
  const CLAUSE_RE = /\b(FROM|WHERE|GROUP BY|HAVING|ORDER BY|LIMIT|UNION ALL|UNION|(?:INNER |LEFT |RIGHT |FULL |CROSS )?(?:OUTER )?JOIN)\b/g;
  let out = parts.map((p, i) => i % 2 ? (p.startsWith('--') ? p + '\n' : p) : p.replace(/\s+/g, ' ').replace(KW_RE, w => w.toUpperCase()).replace(CLAUSE_RE, '\n$1').replace(/\s*;\s*/g, ';\n').replace(i > 0 && parts[i - 1].startsWith('--') ? /^ / : /^(?!)/, '')).join('');
  out = out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').trim();
  ta.value = out; onEdit();
};

/* examples + tabs + boot */
function fillExamples() {
  const sel = $('examples'), sample = store.get('sqlLab.sample', '') === '1';
  sel.innerHTML = '<option value="">Sample queries…</option>' + Object.keys(EXAMPLES).map(k => `<option>${esc(k)}</option>`).join('');
  show(sel, sample && S.kind === 'sandbox');
}
$('examples').onchange = e => { const v = EXAMPLES[e.target.value]; if (v) { $('sql').value = v; onEdit(); schedule(0); } e.target.value = ''; };
$('clearLog').title = 'Clear messages';
const setTab = initTabs({ code: 'p-code', result: 'p-result', steps: 'p-steps', visual: 'p-visual', output: 'p-output' }, t => {
  if (t === 'code') syncScroll();
  if (t === 'visual') { layoutEr(); drawLines(); }
});
window.addEventListener('resize', () => { positionBands(); });
let downOnBackdrop = false;
dlg.addEventListener('mousedown', e => { downOnBackdrop = e.target === dlg; });
dlg.addEventListener('click', e => { if (e.target === dlg && downOnBackdrop) dlg.close(); });

(async function boot() {
  $('sql').value = store.get('sqlLab.sql', 'SELECT * FROM customers;');
  $('auto').checked = store.get('sqlLab.auto', '1') === '1';
  $('mode').value = store.get('sqlLab.mode', 'readonly') === 'rollback' ? 'rollback' : 'readonly';        // a real connection never starts in commit mode
  ['host', 'port', 'db', 'user'].forEach(k => { const v = store.get('sqlLab.f-' + k, ''); if (v) $('f-' + k).value = v; });
  const savedType = store.get('sqlLab.type', 'postgres'), t = savedType === 'mysql' ? 'mysql' : 'postgres'; document.querySelector(`input[name=dbt][value=${t}]`).checked = true; $('f-port').placeholder = t === 'mysql' ? '3306' : '5432';
  updateEditor(); charW = measureChar($('sql')); fillExamples(); analyzeNow();
  await detectBridge(); checkBridge(); setConn();
  try {
    const ddl = store.get('sqlLab.ddl', '') || (SAMPLE_DDL + sampleData());
    if (!store.get('sqlLab.ddl', '')) store.set('sqlLab.sample', '1');
    $('ddl').value = ddl; await applyDDL(ddl); fillExamples(); setConn();
    setStatus('Sandbox ready', 'ok'); schedule(0);
    if (!store.get('sqlLab.seen', '')) { store.set('sqlLab.seen', '1'); openDlg(hasBridge() ? 'live' : 'file'); }
  } catch (e) { setStatus(String(e.message || e), 'err'); }
})();

/* ---------- dockable layout ---------- */
initDock({
  key: 'sqlLab.dock2', def: 'Classic', panels: ['p-code', 'p-steps', 'p-result', 'p-output', 'p-visual'],
  presets: {
    'Classic': { d: 'h', k: [[1.2, { d: 'v', k: [[.8, 'p-code'], [1.1, 'p-result'], [.55, 'p-output']] }], [1, { d: 'v', k: [[1, 'p-steps'], [1.65, 'p-visual']] }]] },
    'Code focus': { d: 'h', k: [[2, { d: 'v', k: [[1.3, 'p-code'], [1, 'p-result']] }], [1, { d: 'v', k: [[1, 'p-steps'], [1, 'p-visual'], [.6, 'p-output']] }]] },
    'Stacked': { d: 'v', k: [[.9, 'p-code'], [1.2, { d: 'h', k: [[1, 'p-result'], [1, 'p-steps']] }], [1.1, { d: 'h', k: [[1.4, 'p-visual'], [1, 'p-output']] }]] },
    'Three columns': { d: 'h', k: [[1, { d: 'v', k: [[1, 'p-code'], [1, 'p-output']] }], [1.2, { d: 'v', k: [[1, 'p-result'], [1, 'p-steps']] }], [1, 'p-visual']] },
    'Results wide': { d: 'v', k: [[.7, 'p-code'], [1.5, { d: 'h', k: [[1.6, 'p-result'], [1, { d: 'v', k: [[1, 'p-steps'], [1, 'p-visual']] }]] }], [.45, 'p-output']] },
    'Schema focus': { d: 'h', k: [[1, { d: 'v', k: [[1, 'p-code'], [1, 'p-result'], [.5, 'p-output']] }], [1.4, { d: 'v', k: [[1.6, 'p-visual'], [1, 'p-steps']] }]] },
  },
});
installErrorHandlers(setStatus);

