/* Example programs and practice exercises for the Flowchart & Pseudocode lab.
 * A practice exercise has tests: the program is run once per test with `input` and its output (split on whitespace)
 * must equal `expected` (split on whitespace). */

export const EXAMPLES = [
  { id: 'py-sum', title: 'Python: sum of 1 to N', input: '10', code:
`n = int(input())
total = 0
for i in range(1, n + 1):
    total += i
print("Sum is", total)
` },
  { id: 'py-grade', title: 'Python: if / elif / else', input: '72', code:
`marks = int(input())
if marks >= 90:
    print("Grade A")
elif marks >= 60:
    print("Grade B")
else:
    print("Try again")
` },
  { id: 'py-while', title: 'Python: while loop', input: '27', code:
`n = int(input())
steps = 0
while n != 1:
    if n % 2 == 0:
        n = n // 2
    else:
        n = 3 * n + 1
    steps += 1
print("Steps:", steps)
` },
  { id: 'hello', title: 'Hello & a little maths', input: '', code:
`// Statements run top to bottom
BEGIN
  price = 250
  qty = 3
  total = price * qty
  OUTPUT "Total:", total
END
` },
  { id: 'sum', title: 'Sum of 1 to N (FOR loop)', input: '10', code:
`INPUT n
total = 0
FOR i = 1 TO n
  total = total + i
ENDFOR
OUTPUT "Sum is", total
` },
  { id: 'evenodd', title: 'Even or odd (IF)', input: '7', code:
`INPUT n
IF n MOD 2 = 0 THEN
  OUTPUT n, "is even"
ELSE
  OUTPUT n, "is odd"
ENDIF
` },
  { id: 'grade', title: 'Grade (IF / ELSE IF)', input: '82', code:
`INPUT marks
IF marks >= 90 THEN
  grade = "A"
ELSE IF marks >= 75 THEN
  grade = "B"
ELSE IF marks >= 50 THEN
  grade = "C"
ELSE
  grade = "Fail"
ENDIF
OUTPUT "Grade:", grade
` },
  { id: 'countdown', title: 'Count down (WHILE)', input: '', code:
`n = 5
WHILE n > 0 DO
  OUTPUT n
  n = n - 1
ENDWHILE
OUTPUT "Lift off!"
` },
  { id: 'double', title: 'Double until 100 (REPEAT)', input: '', code:
`x = 1
REPEAT
  x = x * 2
  OUTPUT x
UNTIL x >= 100
` },
  { id: 'max', title: 'Largest in a list (FOR EACH)', input: '', code:
`marks = [42, 87, 65, 91, 58]
largest = marks[0]
FOR EACH m IN marks DO
  IF m > largest THEN
    largest = m
  ENDIF
ENDFOR
OUTPUT "Largest:", largest
` },
  { id: 'table', title: 'Multiplication table', input: '7', code:
`INPUT n
FOR i = 1 TO 10
  OUTPUT n, "x", i, "=", n * i
ENDFOR
` },
];

