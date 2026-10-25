#!/usr/bin/env python3
"""Practice Lab (Python + SQL) - local bridge.

Browsers cannot open TCP connections to PostgreSQL / MySQL, so this tiny server does it
for the page. It listens on 127.0.0.1 only, keeps credentials in memory only, and serves
index.html.

    pip install "psycopg[binary]" pymysql
    python server.py            (then open http://127.0.0.1:8765)
"""
import argparse
import base64
import glob
import hmac
import shutil
import subprocess
import tempfile
import json
import os
import secrets
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from decimal import Decimal
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

try:
    import psycopg
except ImportError:
    psycopg = None
try:
    import pymysql
    from pymysql.constants import CLIENT as MYCLIENT
except ImportError:
    pymysql = None

HERE = Path(__file__).resolve().parent
TOKEN = secrets.token_urlsafe(24)       # embedded in the served page; guards every /api POST
ROW_LIMIT = 500
STATEMENT_TIMEOUT_MS = 15000
IDLE_SECONDS = 30 * 60
VISION_MODEL = 'claude-sonnet-5-5'

SESSIONS = {}
SESSIONS_LOCK = threading.Lock()


class ApiError(Exception):
    def __init__(self, message, **extra):
        super().__init__(message)
        self.extra = extra


class Session:
    def __init__(self, kind, conn, label):
        self.kind, self.conn, self.label = kind, conn, label
        self.lock = threading.Lock()
        self.last = time.time()
        self.notices = []


def _default(o):
    if isinstance(o, (bytes, bytearray, memoryview)):
        return '\\x' + bytes(o).hex()
    if isinstance(o, Decimal):
        return str(o)
    return str(o)


def cell(v):
    if isinstance(v, float) and (v != v or v in (float('inf'), float('-inf'))):
        return str(v)
    if isinstance(v, int) and not isinstance(v, bool) and abs(v) > 2 ** 53:
        return str(v)
    return v


# ---------------------------------------------------------------- connect / schema

def key_of(schema, name):
    return name if schema in (None, '', 'public') else f'{schema}.{name}'


def pg_schema(conn):
    cur = conn.cursor()
    cur.execute("""
        SELECT c.table_schema, c.table_name, c.column_name, c.data_type, c.is_nullable, t.table_type
        FROM information_schema.columns c
        JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        WHERE t.table_type IN ('BASE TABLE', 'VIEW')
          AND c.table_schema NOT IN ('pg_catalog', 'information_schema') AND c.table_schema NOT LIKE 'pg_toast%%'
        ORDER BY c.table_schema, c.table_name, c.ordinal_position""")
    tables, order = {}, []
    for sch, tn, col, typ, nul, tt in cur.fetchall():
        k = key_of(sch, tn)
        if k not in tables:
            tables[k] = {'name': k, 'view': tt == 'VIEW', 'columns': []}
            order.append(k)
        tables[k]['columns'].append({'name': col, 'type': typ, 'nullable': nul == 'YES', 'pk': False})
    cur.execute("""
        SELECT kcu.table_schema, kcu.table_name, kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON kcu.constraint_schema = tc.constraint_schema AND kcu.constraint_name = tc.constraint_name
        WHERE tc.constraint_type = 'PRIMARY KEY'""")
    for sch, tn, col in cur.fetchall():
        t = tables.get(key_of(sch, tn))
        if t:
            for c in t['columns']:
                if c['name'] == col:
                    c['pk'] = True
    cur.execute("""
        SELECT n.nspname, cl.relname, a.attname, fn.nspname, fcl.relname, fa.attname
        FROM pg_constraint co
        JOIN pg_class cl ON cl.oid = co.conrelid
        JOIN pg_namespace n ON n.oid = cl.relnamespace
        JOIN pg_class fcl ON fcl.oid = co.confrelid
        JOIN pg_namespace fn ON fn.oid = fcl.relnamespace
        CROSS JOIN LATERAL unnest(co.conkey, co.confkey) AS k(ck, fk)
        JOIN pg_attribute a ON a.attrelid = co.conrelid AND a.attnum = k.ck
        JOIN pg_attribute fa ON fa.attrelid = co.confrelid AND fa.attnum = k.fk
        WHERE co.contype = 'f' AND n.nspname NOT IN ('pg_catalog', 'information_schema')""")
    fks = [{'from': [key_of(a, b), c], 'to': [key_of(d, e), f]} for a, b, c, d, e, f in cur.fetchall()]
    conn.rollback()
    return {'tables': [tables[k] for k in order], 'fks': fks}


