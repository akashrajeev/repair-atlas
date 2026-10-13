import { replay, makeBackend } from './replay.js';
import { findFamily, exhaustiveCost } from './search.js';

/** Full diagnosis: family, per-event roles, recovery formula, and the comparison panel. */
export function diagnose(c, { maxSize = 2 } = {}) {
  const complete = findFamily(c, { maxSize, mode: 'complete' });
  const exhaustive = findFamily(c, { maxSize, mode: 'exhaustive' });
  const paper = findFamily(c, { maxSize: 2, mode: 'paper' });
  const singleton = findFamily(c, { maxSize: 1, mode: 'complete' });
  const fam = complete.family;
  const key = (f) => f.join('+');
  const same = (a, b) => a.map(key).join(';') === b.map(key).join(';');

  const roles = {};
  for (const id of c.candidates) {
    const inSets = fam.filter((f) => f.includes(id));
    let role;
    if (!inSets.length) role = 'irrelevant';
    else if (inSets.every((f) => f.length === 1)) role = 'solo';
    else if (inSets.every((f) => f.length > 1)) role = fam.every((f) => f.includes(id)) ? 'required-and' : 'and-partner';
    else role = 'mixed';
    roles[id] = { role, sets: inSets.map(key), inEverySet: fam.length > 0 && fam.every((f) => f.includes(id)) };
  }
  const kind = classify(fam);
  return {
    maxSize, family: fam, kind, roles,
    formula: fam.map((f) => (f.length === 1 ? f[0] : `(${f.join(' AND ')})`)).join(' OR ') || 'none within bound',
    baseline: replay(c, []),
    comparison: {
      complete: summary(complete),
      exhaustive: summary(exhaustive),
      paper: { ...summary(paper), matchesExhaustive: same(paper.family, exhaustive.family), missed: exhaustive.family.filter((f) => !paper.family.some((g) => key(g) === key(f))).map(key) },
      singleOnly: { ...summary(singleton), matchesExhaustive: same(singleton.family, exhaustive.family), missed: exhaustive.family.filter((f) => !singleton.family.some((g) => key(g) === key(f))).map(key) },
      completeMatchesExhaustive: same(complete.family, exhaustive.family),
      exhaustiveFormula: exhaustiveCost(c.candidates.length, maxSize),
    },
    skipped: complete.skipped,
    tested: complete.tested,
  };
}

const summary = (r) => ({ family: r.family.map((f) => f.join('+')), replayCalls: r.replayCalls, poolSize: r.poolSize });

function classify(fam) {
  if (!fam.length) return 'none';
  if (fam.length === 1 && fam[0].length === 1) return 'single';
  if (fam.length === 1) return 'joint-and';
  if (fam.every((f) => f.length === 1)) return 'alternative-or';
  return 'mixed';
}

/** Classify a hand-picked repair set against the computed family. */
export function judgeSet(c, d, set) {
  const r = replay(c, set);
  const fam = d.family;
  if (r.success) {
    if (fam.some((f) => f.length === set.length && f.every((x) => set.includes(x)))) return { kind: 'minimal', missing: [], extra: [] };
    const inside = fam.find((f) => f.every((x) => set.includes(x)));
    return { kind: 'extra', missing: [], extra: inside ? set.filter((x) => !inside.includes(x)) : [] };
  }
  const near = fam.map((f) => ({ f, missing: f.filter((x) => !set.includes(x)) })).sort((x, y) => x.missing.length - y.missing.length)[0];
  if (near && near.missing.length < near.f.length) return { kind: 'partial', missing: near.missing, extra: [] };
  return { kind: 'none', missing: [], extra: [] };
}

/**
 * A witness is a replayable proof for one minimal repair: the repaired run
 * passes, and every strict subset still fails. Anyone can re-run it.
 */
export function witnessFor(c, set) {
  const subsets = [];
  const n = set.length;
  for (let mask = 0; mask < (1 << n) - 1; mask++) {
    const sub = set.filter((_, i) => mask & (1 << i));
    const r = replay(c, sub);
    subsets.push({ repairs: sub, success: r.success, checks: r.checks });
  }
  const fixed = replay(c, set);
  const base = replay(c, []);
  const changed = c.order.filter((id) => JSON.stringify(base.values[id]) !== JSON.stringify(fixed.values[id]));
  return { repairs: set.slice(), success: fixed.success, checks: fixed.checks, changed, subsets, minimal: fixed.success && subsets.every((s) => !s.success) };
}

/** Self-contained, hash-stamped witness file. `verifyWitness` re-executes it from scratch. */
export function exportWitness(c, set) {
  const w = witnessFor(c, set);
  const body = { tool: 'repair-atlas', version: 1, workflow: c.wf, repairs: set.slice().sort(), claim: { success: true, minimal: true } };
  return { ...body, hash: hashString(JSON.stringify(body)), evidence: { changed: w.changed, subsetsAllFail: w.subsets.every((s) => !s.success) } };
}

export function verifyWitness(file, compileFn) {
  const { hash, evidence, ...body } = file;
  if (hashString(JSON.stringify(body)) !== hash) return { ok: false, reason: 'hash mismatch: file was edited after export' };
  let c;
  try { c = compileFn(body.workflow); } catch (e) { return { ok: false, reason: `workflow invalid: ${e.message}` }; }
  if (replay(c, []).success) return { ok: false, reason: 'unmodified run passes' };
  const w = witnessFor(c, body.repairs);
  if (!w.success) return { ok: false, reason: 'repaired replay does not pass' };
  if (!w.minimal) return { ok: false, reason: 'a strict subset of the repairs already passes, so the set is not minimal' };
  return { ok: true, reason: `repaired replay passes; all ${w.subsets.length} strict subsets fail` };
}

/** cyrb53: small, stable, dependency-free string hash for tamper detection (not cryptographic). */
export function hashString(s) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

export { makeBackend };
