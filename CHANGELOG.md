# Changelog

## 1.0.0

First production release.

### Labs
* **Python lab** – live runs in a Web Worker (Pyodide), step-by-step trace with plain-English explanations of every
  expression (slices such as `s[::-1]`, indexes, methods, operators, comprehensions, f-strings …), variable cards,
  infinite-loop detection that still allows big calculations, Stop button, and a **Frames & Objects** visual (frames, heap
  objects and reference arrows, in the style of Python Tutor) with a final *program finished* step.
* **SQL lab** – SQLite in a worker with a 15 s watchdog; clause-by-clause explanation with live row counts; schema diagram;
  upload `.sql` (PostgreSQL / MySQL dumps are converted), PostgreSQL custom and tar backups, `.zip` / `.tar` / `.gz`,
  `.csv`, `.sqlite`; create a schema by typing, from a description or from a picture (own Anthropic key); optional local
  bridge for live PostgreSQL / MySQL.
* **Flowchart & pseudocode lab** *(new)* – write pseudocode, get a live flowchart, step through it box by box with variable
  values substituted into the explanation, trace table, practice exercises that check your output.

### App
* One header bar per lab (lab switcher, database/setup, examples, input, layout) so the work area gets the space.
* Dockable layout: drag title bars to dock or swap boxes, resize, minimise, maximise, layout presets, remembered per lab.
* Playful compact design (cream cards, pill buttons, per-box colours), light and dark, phone layout with a tab bar.

### Security / quality
* Strict Content-Security-Policy, no inline scripts or styles, escaped output everywhere, self-hosted SQLite and fonts.
* Bridge hardening: loopback only, Host/Origin checks, per-run token, strict static-file allowlist (path-traversal tested),
  request bodies always consumed (no smuggling), the Python lab isolated on a different origin from the API, transaction-control
  guard for read-only mode (PostgreSQL / MySQL aware), MySQL DDL refused in rolled-back mode, limits.
* Independent review findings fixed: import data integrity (escapes, `public.` inside text, CSV leading zeros, `$$` bodies),
  shared decompression budget, SQLite statement queue timing, bounded memory for big results, flowchart engine hardening
  (size/time budgets, nested index targets, float comparison), keyboard access (drop zones, Esc-then-Tab out of editors).
* Unit, JavaScript and browser tests plus CI and a GitHub Pages deployment workflow.