def my_schema(conn):
    cur = conn.cursor()
    cur.execute("""
        SELECT c.table_name, c.column_name, c.column_type, c.is_nullable, c.column_key, t.table_type
        FROM information_schema.columns c
        JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        WHERE c.table_schema = DATABASE() ORDER BY c.table_name, c.ordinal_position""")
    tables, order = {}, []
    for tn, col, typ, nul, ck, tt in cur.fetchall():
        if tn not in tables:
            tables[tn] = {'name': tn, 'view': tt == 'VIEW', 'columns': []}
            order.append(tn)
        tables[tn]['columns'].append({'name': col, 'type': typ, 'nullable': nul == 'YES', 'pk': ck == 'PRI'})
    cur.execute("""
        SELECT table_name, column_name, referenced_table_name, referenced_column_name
        FROM information_schema.key_column_usage
        WHERE table_schema = DATABASE() AND referenced_table_name IS NOT NULL""")
    fks = [{'from': [a, b], 'to': [c, d]} for a, b, c, d in cur.fetchall()]
    conn.rollback()
    return {'tables': [tables[k] for k in order], 'fks': fks}


def api_connect(p):
    kind = p.get('type')
    host = (p.get('host') or 'localhost').strip()
    user = (p.get('user') or '').strip()
    password = p.get('password') or ''
    dbname = (p.get('database') or '').strip()
    ssl = bool(p.get('ssl'))
    if not dbname:
        raise ApiError('Please enter the database name.')
    try:
        if kind == 'postgres':
            if psycopg is None:
                raise ApiError('The PostgreSQL driver is missing. Run:  pip install "psycopg[binary]"')
            port = int(p.get('port') or 5432)
            conn = psycopg.connect(host=host, port=port, user=user, password=password, dbname=dbname,
                                   connect_timeout=8, sslmode='require' if ssl else 'prefer', autocommit=False)
            cur = conn.cursor()
            cur.execute(f'SET statement_timeout = {STATEMENT_TIMEOUT_MS}')
            cur.execute('SELECT version()')
            version = cur.fetchone()[0]
            conn.commit()
            schema = pg_schema(conn)
        elif kind == 'mysql':
            if pymysql is None:
                raise ApiError('The MySQL driver is missing. Run:  pip install pymysql')
            port = int(p.get('port') or 3306)
            kw = {'ssl': {'fake_flag_to_enable_tls': True}, 'ssl_verify_cert': False} if ssl else {}
            conn = pymysql.connect(host=host, port=port, user=user, password=password, database=dbname,
                                   connect_timeout=8, charset='utf8mb4', autocommit=False,
                                   client_flag=MYCLIENT.MULTI_STATEMENTS, **kw)
            cur = conn.cursor()
            cur.execute('SELECT VERSION()')
            version = cur.fetchone()[0]
            schema = my_schema(conn)
        else:
            raise ApiError('Unknown database type.')
    except ApiError:
        raise
    except Exception as e:  # driver errors: bad password, host unreachable, unknown db ...
        raise ApiError(describe_error(e)['message'])
    token = secrets.token_urlsafe(24)
    s = Session(kind, conn, f'{user}@{host}:{port}/{dbname}')
    if kind == 'postgres':
        conn.add_notice_handler(lambda d: s.notices.append(d.message_primary or str(d)))
    with SESSIONS_LOCK:
        SESSIONS[token] = s
    return {'token': token, 'label': s.label, 'server': version, 'schema': schema}


def get_session(p):
    with SESSIONS_LOCK:
        s = SESSIONS.get(p.get('token'))
    if not s:
        raise ApiError('Not connected (the connection may have timed out). Please connect again.', reconnect=True)
    s.last = time.time()
    return s


def api_schema(p):
    s = get_session(p)
    with s.lock:
        return {'schema': pg_schema(s.conn) if s.kind == 'postgres' else my_schema(s.conn)}


def api_disconnect(p):
    with SESSIONS_LOCK:
        s = SESSIONS.pop(p.get('token'), None)
    if s:
        try:
            s.conn.close()
        except Exception:
            pass
    return {}


# ---------------------------------------------------------------- queries

def describe_error(e):
    msg, pos, hint = str(e), None, None
    diag = getattr(e, 'diag', None)
    if diag is not None:
        msg = diag.message_primary or msg
        hint = diag.message_hint
        pos = int(diag.statement_position) if diag.statement_position else None
    elif pymysql is not None and isinstance(e, pymysql.err.MySQLError) and len(e.args) >= 2:
        msg = f'{e.args[1]} (error {e.args[0]})'
    return {'message': msg, 'position': pos, 'hint': hint}


def collect(cur, limit):
    sets = []
    while True:
        if cur.description:
            cols = [d[0] for d in cur.description]
            rows = cur.fetchmany(limit + 1)
            sets.append({'columns': cols, 'rows': [[cell(v) for v in r] for r in rows[:limit]],
                         'truncated': len(rows) > limit})
        else:
            sets.append({'columns': [], 'rows': [], 'rowcount': cur.rowcount})
        if not cur.nextset():
            break
    return sets


