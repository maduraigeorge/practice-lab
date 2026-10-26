import sys, ast, io, json, builtins, re

MAX_STEPS = 600
TRACE_LIMIT = 60000      # after this many traced events we stop tracing and let the program run at full speed
REPEAT_LIMIT = 300       # same line + identical variables this many times = provably stuck


class InfiniteLoop(BaseException):   # BaseException so a user's `except Exception` cannot hide it
    pass

MAX_OUT = 50000
NOISE = ('<listcomp>', '<dictcomp>', '<setcomp>', '<genexpr>', '<lambda>')

HINTS = {
    'NameError': 'A name was used before it was created, or it is misspelled.',
    'ZeroDivisionError': 'You divided by zero.',
    'IndexError': 'The index is outside the list. Valid indexes go from 0 to len(list) - 1.',
    'KeyError': 'That key is not in the dictionary.',
    'TypeError': 'An operation was used on the wrong kind of value (e.g. adding a number to text).',
    'ValueError': 'The value has the right type but an unsuitable content.',
    'SyntaxError': 'Python could not understand the code. Check colons, brackets and quotes.',
    'IndentationError': 'The spaces at the start of a line do not line up.',
    'AttributeError': 'That object has no such attribute or method.',
    'EOFError': 'input() needs a line in the "Input for input()" box.',
    'TimeoutError': 'The program ran too long. Does a loop never stop?',
    'InfiniteLoop': 'Something inside the loop must change so it can end - for example add i += 1, or check your while condition.',
}


def ser(v, d=0):
    try:
        r = repr(v)
    except Exception:
        r = '<unprintable>'
    if len(r) > 80:
        r = r[:77] + '...'
    o = {'t': type(v).__name__, 'r': r}
    if isinstance(v, (bool, int, float, complex, str, bytes, type(None))):
        o['k'] = 'p'
    elif isinstance(v, (list, tuple, set, frozenset)) and d < 2:
        items = list(v)
        o['k'] = 'seq'
        o['id'] = id(v)
        o['items'] = [ser(x, d + 1) for x in items[:40]]
        o['more'] = max(0, len(items) - 40)
        o['ordered'] = not isinstance(v, (set, frozenset))
    elif isinstance(v, dict) and d < 2:
        items = list(v.items())
        o['k'] = 'map'
        o['id'] = id(v)
        o['items'] = [[ser(a, d + 1), ser(b, d + 1)] for a, b in items[:40]]
        o['more'] = max(0, len(items) - 40)
    elif callable(v):
        o['k'] = 'fn'
        o['id'] = id(v)
    else:
        o['k'] = 'o'
        o['id'] = id(v)
    return o


def snap(ns):
    out = {}
    for k, v in list(ns.items()):
        if k.startswith('__') or isinstance(v, type(sys)) or (k == 'input' and getattr(v, '__name__', '') == 'fake_input'):
            continue
        out[k] = ser(v)
    return out


def indent(s):
    return len(s) - len(s.lstrip())


def describe(ch):
    parts = []
    for c in ch[:4]:
        n = c['name']
        if c['how'] == 'new':
            parts.append(f"`{n}` is created with value `{c['new']['r']}` ({c['new']['t']})")
        elif c['how'] == 'changed':
            parts.append(f"`{n}` changes from `{c['old']['r']}` to `{c['new']['r']}`")
        else:
            parts.append(f"`{n}` is deleted")
    if len(ch) > 4:
        parts.append(f"and {len(ch) - 4} more change(s)")
    return '; '.join(parts)


def short(t, n=60):
    t = t.strip().replace('\n', ' ⏎ ')
    return t if len(t) <= n else t[:n - 3] + '...'


# ----------------------------------------------------------------------------------------------
# Expression-level explanations ("what does s[::-1] mean?").
# Sub-expressions are evaluated with a tiny whitelist evaluator that only touches built-in types,
# so explaining a line can never run user code or change any state.
# ----------------------------------------------------------------------------------------------
import operator
from itertools import islice

_SAFE = (int, float, complex, bool, str, bytes, list, tuple, set, frozenset, dict, type(None), range)
_PURE_FUNCS = {'len': len, 'abs': abs, 'min': min, 'max': max, 'sum': sum, 'sorted': sorted, 'round': round,
               'int': int, 'float': float, 'str': str, 'bool': bool, 'list': list, 'tuple': tuple, 'set': set,
               'ord': ord, 'chr': chr, 'range': range, 'any': any, 'all': all,
               'reversed': lambda x: list(reversed(x)), 'enumerate': lambda x, s=0: list(enumerate(x, s)),
               'zip': lambda *a: list(zip(*a))}
_PURE_METHODS = {
    str: ('upper lower title capitalize strip lstrip rstrip split rsplit join replace find rfind index count startswith '
          'endswith isdigit isalpha isalnum isspace isupper islower format zfill center ljust rjust splitlines swapcase '
          'casefold').split(),
    list: 'copy count index'.split(), tuple: 'count index'.split(),
    dict: 'get keys values items copy'.split(), set: 'copy union intersection difference issubset issuperset'.split(),
}
_BINOPS = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv,
           ast.FloorDiv: operator.floordiv, ast.Mod: operator.mod, ast.Pow: operator.pow,
           ast.BitAnd: operator.and_, ast.BitOr: operator.or_, ast.BitXor: operator.xor,
           ast.LShift: operator.lshift, ast.RShift: operator.rshift}
