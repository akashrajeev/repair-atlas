import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadFixture } from './helpers.js';
import { cdp, sleep } from './cdp.js';

const chrome = ['/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);

const SNAP = `(() => { const t = (s) => document.querySelector(s).innerText.trim(); return JSON.stringify({
  formula: t('#formula'), kind: t('#kind'), families: t('#families'), roles: t('#roles'), compare: t('#compare'), proof: t('#proof'), wtitle: t('#wtitle'),
  nodes: document.querySelectorAll('#graph g, #graph rect').length,
  dl: document.querySelector('#dl').disabled, rep: document.querySelector('#rep').disabled, play: document.querySelector('#play').disabled,
  title: t('#title'), story: t('#story'), kindShown: getComputedStyle(document.querySelector('#kind')).display !== 'none',
  picked: document.querySelector('#pick').selectedOptions[0].textContent,
  err: !!document.querySelector('#load-error') }); })()`;
const IMPORT = (json) => `(async () => { document.querySelector('#importBtn').click(); await new Promise(r => setTimeout(r, 100)); document.querySelector('#dlgText').value = ${JSON.stringify(JSON.stringify(json))}; document.querySelector('#dlgGo').click(); await new Promise(r => setTimeout(r, 2500)); return true; })()`;

test('browser: valid workflow -> over-budget import clears every panel and disables exports -> valid import recovers', { skip: !chrome && 'no chrome installed' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ra-stale-'));
  const srv = spawn('node', ['scripts/serve.js'], { env: { ...process.env, PORT: '5199' }, stdio: 'pipe' });
  await new Promise((r) => srv.stdout.once('data', r));
  const ch = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=9333', `--user-data-dir=${dir}`, '--window-size=1400,1000', 'about:blank'], { stdio: 'ignore' });
  let page;
  try {
    page = await cdp(9333);
    await page.send('Page.navigate', { url: 'http://127.0.0.1:5199/?f=refund' });
    await sleep(2500);
    const shot = async (name) => { if (process.env.RA_SHOTS) { const r = await page.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(process.env.RA_SHOTS, name), Buffer.from(r.result.data, 'base64')); } };

    const good = JSON.parse(await page.evaluate(SNAP));
    assert.equal(good.err, false);
    assert.match(good.formula, /Manager override/);
    assert.equal(good.dl, false); assert.equal(good.rep, false); assert.equal(good.play, false);
    assert.ok(good.roles.length > 0 && good.compare.length > 0 && good.proof.length > 0);
    await shot('1-good.png');

    // over-budget import: 60 independent replacements, bound 4, unreachable target
    const events = Array.from({ length: 60 }, (_, i) => ({ id: `p${i}`, agent: 'A', label: `Part ${i}`, op: 'const', value: 1, observed: 1, clean: 2 }));
    events.push({ id: 'sum', agent: 'B', label: 'Total', op: 'add', args: events.map((e) => e.id) });
    await page.evaluate(IMPORT({ name: 'Too wide', defaultMaxSize: 4, events, checks: [{ id: 'c', label: 'Total is 99999', event: 'sum', expect: { eq: 99999 } }] }));
    const bad = JSON.parse(await page.evaluate(SNAP));
    await shot('2-over-budget.png');
    assert.equal(bad.err, true);
    assert.match(bad.families, /replays without finishing/);
    assert.doesNotMatch(JSON.stringify(bad), /Manager override|Refund|No combination|No repair of size|none passes/);
    for (const k of ['formula', 'kind', 'roles', 'compare', 'proof']) assert.equal(bad[k], '', `${k} cleared`);
    assert.equal(bad.wtitle, 'No result');
    assert.equal(bad.picked, 'Loaded: Too wide');
    assert.equal(bad.title, 'Too wide'); assert.equal(bad.story, ''); assert.equal(bad.kindShown, false);
    assert.equal(bad.nodes, 0, 'graph cleared');
    assert.equal(bad.dl, true); assert.equal(bad.rep, true); assert.equal(bad.play, true);

    // recovery: a valid workflow loads cleanly afterwards
    await page.evaluate(IMPORT(loadFixture('overshoot-trap.json')));
    const rec = JSON.parse(await page.evaluate(SNAP));
    await shot('3-recovered.png');
    assert.equal(rec.err, false); assert.equal(rec.kindShown, true); assert.match(rec.title, /Overshoot/); assert.match(rec.picked, /^Loaded: Overshoot/);
    assert.match(rec.formula, /Parcel A weight/);
    assert.doesNotMatch(JSON.stringify(rec), /Manager override|replays without finishing/);
    assert.equal(rec.dl, false); assert.equal(rec.rep, false); assert.equal(rec.play, false);
    assert.ok(rec.roles.length > 0 && rec.compare.length > 0 && rec.nodes > 0);
  } finally { page?.close(); ch.kill(); srv.kill(); await sleep(200); rmSync(dir, { recursive: true, force: true }); }
});
