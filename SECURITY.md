# Security

Practice Lab is a set of static web pages plus an **optional** local helper (the "bridge"). This file explains what is
protected, how, and what is deliberately **not** promised. Every statement here is backed by a test in `tests/` unless it is
marked *(by design)* or *(accepted risk)*.

## Reporting a vulnerability

Please use GitHub's **private vulnerability reporting** (Repository → *Security* → *Report a vulnerability*) instead of a
public issue. Include steps to reproduce and the browser / OS.

## What runs where

| Part | Runs where | What it can touch |
|------|-----------|-------------------|
| Python lab | In your browser, inside a Web Worker (Pyodide / WebAssembly) | Nothing on your computer (no file system). *(by design)* Like any script on a web page it can make network requests from inside the worker – so **do not run code from people you do not trust**. |
| SQL lab (sandbox) | Browser, Web Worker (SQLite / WebAssembly) | Only the data you load into it. It never leaves the tab. |
| Flowchart lab | Browser, a small interpreter written in JavaScript for a tiny language | Nothing – the language has no I/O beyond the page. |
| Bridge (`bridge/server.py`) | Your computer, **only if you start it** | The databases you give it credentials for. |

The page never evaluates strings as JavaScript (`eval`, `new Function`) and never loads code from URL parameters, so a shared
link cannot run anything.

## Protections in the web pages

* **Content-Security-Policy** on every page: `default-src 'none'`, scripts and styles only from the site itself, **no inline
  scripts or styles**, `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`; the SQL lab additionally allows
  `https://api.anthropic.com` (optional AI features). Static hosts such as GitHub Pages cannot send headers, so the policy is
  a `<meta>` tag there (which cannot express `frame-ancestors`); pages served by the bridge also get it as a header.
  A page's CSP does **not** govern its Web Workers (their script responses do), which is why the Python worker can load
  Pyodide from jsDelivr – see *Accepted risks*.
* **Output encoding**: everything that comes from your code, SQL, files, databases or the AI is escaped before it reaches the
  DOM (`esc()` in `assets/js/shared.js`); the flowchart is built with DOM calls (`createElementNS`, `textContent`).
  `tests/e2e` feeds `<img onerror=…>` through every lab (as strings, table/column names and values) and asserts that
  nothing executes.
* **Self-hosted** fonts and SQLite (sql.js, license included). **Pyodide** is the one third-party script, loaded from
  jsDelivr at a **pinned version** (`0.26.4`) inside the Python worker.
* **Uploaded files** are parsed locally. Limits: 60 MB per file; **200 MB total unpacked across the whole import** (one shared
  budget for gzip, zip entries and `pg_dump` data); at most 5 000 archive members; zip entries that would be ignored anyway are
  never decompressed; SQLite results are cut at 500 rows while stepping (a query returning millions of rows cannot fill memory).
* **Anthropic API key** (optional AI schema features): typed by you, kept only in the input field of that tab (never in
  storage) and sent to `api.anthropic.com` from your browser. *Exception:* if you started the bridge with
  `ANTHROPIC_API_KEY` set and leave the field empty, the request goes browser → bridge → Anthropic using that key.
* `localStorage` holds only your own code, layout and non-secret hints (host, port, database, user – **never passwords or
  keys**). A real database connection never starts in "Commit" mode, and "Live" (run while typing) is switched off when you connect.

## Protections in the bridge

* Listens on `127.0.0.1` only; never on the network.
* Every request needs a `Host` header for that exact address (defeats DNS-rebinding).
* **The Python lab is isolated from the bridge API.** The API answers only on the `127.0.0.1` origin. When the bridge serves
  the app, the shell loads the Python lab from `http://localhost:PORT` – the same server but a *different origin* – so code you
  run there cannot read the API token (the browser's same-origin policy) and `/api/*` refuses `Host: localhost`.
  (Test: `test_python_lab_cannot_reach_the_bridge_api`.)
* State-changing requests need `Content-Type: application/json`, a same-origin `Origin`, and a random per-run token that only
  the same-origin SQL lab can fetch (`GET /api/session`); no CORS headers are ever sent. Request bodies are always read in
  full, so an unread body can never be interpreted as a second request (request-smuggling test included).
* Only `index.html`, `labs/` and `assets/` are served, after resolving `..`, encoded slashes, backslashes and symlinks;
  dot-files and `.py` files outside `assets/py` are refused (`tests/unit/test_bridge.py`).
* Passwords live in memory only, are dropped after 30 min idle; max 5 connections; request bodies ≤ 14 MB; MySQL read/write
  timeouts and PostgreSQL `statement_timeout`; errors never include stack traces; dead connections are evicted.
* **Read-only mode is a best-effort guard, not a security boundary.** It uses a read-only transaction and refuses `COMMIT`,
  `BEGIN`, `SET TRANSACTION …`, `set_config`, `transaction_read_only` switches, `PREPARE TRANSACTION` and similar (the
  statement splitter understands PostgreSQL `E'…'` / `$$…$$` strings and MySQL backslash escapes and `/*! … */` comments).
  **"Try writes (rolled back)" refuses DDL on MySQL**, because MySQL commits `CREATE/DROP/ALTER/TRUNCATE` immediately.
  A determined user can still look for ways around any such filter: **use a database account that only has `SELECT` rights for
  anything you care about.**
* **"Use SSL" encrypts the connection but does not verify the server's certificate** (`sslmode=require`, no CA check).

## Accepted risks / limits

* *(accepted risk)* Pyodide is fetched from a CDN. Pinning the version and using the CDN's immutable URLs reduces, but does not
  remove, supply-chain risk. Self-host `assets/vendor/pyodide` and change `PYODIDE_VERSION` in `assets/js/python-worker.js`
  if you need that.
* *(by design)* Python code can use the network from inside its worker.
* The SQLite sandbox cannot keep `TEMP` tables or `PRAGMA` settings across statements that change data (sql.js can only
  snapshot by re-opening the connection). A snapshot is skipped while temp objects exist; after a stopped (runaway) query the
  database is restored to the last snapshot.
* Result rows from a live PostgreSQL/MySQL query are buffered by the driver before the 500-row cut; the 15 s timeouts bound this.
* GitHub Pages cannot add HTTP security headers (`X-Frame-Options`, `frame-ancestors`); the app is therefore frameable there.
