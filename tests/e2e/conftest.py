"""End-to-end fixtures: serve the site two ways (plain static = GitHub Pages, and through the bridge) and drive it with Playwright.

Needs:  pip install pytest playwright && playwright install chromium     (Pyodide is downloaded from jsDelivr, so internet is required)
"""
import functools
import http.server
import shutil
import socketserver
import threading
from http.server import ThreadingHTTPServer
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
DATA = Path(__file__).resolve().parent / 'data'

pytest.importorskip('playwright')
from playwright.sync_api import sync_playwright  # noqa: E402


class _Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def end_headers(self):                      # same as a typical static host: no special headers
        super().end_headers()


@pytest.fixture(scope='session')
def static_url():
    """Plain static hosting of the repository root (what GitHub Pages does)."""
    socketserver.TCPServer.allow_reuse_address = True
    srv = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(_Quiet, directory=str(ROOT)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f'http://127.0.0.1:{srv.server_address[1]}'
    srv.shutdown()


@pytest.fixture(scope='session')
def bridge_site(request):
    import importlib.util
    spec = importlib.util.spec_from_file_location('bridge_server_e2e', ROOT / 'bridge' / 'server.py')
    bridge = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(bridge)
    srv = ThreadingHTTPServer(('127.0.0.1', 0), bridge.Handler)
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f'http://127.0.0.1:{srv.server_address[1]}'
    srv.shutdown()


@pytest.fixture(scope='session')
def context():
    with sync_playwright() as p:
        try:
            browser = p.chromium.launch()
        except Exception:                                              # Windows machines without the bundled Chromium
            browser = p.chromium.launch(channel='msedge')
        ctx = browser.new_context(viewport={'width': 1440, 'height': 900})
        yield ctx
        browser.close()


@pytest.fixture()
def page(context):
    pg = context.new_page()
    pg.errors = []
    pg.on('pageerror', lambda e: pg.errors.append(str(e)))
    pg.console = []
    pg.on('console', lambda m: pg.console.append(f'{m.type}: {m.text}'[:300]))
    pg.add_init_script("window.__csp=[];document.addEventListener('securitypolicyviolation',e=>window.__csp.push([e.violatedDirective,e.sourceFile,e.lineNumber]));")
    yield pg
    pg.close()


@pytest.fixture(scope='session')
def data_dir():
    return DATA
