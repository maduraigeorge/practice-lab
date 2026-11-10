"""Cache-busting for the deployed site: append ?v=<version> to every script, stylesheet, worker, page and Python file the site loads.

GitHub Pages lets browsers keep files for 10 minutes, so after a deploy people can keep running an old mix of files. A new
version string in every URL makes the browser fetch the new files at once.

    python tools/stamp_version.py <site_dir> <build>

The release number shown to people (v1.1.0) comes from package.json; <build> (date + commit) goes into the file URLs so every
deploy is fetched fresh, and into the tooltip of the version label.

Only the copy in <site_dir> is changed; the source files stay clean. Every module gets the same version, so a module is
never loaded twice under two different URLs.
"""
import json
import re
import sys
from pathlib import Path

HTML_REF = re.compile(r'''((?:href|src|data-src)=")((?!https?:|//|data:|#)[^"?#]+\.(?:css|js|html|svg))(")''')
JS_IMPORT = re.compile(r'''(\bfrom\s+')(\.{1,2}/[^'?]+\.js)(')''')
JS_URL = re.compile(r'''(new URL\(')(\.{1,2}/[^'?]+\.(?:js|py|wasm))(')''')
META = re.compile(r'(<meta name="app-version" content=")[^"]*(">\s*<meta name="app-build" content=")[^"]*(")')


def stamp(site, version, release=None):
    site = Path(site)
    release = release or json.loads((Path(__file__).resolve().parents[1] / 'package.json').read_text(encoding='utf8'))['version']
    n = 0
    for f in site.rglob('*'):
        if not f.is_file() or 'vendor' in f.relative_to(site).parts:
            continue
        if f.suffix == '.html':
            pats = [(HTML_REF, r'\1\2?v=%s\3' % version), (META, r'\g<1>%s\g<2>%s\g<3>' % (release, version))]
        elif f.suffix == '.js':
            pats = [(JS_IMPORT, r'\1\2?v=%s\3' % version), (JS_URL, r'\1\2?v=%s\3' % version)]
        else:
            continue
        text = old = f.read_text(encoding='utf8')
        for rx, repl in pats:
            text = rx.sub(repl, text)
        if text != old:
            f.write_text(text, encoding='utf8', newline='')
            n += 1
    return n


if __name__ == '__main__':
    if len(sys.argv) != 3 or not re.fullmatch(r'[\w.-]{1,40}', sys.argv[2]):
        sys.exit('usage: stamp_version.py <site_dir> <version>')
    print('stamped %d files with version %s' % (stamp(sys.argv[1], sys.argv[2]), sys.argv[2]))
