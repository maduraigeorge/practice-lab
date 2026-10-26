# 🧪 Practice Lab

**Learn Python, SQL and flowcharts / pseudocode by *watching* your code run – one step at a time.**
Everything runs in your browser. No sign-up, no install, nothing is uploaded anywhere.

By **[@maduraigeorge](https://github.com/maduraigeorge)** · MIT licensed · [Changelog](CHANGELOG.md) · [Security](SECURITY.md)

| Python lab | SQL lab | Flowchart lab |
|---|---|---|
| [![Python lab](docs/images/python-lab.png)](docs/images/python-lab.png) | [![SQL lab](docs/images/sql-lab.png)](docs/images/sql-lab.png) | [![Flowchart lab](docs/images/flow-lab.png)](docs/images/flow-lab.png) |

<sub>Light and dark themes follow your system setting. On a phone the boxes become tabs.</sub>

---

## Contents

1. [What you get](#what-you-get)
2. [Quick start](#quick-start)
3. [The Python lab](#the-python-lab)
4. [The SQL lab](#the-sql-lab)
5. [The Flowchart & Pseudocode lab](#the-flowchart--pseudocode-lab)
6. [The workspace: docking, layouts, phones](#the-workspace-docking-layouts-phones)
7. [Host it on GitHub Pages](#host-it-on-github-pages)
8. [Optional: connect a real database (the local bridge)](#optional-connect-a-real-database-the-local-bridge)
9. [How it works](#how-it-works)
10. [Privacy & security](#privacy--security)
11. [Project layout](#project-layout)
12. [Testing & CI](#testing--ci)
13. [Troubleshooting & FAQ](#troubleshooting--faq)
14. [Known limits](#known-limits)
15. [Contributing, credits, license](#contributing-credits-license)

---

## What you get

| | Python lab | SQL lab | Flowchart & pseudocode lab |
|---|---|---|---|
| **Write** | Python 3 (real CPython via WebAssembly) | SQL (SQLite in the browser) | Simple pseudocode |
| **Live result** | final values, last expression | result grid, CSV download | – |
| **Step-by-step** | every line, with plain-English notes for each expression (`s[::-1]`, `//`, `.split()`, f-strings, comprehensions …) | every clause *in the order the database runs it*, with row counts after each step | every flowchart box, with the real values substituted in (`x + 1 → 4 + 1 = 5`) |
| **Visual** | variable cards, lists as indexed cells, aliasing (`b = a`), call stack | schema diagram – drag tables, foreign keys, highlights what your query uses | flowchart with the running box lit up and the path walked + trace table |
| **Output** | `print()` output and friendly errors | messages, timings, errors with hints | output, errors, and practice-test results |
| **Practice** | examples | sample shop database, upload your own | 8 examples + 9 auto-checked exercises |

Common to all three: live as you type · autocomplete · syntax colours · line numbers · beginner-friendly error messages ·
dockable layout · light/dark · phone layout · keyboard shortcuts · works offline after the first load (except Pyodide's first download).

---

## Quick start

**Use it online** – open the GitHub Pages site (see [Host it on GitHub Pages](#host-it-on-github-pages)). That is all.

**Use it locally** – the pages are plain static files, but browsers refuse web workers on `file://`, so serve the folder:

```bash
python -m http.server 8000        # from the repository root
# then open http://localhost:8000
```

or run the optional bridge, which also serves the site *and* adds live PostgreSQL / MySQL connections:

```bash
cd bridge
python -m pip install -r requirements.txt      # only needed for live databases
python server.py                               # → http://127.0.0.1:8765   (Windows: double-click bridge\start.bat)
```

Keyboard: **Alt+1 / Alt+2 / Alt+3** switch labs · **Ctrl+Enter** run (SQL) · **Tab** accept an autocomplete suggestion ·
**← / →** step through a run · **Esc** closes popups · double-click a box title to maximise it.

---

## The Python lab

* Type Python; it runs a moment after you stop typing (in a Web Worker, so the page never freezes).
* **Step-by-step** explains each executed line and *what its expressions mean*, using the real values:

  ```text
  print(s[::-1])
  • s[::-1] is a slice [start:stop:step]. Start and stop are empty (= the whole text) and the step is -1,
    so it walks backwards: the text is REVERSED → 'raeb eht dna ashaM'
  ```

  Covered: slices, indexes, dictionary lookups, string/list/dict/set methods, built-ins (`len`, `range`, `sorted` …),
  `// % **`, comparisons, `and/or/not`, `in`, f-strings, comprehensions, lambdas, `x += 1`, tuple unpacking and swaps.
  The explainer evaluates sub-expressions with a **whitelisted evaluator that only touches built-in types** – it can never
  run your code a second time or change anything.
* **Visual** shows the variables after the selected step – lists as indexed cells, dictionaries as tables, names that
  point to the *same* object (🔗), and the call stack for recursion. Changed variables glow.
* **Endless loops** (`while True: pass`, or a loop whose variables never change) are detected within a fraction of a second
  and stopped with a clear alert. **Big calculations are allowed**: after 4 s a *Stop* button appears; after 2 min the run is
  stopped. Steps are recorded for the first 600 lines executed; the program still runs to the end.
* **Input**: the **⌨ Input** button in the header holds the lines that `input()` will read.
* Standard library only (no NumPy/pandas).

## The SQL lab

* Starts with a built-in **sample shop database** (customers, products, orders, order_items). Try *Sample queries…*.
* **Step-by-step**: `FROM → JOIN → WHERE → GROUP BY → HAVING → SELECT → ORDER BY → LIMIT`, each with the number of rows left
  (*57 rows → 44 after WHERE*). Click a step to peek at its first rows. `UPDATE` / `DELETE` show which rows they will touch.
* **Visual**: the schema as a diagram; tables and columns your query uses are highlighted. Double-click a table to query it.
* The database engine runs in a worker with a **15 s watchdog**: a runaway query (say, an endless recursive CTE) is stopped and
  your database is restored – the page never hangs.
* **Explain** shows SQLite's own execution plan. **Tidy** formats your query. **Download CSV** exports a result.

### Getting data in – click the database badge in the header

| Tab | What it does |
|---|---|
| **📁 Upload file** | `.sql` dumps (**PostgreSQL** `pg_dump` and **MySQL / phpMyAdmin** exports are cleaned up automatically), **PostgreSQL backups** in custom (`-Fc`) and tar (`-Ft`) format, `.zip` / `.tar` / `.tar.gz` archives with several files, `.csv` (one table per file), `.sqlite` / `.db`. Server-only statements are skipped and listed, never silently dropped. |
| **✏️ Create schema** | Type `CREATE TABLE …` yourself, load a template or the sample, or ✨ **generate with AI** from a written description or a **picture** of an ER diagram (needs your own Anthropic API key – it is only sent from your browser to Anthropic and never stored). |
| **🔌 Connect** | Only appears when the [local bridge](#optional-connect-a-real-database-the-local-bridge) is running: connect to a live PostgreSQL / MySQL / MariaDB (phpMyAdmin) server. |

**Your data from a server without connecting** – this is the recommended way on the hosted site:

* *phpMyAdmin*: select the database → **Export** → format **SQL** → Go → upload the file.
* *pgAdmin*: right-click the database → **Backup…** (any format) – or `pg_dump --no-owner mydb > dump.sql`.

> Why no direct connection on the hosted site? A web page cannot open a TCP connection to PostgreSQL/MySQL. That is a browser
> rule, not a limitation of this project. The local bridge exists only to work around it.

## The Flowchart & Pseudocode lab

Write pseudocode on the left; a flowchart appears and updates as you type. Step through it and the running box lights up,
the path walked turns blue, and the explanation shows the real values. The **Trace table** (Visual box) is the classic
exam-style table: one row per step, one column per variable.

### The pseudocode language

Case-insensitive. Indent however you like. `//` or `#` start a comment. Lists are **0-indexed**.

| You want to… | Write |
|---|---|
| start / finish (optional) | `BEGIN` … `END` |
| read values | `INPUT n`   `INPUT a, b`   `INPUT "Your age", age` |
| show values | `OUTPUT "Total:", total`   (also `PRINT`, `DISPLAY`) |
| store a value | `x = 5`   `x <- 5`   `x ← 5`   `x := 5`   `SET x = 5`   `a[2] = 9` |
| decide | `IF cond THEN … ELSE IF cond THEN … ELSE … ENDIF` |
| repeat while true | `WHILE cond DO … ENDWHILE` |
| count | `FOR i = 1 TO 10 [STEP 2] … ENDFOR`  (negative steps count down) |
| go through a list | `FOR EACH item IN list DO … ENDFOR` |
| repeat until | `REPEAT … UNTIL cond` |
| grow a list | `APPEND(list, value)` |

**Expressions** – numbers, `"text"`, `TRUE` / `FALSE`, lists `[1, 2, 3]`, `a[i]`; `+ - * /` (decimal division),
`DIV` (whole-number division), `MOD` (remainder), `^` (power), `+` also joins text; comparisons `= != <> < > <= >=`
(inside a condition `=` *compares*); `AND OR NOT`.
**Functions** – `LEN ABS SQRT FLOOR CEIL ROUND MIN MAX SUM UPPER LOWER STR INT FLOAT SUBSTR`.

```text
INPUT n
total = 0
FOR i = 1 TO n
  total = total + i
ENDFOR
OUTPUT "Sum is", total
```

Words like `start`, `end`, `next`, `show`, `stop` are fine as variable names (`next = a + b`).

### Reading the chart

| Shape | Meaning |
|---|---|
| green pill | Start |
| red pill | End |
| pink parallelogram | Input / Output |
| blue rectangle | Assignment (process) |
| orange diamond | Decision / loop check – leaves with **Yes** and **No** arrows |
| small dot | Where branches meet again |

Click any box to jump to the first step where it runs. **− + Fit** zoom the chart.

### Practice mode

Pick **🎯** items in the examples menu. The Output box shows the task; your program is run against several hidden-input
tests and each result is listed (*expected "odd", got "even"*). **Hint** and **Show solution** are there when you need them.
The practice tests use their own inputs – the Input box is ignored while you practise.

### Messages you will see

Syntax problems are caught with the line number and a plain explanation (*"This IF has no ENDIF."*). Runtime problems too
(*"The variable "y" has no value yet…"*, *"Position 5 is outside a – valid positions are 0 to 1"*, *"Division by zero"*).
A loop that repeats forever is detected and stopped.

---

## The workspace: docking, layouts, phones

* **One bar** at the top holds everything that is a setting: lab switcher, database, examples, input, run options and the
  **▦ Layout** menu. The rest of the screen is yours.
* **Drag a box's title bar** onto another box: drop near an *edge* to dock beside it, in the *middle* to swap places.
* **Drag the thin bars between boxes** to resize (double-click to reset). **▁** minimises a box to the tray below the
  workspace, **⛶** maximises it (double-clicking the title does too).
* **Layout menu**: several presets per lab, *Restore all boxes*, *Reset layout*. Your layout is remembered per lab.
* **Phones / narrow windows** (≤ 900 px): one box at a time with a bottom tab bar; the header becomes a compact scrolling row.

---

## Host it on GitHub Pages

The site is static – any static host works. For GitHub Pages:

1. Create a repository (for example `practice-lab`) and push this project to the `main` branch:
   ```bash
   git remote add origin https://github.com/<you>/practice-lab.git
   git push -u origin main
   ```
2. In the repository open **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. The workflow in [`.github/workflows/pages.yml`](.github/workflows/pages.yml) publishes `index.html`, `labs/` and `assets/`
   (nothing else – the bridge, tests and docs stay out of the site). After a minute your lab is at
   `https://<you>.github.io/practice-lab/`.

*Alternative:* **Source: Deploy from a branch → `main` / (root)** also works (it will additionally publish `bridge/`, harmless
but unnecessary).

Everything on the hosted site works without any server of your own. Live database connections are the one thing that needs
the [local bridge](#optional-connect-a-real-database-the-local-bridge).

---

## Optional: connect a real database (the local bridge)

`bridge/server.py` is a ~600-line Python program that runs **on your computer** and opens the database connection for the page.

```bash
cd bridge
python -m pip install -r requirements.txt     # psycopg (PostgreSQL) + PyMySQL (MySQL / MariaDB)
python server.py                              # options: --port 8765  --no-browser
```

Open `http://127.0.0.1:8765`, click the database badge → **🔌 Connect**.

* PostgreSQL: host, port (5432), database, user, password – or paste `postgresql://user:pass@host:5432/db`.
* MySQL / phpMyAdmin: choose *MySQL / MariaDB* (phpMyAdmin is only the web front-end; use the MySQL server behind it,
  port 3306, the same user and password). Hosting providers often only allow connections from the server itself – use their
  *Remote MySQL* allow-list, an SSH tunnel (`ssh -L 3307:localhost:3306 user@host`, then connect to `127.0.0.1:3307`), or
  export a backup and upload it.
* **Modes** (header): 🔒 *Read-only* (default) · ↩️ *Try writes (rolled back)* – run `UPDATE`/`DELETE` and see the effect without
  saving · ⚠️ *Commit changes* (asks for confirmation).
* The *Live* (run-while-typing) switch is **off** for real databases – queries only run when you press Run.
* Set `ANTHROPIC_API_KEY` in the environment before starting the bridge to use the AI schema helpers without pasting a key.

> **Read-only mode is a guard, not a security boundary.** For data you care about, connect with a database user that only
> has `SELECT` rights. See [SECURITY.md](SECURITY.md).

---

## How it works

```text
 ┌────────────── browser tab ──────────────┐            ┌── your computer (optional) ──┐
 │ index.html  (shell, keeps 3 labs alive) │            │ bridge/server.py             │
 │   ├─ labs/python-lab.html ──► Web Worker│            │  • serves the same files     │
 │   │        Pyodide + assets/py/lab_runner.py          │  • /api/* → PostgreSQL/MySQL │
 │   ├─ labs/sql-lab.html ─────► Web Worker│◄── http ──►│  • loopback only, token, CSP │
 │   │        sql.js (SQLite) + importers  │            └──────────────────────────────┘
 │   └─ labs/flow-lab.html  (plain JS: parser → flowchart layout → interpreter)       │
 └─────────────────────────────────────────┘
```

* **Python** – `assets/py/lab_runner.py` runs your program under `sys.settrace`, records a step per line (with before/after
  variable snapshots), builds the explanations from the AST, and detects endless loops by hashing the program state.
* **SQL** – `assets/js/sql-parse.js` masks strings/comments and splits clauses to explain a query; `sql-import.js` turns files
  into SQLite-friendly statements (it contains readers for ZIP, TAR, gzip and the `pg_dump` custom/tar archive formats);
  `sqlite-worker.js` executes them and snapshots the database after every change so a stopped worker can be restored.
* **Flowchart** – `pseudo-parser.js` (tokenizer + recursive-descent parser with friendly errors) → `pseudo-flow.js` (recursive
  block layout, so arrows never cross, + SVG renderer) → `pseudo-run.js` (interpreter that records one step per box).
* **Workspace** – `dock.js` is a small docking manager (a layout tree of splits, saved to `localStorage`).
* No framework, no build step, no bundler: ES modules and plain CSS.

---

## Privacy & security

* Your code, SQL, uploaded files and database contents **never leave your browser** (or your computer, for the bridge).
* There are no analytics, trackers or cookies. `localStorage` stores your own code, layout and non-secret hints (never
  passwords or API keys).
* The only network calls: Pyodide from jsDelivr (Python lab), and – only when *you* use the AI helpers – `api.anthropic.com`.
* Strict **Content-Security-Policy**, no inline scripts/styles, all output escaped, self-hosted SQLite and fonts, hardened
  bridge. Details, threat model and accepted risks: **[SECURITY.md](SECURITY.md)**.

---

## Project layout

```text
practice-lab/
├─ index.html                 shell: keeps the three labs alive, switches between them
├─ labs/
│  ├─ python-lab.html
│  ├─ sql-lab.html
│  └─ flow-lab.html
├─ assets/
│  ├─ css/   base.css (design system) · dock.css · shell.css · python-lab.css · sql-lab.css · flow-lab.css
│  ├─ js/    shared.js · dock.js · shell.js
│  │         python-lab.js · python-worker.js
│  │         sql-lab.js · sql-parse.js · sql-import.js · sqlite-client.js · sqlite-worker.js · bridge-client.js
│  │         flow-lab.js · pseudo-parser.js · pseudo-flow.js · pseudo-run.js · flow-exercises.js
│  ├─ py/    lab_runner.py            the Python tracer / explainer that runs inside Pyodide
│  ├─ vendor/sqljs/                   SQLite compiled to WebAssembly (MIT, license included)
│  ├─ fonts/                          Baloo 2 + Plus Jakarta Sans (SIL OFL)
│  └─ img/favicon.svg
├─ bridge/                    OPTIONAL local helper for live PostgreSQL / MySQL
│  ├─ server.py · requirements.txt · start.bat · start.sh
├─ tests/
│  ├─ unit/    pytest: Python runner, bridge security, static hygiene
│  ├─ js/      node:test (also runnable in the browser via harness.html): parser, interpreter, layout, SQL helpers
│  └─ e2e/     Playwright: all labs, imports, CSP, XSS probes, docking, phone layout
├─ docs/images/               screenshots used in this README
├─ .github/workflows/         ci.yml (tests) · pages.yml (deploy)
└─ README.md · SECURITY.md · NOTICE.md · CHANGELOG.md · LICENSE
```

---

## Testing & CI

```bash
python -m pip install -r requirements-dev.txt
python -m playwright install chromium

python -m pytest tests/unit        # Python runner, bridge security (path traversal, Host/Origin/token, read-only guard), static hygiene
node --test tests/js               # pseudocode engine + SQL helpers (Node 20+)
python -m pytest tests/e2e         # real browser: needs internet once for Pyodide
```

The same JavaScript tests also run in a browser: serve the folder and open `/tests/js/harness.html`.
CI ([`ci.yml`](.github/workflows/ci.yml)) runs all three suites on every push and pull request.

What the tests lock in: every example and practice solution runs; flowchart nodes never overlap and every decision has
Yes/No exits; no page uses inline scripts/styles or `eval`; hostile text (`<img onerror=…>` as code, table names, strings) is
displayed as text in every lab; `..` and encoded slashes cannot escape the static-file allowlist; the read-only guard
blocks `COMMIT; DELETE …`.

---

## Troubleshooting & FAQ

**The page says it can't start Python / the SQL engine.** Open it through `http(s)://` (GitHub Pages, `python -m http.server`
or the bridge), not by double-clicking the file – browsers block web workers on `file://`. The first Python start downloads
~10 MB from jsDelivr, so it needs internet once.

**"Connect" tab is missing.** That tab only exists when the page is served by the local bridge. On GitHub Pages use
*Upload file* with an export of your database.

**My PostgreSQL backup is rejected.** Custom (`-Fc`) and tar (`-Ft`) backups and plain `.sql` are supported. Backups that use
`lz4`/`zstd` compression are not – re-export with `pg_dump -Fc --compress=gzip` or as plain SQL.

**Some statements were skipped on import.** SQLite cannot run server features (extensions, sequences, owners, triggers,
stored functions). The import log (Output box) lists what was skipped. Tables, data, primary/foreign keys and indexes are kept.

**Is SQLite SQL the same as PostgreSQL/MySQL?** Mostly, for learning joins, grouping and subqueries. Dialect features differ
(`ILIKE`, `RETURNING`, `AUTO_INCREMENT`, …). Use the live bridge if you need the real server's behaviour.

**A loop stopped with "Endless loop".** The same check was reached again and again with identical values. Make something in
the loop change what the condition looks at (for example `n = n - 1`).

**Can I use it offline?** After the first visit the browser caches the files; Pyodide needs its first download. For a fully
offline copy, self-host Pyodide (see [SECURITY.md](SECURITY.md)).

---

## Known limits

* Python: standard library only (no NumPy/pandas); steps are recorded for the first 600 executed lines; no multi-threading.
* SQL sandbox: SQLite dialect; imports up to 60 MB (200 MB unpacked); results show the first 500 rows.
* Flowchart lab: one-dimensional lists, no user-defined procedures yet, structured programs only (no `GOTO` / `BREAK`).
* Live database connections need the local bridge (a browser rule).
* Pyodide is loaded from a CDN (pinned version).

---

## Contributing, credits, license

Issues and pull requests are welcome. Please run the three test suites first; new behaviour should come with a test.
Style: plain ES modules, no build step, no inline scripts/styles, escape anything that reaches the DOM.

* License: **MIT** – see [LICENSE](LICENSE).
* Third-party components and fonts: see [NOTICE.md](NOTICE.md) (sql.js, Pyodide, Baloo 2, Plus Jakarta Sans, psycopg, PyMySQL).
* UI style inspired by [quiz.bato.dev](https://quiz.bato.dev/) (cream cards, pill buttons with a bottom edge, sky backdrop).

Made with care by **[@maduraigeorge](https://github.com/maduraigeorge)**.
