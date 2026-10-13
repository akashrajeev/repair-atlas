import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../src/model.js';
import { replay } from '../src/replay.js';
import { findFamily, NothingToRepairError } from '../src/search.js';
import { randomWorkflow } from './helpers.js';

function* subsetsUpTo(arr, q) {
  const n = arr.length;
  for (let m = 1; m < 1 << n; m++) {
    const s = arr.filter((_, i) => m & (1 << i));
    if (s.length <= q) yield s;
  }
}

/** Independent brute force: every subset, then keep the inclusion-minimal successes. */
function brute(c, q) {
  const wins = [...subsetsUpTo(c.candidates, q)].filter((s) => replay(c, s).success);
  return wins.filter((w) => !wins.some((x) => x !== w && x.length < w.length && x.every((e) => w.includes(e)))).map((s) => s.join('+')).sort();
}

test('property: complete search == brute force on 400 random workflows (q=3)', () => {
  let checked = 0, nonTrivial = 0, joint = 0;
  for (let seed = 1; checked < 400 && seed < 4000; seed++) {
    const { cw, pick } = randomWorkflow(seed);
    // pick an oracle threshold from the all-clean value so success is reachable
    const allClean = compile({ ...cw, checks: [{ id: 'c', event: 'out', expect: { gte: -1e9 } }] });
    const cleanOut = replay(allClean, allClean.candidates).values.out;
    cw.checks = [{ id: 'c', event: 'out', expect: { [pick(2) ? 'gte' : 'eq']: cleanOut } }];
    if (cw.checks[0].expect.gte === undefined && cw.checks[0].expect.eq === undefined) continue;
    const c = compile(cw);
    if (c.candidates.length > 9) continue;
    let res;
    try { res = findFamily(c, { maxSize: 3, mode: 'complete' }); } catch (e) { if (e instanceof NothingToRepairError) continue; throw e; }
    checked++;
    const got = res.family.map((s) => s.join('+')).sort();
    // order of ids inside a set follows candidate pool order in both
    const want = brute(c, 3);
    assert.deepEqual(got.map((g) => g.split('+').sort().join('+')).sort(), want.map((g) => g.split('+').sort().join('+')).sort(), `seed ${seed}`);
    const ex = findFamily(c, { maxSize: 3, mode: 'exhaustive' }).family.map((s) => s.slice().sort().join('+')).sort();
    assert.deepEqual(got.map((g) => g.split('+').sort().join('+')).sort(), ex, `exhaustive seed ${seed}`);
    if (res.family.length) nonTrivial++;
    if (res.family.some((f) => f.length > 1)) joint++;
    for (const f of res.family) {
      assert.ok(replay(c, f).success, 'family member succeeds');
      for (const s of subsetsUpTo(f, f.length - 1)) assert.ok(!replay(c, s).success, 'strict subset fails');
    }
    for (const a of res.family) for (const b of res.family) if (a !== b) assert.ok(!a.every((x) => b.includes(x)), 'antichain');
    assert.ok(res.replayCalls <= findFamily(c, { maxSize: 3, mode: 'exhaustive' }).replayCalls);
  }
  assert.equal(checked, 400);
  assert.ok(nonTrivial > 100, `non-trivial cases: ${nonTrivial}`);
  assert.ok(joint > 10, `joint cases: ${joint}`);
  console.log(`# property: ${checked} workflows, ${nonTrivial} with repairs, ${joint} with a jointly-necessary repair`);
});
