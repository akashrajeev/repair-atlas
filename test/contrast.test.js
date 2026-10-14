import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cdp, sleep } from './cdp.js';

const chrome = ['/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
const AUDIT = `(()=>{
 const parse=c=>{const m=c.match(/[\\d.]+/g).map(Number);return {r:m[0],g:m[1],b:m[2],a:m[3]??1}};
 const lum=({r,g,b})=>{const f=v=>{v/=255;return v<=.03928?v/12.92:((v+.055)/1.055)**2.4};return .2126*f(r)+.7152*f(g)+.0722*f(b)};
 const bgOf=e=>{while(e){const c=parse(getComputedStyle(e).backgroundColor);if(c.a>0.9)return c;e=e.parentElement}return {r:255,g:255,b:255,a:1}};
 const res={};const seen=new Set();
 for(const e of document.querySelectorAll('body *')){ if(!e.childNodes.length||![...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim()))continue;
  const cs=getComputedStyle(e);if(cs.visibility==='hidden'||e.offsetParent===null||e.disabled)continue; // disabled controls are exempt from WCAG contrast
  const fg=parse(cs.color);const bg=bgOf(e);const op=Number(cs.opacity);
  const mix=(a,b,t)=>({r:a.r*t+b.r*(1-t),g:a.g*t+b.g*(1-t),b:a.b*t+b.b*(1-t)});
  const eff=mix(fg,bg,fg.a*op);const L1=lum(eff),L2=lum(bg);const cr=(Math.max(L1,L2)+.05)/(Math.min(L1,L2)+.05);
  const size=parseFloat(cs.fontSize),bold=Number(cs.fontWeight)>=700;const need=(size>=24||(size>=18.66&&bold))?3:4.5;
  const key=e.tagName+'.'+e.className+'#'+e.id;if(cr<need&&!seen.has(key)){seen.add(key);res[key]=cr.toFixed(2)+' need '+need+' size '+size+' "'+e.textContent.trim().slice(0,30)+'"'}}
 return JSON.stringify(res)})()`;

test('browser: visible text meets WCAG AA contrast (4.5:1, or 3:1 for large text) in the main states', { skip: !chrome && 'no chrome installed' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ra-contrast-'));
  const srv = spawn('node', ['scripts/serve.js'], { env: { ...process.env, PORT: '5231' }, stdio: 'pipe' });
  await new Promise((r) => srv.stdout.once('data', r));
  const ch = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--window-size=1400,900', '--remote-debugging-port=9354', `--user-data-dir=${dir}`, 'about:blank'], { stdio: 'ignore' });
  let page;
  try {
    page = await cdp(9354);
    const states = [];
    for (const f of ['alert', 'incident', 'invoice', 'order', 'overshoot', 'refund', 'release', 'sequential', 'shipping']) {
      await page.send('Page.navigate', { url: `http://127.0.0.1:5231/?f=${f}` });
      await sleep(2200);
      states.push([f, JSON.parse(await page.evaluate(AUDIT))]);
      await page.evaluate(`document.querySelector('#tourBtn').click()`); await sleep(150);
      states.push([f + ' with guide', JSON.parse(await page.evaluate(AUDIT))]);
      await page.evaluate(`(async()=>{const n=document.querySelector('#graph [tabindex]');n.dispatchEvent(new MouseEvent('click',{bubbles:true}));await new Promise(r=>setTimeout(r,300))})()`);
      states.push([f + ' with a pick', JSON.parse(await page.evaluate(AUDIT))]);
    }
    // dialogs and their error messages (modal: the open dialog's own text is audited)
    for (const [btn, bad] of [['verifyBtn', '{"a":1}'], ['importBtn', '{not json'], ['editBtn', null]]) {
      await page.send('Page.navigate', { url: 'http://127.0.0.1:5231/?f=refund' });
      await sleep(2200);
      await page.evaluate(`document.querySelector('#${btn}').click()`); await sleep(200);
      assert.equal(await page.evaluate(`document.querySelector('#dlg').open`), true, btn + ' opened');
      states.push([btn + ' dialog', JSON.parse(await page.evaluate(AUDIT))]);
      if (bad) {
        await page.evaluate(`document.querySelector('#dlgText').value=${JSON.stringify(bad)};document.querySelector('#dlgGo').click()`); await sleep(400);
        assert.ok((await page.evaluate(`document.querySelector('#dlgMsg').innerText`)).length > 5, btn + ' showed an error message');
        states.push([btn + ' dialog with an error', JSON.parse(await page.evaluate(AUDIT))]);
      }
    }
    for (const [name, res] of states) assert.deepEqual(res, {}, `low contrast in "${name}"`);
  } finally { page?.close(); ch.kill(); srv.kill(); await sleep(200); rmSync(dir, { recursive: true, force: true }); }
});
