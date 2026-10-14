import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, applyEdits } from '../src/model.js';
import { diagnose, judgeSet } from '../src/analysis.js';
import { findFamily } from '../src/search.js';
import { loadFixture } from './helpers.js';

const strip = (wf, keys) => { const w = structuredClone(wf); for (const e of w.events) for (const k of keys) delete e[k]; return w; };

test('half-specified repairs are rejected; an already-passing run is reported, not searched', () => {
  assert.throws(() => compile(strip(loadFixture('invoice-reconcile.json'), ['clean'])), /given together/);
  const c = compile(strip(loadFixture('invoice-reconcile.json'), ['clean', 'observed']));
  assert.throws(() => diagnose(c, { maxSize: 3 }), /already passes/);
});

test('an unbounded-looking bound on a small workflow terminates', () => {
  const c = compile(loadFixture('release-gate.json'));
  const d = diagnose(c, { maxSize: 6 });
  assert.ok(d);
});

test('diagnosis is repeatable', () => {
  const c = compile(loadFixture('refund-desk.json'));
  assert.deepEqual(JSON.stringify(diagnose(c, { maxSize: 3 })), JSON.stringify(diagnose(c, { maxSize: 3 })));
});

test('insufficient replacements: claim "none work" only after every subset was searched', () => {
  const w = structuredClone(loadFixture('invoice-reconcile.json'));
  for (const e of w.events) if ('clean' in e) e.clean = e.observed;
  const c = compile(w);
  const small = diagnose(c, { maxSize: 1 });
  assert.equal(small.family.length, 0);
  assert.equal(small.searchedEverySubset, false);
  const full = diagnose(c, { maxSize: c.candidates.length });
  assert.equal(full.family.length, 0);
  assert.equal(full.searchedEverySubset, true);
});

test('non-monotone counterexample: all replacements together fail but a subset passes', () => {
  const wf = {
    name: 'overshoot', checks: [{ id: 'c', event: 'out', expect: { eq: 6 } }],
    events: [
      { id: 'a', agent: 'A', op: 'const', value: 5, observed: 1, clean: 5 },
      { id: 'b', agent: 'B', op: 'const', value: 4, observed: 1, clean: 4 },
      { id: 'out', agent: 'C', op: 'add', args: ['a', 'b'] },
    ],
  };
  const c = compile(wf);
  const d = diagnose(c, { maxSize: 2 });
  assert.equal(d.allCandidatesPass, false); // 5 + 4 = 9, not 6
  assert.deepEqual(d.family, [['a']]);      // 5 + 1 = 6
});

test('optional repair cost: validated, summed per set, cheapest flagged', () => {
  const wf = loadFixture('refund-desk.json');
  const d = diagnose(compile(wf), { maxSize: 3 });
  assert.equal(d.costs.custom, true);
  const byKey = Object.fromEntries(d.family.map((f, i) => [f.join('+'), d.costs.perSet[i]]));
  assert.equal(byKey.override, 5);
  assert.equal(Object.values(byKey).includes(6), true); // reason 2 + amount 3 + cap 1
  assert.equal(d.costs.min, 5);
  assert.deepEqual(d.costs.cheapest.filter(Boolean).length, 1);
  const bad = structuredClone(wf); bad.events[0].cost = -1;
  assert.throws(() => compile(bad), /cost must be a positive number/);
  const noCost = diagnose(compile(loadFixture('invoice-reconcile.json')), { maxSize: 2 });
  assert.equal(noCost.costs.custom, false);
});

test('applyEdits: a worse replacement changes the answer; costs set and cleared; bad ids rejected', () => {
  const wf = loadFixture('refund-desk.json');
  const base = diagnose(compile(wf), { maxSize: 3 });
  assert.equal(base.family.length, 2);
  // break the cap replacement: 3-part route no longer passes, only the override remains
  const broken = applyEdits(wf, { cap: { clean: '100' } });
  assert.deepEqual(diagnose(compile(broken), { maxSize: 3 }).family, [['override']]);
  assert.equal(wf.events.find((e) => e.id === 'cap').clean, 150, 'original untouched');
  const nocost = applyEdits(wf, { reason: { cost: '' }, cap: { cost: '' }, refund_amount: { cost: '' }, override: { cost: '' } });
  assert.equal(diagnose(compile(nocost), { maxSize: 3 }).costs.custom, false);
  assert.throws(() => applyEdits(wf, { weather_word: { clean: '1' } }), /not a repair candidate/);
  assert.equal(applyEdits(wf, { reason: { clean: 'sunny' } }).events[0].clean, 'sunny'); // non-JSON text stays a string
  assert.throws(() => compile(applyEdits(wf, { cap: { cost: '-2' } })), /cost must be a positive number/);
});

