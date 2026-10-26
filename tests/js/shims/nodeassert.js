// Tiny subset of `node:assert/strict` for the browser harness.
class AssertionError extends Error {}
const fail = (m, d) => { throw new AssertionError(m || d); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const assert = (v, m) => { if (!v) fail(m, 'assertion failed'); };
assert.ok = assert;
assert.equal = (a, b, m) => { if (a !== b) fail(m, `expected ${JSON.stringify(b)} but got ${JSON.stringify(a)}`); };
assert.notEqual = (a, b, m) => { if (a === b) fail(m, `expected a different value than ${JSON.stringify(a)}`); };
assert.deepEqual = (a, b, m) => { if (!same(a, b)) fail(m, `expected ${JSON.stringify(b)} but got ${JSON.stringify(a)}`); };
assert.match = (s, re, m) => { if (!re.test(String(s))) fail(m, `${JSON.stringify(String(s))} does not match ${re}`); };
assert.throws = (fn, m) => { try { fn(); } catch { return; } fail(m, 'expected an exception'); };
export default assert;
