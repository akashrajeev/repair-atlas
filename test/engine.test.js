import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, validate, WorkflowError, topoOrder, checkPasses } from '../src/model.js';
import { replay } from '../src/replay.js';
import { findFamily, NothingToRepairError, slice, exhaustiveCost } from '../src/search.js';
import { diagnose, witnessFor, exportWitness, verifyWitness } from '../src/analysis.js';
import { fixtureFiles, loadFixture, rng } from './helpers.js';

const fx = (n) => compile(loadFixture(n + '.json'));
const fam = (c, o) => findFamily(c, o).family.map((f) => f.join('+'));

test('fixtures: every family is the one we designed', () => {
  assert.deepEqual(fam(fx('invoice-reconcile')), ['line_items+tax_amount']);
  assert.deepEqual(fam(fx('alert-triage')), ['log_risk', 'metric_risk']);
  assert.deepEqual(fam(fx('shipping-eta')), ['transit_days']);
  assert.deepEqual(fam(fx('sequential-handoff')), ['order_qty+ship_fee']);
  assert.deepEqual(fam(fx('release-gate'), { maxSize: 3 }), ['tests_green+review_ok+license_ok']);
  assert.deepEqual(fam(fx('refund-desk'), { maxSize: 3 }), ['override', 'reason+refund_amount+cap']);
});

test('incident pipeline: two joint repairs share a core', () => {
  const c = fx('incident-pipeline');
  assert.deepEqual(fam(c, { maxSize: 3 }), ['impact+users+channel_ok', 'severity+impact+channel_ok']);
  const d = diagnose(c, { maxSize: 3 });
  assert.ok(d.roles.impact.inEveryFamily ?? d.roles.impact.inEverySet);
  assert.ok(d.roles.channel_ok.inEverySet);
  assert.ok(!d.roles.severity.inEverySet);
  assert.equal(d.roles.dedupe_key.role, 'irrelevant');
  assert.ok(d.comparison.complete.replayCalls < d.comparison.exhaustive.replayCalls / 2);
});

test('size bound is honest: release gate has no repair of size <= 2', () => {
  assert.deepEqual(fam(fx('release-gate'), { maxSize: 2 }), []);
});

test('no single-event shortcut hides joint repairs', () => {
  const d = diagnose(fx('invoice-reconcile'));
  assert.equal(d.comparison.singleOnly.family.length, 0);
  assert.deepEqual(d.comparison.singleOnly.missed, ['line_items+tax_amount']);
});

test('the published pair rule (declared domain: pairs, incomparable events) does not cover chained or 3-way repairs; complete search does', () => {
  const seq = diagnose(fx('sequential-handoff'));
  assert.equal(seq.comparison.paper.matchesExhaustive, false);
  assert.equal(seq.comparison.completeMatchesExhaustive, true);
  const rd = diagnose(fx('refund-desk'), { maxSize: 3 });
  assert.deepEqual(rd.comparison.paper.missed, ['reason+refund_amount+cap']);
});

test('roles: required AND, solo, alternatives, irrelevant', () => {
  const inv = diagnose(fx('invoice-reconcile')).roles;
  assert.equal(inv.line_items.role, 'required-and');
  assert.equal(inv.rounding.role, 'irrelevant');
  assert.equal(inv.audit_note.role, 'irrelevant');
  const alt = diagnose(fx('alert-triage'));
  assert.equal(alt.kind, 'alternative-or');
  assert.equal(alt.roles.log_risk.role, 'solo');
  assert.equal(alt.roles.ticket_tag.role, 'irrelevant');
  assert.equal(diagnose(fx('shipping-eta')).kind, 'single');
  assert.equal(diagnose(fx('refund-desk'), { maxSize: 3 }).kind, 'mixed');
});

test('slicing drops candidates that cannot reach any check', () => {
  const c = fx('invoice-reconcile');
  assert.ok(!slice(c).includes('audit_note'));
  assert.ok(slice(c).includes('rounding'));
});

test('replay cost: complete search never uses more replays than exhaustive', () => {
  for (const f of fixtureFiles) {
    const wf = loadFixture(f); const c = compile(wf); const q = wf.defaultMaxSize ?? 2;
    const a = findFamily(c, { maxSize: q, mode: 'complete' }), b = findFamily(c, { maxSize: q, mode: 'exhaustive' });
    assert.ok(a.replayCalls <= b.replayCalls, f);
    assert.equal(b.replayCalls, exhaustiveCost(c.candidates.length, q), f + ' matches the 1+n+C(n,2)+... formula');
  }
});

test('passing run is refused, not silently "solved"', () => {
  const wf = loadFixture('shipping-eta.json');
  for (const e of wf.events) { delete e.observed; delete e.clean; }
  assert.throws(() => findFamily(compile(wf)), NothingToRepairError);
});

