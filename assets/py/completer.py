"""Code suggestions that come from the REAL objects of the program that just ran (Pyodide worker, next to lab_runner.py).

The lab re-runs the code as you type, so the variables of the last run are still alive (lab_runner.LAST_NS). Typing `t.` after
`t = (1, 2, 3)` therefore asks the actual tuple what it can do, and each suggestion carries its real signature. Nothing is ever
called while completing: names and attributes are only looked up.

Both functions return a JSON string so the worker can pass it straight to the page:
  complete(text)  -> [[name, kind, detail], ...]   suggestions for the end of `text` (the current line up to the cursor)
  sigs(name)      -> {method: detail}              signatures of a built-in type ('set', 'str', ...) or of 'builtins'
detail = {sig, req, opt, var, doc} or null.
"""
import ast
import builtins
import inspect
import json
import keyword
import re

_lab = {}            # the worker puts lab_runner's globals here; the live variables are _lab['LAST_NS']


def _ns():
    return _lab.get('LAST_NS') or {}


_WORD = re.compile(r'[A-Za-z_]\w*$')
_CHAIN = re.compile(r'[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$')
_PAIRS = {')': '(', ']': '[', '}': '{'}


def _resolve(chain):
    """Look a dotted name such as `t` or `os.path` up WITHOUT calling anything. Returns (found, value)."""
    first, *rest = chain.split('.')
    ns = _ns()
    if first in ns:
        obj = ns[first]
    elif hasattr(builtins, first):
        obj = getattr(builtins, first)
    else:
        return False, None
    for part in rest:
        try:
            obj = inspect.getattr_static(obj, part)
        except AttributeError:
            return False, None
        if isinstance(obj, property):                   # would have to run code to know the value
            return False, None
    return True, obj


def _literal_before(src):
    """If `src` ends with a literal such as (1, 2), [1], {1: 2} or "abc", return (True, value)."""
    c = src[-1]
    if c in '"\'':
        i = src.rfind(c, 0, len(src) - 1)
        if i < 0:
            return False, None
        i -= len(re.search(r'[rbfuRBFU]{0,2}$', src[:i]).group(0))
        start = i
    elif c in _PAIRS:
        depth, start = 0, -1
        for i in range(len(src) - 1, -1, -1):
            if src[i] == c:
                depth += 1
            elif src[i] == _PAIRS[c]:
                depth -= 1
                if depth == 0:
                    start = i
                    break
        if start < 0 or (start > 0 and re.search(r'[\w)\]]$', src[:start])):   # name(...) or x[...] is a call / index: not evaluated
            return False, None
    else:
        return False, None
    try:
        return True, ast.literal_eval(src[start:])
    except Exception:
        return False, None


def _receiver(src):
    src = src.rstrip()
    if not src:
        return False, None
    if _CHAIN.search(src) and not re.search(r'[\w)\]}"\']\s*\.\s*$', src[:-len(_CHAIN.search(src).group(0))]):
        return _resolve(_CHAIN.search(src).group(0))
    return _literal_before(src)


def _kind_of(obj):
    if isinstance(obj, type):
        return 'class'
    return type(obj).__name__


_DOC_SIG = re.compile(r'^[\w.]+(\(.*\))')


# Python 3.12 (the version inside Pyodide) gives these built-in methods no signature of their own, so they are listed here.
_KNOWN = {
    'set.add': '(element, /)', 'set.clear': '()', 'set.copy': '()', 'set.difference': '(*others)', 'set.difference_update': '(*others)',
    'set.discard': '(element, /)', 'set.intersection': '(*others)', 'set.intersection_update': '(*others)',
    'set.isdisjoint': '(other, /)', 'set.issubset': '(other, /)', 'set.issuperset': '(other, /)', 'set.pop': '()',
    'set.remove': '(element, /)', 'set.symmetric_difference': '(other, /)', 'set.symmetric_difference_update': '(other, /)',
    'set.union': '(*others)', 'set.update': '(*others)',
    'dict.clear': '()', 'dict.copy': '()', 'dict.items': '()', 'dict.keys': '()', 'dict.values': '()',
    'dict.update': '(other=(), /, **kwargs)',
}


def _count_text(sig):
    """Count required / optional arguments in a signature written as text, e.g. '(value, start=0, /)'. Returns (req, opt, var) or None."""
    try:
        a = ast.parse('def _f' + sig + ': pass').body[0].args
    except SyntaxError:
        return None
    pos = a.posonlyargs + a.args
    opt = len(a.defaults) + sum(1 for x in a.kw_defaults if x is not None)
    req = len(pos) - len(a.defaults) + sum(1 for x in a.kw_defaults if x is None)
    return req, opt, bool(a.vararg or a.kwarg)


