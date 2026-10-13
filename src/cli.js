#!/usr/bin/env node
import { readFileSync, readdirSync } from 'node:fs';
import { compile } from './model.js';
import { diagnose, exportWitness, verifyWitness } from './analysis.js';

const [cmd, file, ...rest] = process.argv.slice(2);
const load = (f) => JSON.parse(readFileSync(f, 'utf8'));

if (cmd === 'analyze' && file) {
  const wf = load(file);
  const q = Number(rest.find((a) => /^\d+$/.test(a)) ?? wf.defaultMaxSize ?? 2);
  const c = compile(wf);
  const d = diagnose(c, { maxSize: q });
  console.log(`${wf.name}  (bound q=${q})`);
  console.log(`  recovery formula : ${d.formula}`);
  console.log(`  kind             : ${d.kind}`);
  for (const [id, r] of Object.entries(d.roles)) console.log(`  ${id.padEnd(16)} ${r.role}`);
  const cmp = d.comparison;
  console.log(`  replays          : complete=${cmp.complete.replayCalls} exhaustive=${cmp.exhaustive.replayCalls} paper-rule=${cmp.paper.replayCalls}`);
  console.log(`  paper pair rule matches exhaustive: ${cmp.paper.matchesExhaustive}${cmp.paper.missed.length ? ' (misses ' + cmp.paper.missed.join(', ') + ')' : ''}`);
  if (rest.includes('--witness') && d.family[0]) console.log(JSON.stringify(exportWitness(c, d.family[0]), null, 2));
} else if (cmd === 'verify' && file) {
  const r = verifyWitness(load(file), compile);
  console.log(r.ok ? `VERIFIED: ${r.reason}` : `REJECTED: ${r.reason}`);
  process.exit(r.ok ? 0 : 1);
} else if (cmd === 'all') {
  for (const f of readdirSync('fixtures').filter((x) => x.endsWith('.json'))) {
    const wf = load(`fixtures/${f}`); const d = diagnose(compile(wf), { maxSize: wf.defaultMaxSize ?? 2 });
    console.log(`${f.padEnd(26)} ${d.formula}`);
  }
} else {
  console.log('usage: node src/cli.js analyze <workflow.json> [q] [--witness] | verify <witness.json> | all');
}
