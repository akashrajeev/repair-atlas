import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compile } from '../src/model.js';
import { diagnose, exportWitness } from '../src/analysis.js';
import { loadFixture } from './helpers.js';
import { cdp, sleep } from './cdp.js';

const chrome = ['/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);

test('browser: the witness dialog verifies a real witness and rejects an edited or forged one', { skip: !chrome && 'no chrome installed' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ra-verify-'));
  const srv = spawn('node', ['scripts/serve.js'], { env: { ...process.env, PORT: '5213' }, stdio: 'pipe' });
  await new Promise((r) => srv.stdout.once('data', r));
  const ch = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=9336', `--user-data-dir=${dir}`, 'about:blank'], { stdio: 'ignore' });
  let page;
  try {
    const c = compile(loadFixture('refund-desk.json'));
    const d = diagnose(c, { maxSize: 3 });
    const good = exportWitness(c, d.family[0]);
    const edited = { ...good, repairs: [...good.repairs, 'cap'] };           // hash no longer matches
    const { hash, evidence, ...body } = good;
    const nonMinimal = { ...body, repairs: ['cap', 'override'] };             // body changed, hash recomputed below so only replay can catch it
    page = await cdp(9336);
    await page.send('Page.navigate', { url: 'http://127.0.0.1:5213/?f=refund' });
    await sleep(2500);
    const verify = (obj) => page.evaluate(`(async () => { document.querySelector('#verifyBtn').click(); await new Promise(r => setTimeout(r, 100)); document.querySelector('#dlgText').value = ${JSON.stringify(JSON.stringify(obj))}; document.querySelector('#dlgGo').click(); await new Promise(r => setTimeout(r, 300)); const m = document.querySelector('#dlgMsg'); const out = m.className + '|' + m.innerText; document.querySelector('#dlg').close(); return out; })()`);
    assert.match(await verify(good), /^msg ok\|VERIFIED: repaired replay passes; all \d+ strict subsets fail/);
    assert.match(await verify(edited), /^msg bad\|REJECTED: hash mismatch/);
    const { hashString } = await import('../src/analysis.js');
    const forged = { ...nonMinimal, hash: hashString(JSON.stringify(nonMinimal)) };
    assert.match(await verify(forged), /^msg bad\|REJECTED: a strict subset of the repairs already passes/);
    assert.match(await verify({ not: 'a witness' }), /^msg bad\|/);
  } finally { page?.close(); ch.kill(); srv.kill(); await sleep(200); rmSync(dir, { recursive: true, force: true }); }
});
