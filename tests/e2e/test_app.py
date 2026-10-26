"""Browser tests for the whole app. Marked `e2e` – run with:  python -m pytest tests/e2e"""
import pytest

pytestmark = pytest.mark.e2e


def csp(page):
    return page.evaluate('window.__csp')


# ------------------------------------------------------------------ Python lab
def python_ready(page, url):
    page.goto(f'{url}/labs/python-lab.html')
    page.locator('#status.ok').wait_for(timeout=120_000)


def set_code(page, code, sel='#code'):
    page.fill(sel, code)
    page.dispatch_event(sel, 'input')


def test_python_lab_runs_explains_and_has_no_csp_violations(page, static_url):
    python_ready(page, static_url)
    set_code(page, 's = "Mahsa and the bear"\nprint(s[::-1])\n')
    page.locator('#output', has_text='raeb eht dna ashaM').wait_for(timeout=30_000)
    page.click('#steps .step >> nth=1')
    assert 'REVERSED' in page.inner_text('#steps .step.active')
    assert page.locator('.panel:visible').count() == 5
    assert csp(page) == [] and page.errors == []


def test_python_error_infinite_loop_and_big_calculation(page, static_url):
    python_ready(page, static_url)
    set_code(page, 'nums = [1, 2]\nprint(nums[9])\n')
    page.locator('#status.err').wait_for(timeout=30_000)
    assert 'IndexError' in page.inner_text('#output')
    set_code(page, 'while True:\n    pass\n')
    page.locator('#toast', has_text='Infinite loop').wait_for(timeout=30_000)
    set_code(page, 'total = 0\nfor i in range(2000000):\n    total += i\nprint(total)\n')
    page.locator('#output', has_text='1999999000000').wait_for(timeout=60_000)


def test_python_input_values_come_from_the_header_popover(page, static_url):
    python_ready(page, static_url)
    page.click('#stdinBtn')
    page.fill('#stdin', 'Asha')
    page.dispatch_event('#stdin', 'input')
    set_code(page, 'n = input("Name? ")\nprint("Hi", n)\n')
    page.locator('#output', has_text='Hi Asha').wait_for(timeout=30_000)


# ------------------------------------------------------------------ SQL lab
def sql_ready(page, url, close_dialog=True):
    page.add_init_script("try { localStorage.removeItem('sqlLab.seen'); } catch (e) {}")      # the setup dialog opens on a first visit
    page.goto(f'{url}/labs/sql-lab.html')
    page.wait_for_selector('dialog[open]', timeout=60_000)
    if close_dialog:
        page.click('#dClose')
    page.locator('#status.ok').wait_for(timeout=60_000)


def test_sql_lab_sample_query_steps_schema(page, static_url):
    sql_ready(page, static_url)
    assert page.locator('.tb').count() == 4
    set_code(page, 'SELECT c.name, COUNT(*) AS n FROM customers c JOIN orders o ON o.customer_id = c.id GROUP BY c.name ORDER BY n DESC', '#sql')
    page.locator('.step .tt', has_text='GROUP BY').wait_for(timeout=30_000)
    page.locator('#cntFinal', has_text='2 columns').wait_for(timeout=30_000)
    assert [t.strip() for t in page.locator('.step .tt').all_inner_texts()][:3] == ['FROM + JOIN', 'GROUP BY', 'SELECT']
    assert page.locator('.tb.used').count() == 2
    assert csp(page) == [] and page.errors == []


def test_sql_row_count_drop_is_shown_without_csp_violation(page, static_url):
    sql_ready(page, static_url)
    set_code(page, "SELECT * FROM orders WHERE status = 'shipped'", '#sql')
    page.locator('.step .cnt .neg').first.wait_for(timeout=30_000)
    assert csp(page) == []


def test_sql_static_site_has_no_connect_tab_but_explains_uploading(page, static_url):
    sql_ready(page, static_url, close_dialog=False)
    assert not page.locator('.dtabs [data-d=live]').is_visible()
    assert page.locator('.dtabs [data-d=file]').is_visible()
    assert 'phpMyAdmin' in page.text_content('#d-file')


def test_sql_bridge_site_has_connect_tab(page, bridge_site):
    sql_ready(page, bridge_site, close_dialog=False)
    assert page.locator('.dtabs [data-d=live]').is_visible()
    assert page.locator('#liveForm').is_visible()


