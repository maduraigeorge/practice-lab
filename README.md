# Practice Lab – Python + SQL

Interactive practice tool by **@maduraigeorge**.

- **Python lab** – live results, step-by-step explanation, variable visuals, output box (runs in your browser via Pyodide).
- **SQL lab** – sandbox database in the browser (create/upload schema, sample DB), step-by-step query explanation, schema diagram.

## Use it online (GitHub Pages – nothing to install)
Everything runs in your browser:
- Python lab (Pyodide) and SQL lab (SQLite in the browser).
- **Upload file**: `.sql` dumps, PostgreSQL backups (`.dump`/`.tar`, any `pg_dump` format), MySQL/phpMyAdmin exports, `.zip`, `.tar.gz`, `.csv`, `.sqlite`.
- **Create schema** by typing SQL, from the sample DB, from a picture or from a description (the last two use your own Anthropic API key, sent only from your browser to Anthropic).

A web page cannot open a database connection, so for your own data **export a backup and upload it**.

## Optional: live connections (run locally)
1. Install Python 3.9+
2. Double-click `start.bat` (or `pip install -r requirements.txt && python server.py`)
3. Open http://127.0.0.1:8765 – a live PostgreSQL / MySQL connection form appears in the SQL lab.