_CMPOPS = {ast.Eq: operator.eq, ast.NotEq: operator.ne, ast.Lt: operator.lt, ast.LtE: operator.le,
           ast.Gt: operator.gt, ast.GtE: operator.ge, ast.In: lambda a, b: a in b, ast.NotIn: lambda a, b: a not in b,
           ast.Is: operator.is_, ast.IsNot: operator.is_not}
_OPWORD = {ast.Add: 'adds', ast.Sub: 'subtracts', ast.Mult: 'multiplies', ast.Div: 'divides',
           ast.FloorDiv: 'floor-divides', ast.Mod: 'takes the remainder of', ast.Pow: 'raises to a power'}
_SYM = {ast.Add: '+', ast.Sub: '-', ast.Mult: '*', ast.Div: '/', ast.FloorDiv: '//', ast.Mod: '%', ast.Pow: '**'}


class _Unsafe(Exception):
    pass


def _ok(v):
    return type(v) in _SAFE


def _guard(v):
    if isinstance(v, (str, bytes, list, tuple, set, frozenset, dict)) and len(v) > 5000:
        raise _Unsafe()
    return v


def _ev(n, env):
    t = type(n)
    if t is ast.Constant:
        return n.value
    if t is ast.Name:
        if n.id in env[0]:
            return env[0][n.id]
        if n.id in env[1]:
            return env[1][n.id]
        raise _Unsafe()
    if t in (ast.List, ast.Tuple, ast.Set):
        if any(isinstance(e, ast.Starred) for e in n.elts):
            raise _Unsafe()
        return {ast.List: list, ast.Tuple: tuple, ast.Set: set}[t]([_ev(e, env) for e in n.elts])
    if t is ast.Dict:
        if any(k is None for k in n.keys):
            raise _Unsafe()
        return {_ev(k, env): _ev(v, env) for k, v in zip(n.keys, n.values)}
    if t is ast.UnaryOp:
        v = _ev(n.operand, env)
        if not _ok(v):
            raise _Unsafe()
        return {ast.Not: operator.not_, ast.USub: operator.neg, ast.UAdd: operator.pos,
                ast.Invert: operator.invert}[type(n.op)](v)
    if t is ast.BinOp:
        a, b = _ev(n.left, env), _ev(n.right, env)
        if not (_ok(a) and _ok(b)) or type(n.op) not in _BINOPS:
            raise _Unsafe()
        if isinstance(n.op, ast.Pow) and (not isinstance(b, (int, float)) or abs(b) > 1000):
            raise _Unsafe()
        if isinstance(n.op, ast.Mult) and isinstance(b, int) and isinstance(a, (str, list, tuple, bytes)) \
                and len(a) * abs(b) > 5000:
            raise _Unsafe()
        return _guard(_BINOPS[type(n.op)](a, b))
    if t is ast.BoolOp:
        v = None
        for e in n.values:
            v = _ev(e, env)
            if (isinstance(n.op, ast.And) and not v) or (isinstance(n.op, ast.Or) and v):
                break
        return v
    if t is ast.Compare:
        left = _ev(n.left, env)
        res = True
        for op, c in zip(n.ops, n.comparators):
            right = _ev(c, env)
            if not (_ok(left) and _ok(right)) or type(op) not in _CMPOPS:
                raise _Unsafe()
            res = _CMPOPS[type(op)](left, right)
            if not res:
                return res
            left = right
        return res
    if t is ast.IfExp:
        return _ev(n.body if _ev(n.test, env) else n.orelse, env)
    if t is ast.Subscript:
        base = _ev(n.value, env)
        if not _ok(base) or isinstance(base, (set, frozenset, int, float, bool, complex, type(None))):
            raise _Unsafe()
        sl = n.slice
        if isinstance(sl, ast.Slice):
            idx = slice(*[(_ev(x, env) if x is not None else None) for x in (sl.lower, sl.upper, sl.step)])
        else:
            idx = _ev(sl, env)
        return _guard(base[idx])
    if t is ast.JoinedStr:
        out = ''
        for part in n.values:
            if isinstance(part, ast.Constant):
                out += str(part.value)
            elif isinstance(part, ast.FormattedValue) and part.format_spec is None and part.conversion == -1:
                v = _ev(part.value, env)
                if not _ok(v):
                    raise _Unsafe()
                out += str(v)
            else:
                raise _Unsafe()
        return out
    if t is ast.Call:
        if n.keywords and not all(k.arg in ('reverse', 'sep') for k in n.keywords):
            raise _Unsafe()
        f = n.func
        if isinstance(f, ast.Name) and f.id in _PURE_FUNCS and f.id not in env[0] and f.id not in env[1]:
            if any(isinstance(a, ast.Starred) for a in n.args):
                raise _Unsafe()
            args = [_ev(a, env) for a in n.args]
            if not all(_ok(a) for a in args):
                raise _Unsafe()
            if f.id == 'range' and any(isinstance(a, int) and abs(a) > 10 ** 7 for a in args):
                raise _Unsafe()
            kw = {k.arg: _ev(k.value, env) for k in n.keywords}
            return _guard(_PURE_FUNCS[f.id](*args, **kw))
        if isinstance(f, ast.Attribute):
            recv = _ev(f.value, env)
            if type(recv) in _PURE_METHODS and f.attr in _PURE_METHODS[type(recv)]:
                args = [_ev(a, env) for a in n.args]
                if not all(_ok(a) for a in args):
                    raise _Unsafe()
                return _guard(getattr(recv, f.attr)(*args))
    raise _Unsafe()


