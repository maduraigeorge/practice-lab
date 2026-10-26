# Security

Practice Lab is a set of static web pages plus an **optional** local helper (the "bridge"). This file explains what is
protected, how, and what is deliberately *not* promised.

## Reporting a vulnerability

Please use GitHub's **private vulnerability reporting** (Repository → *Security* → *Report a vulnerability*) instead of a
public issue. Include steps to reproduce and the browser / OS. You will get an answer as soon as possible.

## Threat model

| Part | Runs where | What it can touch |
|------|-----------|-------------------|
| Python lab | In your browser, inside a Web Worker (Pyodide / WebAssembly) | Only that tab. No file system, no server. |
| SQL lab (sandbox) | In your browser, inside a Web Worker (SQLite / WebAssembly) | Only data you load into it. Never leaves the tab. |
| Flowchart lab | In your browser, plain JavaScript interpreter for a tiny language | Nothing – the interpreter has no I/O besides the page. |
| Bridge (`bridge/server.py`) | Your computer, **only if you start it** | The databases you give it credentials for. |

Code you type is executed **only inside the lab's own worker/interpreter**. The page never evaluates strings as
JavaScript (`eval`, `new Function`) and never loads code from URL parameters, so a shared link cannot run anything.

## Protections in the web pages

* **Content-Security-Policy** on every page: `default-src 'none'`, scripts and styles only from the site itself, no inline
  scripts or styles, `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`. The SQL lab additionally allows
  `https://api.anthropic.com` (optional AI features). Pages served by the bridge also get the header version with
  `frame-ancestors 'self'`.
* **Output encoding**: everything that comes from your code, SQL, files or the AI is escaped before it reaches the DOM
  (`esc()` in `assets/js/shared.js`); the flowchart is built with DOM calls (`createElementNS`, `textContent`).
* **Self-hosted** fonts and SQLite (sql.js, license included). **Pyodide** is the one third-party script, loaded from
  jsDelivr at a **pinned version** (`0.26.4`) inside the worker.
* **Uploaded files** are parsed locally; decompression is capped (200 MB), archives limited to 5 000 entries, files to 60 MB.
* **Anthropic API key** (optional AI schema features): typed by you, kept only in the input field of that tab, sent only to
  `api.anthropic.com` from your browser. It is never written to storage.
* `localStorage` holds only your own code, layout and non-secret connection hints (host, port, database, user – **never
  passwords**).

## Protections in the bridge

* Listens on `127.0.0.1` only; never on the network.
* Every request needs a `Host` header for that exact address (defeats DNS-rebinding).
* State-changing requests need `Content-Type: application/json`, a same-origin `Origin`, and a random per-run token that
  only same-origin pages can fetch (`GET /api/session`) – cross-site pages cannot read it (no CORS headers are sent).
* Only `index.html`, `labs/` and `assets/` are served, after resolving `..`, symlinks and encoded slashes; dot-files and
  `.py` files outside `assets/py` are refused. Covered by tests (`tests/unit/test_bridge.py`).
* Passwords live in memory only, are dropped after 30 min idle, max 5 connections, request bodies ≤ 14 MB, errors never
  include stack traces.
* **Read-only mode is a convenience guard, not a security boundary.** It uses a read-only transaction and refuses
  `COMMIT`, `BEGIN`, `SET TRANSACTION …`, `SAVEPOINT` and similar. A determined user can still find ways around it. **Use a
  database account that only has `SELECT` rights for anything you care about.**
* Live connections never auto-run queries: the "Live" (run while typing) switch is turned off when you connect.

## Known limits / accepted risks

* Pyodide is fetched from a CDN. Pinning the version and the CDN's immutable URLs reduce, but do not remove, supply-chain
  risk. Self-host `assets/vendor/pyodide` and edit `PYODIDE_VERSION` in `assets/js/python-worker.js` if you need that.
* Python code you run can use the browser's network APIs from inside the worker (as any code you paste into a console can).
  Do not run code from people you do not trust.
* The static pages cannot set HTTP headers on GitHub Pages, so CSP is delivered with a `<meta>` tag (no
  `frame-ancestors`).