@pytest.mark.parametrize('name, tables', [('pg_plain.sql', 2), ('pg_custom.dump', 2), ('pg_tar_format.tar', 2), ('mysql_dump.sql', 1)])
def test_sql_file_imports(page, static_url, data_dir, name, tables):
    sql_ready(page, static_url, close_dialog=False)
    page.click('.dtabs [data-d=file]')
    page.set_input_files('#dbFile', str(data_dir / name))
    page.locator('#fileMsg.ok').wait_for(timeout=30_000)
    assert page.locator('.tb').count() == tables


def test_sql_csv_zip_and_binary_rejection(page, static_url, tmp_path):
    import zipfile
    (tmp_path / 'cities.csv').write_text('id,city,pop\n1,Chennai,7000000\n2,"Pune, MH",3100000\n')
    with zipfile.ZipFile(tmp_path / 'b.zip', 'w', zipfile.ZIP_DEFLATED) as z:
        z.write(tmp_path / 'cities.csv', 'cities.csv')
    (tmp_path / 'junk.bin').write_bytes(bytes(range(256)) * 20)
    sql_ready(page, static_url, close_dialog=False)
    page.click('.dtabs [data-d=file]')
    page.set_input_files('#dbFile', str(tmp_path / 'b.zip'))
    page.locator('#fileMsg.ok').wait_for(timeout=30_000)
    assert page.locator('.tb[data-t=cities]').count() == 1
    page.set_input_files('#dbFile', str(tmp_path / 'junk.bin'))
    page.locator('#fileMsg.err').wait_for(timeout=30_000)
    assert 'binary' in page.inner_text('#fileMsg')


def test_sql_runaway_query_is_stopped_and_database_survives(page, static_url):
    sql_ready(page, static_url)
    set_code(page, 'WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM r) SELECT COUNT(*) FROM r', '#sql')
    page.click('#run')
    page.locator('#status.err').wait_for(timeout=40_000)
    assert 'too long' in page.inner_text('#log') or 'stopped' in page.inner_text('#log')
    set_code(page, 'SELECT COUNT(*) AS n FROM customers', '#sql')
    page.click('#run')
    page.locator('#result .grid', has_text='12').wait_for(timeout=30_000)


# ------------------------------------------------------------------ Flowchart lab
def test_flow_lab_chart_steps_and_practice(page, static_url):
    page.goto(f'{static_url}/labs/flow-lab.html')
    page.locator('#status.ok').wait_for(timeout=30_000)
    assert page.locator('.fc-node').count() >= 8
    page.select_option('#examples', label='Grade (IF / ELSE IF)')
    page.locator('#output', has_text='Grade: B').wait_for(timeout=10_000)
    page.click('#first')
    page.click('#next')
    assert page.locator('.fc-node.active').count() == 1
    page.select_option('#examples', label='🎯 Even or odd')
    page.locator('.goal .fail').wait_for(timeout=10_000)
    set_code(page, 'INPUT n\nIF n MOD 2 = 0 THEN\n  OUTPUT "even"\nELSE\n  OUTPUT "odd"\nENDIF\n')
    page.locator('.goal .pass').wait_for(timeout=10_000)
    assert csp(page) == [] and page.errors == []


def test_flow_lab_syntax_error_and_endless_loop(page, static_url):
    page.add_init_script("try { localStorage.removeItem('flowLab.code'); localStorage.removeItem('flowLab.inputs'); } catch (e) {}")
    page.goto(f'{static_url}/labs/flow-lab.html')
    page.locator('#status.ok').wait_for(timeout=30_000)
    set_code(page, 'x = 1\nIF x > 0 THEN\nOUTPUT x\n')
    page.locator('#status.err').wait_for(timeout=10_000)
    assert 'ENDIF' in page.inner_text('#output')
    set_code(page, 'x = 1\nWHILE x > 0 DO\n  y = 1\nENDWHILE\n')
    page.locator('#toast', has_text='Endless loop').wait_for(timeout=10_000)