test('decoy: a tempting single fix that fixes one check but breaks a passing one is labelled, not "irrelevant"', () => {
  const c = compile(loadFixture('order-regression.json'));
  const d = diagnose(c, { maxSize: 3 });
  assert.deepEqual(d.family, [['qty', 'unit']]);
  assert.equal(d.roles.manual_flag.role, 'decoy');
  assert.equal(d.roles.qty.role, 'required-and');
  const j = judgeSet(c, d, ['manual_flag']);
  assert.notEqual(j.kind, 'minimal');
  // original run: one check failing, one passing
  assert.deepEqual(d.baseline.checks.map((k) => k.pass), [false, true]);
});

test('pruning: complete search skips supersets of working sets and replays fewer than exhaustive', () => {
  const c = compile(loadFixture('refund-desk.json'));
  const comp = findFamily(c, { maxSize: 3, mode: 'complete' });
  const exh = findFamily(c, { maxSize: 3, mode: 'exhaustive' });
  assert.ok(comp.skipped.some((s) => s.why.includes('smaller repair')), 'some set was skipped for containing a working subset');
  assert.ok(comp.replayCalls < exh.replayCalls, `${comp.replayCalls} < ${exh.replayCalls}`);
});

test('a candidate whose repair only breaks a passing check is "does not matter", not a decoy', () => {
  const wf = {
    name: 'breaks-only',
    checks: [{ id: 'c1', event: 'x', expect: { eq: 5 } }, { id: 'c2', event: 'y', expect: { truthy: true } }],
    events: [
      { id: 'a', agent: 'A', op: 'const', value: 5, observed: 1, clean: 5 },
      { id: 'z', agent: 'A', op: 'const', value: 0 },
      { id: 'x', agent: 'A', op: 'add', args: ['a', 'z'] },
      { id: 'b', agent: 'B', op: 'const', value: 0, observed: 1, clean: 0 },
      { id: 'y', agent: 'B', op: 'gt', args: ['b', 'z'] },
    ],
  };
  const d = diagnose(compile(wf), { maxSize: 2 });
  assert.deepEqual(d.family, [['a']]);
  assert.equal(d.roles.b.role, 'irrelevant');
});

test('zero cost is rejected', () => {
  const w = structuredClone(loadFixture('refund-desk.json')); w.events[0].cost = 0;
  assert.throws(() => compile(w), /cost must be a positive number/);
});

test('forged witnesses with a valid re-computed hash are still rejected by replay', async () => {
  const { exportWitness, verifyWitness, hashString } = await import('../src/analysis.js');
  const c = compile(loadFixture('refund-desk.json'));
  const good = exportWitness(c, ['override']);
  assert.equal(verifyWitness(good, compile).ok, true);
  const rehash = (body) => ({ ...body, hash: hashString(JSON.stringify(body)) });
  const { hash, evidence, ...body } = good;
  // a set that does not pass
  assert.equal(verifyWitness(rehash({ ...body, repairs: ['cap'] }), compile).ok, false);
  // a passing set that is not minimal
  const nm = verifyWitness(rehash({ ...body, repairs: ['cap', 'override'] }), compile);
  assert.equal(nm.ok, false); assert.match(nm.reason, /not minimal/);
  // an empty repair set on a failing run
  assert.equal(verifyWitness(rehash({ ...body, repairs: [] }), compile).ok, false);
});

test('overshoot-trap fixture: all replacements fail together, yet one alone passes', () => {
  const d = diagnose(compile(loadFixture('overshoot-trap.json')), { maxSize: 2 });
  assert.equal(d.allCandidatesPass, false);
  assert.deepEqual(d.family, [['parcel_a']]);
});

