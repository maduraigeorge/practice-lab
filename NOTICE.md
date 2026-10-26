# Third-party notices

Practice Lab itself is MIT-licensed (see `LICENSE`). It includes or loads the following components.

| Component | Use | License | Where |
|-----------|-----|---------|-------|
| [sql.js](https://github.com/sql-js/sql.js) 1.10.2 (SQLite compiled to WebAssembly) | SQL sandbox | MIT | `assets/vendor/sqljs/` (license file included) |
| [Pyodide](https://pyodide.org) 0.26.4 (CPython compiled to WebAssembly) | Python lab | MPL-2.0 | loaded from jsDelivr at run time, not bundled |
| [Baloo 2](https://fonts.google.com/specimen/Baloo+2) (Ek Type) | titles / buttons | SIL Open Font License 1.1 | `assets/fonts/baloo-2.woff2` |
| [Plus Jakarta Sans](https://fonts.google.com/specimen/Plus+Jakarta+Sans) (Tokotype) | body text | SIL Open Font License 1.1 | `assets/fonts/plus-jakarta-sans.woff2` |
| [psycopg 3](https://www.psycopg.org) | optional bridge: PostgreSQL | LGPL-3.0 | installed by `pip` only if you run the bridge |
| [PyMySQL](https://github.com/PyMySQL/PyMySQL) | optional bridge: MySQL / MariaDB | MIT | installed by `pip` only if you run the bridge |
| [Anthropic API](https://docs.anthropic.com) | optional AI schema helpers | service terms apply | called from the browser with *your* key |

The UI look (cream cards, pill buttons with a darker bottom edge, sky-blue backdrop) was inspired by
[quiz.bato.dev](https://quiz.bato.dev/); no code, artwork or fonts were taken from that site.
