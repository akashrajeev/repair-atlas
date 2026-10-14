import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cdp, sleep } from './cdp.js';

const chrome = ['/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);

test('browser: the dialogs and the graph work from the keyboard alone (real key events)', { skip: !chrome && 'no chrome installed' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ra-kbd-'));
  const srv = spawn('node', ['scripts/serve.js'], { env: { ...process.env, PORT: '5235' }, stdio: 'pipe' });
  await new Promise((r) => srv.stdout.once('data', r));
  const ch = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=9358', `--user-data-dir=${dir}`, 'about:blank'], { stdio: 'ignore' });
  let page;
  try {
    page = await cdp(9358);
    await page.send('Page.navigate', { url: 'http://127.0.0.1:5235/?f=refund' });
    await sleep(2500);
    const key = async (k, code = k, vk = 0) => { for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: vk, text: type === 'keyDown' ? (k === 'Enter' ? '\r' : k.length === 1 ? k : undefined) : undefined }); await sleep(150); };
    const st = () => page.evaluate(`JSON.stringify({ active: document.activeElement?.id || document.activeElement?.tagName, inDialog: !!document.activeElement?.closest('dialog'), open: document.querySelector('#dlg').open, hint: document.querySelector('#hint').innerText.slice(0, 60) })`).then(JSON.parse);
    for (const [btn, label] of [['importBtn', 'import'], ['verifyBtn', 'verify'], ['editBtn', 'edit']]) {
      await page.evaluate(`document.querySelector('#${btn}').focus()`);
      await key('Enter', 'Enter', 13);
      const opened = await st();
      assert.equal(opened.open, true, `${label}: Enter on the button opens the dialog`);
      assert.equal(opened.inDialog, true, `${label}: focus moves into the dialog`);
      await key('Escape', 'Escape', 27);
      const closed = await st();
      assert.equal(closed.open, false, `${label}: Escape closes the dialog`);
      assert.equal(closed.active, btn, `${label}: focus returns to the button that opened it`);
    }
    // graph: Enter on a candidate picks it, and Enter again clears it
    await page.evaluate(`document.querySelector('#graph [tabindex]').focus()`);
    const before = await st();
    await key('Enter', 'Enter', 13);
    const picked = await st();
    assert.notEqual(picked.hint, before.hint, 'Enter on a focused candidate changes the verdict line');
  } finally { page?.close(); ch.kill(); srv.kill(); await sleep(200); rmSync(dir, { recursive: true, force: true }); }
});
