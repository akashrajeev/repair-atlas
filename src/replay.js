import { OPS } from './ops.js';
import { checkPasses } from './model.js';

/**
 * Deterministic replay. `repairs` is an iterable of candidate event ids whose
 * clean payload replaces the observed one. Everything downstream is recomputed.
 * `order` may be any valid topological order: the result must not depend on it.
 */
export class ReplayLimitError extends Error {
  constructor(id, why) { super(`event "${id}" produced ${why}, over the size limit; replay stopped`); this.name = 'ReplayLimitError'; }
}
const MAX_TEXT = 100000;
function checkSize(id, v) {
  if (typeof v === 'string' && v.length > MAX_TEXT) throw new ReplayLimitError(id, `text longer than ${MAX_TEXT.toLocaleString('en-US')} characters`);
  if (Array.isArray(v) && v.some((x) => x !== null && typeof x === 'object')) throw new ReplayLimitError(id, 'a nested list (lists must stay flat)');
  return v;
}

export function replay(c, repairs = [], order = c.order) {
  const fixed = new Set(repairs);
  const values = Object.create(null);
  for (const id of order) {
    const e = c.byId.get(id);
    if (fixed.has(id) && 'clean' in e) { values[id] = e.clean; continue; }
    if ('observed' in e) { values[id] = e.observed; continue; }
    values[id] = e.op === 'const' ? e.value : checkSize(id, OPS[e.op].run((e.args ?? []).map((a) => values[a])));
  }
  const checks = c.wf.checks.map((k) => ({ id: k.id, event: k.event, value: values[k.event], pass: checkPasses(k.expect, values[k.event]) }));
  return { values, checks, success: checks.every((k) => k.pass) };
}

/** Counting, memoising replay backend. Swap this for a real re-run of an agent system. */
export function makeBackend(c) {
  const memo = new Map();
  let calls = 0;
  const key = (set) => [...set].sort().join('|');
  return {
    run(set) {
      const k = key(set);
      if (memo.has(k)) return memo.get(k);
      calls++;
      const r = replay(c, set).success;
      memo.set(k, r);
      return r;
    },
    get calls() { return calls; },
  };
}
