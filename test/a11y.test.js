import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cdp, sleep } from './cdp.js';

const chrome = ['/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);

test('browser: every control has an accessible name, the dialog is labelled, status and errors are announced', { skip: !chrome && 'no chrome installed' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ra-a11y-'));
  const srv = spawn('node', ['scripts/serve.js'], { env: { ...process.env, PORT: '5227' }, stdio: 'pipe' });
  await new Promise((r) => srv.stdout.once('data', r));
  const ch = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=9350', `--user-data-dir=${dir}`, 'about:blank'], { stdio: 'ignore' });
  let page;
  try {
    page = await cdp(9350);
    await page.send('Page.navigate', { url: 'http://127.0.0.1:5227/?f=refund' });
    await sleep(2500);
    const r = JSON.parse(await page.evaluate(`(async () => {
      const name = (e) => (e.getAttribute('aria-label') || e.innerText || e.textContent || '').trim() || e.getAttribute('title') || (e.id && document.querySelector('label[for="' + e.id + '"]')?.innerText) || '';
      const unnamed = () => [...document.querySelectorAll('button,select,input,textarea,[tabindex],[role=button]')].filter((e) => !name(e).trim()).map((e) => e.tagName + '#' + e.id);
      const out = { unnamedMain: unnamed(), dialogLabelledBy: document.querySelector('#dlg').getAttribute('aria-labelledby'), hintRole: document.querySelector('#hint').getAttribute('role'), msgRole: document.querySelector('#dlgMsg').getAttribute('role') };
      document.querySelector('#editBtn').click(); await new Promise((r) => setTimeout(r, 200));
      out.unnamedEdit = unnamed(); document.querySelector('#dlg').close();
      document.querySelector('#importBtn').click(); await new Promise((r) => setTimeout(r, 150));
      document.querySelector('#dlgText').value = '{"events": 5}'; document.querySelector('#dlgGo').click(); await new Promise((r) => setTimeout(r, 500));
      out.dialogTitle = document.querySelector('#dlgTitle').innerText; out.dlgMsg = document.querySelector('#dlgMsg').innerText;
      document.querySelector('#dlg').close();
      document.querySelector('#bound').value = '1'; document.querySelector('#bound').dispatchEvent(new Event('change', { bubbles: true })); await new Promise((r) => setTimeout(r, 500));
      return JSON.stringify(out); })()`));
    assert.deepEqual(r.unnamedMain, []);
    assert.deepEqual(r.unnamedEdit, []);
    assert.equal(r.dialogLabelledBy, 'dlgTitle');
    assert.equal(r.hintRole, 'status');
    assert.equal(r.msgRole, 'status');
    assert.ok(r.dialogTitle.length > 0 && r.dlgMsg.length > 0, JSON.stringify(r));
  } finally { page?.close(); ch.kill(); srv.kill(); await sleep(200); rmSync(dir, { recursive: true, force: true }); }
});
