// Unit tests for the SQL lab's pure logic: statement splitting, the clause-by-clause explainer and dump clean-up.
import test from 'node:test';
import assert from 'node:assert/strict';
import { maskSQL, splitStatements, analyze } from '../../assets/js/sql-parse.js';
import { cleanStatement, pgCopyToInserts, collectStatements, parseCSV } from '../../assets/js/sql-import.js';

const ctx = () => ({ skipped: 0, notes: new Set(), extra: { fks: [], pks: [] } });

test('maskSQL blanks strings and comments but keeps positions', () => {
  const s = "select 'a;b' -- x;y\n, /* ; */ 1";
  const m = maskSQL(s);
  assert.equal(m.length, s.length); assert.ok(!m.includes(';'));
});

test('splitStatements ignores semicolons inside strings and comments', () => {
  const parts = splitStatements("select ';' ; -- c;\nselect 2;\n/* ; */ select 3");
  assert.equal(parts.length, 3);
});

test('analyze: SELECT clauses are explained in execution order', () => {
  const a = analyze('SELECT c.name, COUNT(*) AS n FROM customers c JOIN orders o ON o.cid = c.id WHERE o.total > 5 GROUP BY c.name HAVING COUNT(*) > 1 ORDER BY n DESC LIMIT 3');
  assert.deepEqual(a.steps.map(s => s.title), ['FROM + JOIN', 'WHERE', 'GROUP BY', 'HAVING', 'SELECT', 'ORDER BY', 'LIMIT / OFFSET']);
  assert.ok(a.steps[0].count && a.steps[1].count, 'row-count queries are prepared');
});

test('analyze: aggregates without GROUP BY, DISTINCT, CTE, UNION', () => {
  assert.ok(analyze('SELECT COUNT(*) FROM t').steps.some(s => s.title === 'AGGREGATE'));
  assert.ok(analyze('SELECT DISTINCT city FROM t').steps.some(s => s.title === 'DISTINCT'));
  assert.ok(analyze('WITH x AS (SELECT 1) SELECT * FROM x').steps.some(s => s.title === 'WITH (CTEs)'));
  assert.ok(analyze('SELECT a FROM t UNION SELECT b FROM u').steps.some(s => s.title.startsWith('UNION')));
});

test('analyze: CTE prefix is kept (with a separator) in the row-count queries', () => {
  const a = analyze('WITH x AS (SELECT 1 a) SELECT * FROM x WHERE a = 1');
  assert.match(a.steps.find(s => s.title === 'WHERE').count, /^WITH x AS \(SELECT 1 a\)\s+SELECT COUNT/);
});

test('analyze: UPDATE / DELETE / INSERT / DDL', () => {
  const u = analyze("UPDATE products SET price = price * 2 WHERE category = 'Books'");
  assert.equal(u.steps[0].title, 'FIND ROWS'); assert.match(u.steps[0].count, /FROM products WHERE category/);
  assert.match(analyze('DELETE FROM t').steps[0].text, /EVERY row/);
  assert.equal(analyze("INSERT INTO t VALUES (1)").steps[0].title, 'INSERT');
  assert.equal(analyze('CREATE TABLE t (a int)').steps[0].title, 'CREATE');
});

test('analyze explains only the last statement and says so', () => {
  assert.match(analyze('SELECT 1; SELECT 2').note, /2 statements/);
  assert.equal(analyze('   '), null);
});

/* ------------------------------------------------------------ dump clean-up */
test('PostgreSQL CREATE TABLE is made SQLite-friendly', () => {
  const sql = cleanStatement("CREATE TABLE public.users (\n id integer NOT NULL,\n name character varying(100) NOT NULL,\n born timestamp without time zone DEFAULT now(),\n country text DEFAULT 'IN'::text,\n n serial\n)", false, ctx());
  assert.ok(!/public\./.test(sql) && !/::/.test(sql) && !/without time zone/i.test(sql) && !/now\(\)/.test(sql) && !/serial/i.test(sql), sql);
  assert.match(sql, /DEFAULT CURRENT_TIMESTAMP/);
});

test('server-only statements are skipped', () => {
  for (const s of ['SET statement_timeout = 0', "SELECT pg_catalog.set_config('search_path', '', false)", 'CREATE EXTENSION plpgsql', 'ALTER TABLE public.t OWNER TO postgres',
    'COMMENT ON TABLE t IS \'x\'', 'GRANT ALL ON t TO u', 'CREATE SEQUENCE s', 'LOCK TABLES t WRITE', 'UNLOCK TABLES', 'CREATE FUNCTION f() RETURNS int AS $$ select 1 $$ LANGUAGE sql'])
    assert.equal(cleanStatement(s, false, ctx()), null, s);
});

test('ALTER TABLE ... PRIMARY KEY / FOREIGN KEY are remembered for the diagram', () => {
  const c = ctx();
  assert.equal(cleanStatement('ALTER TABLE ONLY public.authors ADD CONSTRAINT authors_pkey PRIMARY KEY (id)', false, c), null);
  assert.equal(cleanStatement('ALTER TABLE ONLY public.books ADD CONSTRAINT fk FOREIGN KEY (author_id) REFERENCES public.authors(id)', false, c), null);
  assert.deepEqual(c.extra.pks, [['authors', 'id']]);
  assert.equal(c.extra.fks[0].from[1], 'author_id'); assert.equal(c.extra.fks[0].to[1], 'id');
});

test('MySQL CREATE TABLE loses engine options but keeps columns', () => {
  const sql = cleanStatement("CREATE TABLE `students` (\n  `id` int(11) NOT NULL AUTO_INCREMENT,\n  `name` varchar(50) COLLATE utf8mb4_general_ci NOT NULL COMMENT 'full name',\n  `age` tinyint(3) unsigned DEFAULT NULL,\n  PRIMARY KEY (`id`),\n  KEY `idx_name` (`name`)\n) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4", true, ctx());
  assert.ok(!/ENGINE|AUTO_INCREMENT|COLLATE|COMMENT|unsigned|KEY `idx/i.test(sql), sql);
  assert.match(sql, /`id` INTEGER/); assert.match(sql, /PRIMARY KEY/);
});

test('COPY blocks become INSERT statements (NULL, tabs, quotes)', () => {
  const t = pgCopyToInserts("COPY public.a (id, name, note) FROM stdin;\n1\tO'Henry\t\\N\n2\tx\ty\\tz\n\\.\n");
  assert.match(t, /INSERT INTO public\.a \(id, name, note\) VALUES \('1', 'O''Henry', NULL\);/);
  assert.match(t, /'y\tz'/);
});

test('collectStatements: MySQL escaped quotes and psql meta-commands', async () => {
  const c = ctx();
  const st = await collectStatements("\\restrict abc\nCREATE TABLE t (a text);\nINSERT INTO `t` VALUES ('O\\'Neil');\nINSERT INTO `t` VALUES ('a;b');\n\\unrestrict abc\n", c);
  assert.equal(st.length, 3);
  assert.match(st[1], /'O''Neil'/); assert.match(st[2], /'a;b'/);
});

test('parseCSV handles quotes, commas and newlines inside fields', () => {
  const r = parseCSV('id,city,note\n1,"Pune, MH","line1\nline2"\n2,Chennai,"say ""hi"""\n');
  assert.deepEqual(r[0], ['id', 'city', 'note']);
  assert.equal(r[1][1], 'Pune, MH'); assert.equal(r[1][2], 'line1\nline2'); assert.equal(r[2][2], 'say "hi"');
});