test('irrelevant is not the same as harmless: a non-member can undo a working set', () => {
  const d = diagnose(compile(loadFixture('overshoot-trap.json')), { maxSize: 2 });
  assert.equal(d.roles.parcel_b.role, 'irrelevant');
  assert.deepEqual(d.roles.parcel_b.undoes, ['parcel_a']);
  const r = diagnose(compile(loadFixture('refund-desk.json')), { maxSize: 3 });
  for (const x of Object.values(r.roles)) assert.deepEqual(x.undoes, []);
});

test('README fixture count matches the fixtures directory', async () => {
  const { readdirSync, readFileSync } = await import('node:fs');
  const n = readdirSync(new URL('../fixtures', import.meta.url)).filter((f) => f.endsWith('.json')).length;
  const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(readme, new RegExp(`- ${words[n]} example failed workflows`, 'i'));
});

test('nextBound: cost of raising the bound, null once every subset is covered', () => {
  const c = compile(loadFixture('refund-desk.json')); // 4 candidates
  const d = diagnose(c, { maxSize: 2 });
  assert.deepEqual(d.nextBound, { size: 3, maxSubsets: 15, everyCombination: 16 });
  assert.equal(diagnose(c, { maxSize: 4 }).nextBound, null);
});

const manySum = (k) => {
  const events = [];
  for (let i = 0; i < k; i++) events.push({ id: `p${i}`, agent: 'A', op: 'const', value: 1, observed: 1, clean: 2 });
  events.push({ id: 'sum', agent: 'B', op: 'add', args: Array.from({ length: k }, (_, i) => `p${i}`) });
  return compile({ name: 'many', checks: [{ id: 'c', event: 'sum', expect: { eq: 99999 } }], events }); // unreachable: no pruning possible
};

test('a search that cannot finish within the replay budget stops with a clear message', async () => {
  const { REPLAY_BUDGET } = await import('../src/search.js');
  const t = Date.now();
  assert.throws(() => diagnose(manySum(30), { maxSize: 6 }), /over the limit of 100,000/);
  assert.ok(Date.now() - t < 15000, `took ${Date.now() - t} ms`);
  assert.equal(REPLAY_BUDGET, 100000);
  let out; try { out = diagnose(manySum(30), { maxSize: 6 }); } catch (e) { assert.equal(e.name, 'SearchTooLargeError'); assert.doesNotMatch(e.message, /no combination|none passes|no repair/i); }
  assert.equal(out, undefined, 'budget exhaustion must throw, never return an empty family');
  assert.doesNotThrow(() => diagnose(manySum(30), { maxSize: 3 })); // 4,526 sets
});

test('diagnosis without the every-subset baseline: pruned search runs, baseline reports as not run', () => {
  const events = [];
  for (let i = 0; i < 40; i++) events.push({ id: `p${i}`, agent: 'A', op: 'const', value: false, observed: false, clean: true });
  events.push({ id: 'any', agent: 'B', op: 'or', args: Array.from({ length: 40 }, (_, i) => `p${i}`) });
  const c = compile({ name: 'any-of-40', checks: [{ id: 'c', event: 'any', expect: { truthy: true } }], events });
  const t = Date.now();
  const d = diagnose(c, { maxSize: 4 }); // every-subset baseline would be 102,091 replays
  assert.ok(Date.now() - t < 3000);
  assert.equal(d.family.length, 40);
  assert.equal(d.comparison.baselineRan, false);
  assert.equal(d.comparison.exhaustive, null);
  assert.equal(d.comparison.completeMatchesExhaustive, null);
  assert.equal(d.comparison.complete.replayCalls, 41);
  assert.equal(d.comparison.exhaustiveFormula, 102091);
});