def _val(n, env):
    """Evaluate a node safely; returns (True, value) or (False, None)."""
    try:
        return True, _ev(n, env)
    except Exception:
        return False, None


def _fmt(v, n=48):
    if isinstance(v, range):
        items = list(islice(v, 6))
        if not len(v):
            return '(nothing: empty range)'
        return ', '.join(map(str, items)) + (', ...' if len(v) > 6 else '') + f"  ({len(v)} numbers)"
    try:
        r = repr(v)
    except Exception:
        return '?'
    return r if len(r) <= n else r[:n - 3] + '...'


def _src(n, code):
    try:
        s = ast.get_source_segment(code, n)
    except Exception:
        s = None
    if not s or '\n' in s:
        try:
            s = ast.unparse(n)
        except Exception:
            s = '?'
    return s if len(s) <= 60 else s[:57] + '...'


def _kind(v):
    return {str: 'text', list: 'list', tuple: 'tuple', bytes: 'bytes', range: 'range', dict: 'dictionary',
            set: 'set', frozenset: 'set'}.get(type(v), 'value')


def _ordinal(n):
    return f"{n}{'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


_METHOD_DOC = {
    ('str', 'upper'): 'makes every letter UPPERCASE', ('str', 'lower'): 'makes every letter lowercase',
    ('str', 'title'): 'capitalises the first letter of each word', ('str', 'capitalize'): 'capitalises the first letter',
    ('str', 'strip'): 'removes spaces/newlines from both ends', ('str', 'lstrip'): 'removes spaces from the left end',
    ('str', 'rstrip'): 'removes spaces from the right end',
    ('str', 'split'): 'cuts the text into a list of pieces (at spaces, or at the separator you give)',
    ('str', 'rsplit'): 'cuts the text into pieces, starting from the right',
    ('str', 'join'): 'glues the items of the list together, putting the text before the dot between them',
    ('str', 'replace'): 'swaps every occurrence of the first text for the second',
    ('str', 'find'): 'gives the position of the first match (-1 if absent)',
    ('str', 'index'): 'gives the position of the first match (error if absent)',
    ('str', 'count'): 'counts how many times it appears',
    ('str', 'startswith'): 'checks whether the text begins with it', ('str', 'endswith'): 'checks whether the text ends with it',
    ('str', 'isdigit'): 'checks that every character is a digit', ('str', 'isalpha'): 'checks that every character is a letter',
    ('str', 'isalnum'): 'checks that every character is a letter or digit',
    ('str', 'format'): 'fills the {} holes with the given values', ('str', 'zfill'): 'pads with zeros on the left',
    ('str', 'splitlines'): 'cuts the text into a list of lines', ('str', 'swapcase'): 'flips upper and lower case',
    ('str', 'center'): 'pads both sides to centre the text',
    ('list', 'append'): 'adds the item to the END of the list (the list itself changes)',
    ('list', 'extend'): 'adds every item of another list to the end', ('list', 'insert'): 'puts an item at the given position',
    ('list', 'pop'): 'removes and returns the last item (or the one at the given position)',
    ('list', 'remove'): 'deletes the first item equal to the value', ('list', 'sort'): 'sorts the list in place (smallest first)',
    ('list', 'reverse'): 'reverses the list in place', ('list', 'index'): 'gives the position of the first match',
    ('list', 'count'): 'counts how often it appears', ('list', 'copy'): 'makes a new, separate copy of the list',
    ('list', 'clear'): 'empties the list',
    ('dict', 'get'): 'looks up a key; gives None (or your default) instead of an error when it is missing',
    ('dict', 'keys'): 'gives all the keys', ('dict', 'values'): 'gives all the values',
    ('dict', 'items'): 'gives every (key, value) pair', ('dict', 'update'): 'merges another dict into this one',
    ('dict', 'pop'): 'removes a key and returns its value',
    ('dict', 'setdefault'): 'returns the value for a key, adding it first if it is missing',
    ('dict', 'copy'): 'makes a new, separate copy', ('dict', 'clear'): 'removes everything',
    ('set', 'add'): 'adds an item (duplicates are ignored)', ('set', 'discard'): 'removes an item if it is present',
    ('set', 'union'): 'everything that is in either set', ('set', 'intersection'): 'only what is in both sets',
    ('set', 'difference'): 'what is in the first set but not in the second',
}
_FUNC_DOC = {
    'len': 'counts the items (or characters)', 'sum': 'adds up all the numbers', 'min': 'finds the smallest value',
    'max': 'finds the largest value', 'sorted': 'returns a new list in ascending order (reverse=True gives descending)',
    'reversed': 'walks through the items backwards', 'enumerate': 'pairs each item with its position number (0, 1, 2 ...)',
    'zip': 'pairs up items from several lists, side by side', 'abs': 'drops the minus sign (absolute value)',
    'round': 'rounds to the nearest whole number (or to n decimals)', 'int': 'converts to a whole number (cuts off decimals)',
    'float': 'converts to a decimal number', 'str': 'converts to text',
    'bool': 'converts to True/False (empty or zero means False)', 'list': 'builds a list from the items',
    'tuple': 'builds a tuple from the items', 'set': 'builds a set (duplicates removed)', 'dict': 'builds a dictionary',
    'ord': 'gives the number code of a character', 'chr': 'gives the character for a number code',
    'any': 'is True if at least one item is true', 'all': 'is True only if every item is true',
    'map': 'applies a function to every item', 'filter': 'keeps only the items for which a function is true',
    'isinstance': 'checks whether a value is of a given type', 'type': 'tells the type of a value',
}


