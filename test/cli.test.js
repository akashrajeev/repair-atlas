import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
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
  const json = out.slice(out.indexOf('{'));
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
  assert.equal(r.stdout.trim().split('\n').length, 7);
  assert.match(cli().stdout, /usage/);
});
