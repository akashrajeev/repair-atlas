import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, cpSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compile } from '../src/model.js';
import { layout, NODE } from '../ui/layout.js';
import { fixtureFiles, loadFixture } from './helpers.js';

test('layout: no two events overlap, every event sits inside its agent lane', () => {
  for (const f of fixtureFiles) {
    const c = compile(loadFixture(f)); const L = layout(c);
    const boxes = [...L.pos.entries()];
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const [, a] = boxes[i], [, b] = boxes[j];
      const apart = a.x + NODE.w <= b.x || b.x + NODE.w <= a.x || a.y + NODE.h <= b.y || b.y + NODE.h <= a.y;
      assert.ok(apart, `${f}: ${boxes[i][0]} overlaps ${boxes[j][0]}`);
    }
    for (const [id, p] of boxes) {
      const lane = L.lanes.find((l) => l.agent === p.agent);
      assert.ok(p.y >= lane.y && p.y + NODE.h <= lane.y + lane.h + 14, `${f}: ${id} outside lane`);
      assert.ok(p.x + NODE.w <= L.width && p.y + NODE.h <= L.height, `${f}: ${id} outside canvas`);
    }
    // arrows always point left to right
    for (const e of c.events) for (const a of e.args ?? []) assert.ok(L.pos.get(a).x < L.pos.get(e.id).x, `${f}: ${a} -> ${e.id}`);
  }
});

