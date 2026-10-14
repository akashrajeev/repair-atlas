import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cdp, sleep } from './cdp.js';

const chrome = ['/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);

test('browser: at phone width the page does not scroll sideways', { skip: !chrome && 'no chrome installed' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ra-resp-'));
  const srv = spawn('node', ['scripts/serve.js'], { env: { ...process.env, PORT: '5239' }, stdio: 'pipe' });
  await new Promise((r) => srv.stdout.once('data', r));
  const ch = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=9362', `--user-data-dir=${dir}`, 'about:blank'], { stdio: 'ignore' });
  let page;
  try {
    page = await cdp(9362);
    await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    for (const f of ['refund', 'overshoot']) {
      await page.send('Page.navigate', { url: `http://127.0.0.1:5239/?f=${f}` });
      await sleep(2200);
      const m = JSON.parse(await page.evaluate(`JSON.stringify({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })`));
      assert.equal(m.sw, m.cw, `${f}: page is ${m.sw}px wide in a ${m.cw}px viewport`);
    }
  } finally { page?.close(); ch.kill(); srv.kill(); await sleep(200); rmSync(dir, { recursive: true, force: true }); }
});

test('browser: at 320px the edit dialog keeps inputs readable and Close/Run inside the screen', { skip: !chrome && 'no chrome installed' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ra-resp2-'));
  const srv = spawn('node', ['scripts/serve.js'], { env: { ...process.env, PORT: '5241' }, stdio: 'pipe' });
  await new Promise((r) => srv.stdout.once('data', r));
  const ch = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=9364', `--user-data-dir=${dir}`, 'about:blank'], { stdio: 'ignore' });
  let page;
  try {
    page = await cdp(9364);
    await page.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 640, deviceScaleFactor: 1, mobile: true });
    await page.send('Page.navigate', { url: 'http://127.0.0.1:5241/?f=refund' });
    await sleep(2200);
    const m = JSON.parse(await page.evaluate(`(async () => {
      document.querySelector('#editBtn').click(); await new Promise((r) => setTimeout(r, 300));
      const w = (sel) => Math.round(document.querySelector(sel).getBoundingClientRect().width);
      const go = document.querySelector('#dlgGo').getBoundingClientRect();
      return JSON.stringify({ clean: w('input[data-f="clean"]'), cost: w('input[data-f="cost"]'), goBottom: Math.round(go.bottom), goRight: Math.round(go.right), vh: innerHeight, vw: innerWidth, sw: document.documentElement.scrollWidth }); })()`));
    assert.ok(m.clean >= 180, `replacement input is only ${m.clean}px wide`);
    assert.ok(m.goBottom <= m.vh && m.goRight <= m.vw, `Run button is off screen: ${JSON.stringify(m)}`);
    assert.equal(m.sw, m.vw);
  } finally { page?.close(); ch.kill(); srv.kill(); await sleep(200); rmSync(dir, { recursive: true, force: true }); }
});
