"""tools/stamp_version.py: every file URL the site loads gets the same ?v= version, source files stay untouched."""
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
V = '261111.0100-abc1234'
RELEASE = json.loads((ROOT / 'package.json').read_text(encoding='utf8'))['version']


def test_stamping_a_copy_versions_every_reference(tmp_path):
    site = tmp_path / '_site'
    site.mkdir()
    shutil.copy(ROOT / 'index.html', site)
    shutil.copytree(ROOT / 'labs', site / 'labs')
    shutil.copytree(ROOT / 'assets', site / 'assets')
    subprocess.run([sys.executable, str(ROOT / 'tools' / 'stamp_version.py'), str(site), V], check=True)

    for page in [site / 'index.html', *(site / 'labs').glob('*.html')]:
        html = page.read_text(encoding='utf8')
        assert f'<meta name="app-version" content="{RELEASE}">' in html and f'<meta name="app-build" content="{V}">' in html, page.name
        for ref in re.findall(r'(?:href|src|data-src)="([^"#:]+\.(?:css|js|html|svg)(?:\?[^"]*)?)"', html):
            assert ref.endswith('?v=' + V), f'{page.name}: {ref}'
    for js in (site / 'assets' / 'js').glob('*.js'):
        src = js.read_text(encoding='utf8')
        assert not re.search(r"from '\.{1,2}/[^'?]+\.js'", src), f'{js.name}: unstamped import'
        assert not re.search(r"new URL\('\.{1,2}/[^'?]+\.(?:js|py)'", src), f'{js.name}: unstamped worker / file'
    assert '?v=' not in (site / 'assets' / 'vendor' / 'sqljs' / 'sql-wasm.js').read_text(encoding='utf8')
    # the source tree is not touched
    assert 'content="dev"' in (ROOT / 'index.html').read_text(encoding='utf8')
    assert '?v=' not in (ROOT / 'assets' / 'js' / 'python-lab.js').read_text(encoding='utf8')
