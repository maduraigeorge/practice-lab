"""Code suggestions (assets/py/completer.py): they come from the real objects left behind by the last run of the lab."""
import json
import runpy
from pathlib import Path

import pytest

PY = Path(__file__).resolve().parents[2] / 'assets' / 'py'


@pytest.fixture()
def lab():
    runner = runpy.run_path(str(PY / 'lab_runner.py'))
    comp = runpy.run_path(str(PY / 'completer.py'))
    comp['complete'].__globals__['_lab'] = runner['run'].__globals__      # what python-worker.js does

    class Lab:
        def run(self, code, stdin=''):
            return json.loads(runner['run'](code, stdin))

        def items(self, text):
            return json.loads(comp['complete'](text))

        def names(self, text):
            return [i[0] for i in self.items(text)]

        def details(self, text):
            return {n: d for n, _, d in self.items(text)}

        def detail_of(self, f):
            return comp['_detail'](f)

        def ns(self):
            return runner['run'].__globals__['LAST_NS']

        def sigs(self, name):
            return json.loads(comp['sigs'](name))
    return Lab()


def test_tuple_variable_suggests_only_tuple_methods(lab):
    lab.run('t = (1, 2, 3)\n')
    assert lab.names('t.') == ['count', 'index']
    assert lab.names('t.c') == ['count']


def test_suggestions_still_work_when_the_line_being_typed_is_an_error(lab):
    lab.run('t = (1, 2, 3)\n')                       # the editor then runs "t = ...\nt." which cannot even be parsed
    assert lab.run('t = (1, 2, 3)\nt.')['ok'] is False
    assert lab.names('t.') == ['count', 'index']     # the objects of the last good run are still there


def test_variables_defined_before_a_crash_are_available(lab):
    assert lab.run('s = set(range(10))\ns.zzz\n')['ok'] is False
    assert 'add' in lab.names('s.a')
    assert lab.details('s.a')['add']['req'] == 1


@pytest.mark.parametrize('code,var,expect', [
    ('l = [1]', 'l', 'append'), ('d = {1: 2}', 'd', 'items'), ('s = {1, 2}', 's', 'union'),
    ('x = "hi"', 'x', 'upper'), ('n = 5', 'n', 'bit_length')])
def test_each_type_gets_its_own_methods(lab, code, var, expect):
    lab.run(code + '\n')
    got = lab.names(var + '.')
    assert expect in got
    assert 'count' not in got or var in ('l', 'x')


def test_own_classes_and_modules(lab):
    lab.run('import math\nclass Dog:\n    def bark(self, times=1): pass\nd = Dog()\n')
    assert 'sqrt' in lab.names('math.sq')
    d = lab.details('d.')['bark']
    assert d['sig'] == '(times=1)' and d['req'] == 0 and d['opt'] == 1


def test_names_come_from_the_program(lab):
    lab.run('total = 3\ndef area(w, h=1, *rest):\n    return w\n')
    assert lab.names('tot') == ['total']
    d = lab.details('are')['area']
    assert d['sig'] == '(w, h=1, *rest)' and d['req'] == 1 and d['opt'] == 1 and d['var'] is True
    assert 'print' in lab.names('pri')
    assert 'input' in lab.names('inp') and lab.details('inp')['input']['sig']      # the real input(), not the lab's stand-in


def test_literals_and_unknown_names(lab):
    assert lab.names('(1, 2).') == ['count', 'index']
    assert 'upper' in lab.names('"abc".')
    assert lab.names('nope.') == []


def test_completion_never_runs_code(lab):
    lab.run('hits = []\ndef f():\n    hits.append(1)\n    return (1, 2)\n')
    assert lab.names('f().') == []
    assert lab.ns()['hits'] == []                    # f() was never called


def test_signatures_for_builtin_types_and_functions(lab):
    assert lab.sigs('set')['add']['req'] == 1
    assert lab.sigs('tuple')['count']['sig'] == '(value)'      # no '/' marker shown
    assert lab.sigs('builtins')['len']['sig'] == '(obj)'
    assert lab.sigs('nonsense') == {}
    assert lab.details('t.') == {}                   # no program has run: nothing to suggest


def test_builtins_without_their_own_signature_still_explain_their_arguments(lab, monkeypatch):
    """Pyodide's Python 3.12 gives set.add and friends no signature; make this Python behave the same and check the fallback."""
    import inspect
    real = inspect.signature

    def no_builtin_sigs(f, *a, **k):
        if getattr(f, '__self__', None) is not None and not hasattr(f, '__wrapped__') and type(f).__name__ == 'builtin_function_or_method':
            raise ValueError('no signature found for builtin')
        return real(f, *a, **k)
    monkeypatch.setattr(inspect, 'signature', no_builtin_sigs)
    lab.run('s = set(range(10))\nd = {}\n')
    add = lab.details('s.a')['add']
    assert add['sig'] == '(element)' and [a['n'] for a in add['args']] == ['element'] and add['req'] == 1 and add['opt'] == 0 and add['doc']
    assert lab.details('s.un')['union']['var'] is True
    keys = lab.details('d.k')['keys']
    assert keys['sig'] == '()' and keys['req'] == 0                  # "no arguments"


def test_every_argument_is_described(lab):
    lab.run('t = (1, 2)\n')
    index = lab.details('t.in')['index']
    assert index['sig'].startswith('(value, start=0, stop=')
    assert [(a['n'], a['k']) for a in index['args']] == [('value', 'req'), ('start', 'opt'), ('stop', 'opt')]
    assert index['args'][1]['dv'] == '0'
    p = lab.details('pri')['print']
    assert p['sig'] == "(*args, sep=' ', end='\\n', file=None, flush=False)"
    assert p['args'][0] == {'n': '*args', 'k': 'var'}
    assert all(a['kwonly'] for a in p['args'][1:])


def test_position_only_arguments_are_flagged_so_the_popup_can_say_so(lab):
    lab.run('d = {}\ndef f(a, *, b, c=1): pass\n')
    get = lab.details('d.g')['get']
    assert get['sig'] == '(key, default=None)' and all(a['posonly'] for a in get['args'])     # '/' hidden, but the popup warns: no default=...
    detail = lab.detail_of(lab.ns()['f'])
    assert detail['sig'] == '(a, *, b, c=1)'
    kinds = {a['n']: (a['k'], a['kwonly']) for a in detail['args']}
    assert kinds == {'a': ('req', False), 'b': ('req', True), 'c': ('opt', True)}


def test_an_unreadable_signature_means_no_signature_at_all(lab, monkeypatch):
    import inspect

    def f():
        pass
    f.__doc__ = 'f($self, x, ...)\nDoes a thing.'
    monkeypatch.setattr(inspect, 'signature', lambda *a, **k: (_ for _ in ()).throw(ValueError('no signature')))
    d = lab.detail_of(f)
    assert d['sig'] is None and d['args'] is None and d['req'] is None      # so the editor adds no brackets and guesses no placeholders


def test_print_is_described_even_when_python_gives_it_no_signature(lab, monkeypatch):
    """Python 3.10 documents print as print(value, ..., sep=' ', ...), which is not a valid signature: the known table is used."""
    import inspect
    real = inspect.signature

    def fail_for_print(f, *a, **k):
        if getattr(f, '__name__', '') == 'print':
            raise ValueError('no signature found for builtin')
        return real(f, *a, **k)
    monkeypatch.setattr(inspect, 'signature', fail_for_print)
    d = lab.detail_of(print)
    assert d['sig'] == "(*args, sep=' ', end='\\n', file=None, flush=False)"
    assert d['req'] == 0 and d['opt'] == 4 and d['var'] is True