test('input caps: too many events, long ids, oversized or nested payloads are rejected before replay', async () => {
  const { LIMITS } = await import('../src/model.js');
  const base = () => ({ name: 'x', checks: [{ id: 'c', event: 'a', expect: { truthy: true } }], events: [{ id: 'a', agent: 'A', op: 'const', value: 1 }] });
  assert.doesNotThrow(() => compile(base()));
  const many = base(); many.events = Array.from({ length: LIMITS.events + 1 }, (_, i) => ({ id: `e${i}`, agent: 'A', op: 'const', value: 1 })); many.checks[0].event = 'e0';
  assert.throws(() => compile(many), /too many events/);
  const longId = base(); longId.events[0].id = 'x'.repeat(LIMITS.shortText + 1); longId.checks[0].event = longId.events[0].id;
  assert.throws(() => compile(longId), /longer than 200 characters/);
  const bigStr = base(); bigStr.events[0].value = 'y'.repeat(LIMITS.stringValue + 1);
  assert.throws(() => compile(bigStr), /string longer than 2000/);
  const nested = base(); nested.events[0].value = [[1]];
  assert.throws(() => compile(nested), /flat list|plain numbers/);
  const obj = base(); obj.events[0].value = { a: 1 };
  assert.throws(() => compile(obj), /values must be/);
  const manyArgs = base(); manyArgs.events.push({ id: 'b', agent: 'A', op: 'add', args: Array(LIMITS.args + 1).fill('a') });
  assert.throws(() => compile(manyArgs), /more than 64 args/);
});

test('replay stops amplification: doubling concat chains and nested lists fail fast instead of exhausting memory', async () => {
  const { replay, ReplayLimitError } = await import('../src/replay.js');
  const events = [{ id: 's0', agent: 'A', op: 'const', value: 'x'.repeat(1000) }];
  for (let i = 1; i <= 40; i++) events.push({ id: `s${i}`, agent: 'A', op: 'concat', args: [`s${i - 1}`, `s${i - 1}`] });
  const c = compile({ name: 'double', checks: [{ id: 'c', event: 's40', expect: { truthy: true } }], events });
  const t = Date.now();
  assert.throws(() => replay(c, []), ReplayLimitError);
  assert.ok(Date.now() - t < 1000);
  const lists = [{ id: 'l0', agent: 'A', op: 'const', value: 1 }];
  for (let i = 1; i <= 40; i++) lists.push({ id: `l${i}`, agent: 'A', op: 'list', args: [`l${i - 1}`, `l${i - 1}`] });
  const c2 = compile({ name: 'nest', checks: [{ id: 'c', event: 'l40', expect: { truthy: true } }], events: lists });
  assert.throws(() => replay(c2, []), /nested list/);
});

test('parseValue: types are named, bare words are text, JSON-looking typos are errors', async () => {
  const { parseValue } = await import('../src/model.js');
  assert.deepEqual(parseValue('5'), { value: 5, type: 'number' });
  assert.deepEqual(parseValue(' true '), { value: true, type: 'boolean' });
  assert.deepEqual(parseValue('null'), { value: null, type: 'null' });
  assert.deepEqual(parseValue('[1,2]'), { value: [1, 2], type: 'list' });
  assert.deepEqual(parseValue('"x"'), { value: 'x', type: 'text' });
  assert.deepEqual(parseValue('weather'), { value: 'weather', type: 'text' });
  for (const bad of ['{nope', '[1,', '"open', '5,000', '12abc', 'True', 'NULL', 'FALSE']) assert.ok(parseValue(bad).error, bad);
});

test('event ids that collide with Object.prototype names behave like any other id', async () => {
  const { readFileSync } = await import('node:fs');
  const { diagnose, exportWitness, verifyWitness } = await import('../src/analysis.js');
  const { compile } = await import('../src/model.js');
  const raw = readFileSync('fixtures/refund-desk.json', 'utf8');
  const base = diagnose(compile(JSON.parse(raw)), { maxSize: 3 }).family.length;
  for (const id of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'prototype']) {
    const c = compile(JSON.parse(raw.replaceAll('"reason"', JSON.stringify(id))));
    const d = diagnose(c, { maxSize: 3 });
    assert.equal(d.family.length, base, id);
    assert.ok(verifyWitness(JSON.parse(JSON.stringify(exportWitness(c, d.family[0]))), compile).ok, id);
  }
  assert.equal({}.polluted, undefined);
});

