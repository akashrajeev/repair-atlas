import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { fixtureFiles, loadFixture } from './helpers.js';
import { compile } from '../src/model.js';
import { diagnose } from '../src/analysis.js';

const workerSrc = `
import { parentPort, workerData } from 'node:worker_threads';
import { compile } from '${new URL('../src/model.js', import.meta.url).href}';
import { diagnose } from '${new URL('../src/analysis.js', import.meta.url).href}';
const c = compile(workerData.wf);
const d = diagnose(c, { maxSize: workerData.q });
parentPort.postMessage({ formula: d.formula, calls: d.comparison.complete.replayCalls });
`;

test('concurrency: 6 fixtures diagnosed in parallel workers match the serial result', async () => {
  const jobs = fixtureFiles.map((f) => {
    const wf = loadFixture(f); const q = wf.defaultMaxSize ?? 2;
    return new Promise((res, rej) => {
      const w = new Worker(workerSrc, { eval: true, workerData: { wf, q } });
      w.on('message', (m) => res({ f, ...m, q })); w.on('error', rej);
    });
  });
  const out = await Promise.all(jobs);
  for (const o of out) {
    const d = diagnose(compile(loadFixture(o.f)), { maxSize: o.q });
    assert.equal(o.formula, d.formula, o.f);
    assert.equal(o.calls, d.comparison.complete.replayCalls, o.f);
  }
});

test('concurrency: repeated interleaved diagnoses are stable', async () => {
  const wf = loadFixture('refund-desk.json');
  const runs = await Promise.all(Array.from({ length: 24 }, async () => diagnose(compile(wf), { maxSize: 3 }).formula));
  assert.equal(new Set(runs).size, 1);
});
