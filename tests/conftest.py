"""Shared pytest fixtures: import helpers and a throw-away bridge server."""
import importlib.util
import sys
import threading
from http.server import ThreadingHTTPServer
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope='session')
def lab_runner():
    return load_module('lab_runner', ROOT / 'assets' / 'py' / 'lab_runner.py')


@pytest.fixture(scope='session')
def bridge():
    return load_module('bridge_server', ROOT / 'bridge' / 'server.py')


@pytest.fixture()
def bridge_url(bridge):
    """Run the real bridge handler on a random localhost port."""
    srv = ThreadingHTTPServer(('127.0.0.1', 0), bridge.Handler)
    srv.daemon_threads = True
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    yield srv.server_address[1]
    srv.shutdown()
    srv.server_close()