def _bound(n, env, code):
    if n is None:
        return None
    ok, v = _val(n, env)
    return (v if ok and isinstance(v, int) else None, _src(n, code))


def _note_subscript(n, env, code, out):
    ok, base = _val(n.value, env)
    kind = _kind(base) if ok else 'sequence'
    me = _src(n, code)
    okv, res = _val(n, env)
    tail = f" → `{_fmt(res)}`" if okv else ''
    sl = n.slice
    if isinstance(sl, ast.Slice):
        lo, up, st = (_bound(x, env, code) for x in (sl.lower, sl.upper, sl.step))
        stv = st[0] if st else None
        if sl.lower is None and sl.upper is None and st and stv == -1:
            out.append(f"`{me}` is a slice [start:stop:step]. Start and stop are empty (= the whole {kind}) and the step is -1, "
                       f"so it walks backwards: the {kind} is REVERSED{tail}")
            return
        bits = ['from the very beginning' if lo is None else
                f"from position {lo[1]}" + (f" ({_ordinal(-lo[0])} from the end)" if lo[0] is not None and lo[0] < 0 else '')]
        bits.append('to the very end' if up is None else
                    f"up to, but not including, position {up[1]}" + (f" ({_ordinal(-up[0])} from the end)" if up[0] is not None and up[0] < 0 else ''))
        if st:
            bits.append('every item' if stv == 1 else f"taking every {_ordinal(stv)} item" if stv and stv > 0
                        else f"walking backwards by {st[1]}")
        out.append(f"`{me}` is a slice [start:stop:step]: {', '.join(bits)}{tail}. Positions start at 0; negative numbers count from the end.")
        return
    okk, k = _val(sl, env)
    if ok and isinstance(base, dict):
        out.append(f"`{me}` looks up the key `{_fmt(k) if okk else _src(sl, code)}` in the dictionary{tail}")
    elif okk and isinstance(k, int):
        pos = ('the FIRST item (positions start at 0)' if k == 0 else
               'the LAST item (negative numbers count from the end)' if k == -1 else
               f"the item at position {k} (counting from 0)" if k >= 0 else f"the {_ordinal(-k)} item from the end")
        out.append(f"`{me}` takes {pos}{tail}")
    else:
        out.append(f"`{me}` picks one item by its position/key `{_src(sl, code)}`{tail}")


def _note_call(n, env, code, out, top_print):
    f = n.func
    okv, res = _val(n, env)
    tail = f" → `{_fmt(res)}`" if okv else ''
    me = _src(n, code)
    if isinstance(f, ast.Name):
        name = f.id
        if name == 'print':
            if not top_print:
                out.append(f"`{me}` shows its values in the Output box, separated by spaces, then starts a new line.")
            return
        if name == 'input':
            out.append(f"`{me}` pauses to read one line typed by the user (here: the next line of the Input box) and returns it as text.")
            return
        if name in env[0] or name in env[1]:
            return
        if name == 'range':
            out.append(f"`{me}` makes the numbers {_fmt(res)}. The stop value is never included; start defaults to 0 and step to 1."
                       if okv else f"`{me}` makes a sequence of numbers (the stop value is never included; start defaults to 0).")
        elif name in _FUNC_DOC:
            out.append(f"`{me}` {_FUNC_DOC[name]}{tail}")
        return
    if isinstance(f, ast.Attribute):
        ok, recv = _val(f.value, env)
        tn = type(recv).__name__ if ok else None
        doc = _METHOD_DOC.get((tn, f.attr))
        if doc is None:
            cands = {d for (t, m), d in _METHOD_DOC.items() if m == f.attr}
            doc = cands.pop() if len(cands) == 1 else None
        if doc:
            who = f" (on {_kind(recv)} `{_fmt(recv, 30)}`)" if ok and tn in ('str', 'list', 'dict', 'set', 'tuple') else ''
            out.append(f"`{me}` {doc}{who}{tail}")


