"""Interactive Python shell that runs inside the Pyodide worker (next to lab_runner.py, in its own namespace).

Every function returns a JSON string so the worker can pass it straight to the page:
  push(line, stdin_text)  -> {more, out, err}      one line typed at the prompt (more = the statement continues)
  complete(text)          -> [[name, kind], ...]   suggestions for the end of `text`, taken from the LIVE objects
  reset()                 -> {text}                forget every variable, return the banner
  banner()                -> {text}
"""
import builtins
import code
import contextlib
import inspect
import io
import json
import keyword
import re
import sys
import ast

NS = {}
_con = None
_queue = []          # lines for input(), taken from the lab's Input box
_last_stdin = None


def banner():
    return json.dumps({'text': 'Python %s (Pyodide) - an interactive shell.\n'
                               'Your variables stay alive between lines. Press Tab to complete names and methods.' % sys.version.split()[0]})


def reset():
    global _con, _last_stdin
    NS.clear()
    NS.update({'__name__': '__main__', '__doc__': None})
    _con = code.InteractiveConsole(NS)
    _last_stdin = None
    return banner()


_OWN_FRAME = re.compile(r'  File "[^"]*repl\.py", line \d+, in \w+\n(?:    .*\n)?')


def _input(prompt=''):
    if not _queue:
        raise EOFError('No more input. Add a line to the Input box, then try again.')
    value = _queue.pop(0)
    print(str(prompt) + value)
    return value


def push(line, stdin_text=''):
    global _last_stdin
    if stdin_text != _last_stdin:                      # the Input box changed: start reading it from the top
        _last_stdin = stdin_text
        _queue[:] = stdin_text.split('\n') if stdin_text else []
    out, err = io.StringIO(), io.StringIO()
    old_input, old_hook = builtins.input, sys.displayhook
    builtins.input, sys.displayhook = _input, sys.__displayhook__
    try:
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            more = _con.push(line)
    except SystemExit:
        _con.resetbuffer()
        more = False
        err.write('The shell cannot be closed. Use Reset to start again.\n')
    except BaseException as e:                         # e.g. KeyboardInterrupt-like errors: keep the shell alive
        _con.resetbuffer()
        more = False
        err.write('%s: %s\n' % (type(e).__name__, e))
    finally:
        builtins.input, sys.displayhook = old_input, old_hook
    text = _OWN_FRAME.sub('', err.getvalue())          # hide the shell's own input() frame from tracebacks
    return json.dumps({'more': bool(more), 'out': out.getvalue(), 'err': text})


# ---------------------------------------------------------------- completion
_WORD = re.compile(r'[A-Za-z_]\w*$')
_CHAIN = re.compile(r'[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$')
_PAIRS = {')': '(', ']': '[', '}': '{'}


def _resolve(chain):
    """Look a dotted name such as `t` or `os.path` up WITHOUT calling anything. Returns (found, value)."""
    first, *rest = chain.split('.')
    if first in NS:
        obj = NS[first]
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
        items.append([n, kind + (' method' if callable(v) else ' attribute')])
    return items


def _names(word):
    seen, items = set(), []
    for n, v in list(NS.items()):
        if not n.startswith('__') and n.lower().startswith(word.lower()) and n != word and n not in seen:
            seen.add(n)
            items.append([n, 'yours (%s)' % _kind_of(v)])
    for n in dir(builtins):
        if not n.startswith('_') and n.lower().startswith(word.lower()) and n != word and n not in seen:
            seen.add(n)
            items.append([n, 'built-in'])
    for n in keyword.kwlist:
        if n.lower().startswith(word.lower()) and n != word and n not in seen:
            seen.add(n)
            items.append([n, 'keyword'])
    return items


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


reset()
