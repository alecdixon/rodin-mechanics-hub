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
  const click = label => evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`);
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
  async function checkModal(pairs) {
    await waitFor("document.querySelector('dialog[open]') !== null");
    assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('dialog[open] tbody td')).map(e=>e.textContent)"), pairs);
    await click("Close");
    await waitFor("document.querySelector('dialog[open]') === null");
  }

  await login("dan.crain", 1, "/dashboard/car/1/gear-ratio");
  await waitFor(currentLabel("NOT SET"));
  assert.equal(await evaluate("Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='View ratios')"), false);
  for (const [label, ratio, pairs] of [
    ["STD", "STD", ["12:37", "15:35", "18:33", "18:27", "22:28", "20:23"]],
    ["LONG", "LONG", ["12:37", "15:35", "18:33", "18:27", "20:25", "20:22"]],
    ["EXTRA LONG", "EXTRA_LONG", ["12:37", "15:35", "18:33", "18:27", "19:23", "25:26"]],
  ]) {
    const before = writes.length;
    await click(label);
    assert.equal(writes.length, before, "Selecting requires a separate save");
    await click("Save Gear Ratio");
    await waitFor(currentLabel(label));
    assert.equal(configs.get(1).selected_ratio, ratio);
    await click("View ratios");
    await checkModal(pairs);
    await click(label);
    assert.equal(await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Save Gear Ratio').disabled"), true);
  }
  await call("Page.reload");
  await waitFor(currentLabel("EXTRA LONG"));
  assert.equal(configs.get(1).version, 3);
  await navigate("/dashboard/car/2/gear-ratio");
  await waitFor(currentLabel("NOT SET"));
  await click("LONG"); await click("Save Gear Ratio");
  await waitFor(currentLabel("LONG"));
  assert.equal(configs.get(1).selected_ratio, "EXTRA_LONG");
  assert.equal(configs.get(2).version, 1);
  failSave = true;
  await click("STD"); await click("Save Gear Ratio");
  await waitFor("document.body.innerText.includes('Test save failure')");
  assert.equal(configs.get(2).selected_ratio, "LONG");
  failSave = false;
  console.log("PASS: all Chief selections, deliberate save, refresh, independent cars, details, no-op UI and failed save.");

  const chiefWriteCount = writes.filter(w => w.table === "set_car_gear_ratio").length;
  await login("simon.crain", 2, "/car/1/job-list");
  await waitFor(`${badge} && document.body.innerText.includes('Gear Ratio:')`);
  assert.equal(writes.filter(w => w.table === "acknowledge_car_gear_ratio").length, 0);
  assert.equal(await evaluate("Array.from(document.querySelectorAll('section')).find(s=>s.textContent.includes('Required Completion Date')).innerText.includes('12:37')"), false);
  await click("EXTRA LONG");
  await checkModal(["12:37", "15:35", "18:33", "18:27", "19:23", "25:26"]);
  assert.equal(writes.filter(w => w.table === "acknowledge_car_gear_ratio").length, 0, "Summary details must not acknowledge the sidebar");
  await evaluate("window.__testHidden=true; document.querySelector('aside a[href=\"/car/1/gear-ratio\"]').click()");
  await waitFor(currentLabel("EXTRA LONG"));
  await delay(200);
  assert.equal(writes.filter(w => w.table === "acknowledge_car_gear_ratio").length, 0, "Hidden panel must not acknowledge");
  await evaluate("window.__testHidden=false; document.dispatchEvent(new Event('visibilitychange'))");
  await waitFor(`!${badge}`);
  assert.equal(acknowledgements.get(`${user.id}:1`), 3);
  assert.equal(await evaluate("document.body.innerText.includes('Save Gear Ratio')"), false);
  await call("Page.reload");
  await waitFor(currentLabel("EXTRA LONG"));
  assert.equal(await evaluate(`!!${badge}`), false);
  change(1, "STD");
  await refresh();
  await waitFor(`${badge} && ${currentLabel("STD")}`);
  failAck = true;
  await click("Acknowledge change");
  await waitFor("document.body.innerText.includes('Test acknowledgement failure')");
  assert.equal(await evaluate(`!!${badge}`), true);
  failAck = false;
  await click("Acknowledge change");
  await waitFor(`!${badge}`);
  assert.equal(acknowledgements.get(`${user.id}:1`), 4);
  change(1, "LONG"); await refresh();
  await waitFor(`${badge} && ${currentLabel("LONG")}`);
  await evaluate("document.querySelector('aside a[href=\"/car/1/gear-ratio\"]').click()");
  await waitFor(`!${badge}`);
  assert.equal(acknowledgements.get(`${user.id}:1`), 5, "Clicking the already-open section acknowledges the displayed change");
  change(1, "STD"); await refresh();
  await waitFor(currentLabel("STD"));
  console.log("PASS: summary details, hidden-page protection, acknowledgement persistence, subsequent change and acknowledgement failure/retry.");

  for (const width of [320, 390, 768, 1440]) {
    await call("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await click("View ratios");
    await waitFor("document.querySelector('dialog[open]') !== null");
    const bounds = await evaluate("(()=>{const r=document.querySelector('dialog[open]').getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,scroll:document.documentElement.scrollWidth}})()");
    assert.ok(bounds.left >= 0 && bounds.right <= width && bounds.top >= 0 && bounds.bottom <= 900, JSON.stringify(bounds));
    assert.ok(bounds.scroll <= width, `Page overflow at ${width}: ${bounds.scroll}`);
    if (width === 390 || width === 1440) {
      const screenshot = await call("Page.captureScreenshot", { format: "png" });
      fs.mkdirSync("coverage/gear-ratio", { recursive: true });
      fs.writeFileSync(`coverage/gear-ratio/modal-${width}.png`, Buffer.from(screenshot.data, "base64"));
    }
    await click("Close");
  }
  failConfig = true; await refresh();
  await waitFor("document.body.innerText.includes('Test configuration unavailable')");
  assert.equal(await evaluate(currentLabel("NOT SET")), false, "Load errors must not become NOT SET");
  failConfig = false; await click("Retry");
  await waitFor(currentLabel("STD"));
  completionDate = null;
  await navigate("/car/1/job-list");
  await waitFor("document.body.innerText.includes('Gear Ratio:') && document.body.innerText.includes('No date set')");
  await click("STD");
  await checkModal(["12:37", "15:35", "18:33", "18:27", "22:28", "20:23"]);
  await login("olli.moss", 3, "/car/2/gear-ratio");
  await waitFor(currentLabel("LONG"));
  assert.equal(configs.get(1).selected_ratio, "STD");
  await login("jack.carter", 4, "/car/3/gear-ratio");
  await waitFor(currentLabel("NOT SET"));
  assert.equal(await evaluate(`!!${badge}`), false);
  await navigate("/car/1/gear-ratio");
  await waitFor("location.pathname === '/car/3/job-list'");
  for (const [name, id] of [["jimmy", 5], ["guest", 6]]) {
    await login(name, id, "/dashboard/car/1/gear-ratio");
    await waitFor(currentLabel("STD"));
    assert.equal(await evaluate("document.body.innerText.includes('Save Gear Ratio')"), false);
    assert.equal(await evaluate("document.body.innerText.includes('Gear Ratio History')"), false);
    await click("View ratios");
    await checkModal(["12:37", "15:35", "18:33", "18:27", "22:28", "20:23"]);
  }
  await login("ben.southern", 7, "/car/1/gear-ratio");
  await waitFor("location.pathname === '/drain-out'");
  assert.equal(writes.filter(w => w.table === "set_car_gear_ratio").length, chiefWriteCount);
  assert.deepEqual(networkErrors, []);
  console.log("PASS: 320/390/768/1440px layout/modal, errors, no deadline, NOT SET, assigned-car isolation, read-only engineer/guest and Number 2 redirect.");
}

main().catch(error => { console.error(error); process.exitCode = 1; })
  .finally(() => { websocket?.close(); browser.kill(); });