def _note_node(n, env, code, out, top_print):
    t = type(n)
    if t is ast.Subscript:
        _note_subscript(n, env, code, out)
    elif t is ast.Call:
        _note_call(n, env, code, out, top_print)
    elif t is ast.BinOp:
        ok, a = _val(n.left, env)
        okb, b = _val(n.right, env)
        okr, r = _val(n, env)
        me = _src(n, code)
        vals = (f" → `{_fmt(a, 20)}` {_SYM.get(type(n.op), '?')} `{_fmt(b, 20)}` = `{_fmt(r, 30)}`"
                if ok and okb and okr else '')
        if isinstance(n.op, ast.FloorDiv):
            out.append(f"`{me}` is floor division: divide, then round DOWN to a whole number{vals}")
        elif isinstance(n.op, ast.Mod):
            out.append(f"`{me}` is the remainder left after dividing{vals}")
        elif isinstance(n.op, ast.Pow):
            out.append(f"`{me}` raises the left number to the power of the right one{vals}")
        elif isinstance(n.op, ast.Div):
            out.append(f"`{me}` is normal division - the answer is always a decimal (float){vals}")
        elif isinstance(n.op, ast.Add) and ok and isinstance(a, (str, list, tuple)):
            out.append(f"`{me}` joins the two {_kind(a)}s end to end{vals}")
        elif isinstance(n.op, ast.Mult) and ok and okb and (isinstance(a, (str, list)) or isinstance(b, (str, list))):
            out.append(f"`{me}` repeats the {_kind(a if isinstance(a, (str, list)) else b)} that many times{vals}")
    elif t is ast.Compare:
        okr, r = _val(n, env)
        me = _src(n, code)
        ops = {type(o) for o in n.ops}
        res = f" → {'True' if r else 'False'}" if okr else ''
        if ast.In in ops or ast.NotIn in ops:
            out.append(f"`{me}` checks whether `{_src(n.left, code)}` is {'NOT ' if ast.NotIn in ops else ''}found inside `{_src(n.comparators[0], code)}`{res}")
        elif ast.Is in ops or ast.IsNot in ops:
            out.append(f"`{me}` checks if both sides are the very same object (not just equal values){res}")
        elif okr:
            ok, a = _val(n.left, env)
            okb, b = _val(n.comparators[0], env) if len(n.comparators) == 1 else (False, None)
            word = {ast.Eq: 'equal to', ast.NotEq: 'different from', ast.Lt: 'less than', ast.LtE: 'less than or equal to',
                    ast.Gt: 'greater than', ast.GtE: 'greater than or equal to'}.get(type(n.ops[0]), 'compared with')
            out.append(f"`{me}` asks: is `{_fmt(a, 20)}` {word} `{_fmt(b, 20)}`?{res}" if ok and okb and len(n.ops) == 1
                       else f"`{me}` is a comparison{res}")
    elif t is ast.BoolOp:
        okr, r = _val(n, env)
        word = 'and' if isinstance(n.op, ast.And) else 'or'
        out.append(f"`{_src(n, code)}`: `{word}` is "
                   + ("True only when ALL parts are true; Python stops at the first false one" if word == 'and'
                      else "True when ANY part is true; Python stops at the first true one")
                   + (f" → `{_fmt(r)}`" if okr else ''))
    elif t is ast.UnaryOp and isinstance(n.op, ast.Not):
        okr, r = _val(n, env)
        out.append(f"`{_src(n, code)}` flips True to False and False to True" + (f" → `{_fmt(r)}`" if okr else ''))
    elif t is ast.JoinedStr:
        okr, r = _val(n, env)
        out.append(f"`{_src(n, code)}` is an f-string: each {{...}} is replaced by the value of what is inside"
                   + (f" → `{_fmt(r, 60)}`" if okr else ''))
    elif t in (ast.ListComp, ast.SetComp, ast.GeneratorExp, ast.DictComp):
        kind = {ast.ListComp: 'a list', ast.SetComp: 'a set', ast.GeneratorExp: 'a lazy sequence', ast.DictComp: 'a dictionary'}[t]
        g = n.generators[0]
        elt = _src(n.key if t is ast.DictComp else n.elt, code)
        cond = f", keeping only items where `{_src(g.ifs[0], code)}`" if g.ifs else ''
        out.append(f"`{_src(n, code)}` is a comprehension: it builds {kind} by running `{elt}` "
                   f"for each `{_src(g.target, code)}` in `{_src(g.iter, code)}`{cond}")
    elif t is ast.Lambda:
        out.append(f"`{_src(n, code)}` is a tiny unnamed function: it takes `{', '.join(a.arg for a in n.args.args)}` "
                   f"and returns `{_src(n.body, code)}`")
    elif t is ast.IfExp:
        okr, r = _val(n, env)
        out.append(f"`{_src(n, code)}` picks `{_src(n.body, code)}` when `{_src(n.test, code)}` is true, "
                   f"otherwise `{_src(n.orelse, code)}`" + (f" → `{_fmt(r)}`" if okr else ''))


_ROOT_FIELD = {ast.If: 'test', ast.While: 'test', ast.For: 'iter', ast.Assert: 'test', ast.Return: 'value',
               ast.Expr: 'value', ast.Assign: 'value', ast.AugAssign: 'value', ast.AnnAssign: 'value'}


def _walk(root):
    """Breadth-first walk that does not descend into comprehensions or lambdas (their variables are not set yet)."""
    todo = [root]
    while todo:
        n = todo.pop(0)
        yield n
        if not isinstance(n, (ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp, ast.Lambda)):
            todo.extend(ast.iter_child_nodes(n))