# ------------------------------------------------------------------ shell, layout, responsive
def test_shell_switches_labs_and_keeps_state(page, static_url):
    page.goto(f'{static_url}/index.html#python')
    py = page.frame_locator('#fr-python')
    py.locator('#status.ok').wait_for(timeout=120_000)
    py.locator('.labnav a', has_text='SQL').click()
    assert page.evaluate("document.querySelector('#fr-sql').classList.contains('on')")
    sq = page.frame_locator('#fr-sql')
    sq.locator('#status.ok').wait_for(timeout=60_000)
    sq.locator('.labnav a', has_text='Flowchart').click()
    assert page.evaluate("document.querySelector('#fr-flow').classList.contains('on')") and page.url.endswith('#flow')
    page.frame_locator('#fr-flow').locator('.labnav a', has_text='Python').click()
    assert page.evaluate("document.querySelector('#fr-python').classList.contains('on')")
    assert page.locator('iframe.on').count() == 1


def test_dock_presets_minimise_and_persistence(page, static_url):
    python_ready(page, static_url)
    page.select_option('#layoutSel', label='Code focus')
    boxes = page.evaluate("[...document.querySelectorAll('.panel')].map(p => { const r = p.getBoundingClientRect(); return [r.width, r.height]; })")
    assert all(w > 80 and h > 60 for w, h in boxes)
    page.click('#p-result [data-a=min]')
    assert not page.locator('#p-result').is_visible() and 'live result' in page.inner_text('#dktray').lower()
    page.reload()
    page.locator('#status.ok').wait_for(timeout=120_000)
    assert not page.locator('#p-result').is_visible()                 # layout is remembered
    page.click('#dktray button')
    assert page.locator('#p-result').is_visible()


@pytest.mark.parametrize('lab', ['python-lab', 'sql-lab', 'flow-lab'])
def test_phone_layout_has_tabs_and_no_sideways_scroll(page, static_url, lab):
    page.set_viewport_size({'width': 390, 'height': 780})
    page.goto(f'{static_url}/labs/{lab}.html')
    page.locator('#status').wait_for(timeout=60_000)
    page.wait_for_timeout(1500)
    assert page.locator('.panel:visible').count() == 1
    assert page.locator('#tabs').is_visible()
    assert not page.evaluate('document.documentElement.scrollWidth > innerWidth')


# ------------------------------------------------------------------ XSS: hostile text must stay text
EVIL = '<img src=x onerror=window.__pwned=1>'


def test_xss_probes_are_inert_in_every_lab(page, static_url, tmp_path):
    # Python: strings, repr values, exception messages
    python_ready(page, static_url)
    set_code(page, f'x = "{EVIL}"\nprint(x)\nraise ValueError("{EVIL}")\n')
    page.locator('#status.err').wait_for(timeout=30_000)
    page.wait_for_timeout(400)
    assert EVIL in page.inner_text('#output') and page.locator('img[src="x"]').count() == 0
    assert page.evaluate('window.__pwned') is None

    # SQL: hostile table / column names and values come back in the diagram, grid, steps and log
    (tmp_path / 'evil.sql').write_text(f'CREATE TABLE "{EVIL}" ("<svg onload=window.__pwned=1>" text);\nINSERT INTO "{EVIL}" VALUES (\'{EVIL}\');\n')
    sql_ready(page, static_url, close_dialog=False)
    page.click('.dtabs [data-d=file]')
    page.set_input_files('#dbFile', str(tmp_path / 'evil.sql'))
    page.locator('#fileMsg.ok').wait_for(timeout=30_000)
    set_code(page, f'SELECT * FROM "{EVIL}"', '#sql')
    page.click('#run')
    page.locator('#result .grid').wait_for(timeout=30_000)
    page.wait_for_timeout(600)
    assert page.locator('img[src="x"], svg[onload]').count() == 0
    assert page.evaluate('window.__pwned') is None
    assert EVIL in page.text_content('#result') and EVIL in page.text_content('#visual')

    # Flowchart: strings flow into the chart (SVG), steps, trace table and output
    page.goto(f'{static_url}/labs/flow-lab.html')
    page.locator('#status').wait_for(timeout=30_000)
    set_code(page, f'x = "{EVIL}"\nOUTPUT x\nOUTPUT x + "!"\n')
    page.locator('#status.ok').wait_for(timeout=10_000)
    page.click('.vtabs [data-v=trace]')
    page.wait_for_timeout(400)
    assert page.locator('img[src="x"]').count() == 0 and page.evaluate('window.__pwned') is None
    assert EVIL in page.inner_text('#output') and EVIL in page.text_content('#chart')
