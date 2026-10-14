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

test('property: judgeSet and roles[].undoes agree with brute force on 150 random workflows', async () => {
  const { diagnose, judgeSet } = await import('../src/analysis.js');
  let checked = 0, withUndo = 0;
  for (let seed = 1; checked < 150 && seed < 4000; seed++) {
    const { cw, pick } = randomWorkflow(seed);
    const allClean = compile({ ...cw, checks: [{ id: 'c', event: 'out', expect: { gte: -1e9 } }] });
    const cleanOut = replay(allClean, allClean.candidates).values.out;
    cw.checks = [{ id: 'c', event: 'out', expect: { [pick(2) ? 'gte' : 'eq']: cleanOut } }];
    let c; try { c = compile(cw); } catch { continue; }
    if (replay(c, []).success) continue;
    const n = c.candidates.length; if (n > 8) continue;
    const d = diagnose(c, { maxSize: n });
    const fam = brute(c, n);
    assert.deepEqual(d.family.map((f) => f.join('+')).sort(), fam, `family, seed ${seed}`);
    for (const id of c.candidates) {
      const inFam = d.family.some((f) => f.includes(id));
      const expected = inFam ? [] : d.family.filter((f) => !replay(c, [...f, id]).success).map((f) => f.join('+'));
      assert.deepEqual(d.roles[id].undoes, expected, `undoes ${id}, seed ${seed}`);
      if (expected.length) withUndo++;
    }
    for (let m = 1; m < 1 << n; m++) {
      const set = c.candidates.filter((_, i) => m & (1 << i));
      const j = judgeSet(c, d, set), ok = replay(c, set).success;
      const isMin = d.family.some((f) => f.length === set.length && f.every((x) => set.includes(x)));
      if (ok) assert.equal(j.kind, isMin ? 'minimal' : 'extra', `seed ${seed} {${set}}`);
      else assert.ok(['partial', 'none', 'undone'].includes(j.kind), `seed ${seed} {${set}} ${j.kind}`);
      if (!ok) assert.equal(j.kind === 'undone', d.family.some((f) => f.every((x) => set.includes(x))), `undone iff it contains a working set, seed ${seed}`);
      if (!ok && j.kind === 'partial') assert.ok(j.missing.length > 0, `partial names what is missing, seed ${seed}`);
    }
    checked++;
  }
  assert.equal(checked, 150);
  console.log(`# undoes cases exercised: ${withUndo}`);
});

test('property: targeted overshoot workflows (eq target on a sum) - search, undoes and judgeSet match brute force', async () => {
  const { diagnose, judgeSet } = await import('../src/analysis.js');
  const { rng } = await import('./helpers.js');
  let checked = 0, withUndo = 0, nonMonotone = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const r = rng(seed * 7919); const pick = (n) => Math.floor(r() * n);
    const k = 3 + pick(4);
    const events = []; let target = 0;
    const goodSubset = 1 + pick((1 << k) - 1);
    for (let i = 0; i < k; i++) {
      const observed = 1 + pick(3), clean = observed + 1 + pick(5);
      events.push({ id: `p${i}`, agent: 'A', op: 'const', value: observed, observed, clean });
    }
    for (let i = 0; i < k; i++) target += (goodSubset & (1 << i)) ? events[i].clean : events[i].observed;
    let acc = 'p0';
    for (let i = 1; i < k; i++) { events.push({ id: `s${i}`, agent: 'B', op: 'add', args: [acc, `p${i}`] }); acc = `s${i}`; }
    const c = compile({ name: `ov${seed}`, checks: [{ id: 'c', event: acc, expect: { eq: target } }], events });
    if (replay(c, []).success) continue;
    const d = diagnose(c, { maxSize: k });
    assert.deepEqual(d.family.map((f) => f.join('+')).sort(), brute(c, k), `family seed ${seed}`);
    if (!d.allCandidatesPass) nonMonotone++;
    for (const id of c.candidates) {
      const inFam = d.family.some((f) => f.includes(id));
      const expected = inFam ? [] : d.family.filter((f) => !replay(c, [...f, id]).success).map((f) => f.join('+'));
      assert.deepEqual(d.roles[id].undoes, expected, `undoes ${id} seed ${seed}`);
      if (expected.length) withUndo++;
    }
    for (let m = 1; m < 1 << k; m++) {
      const set = c.candidates.filter((_, i) => m & (1 << i));
      const j = judgeSet(c, d, set), ok = replay(c, set).success;
      const isMin = d.family.some((f) => f.length === set.length && f.every((x) => set.includes(x)));
      if (ok) assert.equal(j.kind, isMin ? 'minimal' : 'extra', `seed ${seed}`); else { assert.ok(['partial', 'none', 'undone'].includes(j.kind), `seed ${seed}`); assert.equal(j.kind === 'undone', d.family.some((f) => f.every((x) => set.includes(x))), `undone seed ${seed}`); if (j.kind === 'partial') assert.ok(j.missing.length > 0, `partial names the missing ones, seed ${seed}`); }
    }
    checked++;
  }
  assert.ok(checked >= 150, `checked ${checked}`);
  assert.ok(withUndo >= 50, `harmful-addition cases ${withUndo}`);
  console.log(`# overshoot workflows ${checked}, all-replacements-fail ${nonMonotone}, harmful-addition cases ${withUndo}`);
});
