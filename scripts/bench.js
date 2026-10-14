// Measures, over seeded random workflows, how each search strategy compares.
// Usage: node scripts/bench.js [count=300] [bound=3]
import { compile } from '../src/model.js';
import { replay } from '../src/replay.js';
import { findFamily, paperPairFeasible, NothingToRepairError } from '../src/search.js';
import { randomWorkflow } from '../test/helpers.js';
import { writeFileSync } from 'node:fs';

const want = Number(process.argv[2] ?? 300), q = Number(process.argv[3] ?? 3);
const norm = (f) => f.map((s) => s.slice().sort().join('+')).sort().join(';');
const rows = [];
const t = {  inDomain: 0, inDomainPaperDiffers: 0, outDomain: 0, outDomainPaperDiffers: 0, singleFoundNone: 0, singleFoundSome: 0, n: 0, withRepair: 0, joint: 0, paperMiss: 0, singleMiss: 0, completeMismatch: 0, completeCalls: 0, exhaustiveCalls: 0 };

for (let seed = 1; t.n < want && seed < 20000; seed++) {
  const { cw, pick } = randomWorkflow(seed);
  const probe = compile({ ...cw, checks: [{ id: 'c', event: 'out', expect: { gte: -1e9 } }] });
  const cleanOut = replay(probe, probe.candidates).values.out;
  cw.checks = [{ id: 'c', event: 'out', expect: { [pick(2) ? 'gte' : 'eq']: cleanOut } }];
  const c = compile(cw);
  if (c.candidates.length > 9) continue;
  let complete;
  try { complete = findFamily(c, { maxSize: q, mode: 'complete' }); } catch (e) { if (e instanceof NothingToRepairError) continue; throw e; }
  t.n++;
  const exh = findFamily(c, { maxSize: q, mode: 'exhaustive' });
  const paper = findFamily(c, { maxSize: 2, mode: 'paper' });
  const single = findFamily(c, { maxSize: 1, mode: 'complete' });
  if (norm(complete.family) !== norm(exh.family)) t.completeMismatch++;
  if (!exh.family.length) continue;
  t.withRepair++;
  if (exh.family.some((f) => f.length > 1)) t.joint++;
  const inDom = exh.family.every((f) => f.length === 1 || (f.length === 2 && paperPairFeasible(c, f[0], f[1])));
  const paperDiff = norm(paper.family) !== norm(exh.family);
  if (inDom) { t.inDomain++; if (paperDiff) t.inDomainPaperDiffers++; } else { t.outDomain++; if (paperDiff) t.outDomainPaperDiffers++; }
  const singleDiff = norm(single.family) !== norm(exh.family);
  if (singleDiff) { if (single.family.length === 0) t.singleFoundNone++; else t.singleFoundSome++; t.singleMiss++; }
  rows.push({ seed, candidates: c.candidates.length, exact: exh.family.map((f) => f.join('+')), inPaperDomain: inDom, paperDiffers: paperDiff, singleFound: single.family.map((f) => f.join('+')) });
  t.completeCalls += complete.replayCalls; t.exhaustiveCalls += exh.replayCalls;
}
const pct = (a, b) => (b ? `${a}/${b} (${Math.round((100 * a) / b)}%)` : '0/0');
console.log(`workflows tried: ${t.n}, bound ${q}, seeded (seed order 1..)`);
console.log(`with at least one repair: ${t.withRepair}; needing a joint (2+) repair: ${t.joint}`);
console.log(`complete search differs from exhaustive: ${t.completeMismatch}`);
console.log(`one-fix-at-a-time search (denominator: ${t.withRepair} repairable workflows): found none ${t.singleFoundNone}, found only part of the exact answer ${t.singleFoundSome}, found all ${t.withRepair - t.singleMiss}`);
console.log(`published pair rule at bound 2 vs the exact bound-${q} answer, split by whether the exact answer lies inside the rule's declared domain (sizes 1-2, pairs from different agents, causally unordered, meeting at a join):`);
console.log(`  inside the domain: ${pct(t.inDomainPaperDiffers, t.inDomain)} differ`);
console.log(`  outside the domain (chains, triples, same-agent pairs): ${pct(t.outDomainPaperDiffers, t.outDomain)} differ; not a defect of the rule`);
console.log(`replays, summed: complete ${t.completeCalls} vs replay-everything ${t.exhaustiveCalls}`);
writeFileSync(new URL(`../bench-results-n${t.n}-q${q}.json`, import.meta.url), JSON.stringify({ conditions: { count: want, bound: q, seedsFrom: 1, maxCandidates: 9 }, totals: t, rows }, null, 1));
