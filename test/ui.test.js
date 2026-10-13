import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
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
