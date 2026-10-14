import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadFixture } from './helpers.js';
import { cdp, sleep } from './cdp.js';

const chrome = ['/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
const evil = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>';

test('browser: markup inside an imported workflow is shown as text and never runs', { skip: !chrome && 'no chrome installed' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ra-xss-'));
  const srv = spawn('node', ['scripts/serve.js'], { env: { ...process.env, PORT: '5217' }, stdio: 'pipe' });
  await new Promise((r) => srv.stdout.once('data', r));
  const ch = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=9340', `--user-data-dir=${dir}`, 'about:blank'], { stdio: 'ignore' });
  let page;
  try {
    const wf = loadFixture('refund-desk.json');
    wf.name = evil; wf.story = evil;
    wf.events = wf.events.map((e) => ({ ...e, label: e.label + evil }));
    page = await cdp(9340);
    await page.send('Page.navigate', { url: 'http://127.0.0.1:5217/?f=refund' });
    await sleep(2500);
    const r = JSON.parse(await page.evaluate(`(async () => {
      document.querySelector('#importBtn').click(); await new Promise(r => setTimeout(r, 150));
      document.querySelector('#dlgText').value = ${JSON.stringify(JSON.stringify(wf))};
      document.querySelector('#dlgGo').click(); await new Promise(r => setTimeout(r, 1500));
      const msg = document.querySelector('#dlgMsg').innerText;
      const dlgOpen = document.querySelector('#dlg').open;
      return JSON.stringify({ xss: window.__xss ?? null, imgs: document.querySelectorAll('img').length, injected: document.querySelectorAll('script').length, shown: document.body.innerText.includes('<img src=x'), msg, dlgOpen });
    })()`));
    assert.equal(r.xss, null, 'markup executed');
    assert.equal(r.imgs, 0);
    assert.equal(r.injected, 1, 'only the page\'s own script tag: ' + JSON.stringify(r));
    assert.equal(r.dlgOpen, false, 'import should succeed: ' + JSON.stringify(r));
    assert.ok(r.shown, 'the markup should appear as literal text: ' + JSON.stringify(r));
  } finally { page?.close(); ch.kill(); srv.kill(); await sleep(200); rmSync(dir, { recursive: true, force: true }); }
});
