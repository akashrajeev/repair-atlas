// The only operations a workflow node may use. Workflows are data, never code:
// a loaded trace cannot run anything outside this table.
const num = (x) => (typeof x === 'number' ? x : Number(x));

export const OPS = {
  const: { arity: 0, run: () => undefined }, // value comes from node.value
  add: { arity: [2, Infinity], run: (a) => a.reduce((s, x) => s + num(x), 0) },
  sub: { arity: 2, run: ([a, b]) => num(a) - num(b) },
  mul: { arity: [2, Infinity], run: (a) => a.reduce((s, x) => s * num(x), 1) },
  div: { arity: 2, run: ([a, b]) => (num(b) === 0 ? NaN : num(a) / num(b)) },
  mod: { arity: 2, run: ([a, b]) => (num(b) === 0 ? NaN : num(a) % num(b)) },
  min: { arity: [1, Infinity], run: (a) => Math.min(...a.map(num)) },
  max: { arity: [1, Infinity], run: (a) => Math.max(...a.map(num)) },
  abs: { arity: 1, run: ([a]) => Math.abs(num(a)) },
  neg: { arity: 1, run: ([a]) => -num(a) },
  round: { arity: 1, run: ([a]) => Math.round(num(a)) },
  clamp: { arity: 3, run: ([x, lo, hi]) => Math.min(Math.max(num(x), num(lo)), num(hi)) },
  eq: { arity: 2, run: ([a, b]) => JSON.stringify(a) === JSON.stringify(b) },
  gt: { arity: 2, run: ([a, b]) => num(a) > num(b) },
  gte: { arity: 2, run: ([a, b]) => num(a) >= num(b) },
  lt: { arity: 2, run: ([a, b]) => num(a) < num(b) },
  lte: { arity: 2, run: ([a, b]) => num(a) <= num(b) },
  and: { arity: [2, Infinity], run: (a) => a.every(Boolean) },
  or: { arity: [2, Infinity], run: (a) => a.some(Boolean) },
  not: { arity: 1, run: ([a]) => !a },
  if: { arity: 3, run: ([c, a, b]) => (c ? a : b) },
  concat: { arity: [2, Infinity], run: (a) => a.map(String).join('') },
  len: { arity: 1, run: ([a]) => (a == null ? 0 : a.length) },
  includes: { arity: 2, run: ([a, b]) => (a == null ? false : a.includes(b)) },
  list: { arity: [0, Infinity], run: (a) => a.slice() },
  sum: { arity: 1, run: ([a]) => (Array.isArray(a) ? a.reduce((s, x) => s + num(x), 0) : NaN) },
};

export function arityOk(op, n) {
  const a = OPS[op].arity;
  return Array.isArray(a) ? n >= a[0] && n <= a[1] : n === a;
}