def line_notes(stmt, frame, code):
    """Short explanations of the interesting pieces of one statement (max 4)."""
    out = []
    try:
        env = (frame.f_locals, frame.f_globals)
        field = _ROOT_FIELD.get(type(stmt))
        root = getattr(stmt, field, None) if field else None
        if isinstance(stmt, ast.AugAssign):
            tgt = _src(stmt.target, code)
            sym = _SYM.get(type(stmt.op), '?')
            ok, cur = _val(stmt.target, env)
            ok2, add = _val(stmt.value, env)
            extra = f" (now `{_fmt(cur, 20)}` and `{_fmt(add, 20)}`)" if ok and ok2 else ''
            out.append(f"`{tgt} {sym}= ...` is shorthand for `{tgt} = {tgt} {sym} ...`: it "
                       f"{_OPWORD.get(type(stmt.op), 'combines')} the value into `{tgt}` and stores the result back{extra}")
        if isinstance(stmt, ast.Assign):
            for tg in stmt.targets:
                if isinstance(tg, (ast.Tuple, ast.List)):
                    names = [_src(e, code) for e in tg.elts]
                    swap = isinstance(stmt.value, ast.Tuple) and {_src(e, code) for e in stmt.value.elts} == set(names)
                    out.append('`' + ', '.join(names) + '` receive the values on the right in order'
                               + (' - this swaps them' if swap else ' (unpacking)'))
                elif isinstance(tg, ast.Subscript):
                    ok, base = _val(tg.value, env)
                    what = ('stores the value under that key (adds it if the key is new)' if ok and isinstance(base, dict)
                            else 'replaces the item at that position')
                    out.append(f"`{_src(tg, code)} = ...` {what}")
        if isinstance(stmt, ast.For):
            out.append(f"`for {_src(stmt.target, code)} in ...` repeats the indented block once for every item")
        if root is not None:
            top_print = (isinstance(stmt, ast.Expr) and isinstance(root, ast.Call)
                         and isinstance(root.func, ast.Name) and root.func.id == 'print')
            if isinstance(stmt, (ast.If, ast.While, ast.Assert)) and not isinstance(root, (ast.Compare, ast.BoolOp)):
                okr, r = _val(root, env)
                if okr:
                    out.append(f"`{_src(root, code)}` is {'truthy (counts as True)' if r else 'falsy (counts as False)'} → `{_fmt(r)}`")
            for n in _walk(root):
                _note_node(n, env, code, out, top_print and n is root)
    except Exception:
        pass
    seen, uniq = set(), []
    for x in out:
        if x not in seen:
            seen.add(x)
            uniq.append(x if len(x) <= 260 else x[:257] + '...')
    return uniq[:4]


def _explain_base(rec, lines):
    k = rec['kind']
    if k == 'end':
        return 'The program has finished. This is the final state of everything it created.'
    if k == 'call':
        return f"Calls `{rec['fn']}({rec['args']})`. Python jumps into the function and adds a new frame to the call stack."
    if k == 'return':
        return f"`{rec['fn']}` returns `{rec['value']['r']}`. Its local variables are discarded and Python continues in the caller."
    s = rec['src'].strip()
    ch = rec['changes']
    desc = describe(ch)
    nxt = rec.get('next')
    entered = nxt is not None and 1 <= nxt <= len(lines) and indent(lines[nxt - 1]) > indent(rec['src'])
    printed = rec.get('printed', '')
    mfirst = re.match(r'[A-Za-z_]+', s)
    first = mfirst.group(0) if mfirst else ''
    if rec.get('exc'):
        tail = ' Nothing catches it, so the program stops here.' if rec.get('fatal') else ' An except block catches it.'
        return f"Error! `{short(rec['exc'], 90)}` is raised by `{short(s, 50)}`." + tail
    if first == 'def':
        return f"Defines the function `{s[3:].split('(')[0].strip()}`. Python only remembers it now; the body runs when it is called."
    if first == 'class':
        return f"Defines the class `{s[5:].split('(')[0].split(':')[0].strip()}`."
    if first == 'for':
        if entered:
            return "Loop: takes the next item" + (f" - {desc}." if desc else ".") + " The indented body runs."
        return "Loop: no items left, so the loop ends and Python continues after it."
    if first == 'while':
        cond = s[5:].rstrip(':').strip()
        return (f"Checks `{short(cond, 40)}` - it is True, so the loop body runs." if entered
                else f"Checks `{short(cond, 40)}` - it is False, so the loop ends.")
    if first in ('if', 'elif'):
        cond = s[len(first):].rstrip(':').strip()
        return (f"Tests `{short(cond, 40)}` - True, so the indented block runs." if entered
                else f"Tests `{short(cond, 40)}` - False, so Python skips this block.")
    if first == 'else':
        return "Reaches `else`: earlier conditions were not met, so this block runs."
    if first == 'try':
        return "Starts a `try` block. If an error happens inside, Python jumps to `except`."
    if first == 'except':
        return "An error happened and this `except` block handles it."
    if first == 'return':
        e = s[6:].strip() or 'None'
        return f"Works out `{short(e, 40)}` and is about to leave the function with that value."
    if first in ('break', 'continue', 'pass'):
        return {'break': "`break` leaves the loop immediately.",
                'continue': "`continue` skips to the next loop iteration.",
                'pass': "`pass` does nothing."}[first]
    if first in ('import', 'from'):
        return f"Runs `{short(s, 50)}` to make a module available."
    if printed and first == 'print':
        return f"Prints `{short(printed)}` to the Output box."
    text = (f"{desc[0].upper()}{desc[1:]}." if desc else f"Evaluates `{short(s, 50)}`.")
    if printed:
        text += f" It prints `{short(printed)}` to the Output box."
    return text


