// Isolated mechanic workflow test. Supabase/storage requests are intercepted.
// Start the built app on 3102, then run: node tests/clutch-default-browser.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());
const host = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host;
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:3102";
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "rodin-clutch-default-test-"));
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
    for (let i = 0; i < 200; i++) { if (await evaluate(expression)) return; await delay(100); }
    throw new Error(`Timed out: ${expression}\n${await evaluate("document.body.innerText.slice(0,2000)")}`);
  };
  const click = label => evaluate(`Array.from((document.querySelector('dialog[open]') || document).querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`);
  const setValue = (selector, value) => evaluate(`(()=>{const element=${selector};const prototype=element instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(element,${JSON.stringify(value)});element.dispatchEvent(new Event('input',{bubbles:true}));element.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  const field = label => `Array.from(document.querySelectorAll('label')).find(e=>e.querySelector('span')?.textContent.trim()===${JSON.stringify(label)}).querySelector('input')`;
  const dialogOpen = "document.querySelector('dialog[open]') !== null";
  const inventory = [
    { id: "clutch-1", serial_no: "CL-001", label: null, current_car_id: 1, active: true, notes: null },
    { id: "clutch-2", serial_no: "CL-002", label: null, current_car_id: null, active: true, notes: null },
    { id: "clutch-3", serial_no: "CL-003", label: null, current_car_id: 2, active: true, notes: null },
    { id: "clutch-4", serial_no: " cl-002 ", label: "format match", current_car_id: null, active: true, notes: null },
  ];
  const measurements = [];
  const rpcWrites = [];
  const networkErrors = [];
  let failRpc = false;
  const user = {
    id: "00000000-0000-4000-8000-000000000002",
    email: "simon.crain@rodinmotorsport.com",
    aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {},
  };

  handlers.set("Fetch.requestPaused", async ({ requestId, request }) => {
    try {
      const url = new URL(request.url);
      if (url.origin === base) { await call("Fetch.continueRequest", { requestId }); return; }
      if (url.host !== host) { await call("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }); return; }
      let body = [];
      let responseCode = 200;
      const table = url.pathname.split("/").pop();
      if (request.method === "OPTIONS") body = null;
      else if (url.pathname.startsWith("/auth/")) body = user;
      else if (url.pathname.includes("/storage/v1/object/")) body = { Key: url.pathname };
      else if (table === "dashboard_cars") body = { name: "Car 1" };
      else if (table === "clutch_inventory") body = inventory;
      else if (table === "clutch_measurements") {
        if (request.method === "POST") {
          const parsedPayload = JSON.parse(request.postData);
          const payload = Array.isArray(parsedPayload) ? parsedPayload[0] : parsedPayload;
          measurements.push({ id: `measurement-${measurements.length + 1}`, created_at: new Date().toISOString(), ...payload });
          body = null;
        } else if (url.searchParams.has("serial_no")) body = [];
        else body = measurements;
      } else if (table === "set_car_default_clutch") {
        const payload = JSON.parse(request.postData);
        rpcWrites.push(payload);
        const clutch = inventory.find(item => item.id === payload.p_clutch_id);
        if (failRpc) { responseCode = 500; body = { message: "Test allocation failure" }; }
        else if (!clutch) { responseCode = 400; body = { message: "Clutch does not exist" }; }
        else if (clutch.current_car_id !== null && clutch.current_car_id !== payload.p_car_id) {
          responseCode = 409; body = { message: `Clutch ${clutch.serial_no} is currently assigned to another car and cannot be made the default` };
        } else {
          const previous = inventory.find(item => item.current_car_id === payload.p_car_id) ?? null;
          for (const item of inventory) if (item.current_car_id === payload.p_car_id) item.current_car_id = null;
          clutch.current_car_id = payload.p_car_id;
          body = { car_id: payload.p_car_id, clutch_id: clutch.id, serial_no: clutch.serial_no, previous_clutch_id: previous?.id ?? null, previous_serial_no: previous?.serial_no ?? null, changed: previous?.id !== clutch.id };
        }
      } else if (table === "job_list_notifications" || table === "team_job_notifications") body = null;
      await call("Fetch.fulfillRequest", { requestId, responseCode, responseHeaders: [
        { name: "Content-Type", value: "application/json" }, { name: "Access-Control-Allow-Origin", value: "*" },
        { name: "Access-Control-Allow-Headers", value: "*" }, { name: "Access-Control-Allow-Methods", value: "GET,POST,PUT,PATCH,OPTIONS" },
      ], body: Buffer.from(JSON.stringify(body)).toString("base64") });
    } catch (error) {
      if (error.message !== "Invalid InterceptionId.") networkErrors.push(error.message);
    }
  });
  await call("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
  const token = [{ alg: "HS256", typ: "JWT" }, { sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600 }, "test"].map(value => Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url")).join(".");
  const session = { access_token: token, refresh_token: "isolated-test-only", expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, token_type: "bearer", user };
  await call("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.setItem('rodin-mechanics-hub-auth',${JSON.stringify(JSON.stringify(session))});URL.createObjectURL=()=> 'blob:test';URL.revokeObjectURL=()=>{};HTMLAnchorElement.prototype.click=()=>{};` });
  await call("Network.setCookie", { name: "user-email", value: user.email, url: base });
  await call("Page.navigate", { url: `${base}/car/1/clutch-measurement` });
  await waitFor("document.querySelector('select')?.value === 'clutch-1' && !Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Save Measurement')).disabled");

  async function completeMeasurement(clutchId) {
    const previousMeasurementCount = measurements.length;
    await setValue("document.querySelector('select')", clutchId);
    await waitFor(`document.querySelector('select').value === ${JSON.stringify(clutchId)}`);
    await delay(150);
    await setValue(field("Original Stack Height"), "1.000");
    await setValue("Array.from(document.querySelectorAll('h3')).find(e=>e.textContent==='Driven Plates').parentElement.querySelector('input')", "1.000");
    await click("Save Measurement & Generate PDF");

    const deadline = Date.now() + 10_000;
    while (measurements.length !== previousMeasurementCount + 1) {
      if (Date.now() > deadline) {
        throw new Error(
          `Timed out waiting for the saved clutch measurement request\n${await evaluate("document.body.innerText.slice(-2000)")}\nNetwork errors: ${networkErrors.join(" | ")}`,
        );
      }
      await delay(25);
    }

    await waitFor("document.body.innerText.includes('Clutch measurement saved') || document.body.innerText.includes('Measurement saved')");
  }

  await completeMeasurement("clutch-1");
  await waitFor("document.body.innerText.includes('Clutch measurement saved')");
  assert.equal(await evaluate(dialogOpen), false, "Current default must not prompt");
  assert.equal(measurements.length, 1);

  await completeMeasurement("clutch-2");
  await waitFor(dialogOpen);
  assert.ok(await evaluate("document.querySelector('dialog[open]').innerText.includes('Current clutch: CL-001') && document.querySelector('dialog[open]').innerText.includes('Entered clutch: CL-002') && document.querySelector('dialog[open]').innerText.includes('Car 1')"));
  await click("No, keep current");
  await waitFor(`!(${dialogOpen})`);
  assert.equal(measurements.length, 2);
  assert.equal(inventory.find(item => item.id === "clutch-1").current_car_id, 1);
  assert.equal(rpcWrites.length, 0);

  await completeMeasurement("clutch-2");
  await waitFor(dialogOpen);
  await click("Yes, update default");
  await waitFor(`!(${dialogOpen}) && document.body.innerText.includes('CL-002 is now the default')`);
  assert.equal(measurements.length, 3);
  assert.equal(inventory.find(item => item.id === "clutch-2").current_car_id, 1);
  assert.equal(await evaluate("document.querySelector('select').value"), "clutch-2", "New default is auto-selected without reload");

  inventory.find(item => item.id === "clutch-1").current_car_id = 1;
  inventory.find(item => item.id === "clutch-2").current_car_id = null;
  await call("Page.reload");
  await waitFor("document.querySelector('select')?.value === 'clutch-1'");
  await completeMeasurement("clutch-3");
  await waitFor(dialogOpen);
  await click("Yes, update default");
  await waitFor(`!(${dialogOpen}) && document.body.innerText.includes('currently assigned to another car')`);
  assert.equal(measurements.length, 4, "RPC rejection must not undo measurement");
  assert.equal(inventory.find(item => item.id === "clutch-1").current_car_id, 1);

  await completeMeasurement("clutch-2");
  await waitFor(dialogOpen);
  failRpc = true;
  await click("Yes, update default");
  await waitFor(`!(${dialogOpen}) && document.body.innerText.includes('Measurement saved, but default clutch could not be updated')`);
  failRpc = false;
  assert.equal(measurements.length, 5);
  assert.equal(inventory.find(item => item.id === "clutch-1").current_car_id, 1);

  inventory.find(item => item.id === "clutch-1").current_car_id = null;
  await call("Page.reload");
  await waitFor("document.querySelector('select')?.value === ''");
  await completeMeasurement("clutch-2");
  await waitFor("document.querySelector('dialog[open]')?.innerText.includes('No default clutch is currently assigned') === true");
  await click("Yes, update default");
  await waitFor(`!(${dialogOpen}) && document.querySelector('select').value === 'clutch-2'`);
  assert.equal(measurements.length, 6);

  await completeMeasurement("clutch-4");
  await waitFor("document.body.innerText.includes('Clutch measurement saved')");
  assert.equal(await evaluate(dialogOpen), false, "Formatting-only serial differences must not prompt");
  assert.equal(measurements.length, 7);
  assert.deepEqual(networkErrors, []);
  console.log("PASS: clutch measurement/default dialog Yes, No, same serial, normalization, no default, RPC failure, cross-car rejection and auto-fill.");
}

main().catch(error => { console.error(error); process.exitCode = 1; })
  .finally(async () => {
    websocket?.close();
    browser.kill();
    await delay(500);
    if (path.resolve(profile).startsWith(path.resolve(os.tmpdir()) + path.sep)) {
      try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 }); } catch (error) { if (error?.code !== "EPERM") throw error; }
    }
  });
