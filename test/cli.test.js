import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cli = (...a) => spawnSync('node', ['src/cli.js', ...a], { encoding: 'utf8' });

test('cli analyze prints the formula', () => {
  const r = cli('analyze', 'fixtures/refund-desk.json');
  assert.match(r.stdout, /override OR \(reason AND refund_amount AND cap\)/);
  assert.match(r.stdout, /misses/);
});

test('cli: exported witness verifies, edited witness is rejected', () => {
  const out = execFileSync('node', ['src/cli.js', 'analyze', 'fixtures/invoice-reconcile.json', '--witness'], { encoding: 'utf8' });
  const json = out; // README flow: stdout redirected straight to a file must be pure JSON
  const dir = mkdtempSync(join(tmpdir(), 'ra-'));
  const good = join(dir, 'w.json'); writeFileSync(good, json);
  const ok = cli('verify', good);
  assert.equal(ok.status, 0); assert.match(ok.stdout, /VERIFIED/);
  const bad = join(dir, 'bad.json'); writeFileSync(bad, json.replace('"line_items"', '"rounding"'));
  const no = cli('verify', bad);
  assert.equal(no.status, 1); assert.match(no.stdout, /REJECTED/);
});

test('cli: all fixtures listed, usage on no args', () => {
  const r = cli('all');
  assert.equal(r.stdout.trim().split("\n").length, 9);
  assert.match(cli().stdout, /usage/);
});

test('cli report: markdown names the sets, the minimality definition and the limits', () => {
  const r = cli('report', 'fixtures/refund-desk.json', '3');
  assert.match(r.stdout, /# Repair report: Refund desk/);
  assert.match(r.stdout, /Manager override \(fixes it alone\)/);
  assert.match(r.stdout, /all 3 needed together/);
  assert.match(r.stdout, /inclusion-minimal/);
  assert.match(r.stdout, /not re-runs of a live system/);
  assert.match(r.stdout, /cost 5 \(cheapest\)/);
});

test('cli analyze --json: machine-readable result, exit 0 with repairs, exit 2 without', () => {
  const r = cli('analyze', 'fixtures/refund-desk.json', '3', '--json');
  assert.equal(r.status, 0);
  const o = JSON.parse(r.stdout);
  assert.equal(o.repairSets.length, 2);
  assert.equal(o.roles.override, 'solo');
  assert.equal(o.searchedEverySubset, false);
  const none = cli('analyze', 'fixtures/refund-desk.json', '1', '--json');
  assert.equal(JSON.parse(none.stdout).repairSets.length, 1);
  const dir = mkdtempSync(join(tmpdir(), 'ra-'));
  const wf = JSON.parse(execFileSync('cat', ['fixtures/invoice-reconcile.json'], { encoding: 'utf8' }));
  for (const e of wf.events) if ('clean' in e) e.clean = e.observed;
  const f = join(dir, 'nofix.json'); writeFileSync(f, JSON.stringify(wf));
  const n = cli('analyze', f, '4', '--json');
  assert.equal(n.status, 2);
  assert.equal(JSON.parse(n.stdout).repairSets.length, 0);
});

test('cli judge: minimal, extra, partial and unknown ids', () => {
  const f = 'fixtures/refund-desk.json';
  const a = cli('judge', f, 'override'); assert.equal(a.status, 0); assert.match(a.stdout, /minimal/);
  const b = cli('judge', f, 'override,cap'); assert.equal(b.status, 0); assert.match(b.stdout, /extra/); assert.match(b.stdout, /not needed: cap/);
  const c = cli('judge', f, 'reason,cap'); assert.equal(c.status, 2); assert.match(c.stdout, /partial/); assert.match(c.stdout, /refund_amount/);
  const d = cli('judge', f, 'nope'); assert.equal(d.status, 1);
});

test('cli analyze --json lists replacements that break a working set when added', () => {
  const o = JSON.parse(cli('analyze', 'fixtures/overshoot-trap.json', '--json').stdout);
  assert.deepEqual(o.breaksIfAdded, { parcel_b: ['parcel_a'] });
  assert.equal(o.roles.parcel_b, 'irrelevant');
  assert.deepEqual(JSON.parse(cli('analyze', 'fixtures/refund-desk.json', '--json').stdout).breaksIfAdded, {});
});

test('cli states what the search covered, text and json', () => {
  const t = cli('analyze', 'fixtures/refund-desk.json', '2').stdout;
  assert.match(t, /searched\s+: sets of up to 2 of 4 replacements; bound 3 would replay at most 15 sets/);
  assert.match(cli('analyze', 'fixtures/refund-desk.json', '4').stdout, /searched\s+: every combination/);
  assert.deepEqual(JSON.parse(cli('analyze', 'fixtures/refund-desk.json', '2', '--json').stdout).nextBound, { size: 3, maxSubsets: 15, everyCombination: 16 });
});

test('cli stops an unfinishable search with exit 1 and a clear message, and reports a skipped baseline', () => {
  const mk = (events, check) => { const f = join(tmpdir(), `ra-big-${process.pid}-${Math.random().toString(36).slice(2)}.json`); writeFileSync(f, JSON.stringify({ name: 'big', checks: [check], events })); return f; };
  const consts = (k, obs, clean) => Array.from({ length: k }, (_, i) => ({ id: `p${i}`, agent: 'A', op: 'const', value: obs, observed: obs, clean }));
  const args = (k) => Array.from({ length: k }, (_, i) => `p${i}`);
  const hard = mk([...consts(30, 1, 2), { id: 'sum', agent: 'B', op: 'add', args: args(30) }], { id: 'c', event: 'sum', expect: { eq: 99999 } });
  const r = cli('analyze', hard, '6');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /over the limit of 100,000/);
  assert.equal(r.stdout, ''); // nothing that could read as a result
  assert.doesNotMatch(r.stderr, /no combination|none passes|no repair|none within bound/i);
  const easy = mk([...consts(40, false, true), { id: 'any', agent: 'B', op: 'or', args: args(40) }], { id: 'c', event: 'any', expect: { truthy: true } });
  const ok = cli('analyze', easy, '4');
  assert.equal(ok.status, 0);
  assert.match(ok.stdout, /every-set-up-to-4 cross-check: not run/);
  assert.doesNotMatch(ok.stdout, /every-combination cross-check/); // bound 4 of 40 is not every combination
  assert.equal(JSON.parse(cli('analyze', easy, '4', '--json').stdout).replays.exhaustive, null);
});

