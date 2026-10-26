"""Unit tests for the Python lab runner (assets/py/lab_runner.py): tracing, explanations, safety."""
import ast
import json
import time


def run(lab_runner, code, stdin=''):
    return json.loads(lab_runner.run(code, stdin))


def texts(d):
    return [s['text'] for s in d['steps']]


def test_simple_program_runs_and_traces(lab_runner):
    d = run(lab_runner, 'x = 2\ny = x * 3\nprint(y)\ny\n')
    assert d['ok'] and d['output'] == '6\n'
    assert d['last']['r'] == '6'
    assert [s['line'] for s in d['steps']] == [1, 2, 3, 4]      # the last bare expression is a step too
    assert d['final']['y']['r'] == '6'


def test_slice_is_explained(lab_runner):
    d = run(lab_runner, 's = "Mahsa and the bear"\nprint(s[::-1])\n')
    step = d['steps'][1]['text']
    assert 'REVERSED' in step and 'slice' in step and "raeb eht dna ashaM" in step


def test_index_and_negative_index_explained(lab_runner):
    d = run(lab_runner, 'a = [4, 8, 15]\nf = a[0]\nl = a[-1]\n')
    t = texts(d)
    assert 'FIRST item' in t[1] and 'LAST item' in t[2]


def test_slice_bounds_explained(lab_runner):
    d = run(lab_runner, 'a = [1, 2, 3, 4, 5]\nb = a[1:3]\nc = a[::2]\n')
    t = texts(d)
    assert 'up to, but not including, position 3' in t[1]
    assert 'every 2nd item' in t[2]


def test_operators_methods_and_builtins_explained(lab_runner):
    d = run(lab_runner, 'x = 17 // 5\ny = 17 % 5\nw = "a b".split()\nn = len(w)\nz = 2 ** 10\n')
    t = texts(d)
    assert 'floor division' in t[0] and 'remainder' in t[1] and 'cuts the text' in t[2]
    assert 'counts the items' in t[3] and 'power' in t[4]


def test_if_condition_notes(lab_runner):
    d = run(lab_runner, 'x = 3\nif x > 2 and x < 10:\n    print("ok")\n')
    t = d['steps'][1]['text']
    assert 'True' in t and 'and' in t


def test_comprehension_is_a_single_step_and_explained(lab_runner):
    d = run(lab_runner, 'nums = [1, 2, 3, 4]\nev = [n for n in nums if n % 2 == 0]\n')
    assert [s['line'] for s in d['steps']] == [1, 2]
    assert 'comprehension' in d['steps'][1]['text']


def test_input_is_explained_and_not_echoed(lab_runner):
    d = run(lab_runner, 'name = input("Name? ")\nprint("Hi", name)\n', 'Asha')
    assert d['output'] == 'Name? \nHi Asha\n'.replace('Name? \n', 'Name? ') or d['output'].startswith('Name? ')
    assert 'Asha' not in d['output'].split('\n')[0]
    assert 'reads' in d['steps'][0]['text'] or 'pauses to read' in d['steps'][0]['text']


def test_error_has_line_and_hint(lab_runner):
    d = run(lab_runner, 'nums = [1]\nprint(nums[5])\n')
    assert not d['ok'] and d['error']['type'] == 'IndexError' and d['error']['line'] == 2 and d['error']['hint']


def test_syntax_error_reported(lab_runner):
    d = run(lab_runner, 'x = (\n')
    assert not d['ok'] and d['error']['type'] == 'SyntaxError' and d['error']['line'] == 1


def test_infinite_loop_is_detected_fast(lab_runner):
    t0 = time.time()
    d = run(lab_runner, 'while True:\n    pass\n')
    assert d['error']['type'] == 'InfiniteLoop'
    assert time.time() - t0 < 5


def test_loop_that_changes_state_is_not_flagged(lab_runner):
    d = run(lab_runner, 'i = 0\nwhile i < 5000:\n    i += 1\ni\n')
    assert d['ok'] and d['last']['r'] == '5000'


def test_large_calculation_is_allowed(lab_runner):
    d = run(lab_runner, 'total = 0\nfor i in range(600000):\n    total += i\ntotal\n')
    assert d['ok'] and d['last']['r'] == '179999700000'
    assert d['trunc'] is True            # steps are capped, the program still finished


def test_recursion_stack_and_return_steps(lab_runner):
    d = run(lab_runner, 'def f(n):\n    return 1 if n < 2 else n * f(n - 1)\nf(4)\n')
    kinds = {s['kind'] for s in d['steps']}
    assert {'call', 'return', 'line'} <= kinds and d['last']['r'] == '24'


def test_explainer_never_runs_user_code(lab_runner):
    calls = []

    class Evil:
        def __add__(self, other):
            calls.append('add')
            return 1

        def __repr__(self):
            calls.append('repr')
            return 'Evil()'

    node = ast.parse('a + 1', mode='eval').body
    ok, val = lab_runner._val(node, ({'a': Evil()}, {}))
    assert (ok, val) == (False, None) and calls == []


def test_explainer_refuses_huge_values(lab_runner):
    node = ast.parse('"x" * 100000', mode='eval').body
    assert lab_runner._val(node, ({}, {})) == (False, None)
    node = ast.parse('2 ** 100000', mode='eval').body
    assert lab_runner._val(node, ({}, {})) == (False, None)