def explain(rec, lines):
    text = _explain_base(rec, lines)
    if rec['kind'] == 'line' and rec.get('notes'):
        text += ''.join('\n\u2022 ' + x for x in rec['notes'])
    return text


def run(code, stdin_text):
    lines = code.split('\n')
    steps = []
    state = {'events': 0, 'stack': [], 'trunc': False}
    pend = {}
    stmts = {}

    class Out(io.StringIO):
        def write(self, t):
            if steps:
                steps[-1]['printed'] = steps[-1].get('printed', '') + t
            if self.tell() > MAX_OUT:
                raise RuntimeError('Too much output')
            return super().write(t)

    out = Out()
    feed = iter(stdin_text.split('\n') if stdin_text else [])

    def fake_input(prompt=''):
        out.write(str(prompt))
        try:
            v = next(feed)
        except StopIteration:
            raise EOFError('input() was called but there are no more lines in the "Input for input()" box')
        if str(prompt):
            out.write('\n')
        return v

    def src_line(n):
        return lines[n - 1] if 1 <= n <= len(lines) else ''

    def new_rec(kind, frame, **kw):
        if len(steps) >= MAX_STEPS:
            state['trunc'] = True
            return None
        top = frame.f_code.co_name == '<module>'
        ns = frame.f_globals if top else frame.f_locals
        rec = {'kind': kind, 'line': frame.f_lineno, 'fn': frame.f_code.co_name,
               'src': src_line(frame.f_lineno), 'stack': list(state['stack']), 'before': snap(ns)}
        rec.update(kw)
        if kind == 'line' and frame.f_lineno in stmts:
            rec['notes'] = line_notes(stmts[frame.f_lineno], frame, code)
        steps.append(rec)
        return rec

    def frames_of(frame):
        """Every live user frame, outermost first: [{'name', 'vars', 'cur'}] - the data behind the Frames & Objects view."""
        chain, f = [], frame
        while f is not None:
            if f.f_code.co_filename == '<user>' and f.f_code.co_name not in NOISE:
                chain.append(f)
            f = f.f_back
        chain.reverse()
        out = []
        for f in chain[-12:]:
            top = f.f_code.co_name == '<module>'
            out.append({'name': 'Global frame' if top else f.f_code.co_name, 'vars': snap(f.f_globals if top else f.f_locals), 'cur': f is frame})
        return out

    def close(frame, rec, nxt):
        top = frame.f_code.co_name == '<module>'
        rec['after'] = snap(frame.f_globals if top else frame.f_locals)
        if not top:
            rec['glob'] = snap(frame.f_globals)
        rec['frames'] = frames_of(frame)
        rec['next'] = nxt

    detect = not re.search(r'\b(random|time|datetime|secrets|uuid|os|threading|input)\b', code)
    seen = {}

    def frame_sig(f):
        parts, total = [], 0
        spaces = (f.f_locals,) if f.f_code.co_name == '<module>' else (f.f_locals, f.f_globals)
        for ns in spaces:
            for k, v in list(ns.items()):
                if k.startswith('__') or isinstance(v, type(sys)) or callable(v):
                    continue
                try:
                    d = getattr(v, '__dict__', None)
                    r = repr(d if isinstance(d, dict) else v)
                except Exception:
                    return None
                total += len(r)
                if total > 4000:
                    return None
                parts.append((k, r))
        return (id(f.f_code), f.f_lineno, tuple(parts))

    def check_loop(frame):
        sigs, f, depth = [], frame, 0
        while f is not None:
            if f.f_code.co_filename == '<user>':
                s = frame_sig(f)
                depth += 1
                if s is None or depth > 25:
                    return
                sigs.append(s)
            f = f.f_back
        key = hash(tuple(sigs))
        c = seen.get(key, 0) + 1
        if len(seen) > 20000:
            seen.clear()
        seen[key] = c
        if c >= REPEAT_LIMIT:
            raise InfiniteLoop(f"line {frame.f_lineno} ran {c} times and none of the variables changed, so this loop can never finish")

    def detach(frame):
        state['trunc'] = True
        sys.settrace(None)
        f = frame
        while f is not None:
            if f.f_code.co_filename == '<user>':
                f.f_trace = None
            f = f.f_back
        return None

    def tracer(frame, event, arg):
        if frame.f_code.co_filename != '<user>':
            return None
        name = frame.f_code.co_name
        state['events'] += 1
        n = state['events']
        if n > TRACE_LIMIT:
            return detach(frame)
        if detect and event == 'line' and (n < 3000 or n % 4 == 0):
            check_loop(frame)
        if event == 'call':
            if name in NOISE:
                return None
            if name == '<module>':
                state['stack'].append('<module>')
                return tracer
            code_ = frame.f_code
            args = ', '.join(f"{a}={ser(frame.f_locals[a])['r']}" for a in code_.co_varnames[:code_.co_argcount] if a in frame.f_locals)
            state['stack'].append(f"{name}({args})")
            rec = new_rec('call', frame, args=args)
            if rec:
                rec['after'] = rec['before']
                rec['frames'] = frames_of(frame)
            return tracer
        if event == 'line':
            old = pend.pop(frame, None)
            if old and old['line'] == frame.f_lineno and old['kind'] == 'line':
                pend[frame] = old      # same line again (comprehension / one-line loop): still one step
                return tracer
            if old:
                close(frame, old, frame.f_lineno)
            rec = new_rec('line', frame)
            if rec:
                pend[frame] = rec
        elif event == 'exception':
            exc, val, _ = arg
            if exc is not StopIteration:
                rec = pend.get(frame)
                if rec:
                    rec['exc'] = f"{exc.__name__}: {val}"
        elif event == 'return':
            old = pend.pop(frame, None)
            if old:
                close(frame, old, None)
            if name != '<module>' and not (old and old.get('exc')):
                rec = new_rec('return', frame, value=ser(arg))
                if rec:
                    rec['after'] = rec['before']
                    rec['frames'] = frames_of(frame)
            if state['stack']:
                state['stack'].pop()
        return tracer

    def result(**kw):
        base = {'ok': True, 'steps': [], 'output': out.getvalue(), 'error': None, 'last': None,
                'final': {}, 'trunc': False}
        base.update(kw)
        return json.dumps(base)

    try:
        tree = ast.parse(code, '<user>')
        for node in ast.walk(tree):
            if isinstance(node, ast.stmt):
                stmts.setdefault(node.lineno, node)
    except (SyntaxError, ValueError, RecursionError, MemoryError) as e:
        et = type(e).__name__
        msg = getattr(e, 'msg', None) or ('The code is too deeply nested to read.' if et in ('RecursionError', 'MemoryError') else str(e))
        return result(ok=False, error={'type': et, 'msg': msg, 'line': getattr(e, 'lineno', None), 'hint': HINTS.get(et, HINTS['SyntaxError'])})

    body = tree.body
    last_expr = None
    if body and isinstance(body[-1], ast.Expr):
        last_expr = ast.Expression(body[-1].value)
        body = body[:-1]
    try:                                           # some errors (return outside a function, break outside a loop ...) only show up when compiling
        code_obj = compile(ast.Module(body=body, type_ignores=[]), '<user>', 'exec')
        if last_expr is not None:
            compile(last_expr, '<user>', 'eval')
    except (SyntaxError, ValueError, RecursionError, MemoryError) as e:
        et = type(e).__name__
        return result(ok=False, error={'type': et, 'msg': getattr(e, 'msg', None) or str(e), 'line': getattr(e, 'lineno', None), 'hint': HINTS.get(et, HINTS['SyntaxError'])})
    g = {'__name__': '__main__', 'input': fake_input}
    last_val = None
    err = None
    old_o, old_e = sys.stdout, sys.stderr
    sys.stdout = sys.stderr = out
    sys.settrace(tracer)
    try:
        exec(code_obj, g)
        if last_expr is not None:
            last_val = eval(compile(last_expr, '<user>', 'eval'), g)
    except SystemExit:
        pass
    except BaseException as e:
        line = None
        tb = e.__traceback__
        while tb:
            if tb.tb_frame.f_code.co_filename == '<user>':
                line = tb.tb_lineno
            tb = tb.tb_next
        et = type(e).__name__
        err = {'type': et, 'msg': str(e), 'line': line, 'hint': HINTS.get(et, '')}
        for rec in reversed(steps):                # mark the step that really raised the uncaught error (not an earlier handled one)
            if rec.get('exc') and rec.get('line') == line:
                rec['fatal'] = True
                break
        else:
            last = steps[-1] if steps else None
            if last and last.get('line') == line and last['kind'] == 'line':
                last['exc'] = f"{et}: {e}"
                last['fatal'] = True
    finally:
        sys.settrace(None)
        sys.stdout, sys.stderr = old_o, old_e

    if err is None and steps:
        end_vars = snap(g)
        steps.append({'kind': 'end', 'line': None, 'fn': '<module>', 'src': '', 'stack': ['<module>'], 'before': end_vars, 'after': end_vars,
                      'frames': [{'name': 'Global frame', 'vars': end_vars, 'cur': True}]})
    for rec in steps:
        if 'after' not in rec:
            rec['after'] = rec['before']
        b, a = rec['before'], rec['after']
        ch = []
        for k, v in a.items():
            if k not in b:
                ch.append({'name': k, 'how': 'new', 'new': v})
            elif b[k] != v:
                ch.append({'name': k, 'how': 'changed', 'old': b[k], 'new': v})
        for k in b:
            if k not in a:
                ch.append({'name': k, 'how': 'gone', 'old': b[k]})
        rec['changes'] = ch
        rec['text'] = explain(rec, lines)
        rec['changed'] = [c['name'] for c in ch]
        del rec['before'], rec['changes']
    final = snap(g)
    return result(ok=err is None, steps=steps, error=err,
                  last=ser(last_val) if last_val is not None else None,
                  final=final, trunc=state['trunc'])
