import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../src/model.js';
import { diagnose } from '../src/analysis.js';
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