def api_query(p):
    s = get_session(p)
    sql = p.get('sql') or ''
    mode = p.get('mode', 'readonly')       # readonly | rollback | commit
    if not sql.strip():
        raise ApiError('Nothing to run.')
    with s.lock:
        conn, t0 = s.conn, time.time()
        s.notices.clear()
        try:
            conn.rollback()
            if s.kind == 'postgres':
                conn.read_only = (mode == 'readonly')
                cur = conn.cursor()
            else:
                cur = conn.cursor()
                cur.execute('SET SESSION TRANSACTION READ ONLY' if mode == 'readonly' else 'SET SESSION TRANSACTION READ WRITE')
                cur.execute(f'SET SESSION max_execution_time = {STATEMENT_TIMEOUT_MS}')
            cur.execute(sql)
            sets = collect(cur, ROW_LIMIT)
            if mode == 'commit':
                conn.commit()
            else:
                conn.rollback()
        except Exception as e:
            try:
                conn.rollback()
            except Exception:
                pass
            return {'ok': False, 'error': describe_error(e)}
        return {'ok': True, 'sets': sets, 'ms': round((time.time() - t0) * 1000, 1),
                'notices': list(s.notices), 'committed': mode == 'commit',
                'rolledBack': mode == 'rollback'}


# ---------------------------------------------------------------- schema image -> DDL

SCHEMA_SPEC = """Reply with ONLY one JSON object, no markdown fences, with these keys:
  "tables": [{"name": str, "columns": [{"name": str, "type": str, "pk": bool, "nullable": bool}]}],
  "fks": [{"from_table": str, "from_column": str, "to_table": str, "to_column": str}],
  "ddl": a string of SQLite-compatible CREATE TABLE statements (PRIMARY KEY and FOREIGN KEY clauses included, parent tables first),
  "sample_data": a string of SQLite-compatible INSERT statements with 6-10 realistic rows per table, consistent with the foreign keys.
"""
VISION_PROMPT = """This image shows a database schema (an ER diagram, a table list or a screenshot of table structures).
Extract it faithfully - do not invent tables or columns that are not visible. If a column type is unreadable, guess a sensible one.
""" + SCHEMA_SPEC
DESCRIBE_PROMPT = """Design a small, sensible relational database (3-6 tables, proper primary and foreign keys) for this request:
{text}
""" + SCHEMA_SPEC


