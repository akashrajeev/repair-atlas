// Mutation check: break the engine in small ways and confirm the tests notice.
// Usage: node scripts/mutate.js   (copies the repo to a temp dir; never edits your files)
import { cpSync, readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const mutants = [
  ['search.js', 'for (let k = 1; k <= maxSize; k++)', 'for (let k = 1; k < maxSize; k++)', 'size loop off by one'],
  ['search.js', "if (backend.run([])) throw new NothingToRepairError();", "", 'passing run no longer rejected'],
  ['search.js', "const ok = backend.run(set);", "const ok = !backend.run(set);", 'success inverted'],
  ['search.js', "(mode !== 'exhaustive' && hasWinningSubset)", "(false)", 'minimality pruning disabled'],
  ['search.js', "const pool = mode === 'exhaustive' ? c.candidates.slice() : slice(c);", "const pool = c.candidates.slice(1);", 'a candidate dropped from the pool'],
  ['search.js', "g.length < f.length && isSubset(g, f)", "g.length > f.length && isSubset(g, f)", 'final minimal filter reversed'],
  ['analysis.js', "inSets.every((f) => f.length === 1)) role = 'solo'", "inSets.every((f) => f.length === 2)) role = 'solo'", 'solo role wrong'],
  ['analysis.js', "fixesOne && breaksOne ? 'decoy'", "fixesOne || breaksOne ? 'decoy'", 'decoy rule loosened'],
  ['analysis.js', "searchedEverySubset: maxSize >= c.candidates.length", "searchedEverySubset: maxSize >= 1", 'exhaustive flag always true'],
  ['analysis.js', "x === minCost", "x !== minCost", 'cheapest inverted'],
  ['model.js', "e.cost > 0", "e.cost >= 0", 'zero cost accepted'],
];
const unit = ['test/engine.test.js', 'test/property.test.js', 'test/edge.test.js', 'test/domain.test.js', 'test/cli.test.js', 'test/concurrency.test.js'];
let killed = 0;
const rows = [];
for (const [file, from, to, name] of mutants) {
  const dir = mkdtempSync(join(tmpdir(), 'mut-'));
  cpSync('.', dir, { recursive: true, filter: (p) => !/node_modules|\.git(\/|$)/.test(p) });
  const path = join(dir, 'src', file);
  const src = readFileSync(path, 'utf8');
  if (!src.includes(from)) { rows.push(`SKIP    ${name} (pattern not found)`); rmSync(dir, { recursive: true }); continue; }
  writeFileSync(path, src.replace(from, to));
  const r = spawnSync('node', ['--test', ...unit], { cwd: dir, encoding: 'utf8' });
  const dead = r.status !== 0; if (dead) killed++;
  rows.push(`${dead ? 'KILLED ' : 'SURVIVED'} ${name}`);
  rmSync(dir, { recursive: true });
}
console.log(rows.join('\n'));
console.log(`\n${killed}/${rows.filter((x) => !x.startsWith('SKIP')).length} mutants caught by the unit/property/CLI tests`);
