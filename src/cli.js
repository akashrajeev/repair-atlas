#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { compile, LIMITS } from './model.js';
import { diagnose, exportWitness, verifyWitness, reportMarkdown, judgeSet, roleNote } from './analysis.js';

process.on('uncaughtException', (e) => { if (process.env.RA_DEBUG) throw e; console.error(e.code === 'ENOENT' ? `cannot read ${e.path}: no such file` : e.message); process.exit(1); }); // one-line errors, no stack; RA_DEBUG=1 shows the stack
const [cmd, file, ...rest] = process.argv.slice(2);
const load = (f) => {
  if (statSync(f).size > LIMITS.fileBytes) { console.error(`${f} is larger than ${LIMITS.fileBytes.toLocaleString('en-US')} bytes, over the input limit`); process.exit(1); }
  try { return JSON.parse(readFileSync(f, 'utf8')); } catch (e) { console.error(`${f} is not valid JSON: ${e.message}`); process.exit(1); }
};

if (cmd === 'analyze' && file) {
  const wf = load(file);
  const q = Number(rest.find((a) => /^\d+$/.test(a)) ?? wf.defaultMaxSize ?? 2);
  const c = compile(wf);
  const d = diagnose(c, { maxSize: q });
  if (rest.includes('--json')) {
    console.log(JSON.stringify({ name: wf.name, bound: q, searchedEverySubset: d.searchedEverySubset, nextBound: d.nextBound, formula: d.formula, kind: d.kind, repairSets: d.family.map((f, i) => ({ events: f, cost: d.costs.custom ? d.costs.perSet[i] : undefined, cheapest: d.costs.custom ? d.costs.cheapest[i] : undefined })), roles: Object.fromEntries(Object.entries(d.roles).map(([k, r]) => [k, r.role])), roleNotes: Object.fromEntries(Object.entries(d.roles).map(([k, r]) => [k, roleNote(d, r)])), breaksIfAdded: Object.fromEntries(Object.entries(d.roles).filter(([, r]) => r.undoes.length).map(([k, r]) => [k, r.undoes])), replays: { complete: d.comparison.complete.replayCalls, exhaustive: d.comparison.exhaustive ? d.comparison.exhaustive.replayCalls : null } }, null, 2));
    process.exit(d.family.length ? 0 : 2);
  }
  const log = rest.includes('--witness') ? console.error : console.log; // keep stdout pure JSON so `> witness.json` verifies
  log(`${wf.name}  (bound q=${q})`);
  log(`  recovery formula : ${d.formula}`);
  log(`  kind             : ${d.kind}`);
  log(`  searched         : ${d.searchedEverySubset ? 'every combination' : `sets of up to ${d.maxSize} of ${c.candidates.length} replacements; bound ${d.nextBound.size} would replay at most ${d.nextBound.maxSubsets} sets`}`);
  for (const [id, r] of Object.entries(d.roles)) log(`  ${id.padEnd(16)} ${r.role === 'irrelevant' ? roleNote(d, r) : r.role}`);
  const cmp = d.comparison;
  log(`  replays          : complete=${cmp.complete.replayCalls} exhaustive=${cmp.exhaustive ? cmp.exhaustive.replayCalls : 'not run (' + cmp.exhaustiveFormula + ' would be needed)'} paper-rule=${cmp.paper.replayCalls}`);
  log(cmp.baselineRan ? `  paper pair rule matches exhaustive: ${cmp.paper.matchesExhaustive}${cmp.paper.missed.length ? ' (misses ' + cmp.paper.missed.join(', ') + ')' : ''}` : `  ${d.searchedEverySubset ? 'every-combination' : `every-set-up-to-${d.maxSize}`} cross-check: not run (too large for routine diagnosis)`);
  if (rest.includes('--witness') && d.family[0]) console.log(JSON.stringify(exportWitness(c, d.family[0]), null, 2));
} else if (cmd === 'report' && file) {
  const wf = load(file); const c = compile(wf);
  console.log(reportMarkdown(c, diagnose(c, { maxSize: Number(rest.find((a) => /^\d+$/.test(a)) ?? wf.defaultMaxSize ?? 2) })));
} else if (cmd === 'judge' && file) {
  const wf = load(file); const c = compile(wf);
  const set = (rest.find((a) => !a.startsWith('--') && !/^\d+$/.test(a)) ?? '').split(',').filter(Boolean);
  const bad = set.filter((id) => !c.candidates.includes(id));
  if (!set.length || bad.length) { console.error(`pick candidate ids, comma separated. unknown: ${bad.join(', ') || '(none given)'}`); process.exit(1); }
  const d = diagnose(c, { maxSize: Math.max(set.length, Number(rest.find((a) => /^\d+$/.test(a)) ?? wf.defaultMaxSize ?? 2)) });
  const j = judgeSet(c, d, set);
  const word = { minimal: 'works, and no subset of it works', extra: 'works, but contains a smaller working set', undone: 'does not work: it contains a working set, and the extra replacements break it', partial: 'does not work, but part of a working set', none: 'does not work' }[j.kind];
  console.log(`{${set.join(', ')}}: ${j.kind} - ${word}${j.missing.length ? '; still needed: ' + j.missing.join(', ') : ''}${j.extra.length ? (j.kind === 'undone' ? '; breaking it: ' : '; not needed: ') + j.extra.join(', ') : ''}`);
  process.exit(j.kind === 'minimal' || j.kind === 'extra' ? 0 : 2);
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
  console.log('usage: node src/cli.js analyze <workflow.json> [q] [--witness|--json] | report <workflow.json> [q] | judge <workflow.json> a,b [q] | verify <witness.json> | all');
}