test('fuzz: mutated workflows either analyze or fail with a clean validation error, never a raw TypeError', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const junk = [null, undefined, 0, -1, 1e308, '', ' ', 'x', [], {}, [1], { a: 1 }, true, NaN, '__proto__', 'a'.repeat(300)];
  const mutate = (o) => {
    if (o && typeof o === 'object') {
      const ks = Object.keys(o); if (!ks.length || rnd() < 0.15) return pick(junk);
      const k = pick(ks);
      if (rnd() < 0.35) { if (Array.isArray(o)) o.splice(Number(k), 1); else delete o[k]; } else if (rnd() < 0.5) o[k] = pick(junk); else o[k] = mutate(o[k]);
    }
    return o;
  };
  const files = readdirSync('fixtures').map((f) => readFileSync('fixtures/' + f, 'utf8'));
  const crashes = {}; let analyzed = 0;
  for (let i = 0; i < 2000; i++) {
    const w = JSON.parse(pick(files));
    for (let m = 0; m < 1 + Math.floor(rnd() * 3); m++) mutate(w);
    try { diagnose(compile(w), { maxSize: 2 }); analyzed++; } catch (e) { if (e instanceof TypeError || e instanceof RangeError || e instanceof ReferenceError) crashes[e.message.slice(0, 80)] = (crashes[e.message.slice(0, 80)] ?? 0) + 1; }
  }
  assert.deepEqual(crashes, {});
  assert.ok(analyzed > 500, `only ${analyzed} mutants analyzed; the fuzz is not exercising the engine`);
});

test('witness: an edited evidence summary or a non-object file is rejected, not accepted or thrown on', async () => {
  const { exportWitness, verifyWitness } = await import('../src/analysis.js');
  const c = compile(loadFixture('refund-desk.json'));
  const d = diagnose(c, { maxSize: 3 });
  const w = JSON.parse(JSON.stringify(exportWitness(c, d.family[0])));
  assert.ok(verifyWitness(w, compile).ok);
  const lied = { ...w, evidence: { ...w.evidence, subsetsAllFail: !w.evidence.subsetsAllFail } };
  assert.match(verifyWitness(lied, compile).reason, /evidence summary does not match/);
  const { evidence, ...noEvidence } = w;
  assert.ok(verifyWitness(noEvidence, compile).ok, 'the summary is optional; the replay is what is checked');
  for (const x of [null, undefined, 0, 's', [], true]) assert.equal(verifyWitness(x, compile).ok, false);
  assert.match(verifyWitness({ not: 'a witness' }, compile).reason, /not a Repair Atlas witness file/);
  assert.match(verifyWitness({ ...w, workflow: undefined }, compile).reason, /not a Repair Atlas witness file/);
  assert.match(verifyWitness({ ...w, repairs: [...w.repairs, 'cap'] }, compile).reason, /hash mismatch/, 'a real witness that was edited still says so');
});

test('a candidate outside every repair is only described as "in no repair" for the domain that was searched', async () => {
  const { roleNote } = await import('../src/analysis.js');
  // 4 repairs are all needed together (sum must reach 4), so a bound of 2 finds nothing, yet each one matters
  const ev = [0, 1, 2, 3].map((i) => ({ id: `c${i}`, agent: 'A', label: `c${i}`, op: 'const', value: 0, observed: 0, clean: 1 }));
  ev.push({ id: 'total', agent: 'A', label: 'total', op: 'add', args: ev.map((e) => e.id) });
  const wf = { name: 'needs all four', events: ev, checks: [{ id: 'k', event: 'total', expect: { eq: 4 } }] };
  const c = compile(wf);
  const bounded = diagnose(c, { maxSize: 2 });
  assert.equal(bounded.family.length, 0);
  assert.equal(roleNote(bounded, bounded.roles.c0), 'in no repair of up to 2');
  assert.doesNotMatch(roleNote(bounded, bounded.roles.c0), /does not matter|irrelevant/);
  const full = diagnose(c, { maxSize: 4 });
  assert.equal(full.family.length, 1);
  assert.equal(full.roles.c0.role, 'required-and');
  // exhaustive search over a workflow where a candidate really is in no repair: wording is about minimal repairs, not about relevance
  const ov = loadFixture('overshoot-trap.json'); const co = compile(ov);
  const dx = diagnose(co, { maxSize: co.candidates.length });
  const irr = Object.values(dx.roles).find((r) => r.role === 'irrelevant');
  assert.ok(dx.searchedEverySubset && irr);
  assert.match(roleNote(dx, irr), /^in no minimal repair/);
});