def ask_claude(p, content):
    key = (p.get('key') or '').strip() or os.environ.get('ANTHROPIC_API_KEY', '')
    if not key:
        raise ApiError('Enter an Anthropic API key (or set ANTHROPIC_API_KEY before starting the server).')
    body = {'model': VISION_MODEL, 'max_tokens': 8000, 'messages': [{'role': 'user', 'content': content}]}
    req = urllib.request.Request('https://api.anthropic.com/v1/messages', data=json.dumps(body).encode(),
                                 headers={'x-api-key': key, 'anthropic-version': '2023-06-01',
                                          'content-type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            out = json.load(r)
    except urllib.error.HTTPError as e:
        try:
            msg = json.load(e)['error']['message']
        except Exception:
            msg = f'HTTP {e.code}'
        raise ApiError(f'Anthropic API error: {msg}')
    except Exception as e:
        raise ApiError(f'Could not reach the Anthropic API: {e}')
    return {'text': ''.join(b.get('text', '') for b in out.get('content', []))}


def api_vision(p):
    return ask_claude(p, [{'type': 'image', 'source': {'type': 'base64', 'media_type': p.get('media_type', 'image/png'),
                                                       'data': p['image']}},
                          {'type': 'text', 'text': VISION_PROMPT}])


def api_describe(p):
    text = (p.get('text') or '').strip()[:2000]
    if not text:
        raise ApiError('Describe the tables first.')
    return ask_claude(p, [{'type': 'text', 'text': DESCRIBE_PROMPT.replace('{text}', text)}])


def find_pg_restore():
    env = os.environ.get('PG_RESTORE')
    if env and os.path.exists(env):
        return env
    w = shutil.which('pg_restore')
    if w:
        return w
    pats = [r'C:\Program Files\PostgreSQL\*\bin\pg_restore.exe', r'C:\Program Files (x86)\PostgreSQL\*\bin\pg_restore.exe',
            '/usr/lib/postgresql/*/bin/pg_restore', '/opt/homebrew/opt/postgresql*/bin/pg_restore',
            '/usr/local/opt/postgresql*/bin/pg_restore', '/Applications/Postgres.app/Contents/Versions/*/bin/pg_restore']
    found = sorted(sum((glob.glob(x) for x in pats), []), key=lambda s: [int(n) for n in __import__('re').findall(r'\d+', s)] or [0])
    return found[-1] if found else None


def api_pgrestore(p):
    exe = find_pg_restore()
    if not exe:
        raise ApiError('pg_restore was not found on this computer. Install PostgreSQL (or add its bin folder to PATH), '
                       'or run  pg_restore -f dump.sql --no-owner yourfile  yourself and upload dump.sql.')
    raw = base64.b64decode(p.get('data') or '')
    fd, path = tempfile.mkstemp(suffix='.dump')
    try:
        with os.fdopen(fd, 'wb') as f:
            f.write(raw)
        r = subprocess.run([exe, '-f', '-', '--no-owner', '--no-privileges', path], capture_output=True, timeout=180)
    except subprocess.TimeoutExpired:
        raise ApiError('pg_restore took too long.')
    finally:
        try:
            os.remove(path)
        except OSError:
            pass
    if r.returncode != 0 and not r.stdout:
        raise ApiError('pg_restore could not read this file: ' + r.stderr.decode('utf-8', 'replace')[:300])
    return {'text': r.stdout.decode('utf-8', 'replace')}


ROUTES = {'connect': api_connect, 'query': api_query, 'schema': api_schema,
          'disconnect': api_disconnect, 'vision': api_vision, 'describe': api_describe, 'pgrestore': api_pgrestore}


# ---------------------------------------------------------------- http

class Handler(BaseHTTPRequestHandler):
    server_version = 'SQLLab/1.0'

    def log_message(self, *a):
        pass

    def _host_ok(self):
        return self.headers.get('Host', '').rsplit(':', 1)[0] in ('127.0.0.1', 'localhost')

    def _send(self, code, body, ctype='application/json; charset=utf-8'):
        if not isinstance(body, (bytes, str)):
            body = json.dumps(body, default=_default)
        if isinstance(body, str):
            body = body.encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if not self._host_ok():
            return self._send(403, {'error': 'bad host'})
        path = self.path.split('?')[0]
        pages = {'/': 'index.html', '/index.html': 'index.html', '/python.html': 'python.html', '/sql.html': 'sql.html'}
        if path in pages:
            html = (HERE / pages[path]).read_text(encoding='utf-8').replace('__BRIDGE_TOKEN__', TOKEN)
            return self._send(200, html, 'text/html; charset=utf-8')
        if path == '/favicon.ico':
            return self._send(204, b'', 'image/x-icon')
        if path == '/api/ping':
            return self._send(200, {'postgres': psycopg is not None, 'mysql': pymysql is not None,
                                    'hasKey': bool(os.environ.get('ANTHROPIC_API_KEY'))})
        self._send(404, {'error': 'not found'})

    def do_POST(self):
        if not self._host_ok():
            return self._send(403, {'ok': False, 'error': 'bad host'})
        if not hmac.compare_digest(self.headers.get('X-Bridge-Token', ''), TOKEN):
            return self._send(403, {'ok': False, 'error': 'Bad bridge token - reload the page.'})
        name = self.path.split('?')[0].removeprefix('/api/')
        fn = ROUTES.get(name)
        if not fn:
            return self._send(404, {'ok': False, 'error': 'unknown endpoint'})
        try:
            n = int(self.headers.get('Content-Length', 0))
            if n > 14 * 1024 * 1024:
                raise ApiError('Request too large.')
            payload = json.loads(self.rfile.read(n) or b'{}')
            out = fn(payload)
            if 'ok' not in out:
                out['ok'] = True
            self._send(200, out)
        except ApiError as e:
            self._send(200, {'ok': False, 'error': {'message': str(e)}, **e.extra})
        except Exception as e:
            self._send(200, {'ok': False, 'error': {'message': f'Server error: {e}'}})


def reaper():
    while True:
        time.sleep(60)
        now = time.time()
        with SESSIONS_LOCK:
            dead = [t for t, s in SESSIONS.items() if now - s.last > IDLE_SECONDS]
            sessions = [SESSIONS.pop(t) for t in dead]
        for s in sessions:
            try:
                s.conn.close()
            except Exception:
                pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=8765)
    ap.add_argument('--no-browser', action='store_true')
    a = ap.parse_args()
    threading.Thread(target=reaper, daemon=True).start()
    srv = ThreadingHTTPServer(('127.0.0.1', a.port), Handler)
    url = f'http://127.0.0.1:{a.port}/'
    print(f'Practice Lab (Python + SQL) running at {url}   (Ctrl+C to stop)')
    print('  PostgreSQL driver:', 'ok' if psycopg else 'missing  ->  pip install "psycopg[binary]"')
    print('  MySQL driver     :', 'ok' if pymysql else 'missing  ->  pip install pymysql')
    if not a.no_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print('\nbye')


if __name__ == '__main__':
    main()