export const PRACTICE = [
  { id: 'p-sum10', title: 'Sum 1 to 10', prompt: 'Output the sum of the numbers 1 to 10.',
    tests: [{ input: '', expected: '55' }], hint: 'Start total at 0, then FOR i = 1 TO 10 and add i each time.',
    starter: '// Output the sum of 1 to 10\n', solution: 'total = 0\nFOR i = 1 TO 10\n  total = total + i\nENDFOR\nOUTPUT total\n' },
  { id: 'p-evenodd', title: 'Even or odd', prompt: 'Read a number. Output the word even or odd.',
    tests: [{ input: '7', expected: 'odd' }, { input: '10', expected: 'even' }, { input: '0', expected: 'even' }],
    hint: 'n MOD 2 is 0 for even numbers.', starter: 'INPUT n\n', solution: 'INPUT n\nIF n MOD 2 = 0 THEN\n  OUTPUT "even"\nELSE\n  OUTPUT "odd"\nENDIF\n' },
  { id: 'p-countdown', title: 'Count down', prompt: 'Read n and output n, n-1, … down to 1 (one per line).',
    tests: [{ input: '5', expected: '5 4 3 2 1' }, { input: '1', expected: '1' }], hint: 'WHILE n > 0 … n = n - 1',
    starter: 'INPUT n\n', solution: 'INPUT n\nWHILE n > 0 DO\n  OUTPUT n\n  n = n - 1\nENDWHILE\n' },
  { id: 'p-factorial', title: 'Factorial', prompt: 'Read n and output n! (n × (n-1) × … × 1). 0! is 1.',
    tests: [{ input: '5', expected: '120' }, { input: '1', expected: '1' }, { input: '0', expected: '1' }], hint: 'Start result at 1 and multiply by i inside a FOR loop.',
    starter: 'INPUT n\n', solution: 'INPUT n\nresult = 1\nFOR i = 1 TO n\n  result = result * i\nENDFOR\nOUTPUT result\n' },
  { id: 'p-largest3', title: 'Largest of three', prompt: 'Read three numbers (a, b, c) and output the largest.',
    tests: [{ input: '3 9 4', expected: '9' }, { input: '12 5 7', expected: '12' }, { input: '1 2 3', expected: '3' }],
    hint: 'Use MAX(a, b, c) – or compare with IF / ELSE IF.', starter: 'INPUT a, b, c\n', solution: 'INPUT a, b, c\nOUTPUT MAX(a, b, c)\n' },
  { id: 'p-table3', title: 'Table of 3', prompt: 'Output the first 10 multiples of 3: 3 6 9 … 30.',
    tests: [{ input: '', expected: '3 6 9 12 15 18 21 24 27 30' }], hint: 'FOR i = 1 TO 10 then OUTPUT 3 * i',
    starter: '', solution: 'FOR i = 1 TO 10\n  OUTPUT 3 * i\nENDFOR\n' },
  { id: 'p-listsum', title: 'Sum of a list', prompt: 'Read nothing. Given nums = [4, 8, 15, 16, 23, 42], output their sum.',
    tests: [{ input: '', expected: '108' }], hint: 'FOR EACH x IN nums and keep a running total (or SUM(nums)).',
    starter: 'nums = [4, 8, 15, 16, 23, 42]\n', solution: 'nums = [4, 8, 15, 16, 23, 42]\ntotal = 0\nFOR EACH x IN nums DO\n  total = total + x\nENDFOR\nOUTPUT total\n' },
  { id: 'p-prime', title: 'Prime or not', prompt: 'Read n (≥ 2). Output prime if it has no divisor other than 1 and itself, otherwise composite.',
    tests: [{ input: '7', expected: 'prime' }, { input: '9', expected: 'composite' }, { input: '2', expected: 'prime' }, { input: '15', expected: 'composite' }],
    hint: 'Try every i from 2 to n - 1: if n MOD i = 0 it is composite.', starter: 'INPUT n\n',
    solution: 'INPUT n\nisPrime = TRUE\nFOR i = 2 TO n - 1\n  IF n MOD i = 0 THEN\n    isPrime = FALSE\n  ENDIF\nENDFOR\nIF isPrime THEN\n  OUTPUT "prime"\nELSE\n  OUTPUT "composite"\nENDIF\n' },
  { id: 'p-fib', title: 'Fibonacci', prompt: 'Output the first 10 Fibonacci numbers: 0 1 1 2 3 5 8 13 21 34.',
    tests: [{ input: '', expected: '0 1 1 2 3 5 8 13 21 34' }], hint: 'Keep two variables a and b; each round output a, then move on: next = a + b, a = b, b = next.',
    starter: '', solution: 'a = 0\nb = 1\nFOR i = 1 TO 10\n  OUTPUT a\n  next = a + b\n  a = b\n  b = next\nENDFOR\n' },
];

const tokens = s => String(s).trim().split(/\s+/).filter(Boolean);

/** Check a program's output against one test. */
export function checkOutput(got, expected) {
  const a = tokens(got), b = tokens(expected);
  return a.length === b.length && a.every((x, i) => x === b[i]);
}
