import { readFileSync, readdirSync } from 'node:fs';
import { compile } from '../src/model.js';

export const fixtureFiles = readdirSync(new URL('../fixtures/', import.meta.url)).filter((f) => f.endsWith('.json'));
export const loadFixture = (f) => JSON.parse(readFileSync(new URL(`../fixtures/${f}`, import.meta.url), 'utf8'));

/** Seeded PRNG (mulberry32) so property tests are reproducible. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Random layered numeric workflow with some corrupted candidates and a threshold check. */
export function randomWorkflow(seed) {
  const r = rng(seed);
  const pick = (n) => Math.floor(r() * n);
  const nIn = 3 + pick(5), nMid = 1 + pick(4);
  const agents = ['A', 'B', 'C', 'D'];
  const events = [];
  for (let i = 0; i < nIn; i++) {
    const v = 1 + pick(9);
    const e = { id: `i${i}`, agent: agents[pick(4)], op: 'const', value: v };
    if (r() < 0.7) { e.observed = v + 1 + pick(5); e.clean = v; }
    events.push(e);
  }
  const ops = ['add', 'max', 'min', 'mul'];
  const ids = events.map((e) => e.id);
  for (let m = 0; m < nMid; m++) {
    const k = 2 + pick(2);
    const args = Array.from({ length: k }, () => ids[pick(ids.length)]);
    const e = { id: `m${m}`, agent: agents[pick(4)], op: ops[pick(4)], args };
    if (r() < 0.25) { e.observed = 1 + pick(40); e.clean = 1 + pick(40); }
    events.push(e); ids.push(e.id);
  }
  events.push({ id: 'out', agent: 'D', op: ['add', 'max'][pick(2)], args: ids.slice(-Math.min(3, ids.length)) });
  const clean = { events: events.map((e) => ({ ...e })) };
  // threshold chosen so the all-clean run passes and the corrupted run usually fails
  const cw = { name: 'r', events, checks: [{ id: 'c', event: 'out', expect: { truthy: true } }] };
  const probe = compile({ ...cw, checks: [{ id: 'c', event: 'out', expect: { gte: -1e9 } }] });
  return { cw, probe, r, pick };
}