const chrome = ['/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
test('browser smoke: every fixture renders the formula and zero page errors', { skip: !chrome && 'no chrome installed' }, async () => {
  const srv = spawn('node', ['scripts/serve.js'], { env: { ...process.env, PORT: '5191' }, stdio: 'pipe' });
  await new Promise((r) => srv.stdout.once('data', r));
  try {
    for (const f of fixtureFiles) {
      const key = f.split('-')[0];
      const dom = execFileSync(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--virtual-time-budget=4000', '--dump-dom', `http://127.0.0.1:5191/?f=${key}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      assert.match(dom, /id="formula"[^>]*>(?!\s*<\/div>)/, f);
      assert.ok(dom.includes('class="node'), `${f}: nodes drawn`);
      assert.ok(!/class="err"/.test(dom), `${f}: no error panel`);
      assert.ok(/Minimal: the repaired run passes/.test(dom), `${f}: proof rendered`);
    }
  } finally { srv.kill(); }
});

test('browser: guide panel opens with ?tour', { skip: !chrome && 'no chrome installed' }, async () => {
  const srv = spawn('node', ['scripts/serve.js'], { env: { ...process.env, PORT: '5193' }, stdio: 'pipe' });
  await new Promise((r) => srv.stdout.once('data', r));
  try {
    const dom = execFileSync(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--virtual-time-budget=4000', '--dump-dom', 'http://127.0.0.1:5193/?f=refund&tour=1'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    assert.match(dom, /2\/5 The answer/);
  } finally { srv.kill(); }
});

test('browser: repairable events are keyboard-focusable buttons', { skip: !chrome && 'no chrome installed' }, async () => {
  const srv = spawn('node', ['scripts/serve.js'], { env: { ...process.env, PORT: '5194' }, stdio: 'pipe' });
  await new Promise((r) => srv.stdout.once('data', r));
  try {
    const dom = execFileSync(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--virtual-time-budget=4000', '--dump-dom', 'http://127.0.0.1:5194/?f=refund'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const n = (dom.match(/tabindex="0"[^>]*role="button"|role="button"[^>]*tabindex="0"/g) ?? []).length;
    assert.ok(n >= 3, `focusable candidate nodes: ${n}`);
  } finally { srv.kill(); }
});

test('browser: edit-replacements dialog lists every candidate', { skip: !chrome && 'no chrome installed' }, async () => {
  const srv = spawn('node', ['scripts/serve.js'], { env: { ...process.env, PORT: '5195' }, stdio: 'pipe' });
  await new Promise((r) => srv.stdout.once('data', r));
  try {
    const dom = execFileSync(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--virtual-time-budget=4000', '--dump-dom', 'http://127.0.0.1:5195/?f=refund&edit=1'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    assert.equal((dom.match(/data-f="clean"/g) ?? []).length, 4);
    assert.match(dom, /Edit replacements<\/h2>/);
  } finally { srv.kill(); }
});

test('browser: bound selector offers an every-combination option', { skip: !chrome && 'no chrome installed' }, async () => {
  const srv = spawn('node', ['scripts/serve.js'], { env: { ...process.env, PORT: '5196' }, stdio: 'pipe' });
  await new Promise((r) => srv.stdout.once('data', r));
  try {
    const dump = (q) => execFileSync(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--virtual-time-budget=4000', '--dump-dom', `http://127.0.0.1:5196/?f=${q}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    assert.match(dump('refund'), /4 \(?[a-z]*\)? ?- every combination|4 - every combination/);
    const inc = dump('incident');
    assert.match(inc, /value="6"[^>]*>6 - every combination/);
  } finally { srv.kill(); }
});

test('browser: scope note states what the search covered', { skip: !chrome && 'no chrome installed' }, async () => {
  const srv = spawn('node', ['scripts/serve.js'], { env: { ...process.env, PORT: '5197' }, stdio: 'pipe' });
  await new Promise((r) => srv.stdout.once('data', r));
  try {
    const dom = execFileSync(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--virtual-time-budget=4000', '--dump-dom', 'http://127.0.0.1:5197/?f=overshoot'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    assert.match(dom, /id="scope-note"[^>]*>Searched every combination of the 2 supplied replacements/);
    const dom2 = execFileSync(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--virtual-time-budget=4000', '--dump-dom', 'http://127.0.0.1:5197/?f=refund'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    assert.match(dom2, /id="scope-note"[^>]*>Searched sets of up to 3 of the 4 supplied replacements\. Larger repairs were not searched\. Raising the bound to 4 covers every combination \(16 sets\)\./);
  } finally { srv.kill(); }
});

test('browser: a search over the replay budget shows an error and clears every result panel', { skip: !chrome && 'no chrome installed' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ra-ui-'));
  for (const d of ['ui', 'src', 'scripts']) cpSync(d, join(dir, d), { recursive: true });
  cpSync('fixtures', join(dir, 'fixtures'), { recursive: true });
  const events = Array.from({ length: 60 }, (_, i) => ({ id: `p${i}`, agent: 'A', op: 'const', value: 1, observed: 1, clean: 2 }));
  events.push({ id: 'sum', agent: 'B', op: 'add', args: events.map((e) => e.id) });
  writeFileSync(join(dir, 'fixtures', 'zz-hard.json'), JSON.stringify({ name: 'Hard', defaultMaxSize: 4, events, checks: [{ id: 'c', event: 'sum', expect: { eq: 99999 } }] }));
  const srv = spawn('node', ['scripts/serve.js'], { cwd: dir, env: { ...process.env, PORT: '5198' }, stdio: 'pipe' });
  await new Promise((r) => srv.stdout.once('data', r));
  try {
    // 60 replacements at bound 4 is about 523,000 sets, over the 100,000 budget
    const ok = execFileSync(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--virtual-time-budget=8000', '--dump-dom', 'http://127.0.0.1:5198/?f=zz'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    assert.match(ok, /id="load-error"[^>]*>The search for repairs of up to 4 of 60 replacements passed/);
    assert.doesNotMatch(ok, /No combination|No repair of size|none passes/);
    assert.match(ok, /id="formula"[^>]*><\/div>/); // formula panel emptied
    assert.match(ok, /id="compare"[^>]*><\/div>/);
  } finally { srv.kill(); rmSync(dir, { recursive: true, force: true }); }
});
