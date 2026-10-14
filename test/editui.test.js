import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cdp, sleep } from './cdp.js';

const chrome = ['/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);

test('browser: editing a replacement changes the answer; a bad cost is reported and changes nothing', { skip: !chrome && 'no chrome installed' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ra-edit-'));
  const srv = spawn('node', ['scripts/serve.js'], { env: { ...process.env, PORT: '5214' }, stdio: 'pipe' });
  await new Promise((r) => srv.stdout.once('data', r));
  const ch = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=9337', `--user-data-dir=${dir}`, 'about:blank'], { stdio: 'ignore' });
  let page;
  try {
    page = await cdp(9337);
    await page.send('Page.navigate', { url: 'http://127.0.0.1:5214/?f=refund' });
    await sleep(2500);
    const formula = () => page.evaluate(`document.querySelector('#formula').innerText.replace(/\\s+/g, ' ').trim()`);
    const edit = (id, field, value) => page.evaluate(`(async () => { document.querySelector('#editBtn').click(); await new Promise(r => setTimeout(r, 150)); const i = document.querySelector('input[data-id="${id}"][data-f="${field}"]'); i.value = ${JSON.stringify(value)}; document.querySelector('#dlgGo').click(); await new Promise(r => setTimeout(r, 1200)); const m = document.querySelector('#dlgMsg').innerText; const open = document.querySelector('#dlg').open; if (open) document.querySelector('#dlg').close(); return JSON.stringify({ m, open }); })()`);

    assert.match(await formula(), /Manager override OR/);
    // a replacement that no longer fixes anything: the single repair disappears from the answer
    const worse = JSON.parse(await edit('override', 'clean', 'false'));
    assert.equal(worse.open, false);
    const after = await formula();
    assert.doesNotMatch(after, /Manager override/);
    assert.match(after, /Refund reason AND Refund amount AND Auto-approve cap/);
    // a cost that is not a positive number: dialog stays open with the specific message, answer unchanged
    const bad = JSON.parse(await edit('override', 'cost', 'abc'));
    assert.equal(bad.open, true);
    assert.match(bad.m, /cost must be a positive number/);
    assert.equal(await formula(), after);
    // parsed-type feedback while typing, and what is accepted
    const probe = (id, raw) => page.evaluate(`(async () => { document.querySelector('#editBtn').click(); await new Promise(r => setTimeout(r, 150)); const i = document.querySelector('input[data-id="${id}"][data-f="clean"]'); i.value = ${JSON.stringify(raw)}; i.dispatchEvent(new Event('input', { bubbles: true })); const fb = i.parentElement.querySelector('.parsed').innerText; document.querySelector('#dlgGo').click(); await new Promise(r => setTimeout(r, 1000)); const msg = document.querySelector('#dlgMsg').innerText; const open = document.querySelector('#dlg').open; if (open) document.querySelector('#dlg').close(); return JSON.stringify({ fb, msg, open }); })()`);
    const num = JSON.parse(await probe('refund_amount', '90')); assert.equal(num.fb, 'read as number'); assert.equal(num.open, false);
    const bool = JSON.parse(await probe('override', 'true')); assert.equal(bool.fb, 'read as boolean'); assert.equal(bool.open, false);
    const word = JSON.parse(await probe('reason', 'weather')); assert.equal(word.fb, 'read as text'); assert.equal(word.open, false); // unquoted word is accepted on purpose
    const quoted = JSON.parse(await probe('reason', '"weather"')); assert.equal(quoted.fb, 'read as text'); assert.equal(quoted.open, false);
    const typo = JSON.parse(await probe('reason', '{not json')); assert.match(typo.fb, /^error: looks like JSON but does not parse/); assert.equal(typo.open, true); assert.match(typo.msg, /looks like JSON but does not parse/);
    const cased = JSON.parse(await probe('override', 'True')); assert.match(cased.fb, /did you mean true/); assert.equal(cased.open, true);
    const digits = JSON.parse(await probe('refund_amount', '9o')); assert.match(digits.fb, /starts like a number/); assert.equal(digits.open, true);
  } finally { page?.close(); ch.kill(); srv.kill(); await sleep(200); rmSync(dir, { recursive: true, force: true }); }
});