def _detail(f):
    """How to call `f`: {'sig': '(value, /)', 'req': 1, 'opt': 0, 'var': False, 'doc': 'first line of its help'}, or None."""
    if not callable(f):
        return None
    d = {'sig': None, 'req': None, 'opt': 0, 'var': False, 'doc': ''}
    try:
        doc = inspect.getdoc(f) or ''
    except Exception:
        doc = ''
    lines = [x.strip() for x in doc.split('\n') if x.strip()]
    try:
        sig = inspect.signature(f)
        d['sig'] = str(sig)
        d['req'] = d['opt'] = 0
        for p in sig.parameters.values():
            if p.kind in (p.VAR_POSITIONAL, p.VAR_KEYWORD):
                d['var'] = True
            elif p.default is p.empty:
                d['req'] += 1
            else:
                d['opt'] += 1
    except (TypeError, ValueError):                    # a built-in without a signature: use the list above, else the first help line
        owner = getattr(f, '__self__', None)
        known = _KNOWN.get('%s.%s' % (type(owner).__name__, getattr(f, '__name__', '')))
        m = _DOC_SIG.match(lines[0]) if lines else None
        if known:
            d['sig'] = known
        elif m:
            d['sig'] = m.group(1)
            lines = lines[1:]
        counts = _count_text(d['sig']) if d['sig'] else None
        if counts:
            d['req'], d['opt'], d['var'] = counts
    d['doc'] = (lines[0] if lines else '')[:140]
    return d


def _attrs(obj, word):
    show_private = word.startswith('_')
    kind = _kind_of(obj)
    items = []
    for n in dir(obj):
        if n.startswith('_') and not show_private:
            continue
        if not n.lower().startswith(word.lower()) or n == word:
            continue
        try:
            v = inspect.getattr_static(obj, n)
        except AttributeError:
            v = None
        detail = None
        if callable(v) or isinstance(v, (classmethod, staticmethod)):
            try:
                detail = _detail(getattr(obj, n))       # the bound method, so `self` is already left out
            except Exception:
                detail = None
        items.append([n, kind + (' method' if callable(v) or detail else ' attribute'), detail])
    return items


def _names(word):
    seen, items = set(), []
    for n, v in list(_ns().items()):
        if getattr(v, '__name__', '') == 'fake_input':     # the lab's stand-in for input(): the real one is listed below
            continue
        if not n.startswith('__') and n.lower().startswith(word.lower()) and n != word and n not in seen:
            seen.add(n)
            items.append([n, 'yours (%s)' % _kind_of(v), _detail(v)])
    for n in dir(builtins):
        if not n.startswith('_') and n.lower().startswith(word.lower()) and n != word and n not in seen:
            seen.add(n)
            items.append([n, 'built-in', _detail(getattr(builtins, n))])
    for n in keyword.kwlist:
        if n.lower().startswith(word.lower()) and n != word and n not in seen:
            seen.add(n)
            items.append([n, 'keyword', None])
    return items


_SAMPLES = {'str': '', 'list': [], 'dict': {}, 'tuple': (), 'set': set(), 'int': 0, 'float': 0.0, 'bool': True}


def sigs(tname):
    """How to call every public method of a built-in type (or every built-in function for 'builtins'): {name: detail}."""
    out = {}
    if tname == 'builtins':
        for n in dir(builtins):
            if not n.startswith('_'):
                out[n] = _detail(getattr(builtins, n))
    elif tname in _SAMPLES:
        sample = _SAMPLES[tname]
        for n in dir(sample):
            if not n.startswith('_'):
                try:
                    out[n] = _detail(getattr(sample, n))
                except Exception:
                    pass
    return json.dumps({k: v for k, v in out.items() if v})


def complete(text):
    m = _WORD.search(text)
    word = m.group(0) if m else ''
    head = text[:len(text) - len(word)]
    if head.endswith('.'):
        ok, obj = _receiver(head[:-1])
        items = _attrs(obj, word) if ok else []
    elif word:
        items = _names(word)
    else:
        items = []
    return json.dumps(sorted(items, key=lambda x: (x[0].startswith('_'), not x[1].startswith('yours'), x[0].lower(), x[0]))[:80])

