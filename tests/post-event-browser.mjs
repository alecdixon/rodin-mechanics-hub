// Isolated browser test; Supabase requests are intercepted, never sent live.
// Run with the local dev server: node tests/post-event-browser.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import nextEnv from '@next/env';
nextEnv.loadEnvConfig(process.cwd());
const host = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rodin-post-event-test-'));
const browser = spawn(process.env.TEST_CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
let ws;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const endpoint = await new Promise((resolve, reject) => {
    let output = '';
    browser.stderr.on('data', chunk => { output += chunk; const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) resolve(match[1]); });
    browser.on('error', reject);
    browser.on('exit', code => reject(new Error(`Chrome exited: ${code}`)));
    setTimeout(() => reject(new Error('Chrome startup timeout')), 15000).unref();
  });
  ws = new WebSocket(endpoint);
  await once(ws, 'open');
  let sequence = 0;
  const pending = new Map();
  const handlers = new Map();
  ws.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const entry = pending.get(message.id); pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message)); else entry.resolve(message.result);
    } else handlers.get(message.method)?.(message.params);
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++sequence; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const call = (method, params) => send(method, params, sessionId);
  await call('Page.enable');
  await call('Runtime.enable');
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const waitFor = async expression => {
    for (let i = 0; i < 150; i++) { if (await evaluate(expression)) return; await delay(200); }
    throw new Error('Timed out: ' + expression + ' at ' + await evaluate('location.pathname'));
  };
  const legacy = { id: 'legacy', car_id: 1, created_by: 'previous.mechanic@example.test', created_at: '2026-09-01T10:00:00Z', chassis: 'legacy chassis', notes: 'legacy notes' };
  const recent = { ...legacy, id: 'recent', created_by: 'another.mechanic@example.test', created_at: '2026-09-06T10:00:00Z', post_event_date: '2026-09-06', track_name: 'Very long circuit ' + 'CircuitDescription'.repeat(30), notes: 'Historic notes\nSecond line' };
  const rows = [recent, legacy];
  const originals = JSON.stringify(rows);
  const writes = [], queries = [], networkErrors = [];
  const email = 'simon.crain@rodinmotorsport.com';
  const user = { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', email, user_metadata: { full_name: 'Test Mechanic' }, app_metadata: { provider: 'email' }, created_at: '2026-01-01T00:00:00Z' };
  handlers.set('Fetch.requestPaused', async ({ requestId, request }) => {
    try {
      const url = new URL(request.url);
      let body = [];
      if (request.method === 'OPTIONS') body = null;
      else if (url.pathname.startsWith('/auth/')) body = user;
      else if (url.pathname.includes('/storage/')) { writes.push({ kind: 'pdf', method: request.method }); body = { Key: 'test.pdf' }; }
      else if (url.pathname.endsWith('/post_event_sheets')) {
        if (request.method === 'POST') {
          const record = JSON.parse(request.postData);
          writes.push({ kind: 'sheet', method: request.method, record }); rows.unshift({ ...record, id: 'new-submission' }); body = null;
        } else {
          queries.push(url.search);
          const offset = Number(url.searchParams.get('offset') || 0);
          body = rows.slice(offset, offset + Number(url.searchParams.get('limit') || 100));
        }
      }
      await call('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Access-Control-Allow-Headers', value: '*' }, { name: 'Access-Control-Allow-Methods', value: 'GET,POST,OPTIONS' }], body: Buffer.from(JSON.stringify(body)).toString('base64') });
    } catch (error) { networkErrors.push(error.message); }
  });
  await call('Fetch.enable', { patterns: [{ urlPattern: `https://${host}/*` }] });
  const token = [{ alg: 'HS256', typ: 'JWT' }, { sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600 }, 'test'].map(value => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url')).join('.');
  const session = { access_token: token, refresh_token: 'isolated-test-only', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, token_type: 'bearer', user };
  await call('Network.setCookie', { name: 'user-email', value: email, url: 'http://127.0.0.1:3000' });
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('rodin-mechanics-hub-auth',${JSON.stringify(JSON.stringify(session))});` });
  await call('Page.navigate', { url: 'http://127.0.0.1:3000/car/1/post-event' });
  await waitFor(`document.body.innerText.includes('Previous Post-Event Sheets')`);
  const click = label => evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`);
  const input = (label, value) => evaluate(`(()=>{const element=Array.from(document.querySelectorAll('label')).find(l=>l.textContent.trim()===${JSON.stringify(label)}).querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(element,${JSON.stringify(value)});element.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const active = () => evaluate(`JSON.stringify(Array.from(document.querySelectorAll('input,textarea')).map(e=>({value:e.value,disabled:e.disabled})))`);
  await input('After Event', 'Silverstone');
  await input('Date', '2026-09-14');
  await input('Chassis', 'Active chassis');
  const initialHistory = await evaluate(`Array.from(document.querySelectorAll('button[aria-expanded]')).map(b=>b.textContent)`);
  assert.ok(initialHistory[0].includes('another.mechanic@example.test'));
  assert.ok(initialHistory[1].includes('previous.mechanic@example.test'));
  const before = await active();
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Very long circuit')).click()`);
  await waitFor(`document.body.innerText.includes('Read-only submitted sheet')`);
  assert.equal(await active(), before, 'Opening history must preserve all active inputs');
  assert.equal(await evaluate(`document.querySelector('dl').querySelectorAll('input,textarea,select,button').length`), 0);
  assert.equal(writes.length, 0);
  for (const width of [320, 375, 390, 768, 1440]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await delay(100);
    const layout = await evaluate(`({width:innerWidth,scroll:document.documentElement.scrollWidth,overflow:Array.from(document.querySelectorAll('main, main *')).filter(e=>e.getBoundingClientRect().right>innerWidth+1).slice(0,12).map(e=>({tag:e.tagName,classes:e.className,left:e.getBoundingClientRect().left,width:e.getBoundingClientRect().width,right:e.getBoundingClientRect().right}))})`);
    assert.ok(layout.scroll <= width, `Overflow at ${width}: ${JSON.stringify(layout)}`);
    if (width === 390 || width === 1440) {
      await evaluate(`document.querySelector('main main').scrollIntoView()`);
      const screenshot = await call('Page.captureScreenshot', { format: 'png' });
      fs.mkdirSync('coverage/post-event', { recursive: true });
      fs.writeFileSync(`coverage/post-event/${width}.png`, Buffer.from(screenshot.data, 'base64'));
    }
  }
  await click('Close');
  await waitFor(`!document.body.innerText.includes('Read-only submitted sheet')`);
  assert.equal(await active(), before, 'Close must preserve all active inputs');
  assert.equal(writes.length, 0, 'Viewer must not write');
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('After Event not recorded')).click()`);
  await waitFor(`document.querySelector('dl')?.textContent.includes('legacy notes')`);
  assert.ok(await evaluate(`document.querySelector('dl').textContent.includes('Date not recorded')`));
  await click('Close');
  await click('Save Post-Event Sheet');
  await waitFor(`document.body.innerText.includes('saved as a new submission')`);
  assert.equal(networkErrors.length, 0);
  const inserts = writes.filter(w => w.kind === 'sheet');
  assert.equal(inserts.length, 1);
  const record = inserts[0].record;
  assert.equal(record.post_event_date, '2026-09-14');
  assert.equal(record.track_name, 'Silverstone');
  assert.equal(record.car_id, 1);
  assert.equal(record.created_by, email);
  assert.ok(!Number.isNaN(Date.parse(record.created_at)));
  assert.equal(record.chassis, 'Active chassis');
  assert.equal(record.notes, recent.notes);
  assert.equal(record.submission_snapshot.user_id, user.id);
  assert.equal(record.submission_snapshot.submitted_by, 'Test Mechanic');
  assert.equal(record.submission_snapshot.checks.length, 11);
  assert.equal(record.submission_snapshot.checks.find(c => c.name === 'Notes').value, recent.notes);
  assert.equal(JSON.stringify(rows.slice(1)), originals, 'Prior records must not change');
  assert.ok(queries.every(q => q.includes('car_id=eq.1') && !q.includes('created_by=') && q.includes('created_at.desc')));
  await waitFor(`document.querySelector('button[aria-expanded]')?.textContent.includes('Silverstone')`);
  const afterSave = await active();
  await evaluate(`document.querySelector('button[aria-expanded]').click()`);
  await waitFor(`document.querySelector('dl')?.textContent.includes('Test Mechanic')`);
  assert.equal(await active(), afterSave, 'Snapshot viewer must preserve active values');
  assert.ok(await evaluate(`document.querySelector('dl').textContent.includes('Active chassis')`));
  await click('Close');
  assert.equal(writes.filter(w => w.kind === 'sheet').length, 1, 'Snapshot viewing cannot resubmit');
  console.log('PASS: isolated browser submission payload, append-only save, cross-submitter car query, legacy rendering, read-only viewer/Close, no overflow at 320/375/390/768/1440px');
  console.log('NOT TESTED: live database migration, real authentication, storage persistence or Supabase RLS.');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { ws?.close(); browser.kill(); });