test('witness: repaired run passes, every strict subset fails', () => {
  const c = fx('invoice-reconcile');
  const w = witnessFor(c, ['line_items', 'tax_amount']);
  assert.ok(w.success && w.minimal);
  assert.equal(w.subsets.length, 3);
  assert.ok(w.changed.includes('balanced'));
  const nonMin = witnessFor(c, ['line_items', 'tax_amount', 'rounding']);
  assert.equal(nonMin.minimal, false);
});

test('witness file verifies, and tampering is caught', () => {
  const c = fx('refund-desk');
  const file = exportWitness(c, ['override']);
  assert.equal(verifyWitness(JSON.parse(JSON.stringify(file)), compile).ok, true);
  const edited = JSON.parse(JSON.stringify(file)); edited.repairs = ['cap'];
  assert.match(verifyWitness(edited, compile).reason, /hash mismatch/);
  // re-hash after editing so only the semantic check can catch it
  const sneaky = JSON.parse(JSON.stringify(file));
  sneaky.workflow.events.find((e) => e.id === 'override').clean = false;
  const body = { ...sneaky }; delete body.hash; delete body.evidence;
  sneaky.hash = exportWitness(compile(sneaky.workflow), ['override'].filter(() => false)).hash;
  assert.equal(verifyWitness(sneaky, compile).ok, false);
});

test('witness for a non-minimal set is rejected', () => {
  const c = fx('alert-triage');
  const f = exportWitness(c, ['log_risk', 'metric_risk']);
  const r = verifyWitness(f, compile);
  assert.equal(r.ok, false);
  assert.match(r.reason, /not minimal/);
});

test('validation: bad workflows get specific messages', () => {
  assert.ok(validate(null)[0]);
  assert.match(validate({ events: [{ id: 'a', agent: 'x', op: 'eval', args: [] }], checks: [] }).join(), /unknown op "eval"/);
  assert.match(validate({ events: [{ id: 'a', agent: 'x', op: 'add', args: ['b', 'a'] }], checks: [{ id: 'c', event: 'a', expect: { truthy: 1 } }] }).join(), /unknown arg "b"/);
  assert.match(validate({ events: [{ id: 'a', agent: 'x', op: 'not', args: ['a'] }], checks: [{ id: 'c', event: 'a', expect: { truthy: 1 } }] }).join(), /cycle/);
  assert.match(validate({ events: [{ id: 'a', agent: 'x', op: 'const', value: 1, observed: 2 }], checks: [{ id: 'c', event: 'a', expect: { truthy: 1 } }] }).join(), /together/);
  assert.match(validate({ events: [{ id: 'a', agent: 'x', op: 'const', value: 1 }], checks: [{ id: 'c', event: 'a', expect: {} }] }).join(), /expect needs/);
  assert.match(validate({ events: [{ id: 'a', agent: 'x', op: 'sub', args: ['a'] }, { id: 'a', agent: 'x', op: 'const', value: 1 }], checks: [{ id: 'c', event: 'a', expect: { truthy: 1 } }] }).join(), /duplicate/);
  assert.throws(() => compile({ events: [], checks: [] }), WorkflowError);
});

test('workflows are data: hostile op names and prototype keys never execute', () => {
  for (const op of ['constructor', '__proto__', 'toString', 'Function', 'require']) {
    assert.ok(validate({ events: [{ id: 'a', agent: 'x', op, args: [] }], checks: [{ id: 'c', event: 'a', expect: { truthy: 1 } }] }).length, op);
  }
});

test('checkers', () => {
  assert.ok(checkPasses({ eq: [1, 2] }, [1, 2]));
  assert.ok(!checkPasses({ gte: 3 }, 'x'));
  assert.ok(checkPasses({ lt: 3 }, 2) && checkPasses({ falsy: 1 }, 0) && checkPasses({ lte: 2 }, 2) && checkPasses({ gt: 1 }, 2));
});

test('schedule invariance: any valid event order gives identical replays', () => {
  for (const f of fixtureFiles) {
    const c = compile(loadFixture(f));
    const r = rng(7);
    const sets = [[], c.candidates, c.candidates.slice(0, 1), c.candidates.slice(1, 3)];
    for (let i = 0; i < 40; i++) {
      const order = topoOrder(c.events, r);
      for (const s of sets) assert.deepEqual(replay(c, s, order).values, replay(c, s).values, f);
    }
  }
});

import { judgeSet } from '../src/analysis.js';
test('judging a hand-picked repair set', () => {
  const c = fx('invoice-reconcile'); const d = diagnose(c);
  assert.equal(judgeSet(c, d, ['line_items', 'tax_amount']).kind, 'minimal');
  const extra = judgeSet(c, d, ['line_items', 'tax_amount', 'rounding']);
  assert.deepEqual([extra.kind, extra.extra], ['extra', ['rounding']]);
  const part = judgeSet(c, d, ['line_items']);
  assert.deepEqual([part.kind, part.missing], ['partial', ['tax_amount']]);
  assert.equal(judgeSet(c, d, ['rounding']).kind, 'none');
  assert.equal(judgeSet(c, d, []).kind, 'none');
});
