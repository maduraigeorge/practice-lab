#!/usr/bin/env python3
"""Practice Lab - local bridge (optional).

The labs are static web pages and work on their own (GitHub Pages). A browser cannot open TCP connections to
PostgreSQL / MySQL, so this small server does that for the SQL lab. It also serves the site itself.

Security model
  * listens on 127.0.0.1 only (never on the network);
  * every request must carry a Host header for this exact address (blocks DNS-rebinding);
  * state-changing requests need JSON, a same-origin Origin header and a per-run secret token that only same-origin
    pages can read (blocks cross-site requests);
  * credentials live in memory only and are dropped after 30 minutes of inactivity;
  * only whitelisted static files are served (never this folder, tests or dotfiles).

Usage:  pip install -r requirements.txt   then   python server.py   ->  http://127.0.0.1:8765
"""
import argparse
import hmac
import json
import mimetypes
import os
import re
import secrets
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from decimal import Decimal
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote

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
ROOT = HERE.parent                      # the static site (index.html, labs/, assets/)
TOKEN = secrets.token_urlsafe(24)       # per-run secret; only same-origin pages can read it via /api/session
MAX_SESSIONS = 5
MAX_BODY = 14 * 1024 * 1024
STATIC_DIRS = ('labs', 'assets')
STATIC_EXT = {'.html', '.css', '.js', '.py', '.svg', '.woff2', '.wasm', '.json', '.txt', '.png', '.ico', '.md'}
mimetypes.add_type('text/javascript', '.js')
mimetypes.add_type('application/wasm', '.wasm')
mimetypes.add_type('font/woff2', '.woff2')
mimetypes.add_type('text/x-python', '.py')
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
    with SESSIONS_LOCK:
        if len(SESSIONS) >= MAX_SESSIONS:
            try:
                conn.close()
            except Exception:
                pass
            raise ApiError('Too many open connections - disconnect one first.')
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


_TX_CONTROL = re.compile(
    r'^\s*(commit|end|abort|begin|start\s+transaction|set\s+(session|local)?\s*(characteristics|transaction|default_transaction_\w+|transaction_read_only)'
    r'|set\s+transaction_read_only|reset\s+(all|transaction_read_only|default_transaction_read_only)|savepoint|release|rollback\s+to)\b', re.I)


def _mask_sql(sql):
    """Blank out comments and quoted text so statements can be split on ';' safely."""
    out, i, n = [], 0, len(sql)
    while i < n:
        c = sql[i]
        if sql.startswith('--', i):
            j = sql.find('\n', i); j = n if j < 0 else j
            out.append(' ' * (j - i)); i = j
        elif sql.startswith('/*', i):
            j = sql.find('*/', i + 2); j = n if j < 0 else j + 2
            out.append(' ' * (j - i)); i = j
        elif c in ("'", '"', '`') or (c == '$' and re.match(r'\$\w*\$', sql[i:])):
            if c == '$':
                tag = re.match(r'\$\w*\$', sql[i:]).group(0)
                j = sql.find(tag, i + len(tag)); j = n if j < 0 else j + len(tag)
            else:
                j = i + 1
                while j < n:
                    if sql[j] == c:
                        if j + 1 < n and sql[j + 1] == c:
                            j += 2; continue
                        break
                    j += 1
                j = min(j + 1, n)
            out.append(' ' * (j - i)); i = j
        else:
            out.append(c); i += 1
    return ''.join(out)


def check_guard(sql, mode):
    """Read-only / try-it modes must not be able to leave their transaction. This is a convenience guard, NOT a
    security boundary - for real data connect with a database user that only has SELECT rights."""
    if mode == 'commit':
        return
    for st in _mask_sql(sql).split(';'):
        if _TX_CONTROL.match(st):
            raise ApiError('Transaction-control statements (COMMIT, BEGIN, SET TRANSACTION ...) are not allowed in this mode. '
                           'Switch to "Commit changes" if you really need them.')


def api_query(p):
    s = get_session(p)
    sql = p.get('sql') or ''
    mode = p.get('mode', 'readonly')       # readonly | rollback | commit
    if mode not in ('readonly', 'rollback', 'commit'):
        raise ApiError('Unknown mode.')
    if not sql.strip():
        raise ApiError('Nothing to run.')
    if len(sql) > 200000:
        raise ApiError('That query is too long.')
    check_guard(sql, mode)
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


ROUTES = {'connect': api_connect, 'query': api_query, 'schema': api_schema,
          'disconnect': api_disconnect, 'vision': api_vision, 'describe': api_describe}


# ---------------------------------------------------------------- http

CSP = ("default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data: blob:; "
       "connect-src 'self' https://api.anthropic.com; worker-src 'self'; frame-src 'self'; frame-ancestors 'self'; "
       "base-uri 'none'; form-action 'none'; object-src 'none'")
HTML_HEADERS = {'Content-Security-Policy': CSP, 'X-Frame-Options': 'SAMEORIGIN', 'Cross-Origin-Opener-Policy': 'same-origin'}


