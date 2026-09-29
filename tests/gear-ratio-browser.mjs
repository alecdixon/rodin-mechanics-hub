// Isolated UI regression. All Supabase HTTP is intercepted; websocket traffic is blocked.
// Start the built app on 3101, then run: node tests/gear-ratio-browser.mjs
// These fixtures verify browser behaviour, not execution of database RLS/RPC SQL.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());
const host = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host;
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:3101";
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "rodin-gear-ratio-test-"));
const browser = spawn(process.env.TEST_CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  ["--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"],
  { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
let websocket;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const endpoint = await new Promise((resolve, reject) => {
    let output = "";
    browser.stderr.on("data", chunk => {
      output += chunk;
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) resolve(match[1]);
    });
    browser.on("error", reject);
    browser.on("exit", code => reject(new Error(`Chrome exited: ${code}`)));
    setTimeout(() => reject(new Error("Chrome startup timeout")), 15000).unref();
  });
  websocket = new WebSocket(endpoint);
  await once(websocket, "open");
  let sequence = 0;
  const pending = new Map();
  const handlers = new Map();
  websocket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error(message.error.message)); else entry.resolve(message.result);
    } else handlers.get(message.method)?.(message.params);
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
    pending.set(id, { resolve, reject, timer });
    websocket.send(JSON.stringify({ id, method, params, sessionId }));
  });
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const call = (method, params) => send(method, params, sessionId);
  await call("Page.enable");
  await call("Runtime.enable");
  await call("Network.enable");
  await call("Network.setBlockedURLs", { urls: ["wss://*", "ws://*"] });
  const evaluate = async expression => {
    const result = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const waitFor = async expression => {
    for (let i = 0; i < 150; i++) { if (await evaluate(expression)) return; await delay(100); }
    throw new Error(`Timed out: ${expression}\n${await evaluate("document.body.innerText.slice(0,2000)")}`);
  };
  const click = label => evaluate(`Array.from((document.querySelector('dialog[open]') || document).querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`);
  const badge = `document.querySelector('[aria-label="Gear ratio changed"]')`;
  const currentLabel = label => `Array.from(document.querySelectorAll('p')).some(p=>p.className.includes('text-4xl') && p.textContent===${JSON.stringify(label)})`;
  const navigate = async route => { await call("Page.navigate", { url: base + route }); };
  const refresh = async () => { await evaluate("window.dispatchEvent(new Event('focus'))"); };
  const configs = new Map();
  const histories = new Map();
  const acknowledgements = new Map();
  const writes = [];
  const networkErrors = [];
  let failConfig = false;
  let failSave = false;
  let failAck = false;
  let completionDate = "2026-10-01";
  let user;
  let authScript;
  function change(carId, ratio) {
    const current = configs.get(carId);
    if (current?.selected_ratio === ratio) return current;
    const next = { car_id: carId, selected_ratio: ratio, version: (current?.version || 0) + 1,
      updated_at: new Date().toISOString(), updated_by: "00000000-0000-4000-8000-000000000001", updated_by_email: "dan.crain@rodinmotorsport.com" };
    configs.set(carId, next);
    histories.set(carId, [{ ...next, previous_ratio: current?.selected_ratio ?? null }, ...(histories.get(carId) || [])]);
    return next;
  }
  handlers.set("Fetch.requestPaused", async ({ requestId, request }) => {
    try {
      const url = new URL(request.url);
      if (url.origin === base) { await call("Fetch.continueRequest", { requestId }); return; }
      if (url.host !== host) { await call("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }); return; }
      let body = [];
      let responseCode = 200;
      const carId = Number(url.searchParams.get("car_id")?.replace("eq.", ""));
      const table = url.pathname.split("/").pop();
      if (request.method === "OPTIONS") body = null;
      else if (url.pathname.startsWith("/auth/")) body = user;
      else if (table === "set_car_gear_ratio") {
        const payload = JSON.parse(request.postData);
        writes.push({ table, payload });
        if (failSave) { responseCode = 500; body = { message: "Test save failure" }; }
        else if ((configs.get(payload.p_car_id)?.version ?? 0) !== payload.p_expected_version) {
          responseCode = 409; body = { message: "Gear ratio changed since it was loaded. Refresh and select again." };
        } else body = change(payload.p_car_id, payload.p_ratio);
      } else if (table === "acknowledge_car_gear_ratio") {
        const payload = JSON.parse(request.postData);
        writes.push({ table, payload });
        if (failAck) { responseCode = 500; body = { message: "Test acknowledgement failure" }; }
        else {
          const key = `${user.id}:${payload.p_car_id}`;
          body = Math.max(acknowledgements.get(key) || 0, payload.p_version);
          acknowledgements.set(key, body);
        }
      } else if (table === "car_gear_ratio_config") {
        if (failConfig) { responseCode = 500; body = { message: "Test configuration unavailable" }; }
        else body = configs.get(carId) ?? null;
      } else if (table === "car_gear_ratio_history") body = histories.get(carId) || [];
      else if (table === "car_gear_ratio_acknowledgements") {
        const version = acknowledgements.get(`${user.id}:${carId}`);
        body = version ? { acknowledged_version: version } : null;
      } else if (table === "dashboard_cars") body = [1, 2, 3].map(id => ({ id, name: `Car ${id}`, active: true, sort_order: id }));
      else if (table === "job_list_releases") body = { car_id: carId, after_event: "Test event", completion_date: completionDate, status: "published" };
      else if (table === "team_job_notifications") body = null;
      await call("Fetch.fulfillRequest", { requestId, responseCode, responseHeaders: [
        { name: "Content-Type", value: "application/json" }, { name: "Access-Control-Allow-Origin", value: "*" },
        { name: "Access-Control-Allow-Headers", value: "*" }, { name: "Access-Control-Allow-Methods", value: "GET,POST,OPTIONS" },
      ], body: Buffer.from(JSON.stringify(body)).toString("base64") });
    } catch (error) {
      // Full navigation can cancel a paused prefetch before it is fulfilled.
      if (error.message !== "Invalid InterceptionId.") networkErrors.push(error.message);
    }
  });
  await call("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
  async function login(name, id, route) {
    const email = `${name}@rodinmotorsport.com`;
    user = { id: `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`, email, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} };
    const token = [{ alg: "HS256", typ: "JWT" }, { sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600 }, "test"].map(value => Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url")).join(".");
    const session = { access_token: token, refresh_token: "isolated-test-only", expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, token_type: "bearer", user };
    if (authScript) await call("Page.removeScriptToEvaluateOnNewDocument", { identifier: authScript });
    ({ identifier: authScript } = await call("Page.addScriptToEvaluateOnNewDocument", { source:
      `localStorage.setItem('rodin-mechanics-hub-auth',${JSON.stringify(JSON.stringify(session))});
       Object.defineProperty(document,'visibilityState',{get:()=>window.__testHidden ? 'hidden':'visible'});` }));
    await call("Network.setCookie", { name: "user-email", value: email, url: base });
    await navigate(route);
  }
  const selectQuery = car => `document.querySelector('select[aria-label="Gear ratio for Car ${car}"]')`;
  const selectRatio = (car, ratio) => evaluate(`(()=>{
    const select=${selectQuery(car)};
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,${JSON.stringify(ratio)});
    select.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  const dialogOpen = "document.querySelector('dialog[open]') !== null";
  const ratioCases = [
    ["STD", "STD", ["12:37", "15:35", "18:33", "18:27", "22:28", "20:23"]],
    ["LONG", "LONG", ["12:37", "15:35", "18:33", "18:27", "20:25", "20:22"]],
    ["EXTRA LONG", "EXTRA_LONG", ["12:37", "15:35", "18:33", "18:27", "19:23", "25:26"]],
  ];

  await login("dan.crain", 1, "/dashboard/car/1/job-list");
  await waitFor(`${selectQuery(1)}?.value === '' && !${selectQuery(1)}.disabled`);
  assert.deepEqual(await evaluate(`Array.from(${selectQuery(1)}.options).map(o=>o.text)`), ["NOT SET", "STD", "LONG", "EXTRA LONG"]);
  assert.equal(await evaluate(`${selectQuery(1)}.options[0].disabled`), true, "NOT SET does not bypass the existing three-value data model");
  assert.equal(await evaluate("document.querySelector('a[href=\"/dashboard/car/1/gear-ratio\"]')"), null, "Chief Gear Ratio navigation is removed");
  assert.deepEqual(
    await evaluate("['Build Standard List','Save Draft','Publish','Add Standard Job','Add Special Job'].map(label=>Array.from(document.querySelectorAll('button')).some(button=>button.textContent.trim()===label))"),
    [true, true, true, true, true],
    "Existing Workshop controls remain available",
  );
  for (const [label, ratio] of ratioCases) {
    const before = writes.length;
    await selectRatio(1, ratio);
    await waitFor(dialogOpen);
    assert.equal(writes.length, before, "Selecting requires confirmation");
    assert.ok(await evaluate(`document.querySelector('dialog[open]').innerText.includes(${JSON.stringify(label)})`));
    await click("Confirm");
    await waitFor(`!(${dialogOpen}) && ${selectQuery(1)}.value === ${JSON.stringify(ratio)}`);
    assert.equal(configs.get(1).selected_ratio, ratio);
  }
  assert.equal(configs.get(1).version, 3);
  const beforeCancel = writes.length;
  await selectRatio(1, "STD");
  await waitFor(dialogOpen);
  assert.equal(writes.length, beforeCancel, "Selecting alone must not write");
  assert.equal(await evaluate(`${selectQuery(1)}.value`), "EXTRA_LONG", "Selector retains persisted value before confirmation");
  await click("Cancel");
  await waitFor(`!(${dialogOpen})`);
  assert.equal(writes.length, beforeCancel, "Cancel must not write");
  await selectRatio(1, "EXTRA_LONG");
  assert.equal(await evaluate(dialogOpen), false, "Same selection must not open confirmation");
  assert.equal(writes.length, beforeCancel);

  await navigate("/dashboard/car/2/job-list");
  await waitFor(`${selectQuery(2)}?.value === ''`);
  await selectRatio(2, "LONG"); await waitFor(dialogOpen); await click("Confirm");
  await waitFor(`!(${dialogOpen}) && ${selectQuery(2)}.value === 'LONG'`);
  assert.equal(configs.get(1).selected_ratio, "EXTRA_LONG", "Cars remain independent");
  const previousVersion = configs.get(2).version;
  await selectRatio(2, "STD");
  await waitFor(dialogOpen);
  failSave = true;
  await click("Confirm");
  await waitFor("document.querySelector('dialog[open]')?.innerText.includes('Test save failure')");
  assert.equal(await evaluate(`${selectQuery(2)}.value`), "LONG");
  assert.equal(configs.get(2).version, previousVersion);
  failSave = false;
  await click("Cancel"); await waitFor(`!(${dialogOpen})`);
  await selectRatio(2, "STD"); await waitFor(dialogOpen);
  change(2, "EXTRA_LONG"); await refresh();
  await waitFor("document.querySelector('dialog[open]')?.innerText.includes('The current ratio changed')");
  assert.equal(await evaluate("Array.from(document.querySelectorAll('dialog[open] button')).find(b=>b.textContent==='Confirm').disabled"), true);
  await click("Cancel");
  await waitFor(`!(${dialogOpen})`);

  for (const width of [320, 390, 768, 1440]) {
    await call("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
    const selectorBounds = await evaluate(`(()=>{const select=${selectQuery(2)},r=select.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,viewport:innerWidth}})()`);
    assert.ok(selectorBounds.left >= 0 && selectorBounds.right <= width, `Workshop selector overflow at ${width}: ${JSON.stringify(selectorBounds)}`);
    await selectRatio(2, "LONG"); await waitFor(dialogOpen);
    const bounds = await evaluate("(()=>{const r=document.querySelector('dialog[open]').getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}})()");
    assert.ok(bounds.left >= 0 && bounds.right <= width && bounds.top >= 0 && bounds.bottom <= 900, `Confirmation overflows at ${width}`);
    await click("Cancel"); await waitFor(`!(${dialogOpen})`);
  }
  console.log("PASS: Chief Workshop selector options, confirmation, cancel, no-op, failure, stale state, car isolation and responsive layout.");

  const chiefWriteCount = writes.filter(w => w.table === "set_car_gear_ratio").length;
  await login("simon.crain", 2, "/car/1/job-list");
  const completeBySection = "Array.from(document.querySelectorAll('section')).find(s=>s.textContent.includes('Required Completion Date'))";
  await waitFor(`${badge} && ${completeBySection}?.innerText.includes('EXTRA LONG')`);
  assert.deepEqual(await evaluate(`Array.from(${completeBySection}.querySelectorAll('dd')).map(e=>e.textContent)`), ratioCases[2][2]);
  assert.equal(await evaluate(`${completeBySection}.querySelectorAll('button').length`), 0, "Complete By ratio is non-interactive");
  assert.equal(await evaluate(dialogOpen), false);
  assert.equal(writes.filter(w => w.table === "acknowledge_car_gear_ratio").length, 0, "Inline details must not acknowledge the change");
  for (const [, ratio, pairs] of ratioCases) {
    change(1, ratio); await refresh();
    await waitFor(`${completeBySection}?.innerText.includes(${JSON.stringify(ratio === "EXTRA_LONG" ? "EXTRA LONG" : ratio)})`);
    assert.deepEqual(await evaluate(`Array.from(${completeBySection}.querySelectorAll('dd')).map(e=>e.textContent)`), pairs);
  }
  for (const width of [320, 390, 768, 1440]) {
    await call("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
    const layout = await evaluate(`(()=>{const section=${completeBySection},grid=section.firstElementChild,r=section.getBoundingClientRect();return {columns:getComputedStyle(grid).gridTemplateColumns.split(' ').length,left:r.left,right:r.right,client:section.clientWidth,scroll:section.scrollWidth}})()`);
    assert.equal(layout.columns, width >= 768 ? 2 : 1, `Complete By split at ${width}`);
    assert.ok(layout.left >= 0 && layout.right <= width && layout.scroll <= layout.client, `Complete By overflow at ${width}: ${JSON.stringify(layout)}`);
  }

  await evaluate("window.__testHidden=true; document.querySelector('aside a[href=\"/car/1/gear-ratio\"]').click()");
  await waitFor(currentLabel("EXTRA LONG"));
  await delay(200);
  assert.equal(writes.filter(w => w.table === "acknowledge_car_gear_ratio").length, 0, "Hidden panel must not acknowledge");
  await evaluate("window.__testHidden=false; document.dispatchEvent(new Event('visibilitychange'))");
  await waitFor(`!${badge}`);
  assert.equal(acknowledgements.get(`${user.id}:1`), configs.get(1).version);
  assert.equal(await evaluate("document.body.innerText.includes('Save Gear Ratio')"), false, "Mechanics cannot edit ratios");
  change(1, "STD"); await refresh();
  await waitFor(`${badge} && ${currentLabel("STD")}`);
  failAck = true; await click("Acknowledge change");
  await waitFor("document.body.innerText.includes('Test acknowledgement failure')");
  assert.equal(await evaluate(`!!${badge}`), true);
  failAck = false; await click("Acknowledge change");
  await waitFor(`!${badge}`);
  assert.equal(acknowledgements.get(`${user.id}:1`), configs.get(1).version);

  failConfig = true; await refresh();
  await waitFor("document.body.innerText.includes('Test configuration unavailable')");
  failConfig = false; await click("Retry");
  await waitFor(currentLabel("STD"));
  completionDate = null;
  await navigate("/car/1/job-list");
  await waitFor(`${completeBySection}?.innerText.includes('No date set') && ${completeBySection}?.innerText.includes('STD')`);
  assert.deepEqual(await evaluate(`Array.from(${completeBySection}.querySelectorAll('dd')).map(e=>e.textContent)`), ratioCases[0][2]);

  await login("jack.carter", 4, "/car/3/job-list");
  await waitFor(`${completeBySection}?.innerText.includes('NOT SET') && ${completeBySection}?.innerText.includes('No ratio selected')`);
  assert.equal(await evaluate(`${completeBySection}.querySelectorAll('dd').length`), 0, "NOT SET shows no misleading ratios");
  await navigate("/car/1/gear-ratio");
  await waitFor("location.pathname === '/car/3/job-list'");

  for (const [name, id] of [["jimmy", 5], ["guest", 6]]) {
    await login(name, id, "/dashboard/car/1/job-list");
    await waitFor(`${selectQuery(1)}?.value === 'STD'`);
    assert.equal(await evaluate(`${selectQuery(1)}.disabled`), true, `${name} remains read-only`);
  }
  await login("ben.southern", 7, "/car/1/gear-ratio");
  await waitFor("location.pathname === '/drain-out'");
  assert.equal(writes.filter(w => w.table === "set_car_gear_ratio").length, chiefWriteCount);

  await login("dan.crain", 1, "/dashboard");
  await waitFor("document.querySelectorAll('article').length > 0");
  assert.equal(await evaluate("document.querySelectorAll('article select[aria-label^=\"Gear ratio for Car\"]').length"), 0, "Dashboard has no duplicate Gear Ratio editor");
  assert.equal(await evaluate("Array.from(document.querySelectorAll('article')).every(a=>getComputedStyle(a.querySelector('.grid')).gridTemplateColumns.split(' ').length >= 1)"), true);
  await evaluate("Array.from(document.querySelectorAll('article button')).find(b=>b.textContent==='Open Car Links').click()");
  await waitFor("document.querySelector('article a[href=\"/dashboard/car/1/clutch-measurement\"]') !== null");
  assert.ok(await evaluate("document.querySelector('article').innerText.includes('Clutch Records')"));
  await login("simon.crain", 2, "/car/1/job-list");
  change(1, "LONG"); await refresh();
  await waitFor(`${badge} && ${completeBySection}?.innerText.includes('LONG')`);
  await evaluate("document.querySelector('aside a[href=\"/car/1/gear-ratio\"]').click()");
  await waitFor(`${currentLabel("LONG")} && !${badge}`);
  assert.deepEqual(networkErrors, []);
  console.log("PASS: direct Complete By ratios/NOT SET, mobile stack, desktop split, no modal trigger, acknowledgement badge, role restrictions, dashboard deduplication and Clutch link regression.");
}

main().catch(error => { console.error(error); process.exitCode = 1; })
  .finally(() => { websocket?.close(); browser.kill(); });
