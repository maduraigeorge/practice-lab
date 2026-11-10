"""Static checks over the web files: security headers, no inline code/styles, every element id the scripts use exists."""
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
PAGES = ['index.html', 'labs/python-lab.html', 'labs/sql-lab.html', 'labs/flow-lab.html']
JS = sorted((ROOT / 'assets' / 'js').glob('*.js'))
LAB_JS = {'labs/python-lab.html': ['python-lab.js', 'shared.js', 'dock.js'],
          'labs/sql-lab.html': ['sql-lab.js', 'shared.js', 'dock.js'],
          'labs/flow-lab.html': ['flow-lab.js', 'shared.js', 'dock.js']}
# ids that scripts create themselves
DYNAMIC = re.compile(r'^(bar|cnt|peek|erSvg|er|cntFinal|layoutSel|dkhold|dktray)')


def read(rel):
    return (ROOT / rel).read_text(encoding='utf8')


@pytest.mark.parametrize('page', PAGES)
def test_every_page_has_a_strict_csp(page):
    html = read(page)
    m = re.search(r'http-equiv="Content-Security-Policy" content="([^"]+)"', html)
    assert m, 'missing CSP meta tag'
    csp = m.group(1)
    assert "default-src 'none'" in csp and "script-src 'self'" in csp and "object-src 'none'" in csp and "base-uri 'none'" in csp
    assert 'unsafe-inline' not in csp and 'unsafe-eval' not in csp
    assert 'no-referrer' in html


@pytest.mark.parametrize('page', PAGES)
def test_no_inline_scripts_styles_or_handlers(page):
    html = read(page)
    assert not re.search(r'<script(?![^>]*\bsrc=)[^>]*>', html), 'inline <script>'
    assert '<style' not in html and not re.search(r'\sstyle=', html), 'inline style'
    assert not re.search(r'\son[a-z]+=', html), 'inline event handler'
    assert 'javascript:' not in html


def test_scripts_do_not_use_dynamic_code_or_inline_styles():
    for f in JS:
        src = f.read_text(encoding='utf8')
        assert not re.search(r'\beval\(|new Function\(|document\.write\(|insertAdjacentHTML|\.outerHTML\s*=', src), f.name
        assert not re.search(r'style=\\?"', src), f'{f.name}: inline style attribute in a template (blocked by the CSP)'
        assert 'sessionStorage' not in src, f'{f.name}: secrets must not be stored'


@pytest.mark.parametrize('page', list(LAB_JS))
def test_ids_used_by_scripts_exist_in_the_page(page):
    html_ids = set(re.findall(r'\bid="([^"]+)"', read(page)))
    for js in LAB_JS[page]:
        src = read(f'assets/js/{js}')
        used = set(re.findall(r"\$\('([A-Za-z][\w-]*)'\)", src)) | set(re.findall(r"getElementById\('([A-Za-z][\w-]*)'\)", src))
        missing = {i for i in used if i not in html_ids and not DYNAMIC.match(i)}
        assert not missing, f'{js} uses ids that {page} does not contain: {sorted(missing)}'


def test_every_stylesheet_and_script_referenced_exists():
    for page in PAGES:
        html = read(page)
        base = (ROOT / page).parent
        for ref in re.findall(r'(?:href|src)="([^"#:]+\.(?:css|js|svg))"', html):
            assert (base / ref).resolve().is_file(), f'{page}: {ref} not found'


def test_vendor_licenses_and_fonts_present():
    assert (ROOT / 'assets/vendor/sqljs/LICENSE').is_file() and (ROOT / 'NOTICE.md').is_file() and (ROOT / 'LICENSE').is_file()
    for font in ('baloo-2.woff2', 'plus-jakarta-sans.woff2'):
        assert (ROOT / 'assets/fonts' / font).stat().st_size > 10_000
