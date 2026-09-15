// Isolated browser regression: Supabase requests are intercepted and never reach live data.
// Run with the local dev server at http://127.0.0.1:3000.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());
const supabaseHost = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "rodin-clutch-history-test-"));
const browser = spawn(
  process.env.TEST_CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  ["--headless", "--disable-gpu", "--no-sandbox", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"],
  { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] },
);

let websocket;
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function main() {
  const endpoint = await new Promise((resolve, reject) => {
    let output = "";
    browser.stderr.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) resolve(match[1]);
    });
    browser.on("error", reject);
    browser.on("exit", (code) => reject(new Error(`Chrome exited: ${code}`)));
    setTimeout(() => reject(new Error(`Chrome startup timeout: ${output}`)), 15000);
  });

  const browserEndpoint = new URL(endpoint);
  const targetResponse = await fetch(
    `http://${browserEndpoint.host}/json/new?${encodeURIComponent("about:blank")}`,
    { method: "PUT" },
  );
  const target = await targetResponse.json();
  websocket = new WebSocket(target.webSocketDebuggerUrl);
  await once(websocket, "open");
  let sequence = 0;
  const pending = new Map();
  const handlers = new Map();
  websocket.addEventListener("message", ({ data }) => {
    const raw = typeof data === "string" ? data : Buffer.from(data).toString("utf8");
    const message = JSON.parse(raw);
    if (message.id) {
      const entry = pending.get(message.id);
      pending.delete(message.id);
      if (!entry) return;
      clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error(message.error.message));
      else entry.resolve(message.result);
    } else {
      handlers.get(message.method)?.(message.params);
    }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Chrome DevTools timeout: ${method}`));
    }, 15000);
    pending.set(id, { resolve, reject, timer });
    websocket.send(JSON.stringify({ id, method, params }));
  });
  const call = (method, params) => send(method, params);
  await call("Page.enable");
  await call("Runtime.enable");
  const evaluate = async (expression) => {
    const result = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const waitFor = async (expression) => {
    for (let index = 0; index < 150; index += 1) {
      if (await evaluate(expression)) return;
      await delay(200);
    }
    throw new Error(`Timed out: ${expression}\n${await evaluate("document.body.innerText.slice(0, 1200)")}`);
  };

  const user = {
    id: "00000000-0000-4000-8000-000000000001",
    aud: "authenticated",
    role: "authenticated",
    email: "dan.crain@rodinmotorsport.com",
    user_metadata: { full_name: "Chief Mechanic" },
    app_metadata: { provider: "email" },
    created_at: "2026-01-01T00:00:00Z",
  };
  const records = [
    {
      id: "outing-7",
      car_id: 1,
      outing_name: "Outing 7",
      measurement_date: "2026-09-14",
      created_at: "2026-09-14T17:30:00Z",
      created_by: "Simon Crain",
      driver: "Driver One",
      serial_no: "CL-007",
      notes: "Latest saved notes",
      clutch_status: "SERVICE SOON",
      pdf_path: "car-1/outing-7.pdf",
      driven_plates: [{ no: 1, a: 3.123, b: 3.124, c: 3.125 }],
      intermediate_plates: [{ no: 1, a: 2.101, b: 2.102, c: 2.103 }],
    },
    {
      id: "outing-6",
      car_id: 1,
      outing_name: "Outing 6",
      measurement_date: "2026-08-05",
      created_at: "2026-08-05T10:00:00Z",
      created_by: "Alec Dixon",
      driver: null,
      serial_no: "CL-006",
      notes: "Earlier saved notes",
      clutch_status: "GO",
      pdf_path: null,
      driven_plates: [],
      intermediate_plates: [],
    },
  ];
  const writes = [];
  const networkErrors = [];
  handlers.set("Fetch.requestPaused", async ({ requestId, request }) => {
    try {
      const url = new URL(request.url);
      let body = [];
      if (request.method === "OPTIONS") body = null;
      else if (url.pathname.startsWith("/auth/")) body = user;
      else if (url.pathname.endsWith("/clutch_measurements")) {
        if (!["GET", "HEAD"].includes(request.method)) writes.push({ method: request.method, url: request.url });
        body = records;
      }
      await call("Fetch.fulfillRequest", {
        requestId,
        responseCode: 200,
        responseHeaders: [
          { name: "Content-Type", value: "application/json" },
          { name: "Access-Control-Allow-Origin", value: "*" },
          { name: "Access-Control-Allow-Headers", value: "*" },
          { name: "Access-Control-Allow-Methods", value: "GET,HEAD,OPTIONS" },
        ],
        body: Buffer.from(JSON.stringify(body)).toString("base64"),
      });
    } catch (error) {
      networkErrors.push(error.message);
    }
  });
  await call("Fetch.enable", { patterns: [{ urlPattern: `https://${supabaseHost}/*` }] });

  const token = [
    { alg: "HS256", typ: "JWT" },
    { sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600 },
    "test",
  ].map((value) => Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url")).join(".");
  const session = {
    access_token: token,
    refresh_token: "isolated-test-only",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    expires_in: 3600,
    token_type: "bearer",
    user,
  };
  await call("Network.setCookie", { name: "user-email", value: user.email, url: "http://127.0.0.1:3000" });
  await call("Page.addScriptToEvaluateOnNewDocument", {
    source: `localStorage.setItem('rodin-mechanics-hub-auth',${JSON.stringify(JSON.stringify(session))});`,
  });
  await call("Page.navigate", { url: "http://127.0.0.1:3000/dashboard/car/1/clutch-measurement" });
  await waitFor("document.querySelectorAll('button[aria-pressed]').length === 2");

  const clickHistory = (index) => evaluate(`document.querySelectorAll('button[aria-pressed]')[${index}].click()`);
  await clickHistory(0);
  await waitFor("document.querySelector('button[aria-pressed=true]')?.textContent.includes('Outing 7')");
  assert.match(await evaluate("document.body.innerText"), /Latest saved notes/);

  await clickHistory(1);
  await waitFor("document.querySelector('button[aria-pressed=true]')?.textContent.includes('Outing 6')");
  const switchedText = await evaluate("document.body.innerText");
  assert.match(switchedText, /Earlier saved notes/);
  assert.doesNotMatch(switchedText, /Latest saved notes/);

  await clickHistory(1);
  await waitFor("!document.querySelector('button[aria-pressed=true]')");
  assert.equal(await evaluate("document.body.innerText.includes('Select a saved outing to view its measurements.')"), true);

  await clickHistory(0);
  for (const width of [320, 375, 390, 768, 1440]) {
    await call("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await delay(120);
    const layout = await evaluate(`(() => {
      const section = Array.from(document.querySelectorAll('section')).find(element => element.textContent.includes('Saved Measurements'));
      const columns = getComputedStyle(section).gridTemplateColumns.split(' ').filter(Boolean).length;
      return { pageWidth: document.documentElement.scrollWidth, columns };
    })()`);
    assert.ok(layout.pageWidth <= width, `Page overflow at ${width}px: ${JSON.stringify(layout)}`);
    assert.equal(layout.columns, width >= 1024 ? 2 : 1, `Unexpected stacking at ${width}px`);
  }

  const rowHeights = await evaluate("Array.from(document.querySelectorAll('button[aria-pressed]')).map(button => button.getBoundingClientRect().height)");
  assert.ok(rowHeights.every((height) => height < 110), `History rows are not compact: ${rowHeights.join(', ')}`);
  assert.equal(writes.length, 0, "history selection must never write clutch data");
  assert.deepEqual(networkErrors, []);
  console.log("Clutch history master-detail browser tests passed.");
}

try {
  await main();
} finally {
  websocket?.close();
  browser.kill();
  if (browser.exitCode === null) {
    await Promise.race([once(browser, "exit"), delay(3000)]);
  }
  await delay(1000);
  if (path.resolve(profile).startsWith(path.resolve(os.tmpdir()) + path.sep)) {
    try {
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
    } catch (error) {
      if (error?.code !== "EPERM") throw error;
    }
  }
}