test('cli rejects a workflow file over the size limit', () => {
  const f = join(tmpdir(), `ra-huge-${process.pid}.json`);
  writeFileSync(f, JSON.stringify({ name: 'huge', pad: 'z'.repeat(600000) }));
  const r = cli('analyze', f);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /over the input limit/);
});

test('cli judge: a working set plus a breaking extra is "undone", not "partial"', () => {
  const r = cli('judge', 'fixtures/overshoot-trap.json', 'parcel_a,parcel_b');
  assert.equal(r.status, 2);
  assert.match(r.stdout, /undone/);
  assert.match(r.stdout, /breaking it: parcel_b/);
});

test('package.json parses and its scripts point at real files', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.match(pkg.scripts.test, /node --test/);
  assert.ok(existsSync('scripts/serve.js'));
  const r = spawnSync('npm', ['run', '--silent', 'analyze', '--', 'fixtures/refund-desk.json', '--json'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(JSON.parse(r.stdout).repairSets.length > 0);
});

test('cli: missing file and malformed workflow give one-line errors, not stack traces', () => {
  for (const args of [['analyze', 'does-not-exist.json'], ['analyze', 'package.json'], ['report', 'does-not-exist.json']]) {
    const r = cli(...args);
    assert.equal(r.status, 1, args.join(' '));
    assert.doesNotMatch(r.stderr, /\n\s+at /);
    assert.ok(r.stderr.trim().split('\n').length <= 2, r.stderr);
  }
});

test('cli json: roleNotes carry the searched scope next to the stable roles key', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ra-rn-'));
  const ev = [0, 1, 2, 3].map((i) => ({ id: `c${i}`, agent: 'A', label: `c${i}`, op: 'const', value: 0, observed: 0, clean: 1 }));
  ev.push({ id: 'total', agent: 'A', label: 'total', op: 'add', args: ev.map((e) => e.id) });
  const f = join(dir, 'w.json'); writeFileSync(f, JSON.stringify({ name: 'all four', events: ev, checks: [{ id: 'k', event: 'total', expect: { eq: 4 } }] }));
  const j = JSON.parse(cli('analyze', f, '2', '--json').stdout);
  assert.equal(j.roles.c0, 'irrelevant');
  assert.equal(j.searchedEverySubset, false);
  assert.equal(j.roleNotes.c0, 'in no repair of up to 2');
  const k = JSON.parse(cli('analyze', f, '4', '--json').stdout);
  assert.equal(k.roles.c0, 'required-and');
});
