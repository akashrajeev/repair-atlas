import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../src/model.js';
import { replay } from '../src/replay.js';
import { findFamily, paperPairFeasible, NothingToRepairError } from '../src/search.js';
import { randomWorkflow } from './helpers.js';

const norm = (f) => f.map((s) => s.slice().sort().join('+')).sort().join(';');

test('inside its declared domain the published pair rule equals the exhaustive answer (200 seeded workflows)', () => {
  let inDomain = 0;
  for (let seed = 1; seed < 6000 && inDomain < 200; seed++) {
    const { cw, pick } = randomWorkflow(seed);
    const probe = compile({ ...cw, checks: [{ id: 'c', event: 'out', expect: { gte: -1e9 } }] });
    const out = replay(probe, probe.candidates).values.out;
    cw.checks = [{ id: 'c', event: 'out', expect: { [pick(2) ? 'gte' : 'eq']: out } }];
    const c = compile(cw);
    if (c.candidates.length > 9) continue;
    let exh;
    try { exh = findFamily(c, { maxSize: 3, mode: 'exhaustive' }); } catch (e) { if (e instanceof NothingToRepairError) continue; throw e; }
    if (!exh.family.length) continue;
    if (!exh.family.every((f) => f.length === 1 || (f.length === 2 && paperPairFeasible(c, f[0], f[1])))) continue;
    inDomain++;
    assert.equal(norm(findFamily(c, { maxSize: 2, mode: 'paper' }).family), norm(exh.family), `seed ${seed}`);
  }
  assert.ok(inDomain >= 150, `only ${inDomain} in-domain cases found`);
});
