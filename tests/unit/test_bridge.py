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
        assert headers['X-Frame-Options'] == 'SAMEORIGIN'
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


def test_mask_sql_hides_strings_and_comments(bridge):
    assert ';' not in bridge._mask_sql("select ';' /* ; */ -- ;\n, $$ ; $$")
