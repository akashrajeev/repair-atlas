import { makeBackend } from './replay.js';

export class NothingToRepairError extends Error {
  constructor() { super('The unmodified run already passes every check, so there is no failure to localize.'); this.name = 'NothingToRepairError'; }
}

/** Candidates that can structurally influence a check (backward slice). */
export function slice(c) {
  const rel = new Set();
  for (const k of c.wf.checks) { rel.add(k.event); for (const a of c.ancestors.get(k.event)) rel.add(a); }
  return c.candidates.filter((id) => rel.has(id));
}

function* combos(arr, k, start = 0, cur = []) {
  if (cur.length === k) { yield cur.slice(); return; }
  for (let i = start; i < arr.length; i++) { cur.push(arr[i]); yield* combos(arr, k, i + 1, cur); cur.pop(); }
}

const isSubset = (a, b) => a.every((x) => b.includes(x));
const reaches = (c, u, v) => c.ancestors.get(v).has(u);

/** The paper's pair filter: different agents, causally incomparable, meeting at a join. */
export function paperPairFeasible(c, u, v) {
  if (c.byId.get(u).agent === c.byId.get(v).agent) return false;
  if (reaches(c, u, v) || reaches(c, v, u)) return false;
  const sinkSet = new Set();
  for (const k of c.wf.checks) { sinkSet.add(k.event); for (const a of c.ancestors.get(k.event)) sinkSet.add(a); }
  for (const z of sinkSet) {
    if ((c.byId.get(z).args ?? []).length >= 2 && (reaches(c, u, z) || u === z) && (reaches(c, v, z) || v === z) && z !== u && z !== v) return true;
  }
  return false;
}

/**
 * mode:
 *  - "exhaustive": test every subset up to maxSize (the accuracy baseline)
 *  - "complete":   backward slice + level-wise minimality pruning, any maxSize. Exact in the declared domain.
 *  - "paper":      GCJR as published: slice + singletons + structurally filtered pairs (maxSize is 2)
 */
export function findFamily(c, { maxSize = 2, mode = 'complete', backend = makeBackend(c) } = {}) {
  if (mode === 'paper') maxSize = Math.min(maxSize, 2);
  if (backend.run([])) throw new NothingToRepairError();
  const pool = mode === 'exhaustive' ? c.candidates.slice() : slice(c);
  const family = [];
  const tested = [];
  const skipped = [];

  for (let k = 1; k <= maxSize; k++) {
    for (const set of combos(pool, k)) {
      const hasWinningSubset = family.some((f) => isSubset(f, set));
      if (mode !== 'exhaustive' && hasWinningSubset) { skipped.push({ set, why: 'contains a smaller repair that already works' }); continue; }
      if (mode === 'paper' && k === 2 && !paperPairFeasible(c, set[0], set[1])) { skipped.push({ set, why: 'pair filtered out by graph rule' }); continue; }
      const ok = backend.run(set);
      tested.push({ set, ok });
      if (ok && !hasWinningSubset) family.push(set);
    }
  }
  // exhaustive tests everything; keep only inclusion-minimal successes
  const minimal = family.filter((f, i) => !family.some((g, j) => j !== i && g.length < f.length && isSubset(g, f)));
  minimal.sort((a, b) => a.length - b.length || a.join().localeCompare(b.join()));
  return {
    mode, maxSize, family: minimal, replayCalls: backend.calls + 0,
    poolSize: pool.length, candidateCount: c.candidates.length, tested, skipped,
  };
}

/** Cost formulas from the paper (r = 1 for deterministic replay), for the comparison panel. */
export function exhaustiveCost(n, q) {
  let t = 1; let b = 1;
  for (let k = 1; k <= q; k++) { b = (b * (n - k + 1)) / k; t += b; }
  return t;
}
