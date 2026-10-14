import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cdp, sleep } from './cdp.js';

const chrome = ['/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);

test('browser: hand-picked repairs get an accurate verdict, with no overclaim for non-members', { skip: !chrome && 'no chrome installed' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ra-manual-'));
  const srv = spawn('node', ['scripts/serve.js'], { env: { ...process.env, PORT: '5211' }, stdio: 'pipe' });
  await new Promise((r) => srv.stdout.once('data', r));
  const ch = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=9334', `--user-data-dir=${dir}`, 'about:blank'], { stdio: 'ignore' });
  let page;
  try {
    page = await cdp(9334);
    await page.send('Page.navigate', { url: 'http://127.0.0.1:5211/?f=overshoot' });
    await sleep(2500);
    const verdict = await page.evaluate(`(async () => {
      const nodes = [...document.querySelectorAll('#graph [tabindex]')];
      const click = async (i) => { nodes[i].dispatchEvent(new MouseEvent('click', { bubbles: true })); await new Promise((r) => setTimeout(r, 200)); };
      const text = () => document.querySelector('#hint').innerText + ' | ' + document.querySelector('#wtitle').innerText + ' | ' + document.querySelector('#proof').innerText;
      const out = {};
      await click(1); out.parcelB = text();           // Parcel B alone
      await click(0); out.both = text();              // B + A: overshoots
      await click(1); out.parcelA = text();           // A alone: the minimal repair
      return JSON.stringify(out); })()`);
    const v = JSON.parse(verdict);
    assert.match(v.parcelB, /Still fails\. None of these is part of any minimal repair among the supplied replacements\./);
    assert.doesNotMatch(v.parcelB, /helps alone or together/);
    assert.match(v.both, /Still fails\. It contains Parcel A weight, which works alone, but adding Parcel B weight breaks it\./);
    assert.doesNotMatch(v.both, /Still fails\. would/);
    assert.match(v.parcelA, /minimal repair/);
  } finally { page?.close(); ch.kill(); srv.kill(); await sleep(200); rmSync(dir, { recursive: true, force: true }); }
});
