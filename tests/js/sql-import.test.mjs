// Regression tests for data-integrity problems found in review of the SQL import code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { splitStatements } from '../../assets/js/sql-parse.js';
import { pgCopyToInserts, convertMysqlEscapes, stripPublic, cleanStatement, collectStatements, csvTable, parseCSV } from '../../assets/js/sql-import.js';

const ctx = () => ({ skipped: 0, notes: new Set(), extra: { fks: [], pks: [] } });

test('the word "public" inside text is left alone; schema prefixes are removed', () => {
  assert.equal(stripPublic("INSERT INTO public.t VALUES (1, 'Open to the public. Come in')"), "INSERT INTO t VALUES (1, 'Open to the public. Come in')");
  assert.equal(stripPublic('CREATE TABLE "public"."Users" (a int)'), 'CREATE TABLE "Users" (a int)');
  assert.equal(stripPublic('SELECT republic.x, public_x.y FROM public.a -- public.b'), 'SELECT republic.x, public_x.y FROM a -- public.b');
});

test('COPY text escapes are decoded in one pass (a literal backslash stays a backslash)', () => {
  const t = pgCopyToInserts('COPY a (id, p) FROM stdin;\n1\tC:\\\\temp\\\\new\n2\ttab\\there\\nnewline\n\\.\n');
  assert.ok(t.includes("'C:\\temp\\new'"), t);
  assert.ok(t.includes("'tab\there\nnewline'"), t);
});

test('COPY keeps empty rows of one-column tables', () => {
  const t = pgCopyToInserts('COPY a (s) FROM stdin;\n\nx\n\n\\.\n');
  assert.equal(t.split('\n').length, 3);
});

test('MySQL string escapes are converted for SQLite in one pass', () => {
  assert.equal(convertMysqlEscapes("INSERT INTO t VALUES ('O\\'Neil', 'a\\\\nb', 'x\\ny', \"d\")"), "INSERT INTO t VALUES ('O''Neil', 'a\\nb', 'x\ny', \"d\")");
  assert.equal(convertMysqlEscapes("-- it's a comment\nSELECT 'ok'"), "-- it's a comment\nSELECT 'ok'");
});

test('dollar-quoted PostgreSQL function bodies are not split into statements', () => {
  const sql = "CREATE FUNCTION f() RETURNS trigger AS $$ BEGIN DELETE FROM audit; RETURN NEW; END $$ LANGUAGE plpgsql;\nINSERT INTO t VALUES (1);\nCREATE FUNCTION g() RETURNS int AS $body$ select 'it''s; fine' $body$ LANGUAGE sql;";
  const parts = splitStatements(sql);
  assert.equal(parts.length, 3);
  assert.ok(parts[0].includes('DELETE FROM audit') && parts[0].includes('LANGUAGE plpgsql'));
});

test('skipped statements are listed by kind, not just counted', async () => {
  const c = ctx();
  const out = await collectStatements("SET a = 1;\nSET b = 2;\nGRANT ALL ON t TO u;\nCREATE TABLE t (x int);\nCREATE EXTENSION plpgsql;", c);
  assert.equal(out.length, 1); assert.equal(c.skipped, 4);
  const note = [...c.notes].join(' ');
  assert.match(note, /SET ×2/); assert.match(note, /GRANT ×1/); assert.match(note, /CREATE ×1/);
});

test('CSV: leading zeros, hex and exponents stay text; other delimiters and duplicate headers work', () => {
  const t = csvTable('zip.csv', 'zip;phone;n;n\n01234;007;12;1e3\n98765;0x10;3.5;2\n');
  assert.deepEqual(t.cols, ['zip', 'phone', 'n', 'n_2']);
  assert.deepEqual(t.num, [false, false, true, false]);
  assert.equal(t.rows[0][0], '01234'); assert.equal(t.rows[1][1], '0x10'); assert.equal(t.rows[1][2], 3.5);
  const u = csvTable('a.csv', 'id\tname\n1\tAsha\n');
  assert.deepEqual(u.cols, ['id', 'name']);
  const taken = new Set(); assert.equal(csvTable('x.csv', 'a\n1', taken).name, 'x'); assert.equal(csvTable('x.csv', 'a\n1', taken).name, 'x_2');
});

test('parseCSV supports a custom delimiter', () => {
  assert.deepEqual(parseCSV('a;b\n"1;2";3', ';'), [['a', 'b'], ['1;2', '3']]);
});

test('PostgreSQL CREATE TABLE with a column default of now() works end-to-end through cleanStatement', () => {
  const s = cleanStatement('CREATE TABLE public.e (id serial PRIMARY KEY, at timestamp DEFAULT now(), note text DEFAULT \'x\'::text)', false, ctx());
  assert.ok(!/serial|now\(\)|::|public\./i.test(s), s);
});