class Handler(BaseHTTPRequestHandler):
    server_version = 'PracticeLab'
    sys_version = ''
    protocol_version = 'HTTP/1.1'

    def log_message(self, *a):
        pass                                    # never log request lines (they could contain secrets)

    # -- guards ---------------------------------------------------------------------------------
    def _allowed_hosts(self):
        port = self.server.server_address[1]
        return {f'127.0.0.1:{port}', f'localhost:{port}', f'[::1]:{port}'}

    def _host_ok(self):
        return self.headers.get('Host', '').lower() in self._allowed_hosts()

    def _origin_ok(self):
        origin = self.headers.get('Origin')
        if origin is None:
            return self.headers.get('Sec-Fetch-Site', 'same-origin') in ('same-origin', 'none')
        return origin.lower() in {f'http://{h}' for h in self._allowed_hosts()}

    # -- responses ------------------------------------------------------------------------------
    def _send(self, code, body, ctype='application/json; charset=utf-8', extra=None):
        if not isinstance(body, (bytes, str)):
            body = json.dumps(body, default=_default)
        if isinstance(body, str):
            body = body.encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()')
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def _static(self, rel):
        rel = unquote(rel).lstrip('/') or 'index.html'
        if '\x00' in rel or '\\' in rel or ':' in rel:
            return self._send(404, {'error': 'not found'})
        try:
            target = (ROOT / rel).resolve()
        except (OSError, ValueError):
            return self._send(404, {'error': 'not found'})
        # Allowed: the root index.html, or a file that really lives inside labs/ or assets/ after resolving "..", links etc.
        inside = any((ROOT / d).resolve() in target.parents for d in STATIC_DIRS)
        allowed = (target == ROOT / 'index.html') or inside
        parts = target.relative_to(ROOT).parts if ROOT in target.parents else ()
        if (not allowed or not target.is_file() or target.suffix.lower() not in STATIC_EXT
                or any(p.startswith('.') for p in parts)
                or (target.suffix.lower() == '.py' and parts[:2] != ('assets', 'py'))):
            return self._send(404, {'error': 'not found'})
        try:
            data = target.read_bytes()
        except OSError:
            return self._send(404, {'error': 'not found'})
        ctype = mimetypes.guess_type(target.name)[0] or 'application/octet-stream'
        if ctype.startswith('text/') or ctype in ('application/json',):
            ctype += '; charset=utf-8'
        self._send(200, data, ctype, HTML_HEADERS if target.suffix.lower() == '.html' else None)

    # -- verbs ----------------------------------------------------------------------------------
    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        if not self._host_ok():
            return self._send(403, {'error': 'bad host'})
        path = self.path.split('?')[0].split('#')[0]
        if path == '/api/session':
            if not self._origin_ok():
                return self._send(403, {'error': 'cross-site request refused'})
            return self._send(200, {'token': TOKEN, 'postgres': psycopg is not None, 'mysql': pymysql is not None,
                                    'hasKey': bool(os.environ.get('ANTHROPIC_API_KEY'))})
        if path.startswith('/api/'):
            return self._send(404, {'error': 'not found'})
        if path == '/favicon.ico':
            return self._send(204, b'', 'image/x-icon')
        self._static(path)

    def do_POST(self):
        if not self._host_ok() or not self._origin_ok():
            return self._send(403, {'ok': False, 'error': {'message': 'Request refused.'}})
        if not hmac.compare_digest(self.headers.get('X-Bridge-Token', ''), TOKEN):
            return self._send(403, {'ok': False, 'error': {'message': 'Bad bridge token - reload the page.'}})
        if not self.headers.get('Content-Type', '').lower().startswith('application/json'):
            return self._send(415, {'ok': False, 'error': {'message': 'JSON required.'}})
        name = self.path.split('?')[0].removeprefix('/api/')
        fn = ROUTES.get(name)
        if not fn:
            return self._send(404, {'ok': False, 'error': {'message': 'unknown endpoint'}})
        try:
            n = int(self.headers.get('Content-Length', '0'))
            if n < 0 or n > MAX_BODY:
                raise ApiError('Request too large.')
            payload = json.loads(self.rfile.read(n) or b'{}')
            if not isinstance(payload, dict):
                raise ApiError('Bad request.')
            out = fn(payload)
            if 'ok' not in out:
                out['ok'] = True
            self._send(200, out)
        except ApiError as e:
            self._send(200, {'ok': False, 'error': {'message': str(e)}, **e.extra})
        except (ValueError, KeyError, TypeError):
            self._send(400, {'ok': False, 'error': {'message': 'Bad request.'}})
        except Exception:                                    # never leak internals
            self._send(500, {'ok': False, 'error': {'message': 'Internal error in the bridge.'}})


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
    srv.daemon_threads = True
    url = f'http://127.0.0.1:{a.port}/'
    print(f'Practice Lab running at {url}   (Ctrl+C to stop)')
    print('  Only reachable from this computer. Passwords stay in memory and are never written to disk.')
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
