"""Security-focused tests for the optional local bridge (bridge/server.py)."""
import http.client
import json

import pytest


def request(port, method, path, headers=None, body=None, host=None):
    conn = http.client.HTTPConnection('127.0.0.1', port, timeout=5)
    h = {'Host': host or f'127.0.0.1:{port}'}
    h.update(headers or {})
    conn.request(method, path, body=body, headers=h)
    r = conn.getresponse()
    data = r.read()
    conn.close()
    return r.status, dict(r.getheaders()), data


# ---------------------------------------------------------------- static files
def test_index_and_lab_pages_are_served_with_security_headers(bridge_url):
    for path in ('/', '/index.html', '/labs/python-lab.html', '/labs/sql-lab.html', '/labs/flow-lab.html'):
        status, headers, _ = request(bridge_url, 'GET', path)
        assert status == 200, path
        assert "default-src 'none'" in headers['Content-Security-Policy']
        assert 'frame-ancestors' in headers['Content-Security-Policy']
        assert ("frame-ancestors 'none'" in headers['Content-Security-Policy']) == (path in ('/', '/index.html'))   # only the shell refuses framing
        assert headers['X-Content-Type-Options'] == 'nosniff'
        assert headers['Referrer-Policy'] == 'no-referrer'


def test_assets_have_correct_types(bridge_url):
    assert request(bridge_url, 'GET', '/assets/js/shared.js')[1]['Content-Type'].startswith('text/javascript')
    assert request(bridge_url, 'GET', '/assets/vendor/sqljs/sql-wasm.wasm')[1]['Content-Type'] == 'application/wasm'
    assert request(bridge_url, 'GET', '/assets/fonts/baloo-2.woff2')[1]['Content-Type'] == 'font/woff2'


@pytest.mark.parametrize('path', [
    '/bridge/server.py', '/tests/conftest.py', '/.git/config', '/README.md', '/assets/../bridge/server.py',
    '/assets/%2e%2e/bridge/server.py', '/labs/../bridge/server.py', '/assets/js/', '/assets/js/nonexistent.js', '/..%2fbridge%2fserver.py',
    '/assets/.hidden.css', '//etc/passwd', '/C:/Windows/win.ini',
])
def test_private_or_missing_files_are_not_served(bridge_url, path):
    status, _, data = request(bridge_url, 'GET', path)
    assert status in (404, 403) and b'import ' not in data


# ---------------------------------------------------------------- host / origin / token
def test_wrong_host_header_is_rejected(bridge_url):
    assert request(bridge_url, 'GET', '/', host='evil.example')[0] == 403
    assert request(bridge_url, 'GET', '/api/session', host=f'attacker.test:{bridge_url}')[0] == 403


def test_api_is_unreachable_from_the_localhost_origin(bridge_url):
    """The Python lab is served from http://localhost:PORT; code run there must not be able to use the API."""
    lh = f'localhost:{bridge_url}'
    assert request(bridge_url, 'GET', '/api/session', host=lh)[0] == 403
    assert request(bridge_url, 'POST', '/api/query', {'Content-Type': 'application/json', 'X-Bridge-Token': 'x'}, '{}', host=lh)[0] == 403
    status, headers, _ = request(bridge_url, 'GET', '/labs/python-lab.html', host=lh)
    assert status == 200                                                    # the Python lab itself is served there
    assert request(bridge_url, 'GET', '/assets/js/python-lab.js', host=lh)[0] == 200
    for page in ('/', '/index.html', '/labs/sql-lab.html', '/labs/flow-lab.html'):
        status, headers, _ = request(bridge_url, 'GET', page, host=lh)
        assert status == 302 and headers['Location'] == f'http://127.0.0.1:{bridge_url}{page}'


def test_unread_request_bodies_cannot_smuggle_a_second_request(bridge_url):
    """A refused POST must still consume its body, otherwise the body is parsed as the next request on the connection."""
    import socket
    inner = f'GET /api/session HTTP/1.1\r\nHost: 127.0.0.1:{bridge_url}\r\n\r\n'
    outer = (f'POST /api/query HTTP/1.1\r\nHost: 127.0.0.1:{bridge_url}\r\nOrigin: http://evil.example\r\n'
             f'Content-Type: application/json\r\nContent-Length: {len(inner)}\r\n\r\n{inner}')
    sock = socket.create_connection(('127.0.0.1', bridge_url), timeout=3)
    sock.sendall(outer.encode())
    data = b''
    try:
        while True:
            chunk = sock.recv(65536)
            if not chunk:
                break
            data += chunk
    except socket.timeout:
        pass
    sock.close()
    assert data.count(b'HTTP/1.') == 1 and b'"token"' not in data


def test_session_token_only_for_same_origin(bridge_url):
    status, _, data = request(bridge_url, 'GET', '/api/session')
    assert status == 200 and len(json.loads(data)['token']) > 20
    assert request(bridge_url, 'GET', '/api/session', {'Origin': 'https://evil.example'})[0] == 403
    assert request(bridge_url, 'GET', '/api/session', {'Sec-Fetch-Site': 'cross-site'})[0] == 403
    assert request(bridge_url, 'GET', '/api/session', {'Origin': f'http://127.0.0.1:{bridge_url}'})[0] == 200


