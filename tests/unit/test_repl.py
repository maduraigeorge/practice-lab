"""The interactive shell (assets/py/repl.py): state between lines, multi-line blocks, errors, input() and live completion."""
import json
import runpy
from pathlib import Path

import pytest

REPL = Path(__file__).resolve().parents[2] / 'assets' / 'py' / 'repl.py'


@pytest.fixture()
def sh():
    g = runpy.run_path(str(REPL))
    g['reset']()
    return g


def push(sh, line, stdin=''):
    return json.loads(sh['push'](line, stdin))


def names(sh, text):
    return [item[0] for item in json.loads(sh['complete'](text))]


def test_variables_live_between_lines(sh):
    push(sh, 't = (1, 2, 3)')
    assert push(sh, 't')['out'] == '(1, 2, 3)\n'
    assert push(sh, 'print(len(t))')['out'] == '3\n'


def test_multiline_block_continues_until_blank_line(sh):
    assert push(sh, 'for i in range(2):')['more'] is True
    assert push(sh, '    print(i)')['more'] is True
    r = push(sh, '')
    assert r['more'] is False and r['out'] == '0\n1\n'


def test_errors_go_to_err_and_shell_survives(sh):
    r = push(sh, '1/0')
    assert 'ZeroDivisionError' in r['err'] and r['more'] is False
    assert push(sh, '2+2')['out'] == '4\n'
    assert 'cannot be closed' in push(sh, 'exit()')['err']


def test_input_reads_the_input_box(sh):
    assert push(sh, 'n = input("Name? ")', 'Asha')['out'] == 'Name? Asha\n'
    assert push(sh, 'n', 'Asha')['out'] == "'Asha'\n"
    r = push(sh, 'input()', 'Asha')
    assert 'No more input' in r['err'] and 'repl.py' not in r['err']


def test_tuple_variable_completes_to_tuple_methods_only(sh):
    push(sh, 't = (1, 2, 3)')
    assert names(sh, 't.') == ['count', 'index']
    assert names(sh, 't.c') == ['count']


@pytest.mark.parametrize('src,expect', [
    ('l = [1]', 'append'), ('d = {1: 2}', 'items'), ('s = {1, 2}', 'union'), ('x = "hi"', 'upper'), ('n = 5', 'bit_length')])
def test_each_type_gets_its_own_methods(sh, src, expect):
    push(sh, src)
    var = src.split()[0]
    got = names(sh, var + '.')
    assert expect in got
    assert 'count' not in got or var in ('l', 'x')       # tuple-only names do not leak into other types


def test_literals_and_names(sh):
    assert names(sh, '(1, 2).') == ['count', 'index']
    assert 'upper' in names(sh, '"abc".')
    push(sh, 'total = 3')
    assert names(sh, 'tot') == ['total']
    assert 'print' in names(sh, 'pri')
    assert names(sh, 'nope.') == []


def test_completion_does_not_run_code(sh):
    push(sh, 'hits = []')
    push(sh, 'def f():\n    hits.append(1)\n    return (1, 2)\n')
    assert names(sh, 'f().') == []                       # calls are never evaluated
    assert push(sh, 'hits')['out'] == '[]\n'


def details(sh, text):
    return {n: d for n, _, d in json.loads(sh['complete'](text))}


def test_suggestions_carry_syntax_and_argument_counts(sh):
    push(sh, 't = (1, 2, 3)')
    d = details(sh, 't.')
    assert d['count']['sig'] == '(value, /)' and d['count']['req'] == 1 and d['count']['opt'] == 0
    assert d['index']['req'] == 1 and d['index']['opt'] == 2      # index(value, start=0, stop=maxsize)
    assert d['count']['doc']


def test_user_functions_and_builtins_show_their_arguments(sh):
    push(sh, 'def area(w, h=1, *rest):\n    return w * h\n')
    d = details(sh, 'are')['area']
    assert d['sig'] == '(w, h=1, *rest)' and d['req'] == 1 and d['opt'] == 1 and d['var'] is True
    assert details(sh, 'le')['len']['sig'] == '(obj, /)'
    assert details(sh, 'pri')['print']['sig']                    # falls back to the help text if there is no signature


def test_plain_values_have_no_signature(sh):
    push(sh, 'xy = 5')
    assert details(sh, 'x')['xy'] is None
