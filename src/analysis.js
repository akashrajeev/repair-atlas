import { replay, makeBackend } from './replay.js';
import { findFamily, exhaustiveCost, BASELINE_BUDGET } from './search.js';

/** Full diagnosis: family, per-event roles, recovery formula, and the comparison panel. */
export function diagnose(c, { maxSize = 2 } = {}) {
  // Diagnosis itself is the pruned search (bounded by REPLAY_BUDGET). Replaying every subset is only an
  // optional accuracy cross-check, and it is skipped when it would be expensive.
  const baselineCost = exhaustiveCost(c.candidates.length, maxSize);
  const complete = findFamily(c, { maxSize, mode: 'complete' });
  const exhaustive = baselineCost <= BASELINE_BUDGET ? findFamily(c, { maxSize, mode: 'exhaustive' }) : null;
  const paper = findFamily(c, { maxSize: 2, mode: 'paper' });
  const singleton = findFamily(c, { maxSize: 1, mode: 'complete' });
  const fam = complete.family;
  const key = (f) => f.join('+');
  const same = (a, b) => a.map(key).join(';') === b.map(key).join(';');

  const roles = {};
  for (const id of c.candidates) {
    const inSets = fam.filter((f) => f.includes(id));
    let role;
    if (!inSets.length) {
      const base0 = replay(c, []).checks, solo = replay(c, [id]).checks;
      const fixesOne = base0.some((k, i) => !k.pass && solo[i].pass), breaksOne = base0.some((k, i) => k.pass && !solo[i].pass);
      role = fixesOne && breaksOne ? 'decoy' : 'irrelevant';
    }
    else if (inSets.every((f) => f.length === 1)) role = 'solo';
    else if (inSets.every((f) => f.length > 1)) role = fam.every((f) => f.includes(id)) ? 'required-and' : 'and-partner';
    else role = 'mixed';
    // harmless-to-apply is a separate question from belongs-to-a-repair: adding a non-member can undo a working set
    const undoes = inSets.length ? [] : fam.filter((f) => !replay(c, [...f, id]).success).map(key);
    roles[id] = { role, sets: inSets.map(key), undoes, inEverySet: fam.length > 0 && fam.every((f) => f.includes(id)) };
  }
  const cost = (id) => c.byId.get(id).cost ?? 1;
  const famCost = fam.map((f) => f.reduce((t, id) => t + cost(id), 0));
  const minCost = famCost.length ? Math.min(...famCost) : null;
  const kind = classify(fam);
  return {
    maxSize, family: fam, kind, roles,
    costs: { perSet: famCost, cheapest: famCost.map((x) => x === minCost), min: minCost, custom: c.candidates.some((id) => 'cost' in c.byId.get(id)) },
    formula: fam.map((f) => (f.length === 1 ? f[0] : `(${f.join(' AND ')})`)).join(' OR ') || 'none within bound',
    baseline: replay(c, []),
    nextBound: maxSize >= c.candidates.length ? null : { size: maxSize + 1, maxSubsets: exhaustiveCost(c.candidates.length, maxSize + 1), everyCombination: 2 ** c.candidates.length },
    allCandidatesPass: replay(c, c.candidates).success,
    searchedEverySubset: maxSize >= c.candidates.length,
    comparison: {
      baselineRan: !!exhaustive,
      complete: summary(complete),
      exhaustive: exhaustive ? summary(exhaustive) : null,
      paper: { ...summary(paper), matchesExhaustive: exhaustive ? same(paper.family, exhaustive.family) : null, missed: exhaustive ? exhaustive.family.filter((f) => !paper.family.some((g) => key(g) === key(f))).map(key) : [] },
      singleOnly: { ...summary(singleton), matchesExhaustive: exhaustive ? same(singleton.family, exhaustive.family) : null, missed: exhaustive ? exhaustive.family.filter((f) => !singleton.family.some((g) => key(g) === key(f))).map(key) : [] },
      completeMatchesExhaustive: exhaustive ? same(complete.family, exhaustive.family) : null,
      exhaustiveFormula: baselineCost,
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

const ROLE_TEXT = { solo: 'fixes it alone', 'required-and': 'needed with partners', 'and-partner': 'part of a joint repair', mixed: 'in several repairs', decoy: 'fixes one check but breaks another' };
/** One-line meaning of a role. A candidate in no repair is only "in no repair" for the searched domain: within the bound, or among all combinations. */
export function roleNote(d, r) {
  if (r.inEverySet && d.family.length > 1) return 'in every repair';
  if (r.role !== 'irrelevant') return ROLE_TEXT[r.role];
  const where = d.searchedEverySubset ? 'in no minimal repair' : `in no repair of up to ${d.maxSize}`;
  return r.undoes?.length ? `${where}; breaks one if added` : where;
}

export function judgeSet(c, d, set) {
  const r = replay(c, set);
  const fam = d.family;
  if (r.success) {
    if (fam.some((f) => f.length === set.length && f.every((x) => set.includes(x)))) return { kind: 'minimal', missing: [], extra: [] };
    const inside = fam.find((f) => f.every((x) => set.includes(x)));
    return { kind: 'extra', missing: [], extra: inside ? set.filter((x) => !inside.includes(x)) : [] };
  }
  // a failing set that contains a working minimal set: the extra replacements undo it
  const held = fam.find((f) => f.every((x) => set.includes(x)));
  if (held) return { kind: 'undone', missing: [], extra: set.filter((x) => !held.includes(x)), contains: held };
  const near = fam.map((f) => ({ f, missing: f.filter((x) => !set.includes(x)) })).filter((n) => n.missing.length < n.f.length).sort((x, y) => x.missing.length - y.missing.length)[0];
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
  if (!file || typeof file !== 'object' || Array.isArray(file)) return { ok: false, reason: 'not a witness file (expected a JSON object)' };
  const { hash, evidence, ...body } = file;
  if (typeof hash !== 'string' || !body.workflow || typeof body.workflow !== 'object' || !Array.isArray(body.repairs)) return { ok: false, reason: 'not a Repair Atlas witness file (it needs a hash, a workflow and a list of repairs)' };
  if (hashString(JSON.stringify(body)) !== hash) return { ok: false, reason: 'hash mismatch: file was edited after export' };
  let c;
  try { c = compileFn(body.workflow); } catch (e) { return { ok: false, reason: `workflow invalid: ${e.message}` }; }
  if (replay(c, []).success) return { ok: false, reason: 'unmodified run passes' };
  const w = witnessFor(c, body.repairs);
  if (!w.success) return { ok: false, reason: 'repaired replay does not pass' };
  if (!w.minimal) return { ok: false, reason: 'a strict subset of the repairs already passes, so the set is not minimal' };
  if (evidence !== undefined && JSON.stringify(evidence) !== JSON.stringify({ changed: w.changed, subsetsAllFail: w.subsets.every((x) => !x.success) })) return { ok: false, reason: 'evidence summary does not match the replay: file was edited after export' };
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

/** Plain-text report of one diagnosis, safe to paste into an issue or a postmortem. */
export function reportMarkdown(c, d) {
  const label = (id) => c.byId.get(id).label ?? id;
  const L = [];
  L.push(`# Repair report: ${c.wf.name}`, '');
  L.push(`Search bound: repair sets of up to ${d.maxSize} replacement${d.maxSize === 1 ? '' : 's'} (${d.searchedEverySubset ? 'every combination was replayed' : 'combinations larger than the bound were not searched'}).`);
  L.push(`Failing checks in the original run: ${d.baseline.checks.filter((k) => !k.pass).map((k) => k.id).join(', ') || 'none'}.`, '');
  L.push('## Recovery formula', '', '`' + d.formula.replace(/\b[\w]+\b/g, (m) => (m === 'AND' || m === 'OR' || !c.byId.has(m) ? m : label(m))) + '`', '');
  L.push('Each listed set passes, and no smaller subset of it passes (inclusion-minimal). It is not necessarily the fewest-fix answer.', '');
  L.push('## Repair sets', '');
  d.family.forEach((f, i) => {
    const w = witnessFor(c, f);
    L.push(`${i + 1}. ${f.map(label).join(' + ')} (${f.length === 1 ? 'fixes it alone' : `all ${f.length} needed together`})${d.costs.custom ? `, cost ${d.costs.perSet[i]}${d.costs.cheapest[i] ? ' (cheapest)' : ''}` : ''}`);
    L.push(`   - replay: passes with the set; ${w.subsets.length} strict subset${w.subsets.length === 1 ? '' : 's'} all fail: ${w.minimal ? 'yes' : 'NO'}`);
    L.push(`   - events whose value changed: ${w.changed.map(label).join(', ') || 'none'}`);
  });
  if (!d.family.length) L.push('None found within the bound.');
  L.push('', '## Event roles', '');
  for (const [id, r] of Object.entries(d.roles)) L.push(`- ${label(id)}: ${roleNote(d, r)}`);
  L.push('', '## How this was computed', '', `Replays used: ${d.comparison.complete.replayCalls} (replaying every combination up to the bound would take ${d.comparison.exhaustiveFormula}${d.comparison.baselineRan ? '' : '; the every-combination cross-check was not run because it is too large'}).`);
  L.push('Replays are a deterministic executor over recorded payloads, not re-runs of a live system. Clean replacements and the pass/fail checks were supplied by the workflow file.', '');
  return L.join('\n');
}
