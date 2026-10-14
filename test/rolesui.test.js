import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cdp, sleep } from './cdp.js';

const chrome = ['/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);

test('browser: when the bound finds nothing, the role list does not call candidates irrelevant', { skip: !chrome && 'no chrome installed' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ra-roles-'));
  const srv = spawn('node', ['scripts/serve.js'], { env: { ...process.env, PORT: '5219' }, stdio: 'pipe' });
  await new Promise((r) => srv.stdout.once('data', r));
  const ch = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=9342', `--user-data-dir=${dir}`, 'about:blank'], { stdio: 'ignore' });
  let page;
  try {
    const ev = [0, 1, 2, 3].map((i) => ({ id: `c${i}`, agent: 'A', label: `Part ${i}`, op: 'const', value: 0, observed: 0, clean: 1 }));
    ev.push({ id: 'total', agent: 'A', label: 'Total', op: 'add', args: ev.map((e) => e.id) });
    const wf = { name: 'Needs all four', defaultMaxSize: 2, events: ev, checks: [{ id: 'k', event: 'total', expect: { eq: 4 } }] };
    page = await cdp(9342);
    await page.send('Page.navigate', { url: 'http://127.0.0.1:5219/?f=refund' });
    await sleep(2500);
    const roles = async (bound) => page.evaluate(`(async () => {
      if (${bound === null ? 'false' : 'true'}) { const b = document.querySelector('#bound'); b.value = ${JSON.stringify(String(bound))}; b.dispatchEvent(new Event('change', { bubbles: true })); await new Promise(r => setTimeout(r, 800)); }
      return [...document.querySelectorAll('#roles .role')].map(x => x.innerText.replace(/\\s+/g, ' ')).join(' | '); })()`);
    await page.evaluate(`(async () => { document.querySelector('#importBtn').click(); await new Promise(r => setTimeout(r, 150)); document.querySelector('#dlgText').value = ${JSON.stringify(JSON.stringify(wf))}; document.querySelector('#dlgGo').click(); await new Promise(r => setTimeout(r, 1200)); })()`);
    const compare = () => page.evaluate(`document.querySelector('#compare').innerText.replace(/\\s+/g, ' ')`);
    const bounded = await roles(null);
    const cmpBounded = await compare();
    assert.match(cmpBounded, /Replay every set up to 2/);
    assert.match(cmpBounded, /accuracy baseline for sets up to 2/);
    assert.doesNotMatch(cmpBounded, /Replay everything|Replay every combination/);
    assert.match(bounded, /Part 0 in no repair of up to 2/);
    assert.doesNotMatch(bounded, /does not matter|irrelevant/);
    const full = await roles(4);
    assert.match(full, /Part 0 needed with partners|Part 0 in every repair/);
    assert.match(await compare(), /Replay every combination/);
  } finally { page?.close(); ch.kill(); srv.kill(); await sleep(200); rmSync(dir, { recursive: true, force: true }); }
});