def test_post_requires_token_origin_and_json(bridge_url):
    body = json.dumps({'token': 'x', 'sql': 'select 1'})
    ok_headers = {'Content-Type': 'application/json'}
    token = json.loads(request(bridge_url, 'GET', '/api/session')[2])['token']
    assert request(bridge_url, 'POST', '/api/query', ok_headers, body)[0] == 403                                   # no token
    assert request(bridge_url, 'POST', '/api/query', {**ok_headers, 'X-Bridge-Token': 'wrong'}, body)[0] == 403
    assert request(bridge_url, 'POST', '/api/query', {**ok_headers, 'X-Bridge-Token': token, 'Origin': 'https://evil.example'}, body)[0] == 403
    assert request(bridge_url, 'POST', '/api/query', {'Content-Type': 'text/plain', 'X-Bridge-Token': token}, body)[0] == 415
    status, _, data = request(bridge_url, 'POST', '/api/query', {**ok_headers, 'X-Bridge-Token': token}, body)
    assert status == 200 and json.loads(data)['ok'] is False        # token fine, but there is no database session


def test_malformed_requests_do_not_leak_internals(bridge_url):
    token = json.loads(request(bridge_url, 'GET', '/api/session')[2])['token']
    h = {'Content-Type': 'application/json', 'X-Bridge-Token': token}
    status, _, data = request(bridge_url, 'POST', '/api/query', h, '{not json')
    assert status == 400 and b'Traceback' not in data
    status, _, data = request(bridge_url, 'POST', '/api/query', h, '[1,2,3]')
    assert json.loads(data)['ok'] is False
    assert request(bridge_url, 'POST', '/api/nope', h, '{}')[0] == 404


# ---------------------------------------------------------------- read-only guard
@pytest.mark.parametrize('sql', [
    'COMMIT; DELETE FROM t', 'select 1; commit', 'BEGIN READ WRITE; delete from t', 'set transaction read write',
    'SET SESSION CHARACTERISTICS AS TRANSACTION READ WRITE', 'set default_transaction_read_only = off', 'SET transaction_read_only = off',
    'START TRANSACTION; drop table t', 'savepoint a', 'END; delete from t', 'abort', '/* hi */ COMMIT',
])
def test_guard_blocks_transaction_control(bridge, sql):
    with pytest.raises(bridge.ApiError):
        bridge.check_guard(sql, 'readonly')
    with pytest.raises(bridge.ApiError):
        bridge.check_guard(sql, 'rollback')
    bridge.check_guard(sql, 'commit')                     # allowed once the user explicitly chose commit mode


@pytest.mark.parametrize('sql', [
    'SELECT * FROM t', "SELECT 'COMMIT; DELETE' AS x", 'SELECT CASE WHEN a THEN 1 END FROM t', "SELECT 1 -- commit\n", 'SELECT "end" FROM t',
    'UPDATE t SET commit_count = 1', 'SELECT * FROM begin_dates',
])
def test_guard_allows_normal_queries(bridge, sql):
    bridge.check_guard(sql, 'readonly')


@pytest.mark.parametrize('kind, sql', [
    ('postgres', "SELECT E'\\''; COMMIT; DELETE FROM t; SELECT '"),                    # backslash-escaped quote in an E'' string hides nothing now
    ('mysql', "SELECT '\\''; COMMIT; DELETE FROM t; SELECT '"),                        # MySQL backslash escapes
    ('mysql', '/*!50000 COMMIT */'),                                                     # MySQL executable comment
    ('mysql', 'SET @@session.transaction_read_only = 0'), ('mysql', 'SET SESSION tx_read_only = 0'),
    ('postgres', "SELECT set_config('transaction_read_only', 'off', false)"), ('postgres', 'PREPARE TRANSACTION \'x\''),
    ('postgres', 'SET transaction_read_only = off'), ('postgres', 'COMMIT PREPARED \'x\''),
])
def test_guard_bypasses_found_in_review_are_blocked(bridge, kind, sql):
    with pytest.raises(bridge.ApiError):
        bridge.check_guard(sql, 'readonly', kind)


def test_guard_rollback_mode_refuses_mysql_ddl_but_not_postgres(bridge):
    for sql in ('CREATE TABLE t (a int)', 'DROP TABLE t', 'ALTER TABLE t ADD b int', 'TRUNCATE t'):
        with pytest.raises(bridge.ApiError):
            bridge.check_guard(sql, 'rollback', 'mysql')
        bridge.check_guard(sql, 'rollback', 'postgres')           # PostgreSQL DDL is transactional
        bridge.check_guard(sql, 'commit', 'mysql')
    bridge.check_guard("SELECT 'it''s fine; COMMIT'", 'readonly', 'postgres')
    bridge.check_guard("SELECT $$ ; COMMIT ; $$", 'readonly', 'postgres')


def test_mask_sql_hides_strings_and_comments(bridge):
    assert ';' not in bridge._mask_sql("select ';' /* ; */ -- ;\n, $$ ; $$")
