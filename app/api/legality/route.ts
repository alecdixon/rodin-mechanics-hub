// SURFACE TABLE CHECKS API ROUTE - HTML ATTACHMENT VERSION - v19 HTML attachment / no driver requirement
import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { canEditLegality } from "@/lib/userAccess";

export const runtime = "nodejs";

type LegalityStatus = "legal" | "illegal";

type LegalityReportItem = {
  item_key: string;
  item_name: string;
  item_side: string;
  item_position: string;
  status: LegalityStatus;
  illegal_note: string | null;
  height_notation_enabled?: boolean | null;
  height_notation?: string | number | null;
};

type CornerWeights = {
  fl: string | number | null;
  fr: string | number | null;
  rl: string | number | null;
  rr: string | number | null;
  total: string | number | null;
};

type CamberMeasurements = {
  fl: string | number | null;
  fr: string | number | null;
  rl: string | number | null;
  rr: string | number | null;
};

type NormalisedCornerWeights = {
  fl: string;
  fr: string;
  rl: string;
  rr: string;
  total: string;
};

type NormalisedCamberMeasurements = {
  fl: string;
  fr: string;
  rl: string;
  rr: string;
};

type WingShims = {
  main_lh: string | number | null;
  main_rh: string | number | null;
  spare_lh: string | number | null;
  spare_rh: string | number | null;
};

type NormalisedWingShims = {
  main_lh: string;
  main_rh: string;
  spare_lh: string;
  spare_rh: string;
};

type LegalityEmailPayload = {
  check_id?: string | null;
  car_id: number;
  car_name?: string | null;
  driver?: string | null;
  circuit?: string | null;
  check_date?: string | null;
  engineer_name?: string | null;
  engineer_email?: string | null;
  created_by?: string | null;
  corner_weights?: Partial<CornerWeights> | null;
  camber_measurements?: Partial<CamberMeasurements> | null;
  wing_shims?: Partial<WingShims> | null;
  download_only?: boolean | null;
  items?: LegalityReportItem[];
};

type NormalisedLegalityEmailPayload = {
  check_id: string;
  car_id: number;
  car_name: string;
  driver: string;
  circuit: string;
  check_date: string;
  engineer_name: string;
  engineer_email: string;
  created_by: string;
  corner_weights: NormalisedCornerWeights;
  camber_measurements: NormalisedCamberMeasurements;
  wing_shims: NormalisedWingShims;
  items: LegalityReportItem[];
};

function getRequestUserEmail(request: NextRequest) {
  return request.cookies.get("user-email")?.value?.trim().toLowerCase() ?? "";
}

function blockUnauthorisedUser(request: NextRequest) {
  const userEmail = getRequestUserEmail(request);

  if (!userEmail || !canEditLegality(userEmail)) {
    return NextResponse.json(
      {
        error: "Only authorised users can send surface table check emails.",
      },
      { status: 403 },
    );
  }

  return null;
}

function clean(value: string | number | null | undefined) {
  return String(value ?? "").trim();
}

function cleanDecimalValue(value: string | number | null | undefined) {
  const cleanValue = String(value ?? "").trim();
  if (!cleanValue) return "";

  const numericValue = Number(cleanValue);
  if (!Number.isFinite(numericValue)) return cleanValue;

  return numericValue.toFixed(1).replace(/\.0$/, "");
}

function normaliseCornerWeights(
  weights: Partial<CornerWeights> | null | undefined,
): NormalisedCornerWeights {
  return {
    fl: cleanDecimalValue(weights?.fl),
    fr: cleanDecimalValue(weights?.fr),
    rl: cleanDecimalValue(weights?.rl),
    rr: cleanDecimalValue(weights?.rr),
    total: cleanDecimalValue(weights?.total),
  };
}

function normaliseCamberMeasurements(
  measurements: Partial<CamberMeasurements> | null | undefined,
): NormalisedCamberMeasurements {
  return {
    fl: cleanDecimalValue(measurements?.fl),
    fr: cleanDecimalValue(measurements?.fr),
    rl: cleanDecimalValue(measurements?.rl),
    rr: cleanDecimalValue(measurements?.rr),
  };
}

function normaliseWingShims(shims: Partial<WingShims> | null | undefined): NormalisedWingShims {
  return {
    main_lh: clean(shims?.main_lh),
    main_rh: clean(shims?.main_rh),
    spare_lh: clean(shims?.spare_lh),
    spare_rh: clean(shims?.spare_rh),
  };
}

function formatShim(value: string) {
  return value ? value : "—";
}

function cleanHeightNotation(value: string | number | null | undefined) {
  const cleanValue = clean(value);
  return /^[0-5]$/.test(cleanValue) ? cleanValue : "";
}

function formatHeightNotation(item: LegalityReportItem) {
  if (!item.height_notation_enabled || item.status !== "legal") return "";

  const notation = cleanHeightNotation(item.height_notation);
  return notation ? `Height ${notation}/5` : "Height not recorded";
}

function heightLabel(item: LegalityReportItem) {
  const height = formatHeightNotation(item).replace("Height ", "");
  return height || "—";
}

function formatWeight(value: string) {
  return value ? `${value} kg` : "—";
}

function formatCamber(value: string) {
  return value ? `${value}°` : "—";
}

function getFallbackEngineerEmailForCar(carId: number) {
  const specific = process.env[`DRAIN_OUT_ENGINEER_EMAIL_CAR_${carId}`];

  if (specific?.trim()) {
    return specific.trim();
  }

  return process.env.DRAIN_OUT_ENGINEER_EMAIL?.trim() || "";
}

function getFallbackEngineerNameForCar(carId: number) {
  return (
    process.env[`DRAIN_OUT_ENGINEER_NAME_CAR_${carId}`]?.trim() ||
    `Engineer Car ${carId}`
  );
}

function escapeHtml(value: string | number | null | undefined) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatReportDate(value: string | null | undefined) {
  if (!value) return "Not supplied";

  const date = new Date(`${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function buildFriendlyEmailError(rawMessage: string) {
  const lower = rawMessage.toLowerCase();

  if (
    rawMessage.includes("535-5.7.8") ||
    lower.includes("username and password not accepted") ||
    lower.includes("badcredentials")
  ) {
    return {
      error:
        "Gmail rejected the SMTP username/password. GMAIL_USER and GMAIL_APP_PASSWORD probably do not match.",
      likely_cause:
        "Wrong Gmail address, wrong app password, app password copied incorrectly, or using the normal Gmail password.",
      fix:
        "Generate a fresh Google App Password from the exact Gmail account in GMAIL_USER, paste it into GMAIL_APP_PASSWORD with no spaces, then redeploy.",
    };
  }

  if (
    rawMessage.includes("534-5.7.9") ||
    lower.includes("webloginrequired") ||
    lower.includes("please log in with your web browser")
  ) {
    return {
      error:
        "Gmail is blocking the SMTP login because the account needs a browser security check.",
      likely_cause: "Google does not trust the SMTP login from this environment.",
      fix:
        "Log into the Gmail account in a browser, approve any security warning, then redeploy. If it continues, switch to Resend instead of Gmail SMTP.",
    };
  }

  if (
    lower.includes("invalid login") ||
    lower.includes("authentication failed") ||
    lower.includes("auth")
  ) {
    return {
      error: "The SMTP login failed.",
      likely_cause:
        "The Gmail credentials are wrong, revoked, or the deployment has not picked up the latest environment variables.",
      fix: "Check GMAIL_USER and GMAIL_APP_PASSWORD, then restart/redeploy.",
    };
  }

  if (
    lower.includes("no recipients defined") ||
    lower.includes("recipient") ||
    lower.includes("invalid address")
  ) {
    return {
      error: "No valid engineer recipient email was found.",
      likely_cause:
        "The selected car did not provide engineer_email, and no fallback email is configured.",
      fix:
        "Check NEXT_PUBLIC_DRAIN_OUT_ENGINEER_EMAIL_CAR_X and DRAIN_OUT_ENGINEER_EMAIL_CAR_X in Vercel/.env.local.",
    };
  }

  return {
    error: "Surface table check HTML notification failed while sending the engineer email.",
    likely_cause:
      "The surface table check may have saved, but the HTML email attachment failed.",
    fix: "Check the technical_error value, then verify Gmail/Vercel environment variables.",
  };
}

function isSpareWingItem(item: LegalityReportItem) {
  const key = item.item_key.toLowerCase();
  const name = item.item_name.toLowerCase();

  return key.startsWith("spare_") || name.includes("spare front wing");
}

function shortItemName(item: LegalityReportItem) {
  const sidePattern =
    item.item_side === "LH" || item.item_side === "RH"
      ? new RegExp(`\\s+${item.item_side}$`, "i")
      : null;

  const withoutSide = sidePattern
    ? item.item_name.replace(sidePattern, "").trim()
    : item.item_name.trim();

  const name = withoutSide
    .replace(/spare front wing/gi, "Spare FW")
    .replace(/front wing endplate/gi, "FWEP")
    .replace(/endplate/gi, "EP")
    .replace(/front wing/gi, "FW")
    .trim();

  return name || withoutSide || item.item_name;
}

function sortForSheet(items: LegalityReportItem[]) {
  const order = [
    "spare_fwep_lh",
    "spare_fw",
    "spare_fwep_rh",
    "fw_lh",
    "fwep_lh",
    "front_lh",
    "mid_lh",
    "rear_lh",
    "diffuser_lh",
    "rw_gap",
    "fw_rh",
    "fwep_rh",
    "front_rh",
    "mid_rh",
    "rear_rh",
    "diffuser_rh",
  ];

  return [...items].sort((a, b) => {
    const aIndex = order.indexOf(a.item_key);
    const bIndex = order.indexOf(b.item_key);
    if (aIndex !== -1 || bIndex !== -1) {
      return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
    }
    const aSide = a.item_side === "LH" ? 0 : a.item_side === "RH" ? 2 : 1;
    const bSide = b.item_side === "LH" ? 0 : b.item_side === "RH" ? 2 : 1;
    return aSide - bSide || a.item_name.localeCompare(b.item_name);
  });
}

function orderedSpareWingItems(items: LegalityReportItem[]) {
  const order = ["spare_fwep_lh", "spare_fw", "spare_fwep_rh"];
  return [...items].sort((a, b) => {
    const aIndex = order.indexOf(a.item_key);
    const bIndex = order.indexOf(b.item_key);
    return (
      (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex) ||
      a.item_name.localeCompare(b.item_name)
    );
  });
}

function statusText(item: LegalityReportItem) {
  return item.status === "illegal" ? "Illegal" : "Legal";
}

function statusClass(item: LegalityReportItem) {
  return item.status === "illegal" ? "illegal" : "legal";
}

async function tryReadPublicImageDataUrl(fileName: string) {
  try {
    const filePath = path.join(process.cwd(), "public", fileName);
    const bytes = await readFile(filePath);
    const lower = fileName.toLowerCase();
    const contentType = lower.endsWith(".jpg") || lower.endsWith(".jpeg") ? "image/jpeg" : "image/png";
    return `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`;
  } catch {
    return "";
  }
}

function makeInfoCard(label: string, value: string) {
  return `
    <div class="info-card">
      <div class="label">${escapeHtml(label)}</div>
      <div class="value">${escapeHtml(value || "—")}</div>
    </div>
  `;
}

function makeMeasurementCard(label: string, value: string) {
  return `
    <div class="measurement-card">
      <div class="label">${escapeHtml(label)}</div>
      <div class="measurement-value">${escapeHtml(value || "—")}</div>
    </div>
  `;
}

function makeShimCard(label: string, value: string) {
  return `
    <div class="measurement-card compact">
      <div class="label">${escapeHtml(label)}</div>
      <div class="measurement-value small-value">${escapeHtml(formatShim(value))}</div>
    </div>
  `;
}

function makeStatusCard(item: LegalityReportItem) {
  return `
    <div class="status-card ${statusClass(item)}">
      <div>
        <div class="status-title">${escapeHtml(shortItemName(item))}</div>
        <div class="status-meta">${escapeHtml(item.item_side || "—")} · ${escapeHtml(heightLabel(item))}</div>
      </div>
      <div class="badge ${statusClass(item)}">${escapeHtml(statusText(item))}</div>
    </div>
  `;
}

function makeStatusRow(item: LegalityReportItem) {
  return `
    <tr class="${statusClass(item)}">
      <td>${escapeHtml(shortItemName(item))}</td>
      <td>${escapeHtml(item.item_side || "—")}</td>
      <td>${escapeHtml(item.item_position || "—")}</td>
      <td>${escapeHtml(heightLabel(item))}</td>
      <td><span class="badge ${statusClass(item)}">${escapeHtml(statusText(item))}</span></td>
      <td>${item.status === "illegal" ? escapeHtml(item.illegal_note || "Missing note") : "—"}</td>
    </tr>
  `;
}

function makeImagePanel(title: string, subtitle: string, imageDataUrl: string, alt: string) {
  return `
    <section class="panel visual-panel">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Visual Reference</p>
          <h2>${escapeHtml(title)}</h2>
          <p>${escapeHtml(subtitle)}</p>
        </div>
      </div>
      <div class="visual-box">
        ${
          imageDataUrl
            ? `<img src="${imageDataUrl}" alt="${escapeHtml(alt)}" />`
            : `<div class="missing-image">Image not found in public folder</div>`
        }
      </div>
    </section>
  `;
}

async function buildLegalityHtml(payload: NormalisedLegalityEmailPayload) {
  const illegalItems = payload.items.filter((item) => item.status === "illegal");
  const spareWingItems = orderedSpareWingItems(payload.items.filter(isSpareWingItem));
  const carItems = sortForSheet(payload.items.filter((item) => !isSpareWingItem(item)));
  const legalCount = payload.items.length - illegalItems.length;
  const summary =
    illegalItems.length === 0
      ? `${payload.items.length}/${payload.items.length} legal`
      : `${illegalItems.length} illegal · ${legalCount} legal`;

  const rodinLogo = await tryReadPublicImageDataUrl("rodin-logo.png");
  const gb3Logo = await tryReadPublicImageDataUrl("gb3-logo.png");
  const carOverviewImage = await tryReadPublicImageDataUrl("legality-car-overview-inverted.png");
  const spareWingImage = await tryReadPublicImageDataUrl("legality-spare-front-wing.png");

  const leftCarItems = carItems.filter((item) => item.item_side === "LH");
  const rightCarItems = carItems.filter((item) => item.item_side === "RH");
  const centreCarItems = carItems.filter((item) => item.item_side !== "LH" && item.item_side !== "RH");

  const illegalNotes = illegalItems.length
    ? illegalItems
        .map(
          (item) => `
            <div class="note-row">
              <strong>${escapeHtml(shortItemName(item))}</strong>
              <span>${escapeHtml(item.illegal_note || "Missing note")}</span>
            </div>
          `,
        )
        .join("")
    : `<div class="all-clear">All recorded surface table check items are legal.</div>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Surface Table Checks - ${escapeHtml(payload.car_name)} - ${escapeHtml(payload.circuit)}</title>
  <style>
    :root {
      --bg: #0d0f12;
      --sheet: #0a0e14;
      --panel: #111418;
      --panel2: #14181d;
      --cell: #070a0f;
      --border: #2a3441;
      --muted: #9ca3af;
      --soft: #d1d5db;
      --white: #f9fafb;
      --red: #ef4444;
      --red-dark: rgba(127, 29, 29, 0.55);
      --green: #22c55e;
      --green-dark: rgba(20, 83, 45, 0.48);
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      background: var(--bg);
      color: var(--white);
      font-family: Arial, Helvetica, sans-serif;
      -webkit-font-smoothing: antialiased;
    }

    .report {
      max-width: 1280px;
      margin: 0 auto;
      padding: 24px;
    }

    .page {
      min-height: 820px;
      margin-bottom: 24px;
      overflow: hidden;
      border: 1px solid var(--border);
      border-radius: 32px;
      background:
        radial-gradient(circle at top right, rgba(239, 68, 68, 0.12), transparent 38%),
        linear-gradient(135deg, #05070a 0%, #0a0e14 48%, #111418 100%);
      box-shadow: 0 24px 80px rgba(0, 0, 0, 0.35);
    }

    .header {
      display: grid;
      grid-template-columns: 140px 1fr auto;
      align-items: center;
      gap: 24px;
      min-height: 128px;
      padding: 28px 34px;
      border-bottom: 1px solid var(--border);
      background: linear-gradient(90deg, rgba(0,0,0,0.62), rgba(17,20,24,0.86));
    }

    .logo-stack img {
      display: block;
      max-width: 112px;
      max-height: 46px;
      object-fit: contain;
      margin-bottom: 10px;
    }

    .logo-fallback {
      font-size: 20px;
      font-weight: 900;
      letter-spacing: 0.08em;
    }

    .eyebrow {
      margin: 0 0 8px;
      color: var(--red);
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.34em;
      text-transform: uppercase;
    }

    h1, h2, h3, p { margin-top: 0; }

    h1 {
      margin-bottom: 8px;
      font-size: 42px;
      line-height: 0.98;
      letter-spacing: -0.04em;
    }

    .subtitle {
      margin: 0;
      color: var(--muted);
      font-size: 14px;
      line-height: 1.55;
    }

    .summary-pill,
    .badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 999px;
      border: 1px solid currentColor;
      font-weight: 900;
      text-transform: uppercase;
      letter-spacing: 0.1em;
    }

    .summary-pill {
      min-width: 190px;
      padding: 12px 18px;
      font-size: 12px;
    }

    .summary-pill.legal,
    .badge.legal { color: var(--green); background: var(--green-dark); }
    .summary-pill.illegal,
    .badge.illegal { color: var(--red); background: var(--red-dark); }

    .summary-layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 430px;
      gap: 20px;
      padding: 24px;
    }

    .left-stack,
    .visual-stack {
      display: grid;
      gap: 16px;
      align-content: start;
    }

    .panel {
      border: 1px solid var(--border);
      border-radius: 24px;
      background: rgba(17, 20, 24, 0.92);
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.03);
      padding: 18px;
    }

    .section-heading {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 14px;
    }

    .section-heading h2 {
      margin: 0 0 5px;
      font-size: 21px;
      letter-spacing: -0.02em;
    }

    .section-heading p:not(.eyebrow) {
      margin: 0;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.45;
    }

    .unit-chip {
      align-self: start;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: var(--cell);
      color: var(--muted);
      padding: 7px 10px;
      font-size: 10px;
      font-weight: 900;
      text-transform: uppercase;
      letter-spacing: 0.16em;
    }

    .info-grid {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 10px;
    }

    .info-card,
    .measurement-card {
      min-height: 64px;
      border: 1px solid var(--border);
      border-radius: 18px;
      background: var(--cell);
      padding: 12px;
    }

    .label {
      margin-bottom: 8px;
      color: var(--muted);
      font-size: 10px;
      font-weight: 900;
      letter-spacing: 0.2em;
      text-transform: uppercase;
    }

    .value {
      color: var(--white);
      font-size: 14px;
      font-weight: 800;
      line-height: 1.25;
      word-break: break-word;
    }

    .measurement-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }

    .measurement-grid.five {
      grid-template-columns: repeat(5, minmax(0, 1fr));
    }

    .measurement-grid.four {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }

    .measurement-card {
      min-height: 76px;
    }

    .measurement-card.compact {
      min-height: 62px;
    }

    .measurement-value {
      color: var(--white);
      font-size: 23px;
      font-weight: 900;
      line-height: 1;
      letter-spacing: -0.04em;
      white-space: nowrap;
    }

    .small-value { font-size: 18px; }

    .visual-panel {
      min-height: 256px;
      padding-bottom: 16px;
    }

    .visual-box {
      display: grid;
      place-items: center;
      min-height: 188px;
      border: 1px solid var(--border);
      border-radius: 22px;
      background:
        linear-gradient(to right, rgba(82,82,91,.20) 1px, transparent 1px),
        linear-gradient(to bottom, rgba(82,82,91,.20) 1px, transparent 1px),
        #030507;
      background-size: 28px 28px;
      overflow: hidden;
    }

    .visual-box img {
      display: block;
      width: 94%;
      height: 218px;
      object-fit: contain;
      filter: contrast(1.1) drop-shadow(0 0 12px rgba(255,255,255,0.08));
    }

    .visual-panel:first-child .visual-box img {
      height: 148px;
    }

    .missing-image {
      color: var(--muted);
      font-size: 13px;
      font-weight: 800;
    }

    .status-cards {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
    }

    .status-card {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      min-height: 72px;
      border: 1px solid var(--border);
      border-radius: 18px;
      background: var(--cell);
      padding: 13px;
    }

    .status-card.legal { border-color: rgba(34, 197, 94, 0.7); }
    .status-card.illegal { border-color: rgba(239, 68, 68, 0.9); background: rgba(127, 29, 29, 0.34); }

    .status-title {
      font-size: 14px;
      font-weight: 900;
      line-height: 1.2;
    }

    .status-meta {
      margin-top: 5px;
      color: var(--muted);
      font-size: 11px;
      font-weight: 700;
    }

    .badge {
      flex: 0 0 auto;
      padding: 7px 10px;
      font-size: 9px;
    }

    .details-content {
      padding: 24px;
      display: grid;
      gap: 18px;
    }

    .two-column {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 18px;
    }

    .table-wrap {
      overflow: hidden;
      border: 1px solid var(--border);
      border-radius: 18px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }

    th {
      background: #090d13;
      color: var(--muted);
      text-align: left;
      font-size: 10px;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      padding: 10px 11px;
    }

    td {
      border-top: 1px solid var(--border);
      padding: 10px 11px;
      color: var(--soft);
      vertical-align: top;
      line-height: 1.35;
    }

    tr.illegal td {
      background: rgba(127, 29, 29, 0.28);
      color: #fee2e2;
    }

    .note-list {
      display: grid;
      gap: 9px;
    }

    .note-row,
    .all-clear {
      border: 1px solid rgba(239, 68, 68, 0.55);
      border-radius: 16px;
      background: rgba(127, 29, 29, 0.32);
      padding: 12px 14px;
      font-size: 13px;
      line-height: 1.4;
    }

    .note-row strong {
      display: block;
      margin-bottom: 3px;
      color: #fecaca;
    }

    .all-clear {
      border-color: rgba(34, 197, 94, 0.55);
      background: rgba(20, 83, 45, 0.35);
      color: #bbf7d0;
      font-weight: 800;
    }

    .footer-note {
      color: var(--muted);
      font-size: 11px;
      text-align: right;
      padding: 0 28px 22px;
    }

    @media print {
      @page { size: A4 landscape; margin: 8mm; }
      body { background: white; }
      .report { max-width: none; padding: 0; }
      .page {
        min-height: 183mm;
        margin: 0;
        border-radius: 0;
        box-shadow: none;
        page-break-after: always;
      }
    }
  </style>
</head>
<body>
  <main class="report">
    <section class="page">
      <header class="header">
        <div class="logo-stack">
          ${rodinLogo ? `<img src="${rodinLogo}" alt="Rodin Motorsport" />` : `<div class="logo-fallback">RODIN</div>`}
          ${gb3Logo ? `<img src="${gb3Logo}" alt="GB3" />` : ``}
        </div>
        <div>
          <p class="eyebrow">Rodin Motorsport</p>
          <h1>Surface Table Checks</h1>
          <p class="subtitle">Completed mechanic sheet copy · ${escapeHtml(formatReportDate(payload.check_date))} · ${escapeHtml(payload.circuit)}</p>
        </div>
        <div class="summary-pill ${illegalItems.length ? "illegal" : "legal"}">${escapeHtml(summary)}</div>
      </header>

      <div class="summary-layout">
        <div class="left-stack">
          <section class="panel">
            <div class="section-heading">
              <div>
                <p class="eyebrow">Event Details</p>
                <h2>Check Information</h2>
                <p>Saved surface table check metadata.</p>
              </div>
            </div>
            <div class="info-grid">
              ${makeInfoCard("Date", formatReportDate(payload.check_date))}
              ${makeInfoCard("Circuit", payload.circuit)}
              ${makeInfoCard("Car", payload.car_name || `Car ${payload.car_id}`)}
              ${makeInfoCard("Driver", payload.driver || "Unknown")}
              ${makeInfoCard("Engineer", payload.engineer_name)}
            </div>
          </section>

          <section class="panel">
            <div class="section-heading">
              <div>
                <p class="eyebrow">Measurements</p>
                <h2>Corner Weights</h2>
                <p>Front axle over rear axle, matching the app input sheet.</p>
              </div>
              <div class="unit-chip">kg</div>
            </div>
            <div class="measurement-grid five">
              ${makeMeasurementCard("FL", formatWeight(payload.corner_weights.fl))}
              ${makeMeasurementCard("FR", formatWeight(payload.corner_weights.fr))}
              ${makeMeasurementCard("RL", formatWeight(payload.corner_weights.rl))}
              ${makeMeasurementCard("RR", formatWeight(payload.corner_weights.rr))}
              ${makeMeasurementCard("Total", formatWeight(payload.corner_weights.total))}
            </div>
          </section>

          <section class="panel">
            <div class="section-heading">
              <div>
                <p class="eyebrow">Measurements</p>
                <h2>Camber</h2>
                <p>Negative values shown exactly as entered.</p>
              </div>
              <div class="unit-chip">deg</div>
            </div>
            <div class="measurement-grid four">
              ${makeMeasurementCard("FL", formatCamber(payload.camber_measurements.fl))}
              ${makeMeasurementCard("FR", formatCamber(payload.camber_measurements.fr))}
              ${makeMeasurementCard("RL", formatCamber(payload.camber_measurements.rl))}
              ${makeMeasurementCard("RR", formatCamber(payload.camber_measurements.rr))}
            </div>
          </section>

          <section class="panel">
            <div class="section-heading">
              <div>
                <p class="eyebrow">Front Wing</p>
                <h2>Shim Record</h2>
                <p>Main and spare front wing shim packs.</p>
              </div>
              <div class="unit-chip">shims</div>
            </div>
            <div class="measurement-grid four">
              ${makeShimCard("Main LH", payload.wing_shims.main_lh)}
              ${makeShimCard("Main RH", payload.wing_shims.main_rh)}
              ${makeShimCard("Spare LH", payload.wing_shims.spare_lh)}
              ${makeShimCard("Spare RH", payload.wing_shims.spare_rh)}
            </div>
          </section>
        </div>

        <aside class="visual-stack">
          ${makeImagePanel("Spare Front Wing", "Reference image from the mechanic sheet.", spareWingImage, "Spare front wing legality overview")}
          ${makeImagePanel("Car Surface Overview", "Reference image from the mechanic sheet.", carOverviewImage, "Car surface table overview")}
        </aside>
      </div>
    </section>

    <section class="page">
      <header class="header">
        <div class="logo-stack">
          ${rodinLogo ? `<img src="${rodinLogo}" alt="Rodin Motorsport" />` : `<div class="logo-fallback">RODIN</div>`}
          ${gb3Logo ? `<img src="${gb3Logo}" alt="GB3" />` : ``}
        </div>
        <div>
          <p class="eyebrow">Individual Elements</p>
          <h1>Surface Point Results</h1>
          <p class="subtitle">${escapeHtml(payload.car_name)} · ${escapeHtml(payload.circuit)} · ${escapeHtml(formatReportDate(payload.check_date))}</p>
        </div>
        <div class="summary-pill ${illegalItems.length ? "illegal" : "legal"}">${escapeHtml(summary)}</div>
      </header>

      <div class="details-content">
        <section class="panel">
          <div class="section-heading">
            <div>
              <p class="eyebrow">Spare Front Wing</p>
              <h2>Element Checks</h2>
              <p>Individual spare front wing statuses.</p>
            </div>
          </div>
          <div class="status-cards">
            ${spareWingItems.length ? spareWingItems.map(makeStatusCard).join("") : `<div class="all-clear">No spare front wing items supplied.</div>`}
          </div>
        </section>

        <div class="two-column">
          <section class="panel">
            <div class="section-heading">
              <div>
                <p class="eyebrow">Total Car</p>
                <h2>Left Hand Side</h2>
                <p>All LH surface check points.</p>
              </div>
            </div>
            <div class="table-wrap">
              <table>
                <thead><tr><th>Point</th><th>Side</th><th>Position</th><th>Height</th><th>Status</th><th>Note</th></tr></thead>
                <tbody>${leftCarItems.length ? leftCarItems.map(makeStatusRow).join("") : `<tr><td colspan="6">No LH items supplied.</td></tr>`}</tbody>
              </table>
            </div>
          </section>

          <section class="panel">
            <div class="section-heading">
              <div>
                <p class="eyebrow">Total Car</p>
                <h2>Right Hand Side / Centre</h2>
                <p>All RH and centre surface check points.</p>
              </div>
            </div>
            <div class="table-wrap">
              <table>
                <thead><tr><th>Point</th><th>Side</th><th>Position</th><th>Height</th><th>Status</th><th>Note</th></tr></thead>
                <tbody>${[...rightCarItems, ...centreCarItems].length ? [...rightCarItems, ...centreCarItems].map(makeStatusRow).join("") : `<tr><td colspan="6">No RH or centre items supplied.</td></tr>`}</tbody>
              </table>
            </div>
          </section>
        </div>

        <section class="panel">
          <div class="section-heading">
            <div>
              <p class="eyebrow">Check Summary</p>
              <h2>${escapeHtml(summary)}</h2>
              <p>Illegal notes are listed below. Legal items are kept in the tables above.</p>
            </div>
          </div>
          <div class="note-list">${illegalNotes}</div>
        </section>
      </div>

      <div class="footer-note">HTML layout version: surface-table-v18-html-attachment</div>
    </section>
  </main>
</body>
</html>`;
}

export async function POST(request: NextRequest) {
  try {
    const rawPayload = (await request.json()) as LegalityEmailPayload;
    const downloadOnly = rawPayload.download_only === true;

    if (!downloadOnly) {
      const authBlock = blockUnauthorisedUser(request);

      if (authBlock) {
        return authBlock;
      }
    }

    if (!rawPayload.car_id || !rawPayload.check_date || !rawPayload.circuit) {
      return NextResponse.json(
        {
          error: "Missing surface table check payload fields.",
          details: "The request must include car_id, check_date and circuit.",
        },
        { status: 400 },
      );
    }

    const items = rawPayload.items ?? [];

    if (items.length === 0) {
      return NextResponse.json(
        {
          error: "No surface table check items were supplied for the HTML report.",
        },
        { status: 400 },
      );
    }

    const illegalWithoutNotes = items.filter(
      (item) => item.status === "illegal" && !clean(item.illegal_note),
    );

    if (illegalWithoutNotes.length > 0) {
      return NextResponse.json(
        {
          error: "Illegal items cannot be emailed without notes.",
          details: illegalWithoutNotes.map((item) => item.item_name).join(", "),
        },
        { status: 400 },
      );
    }

    const fallbackEngineerEmail = getFallbackEngineerEmailForCar(Number(rawPayload.car_id));
    const to = clean(rawPayload.engineer_email) || fallbackEngineerEmail;

    if (!downloadOnly && !to) {
      return NextResponse.json(
        {
          error: "No engineer email selected and no fallback engineer email is configured.",
          details: `No engineer email was found for car ${rawPayload.car_id}.`,
          fix: `Add DRAIN_OUT_ENGINEER_EMAIL_CAR_${rawPayload.car_id}, NEXT_PUBLIC_DRAIN_OUT_ENGINEER_EMAIL_CAR_${rawPayload.car_id} or DRAIN_OUT_ENGINEER_EMAIL in Vercel/.env.local.`,
        },
        { status: 500 },
      );
    }

    const carName = clean(rawPayload.car_name) || `Car ${rawPayload.car_id}`;

    const payload: NormalisedLegalityEmailPayload = {
      check_id: clean(rawPayload.check_id),
      car_id: Number(rawPayload.car_id),
      car_name: carName,
      driver: clean(rawPayload.driver) || carName,
      circuit: clean(rawPayload.circuit) || "Unknown",
      check_date: clean(rawPayload.check_date),
      engineer_name:
        clean(rawPayload.engineer_name) || getFallbackEngineerNameForCar(Number(rawPayload.car_id)),
      engineer_email: to || clean(rawPayload.engineer_email) || "Not supplied",
      created_by: clean(rawPayload.created_by) || getRequestUserEmail(request) || "Unknown",
      corner_weights: normaliseCornerWeights(rawPayload.corner_weights),
      camber_measurements: normaliseCamberMeasurements(rawPayload.camber_measurements),
      wing_shims: normaliseWingShims(rawPayload.wing_shims),
      items,
    };

    const illegalCount = payload.items.filter((item) => item.status === "illegal").length;
    const summary =
      illegalCount === 0
        ? `${payload.items.length}/${payload.items.length} legal`
        : `${illegalCount} illegal · ${payload.items.length - illegalCount} legal`;

    const html = await buildLegalityHtml(payload);
    const htmlBuffer = Buffer.from(html, "utf8");
    const safeBaseName = `Surface_Table_Checks_${payload.circuit.replace(/[^a-z0-9]+/gi, "_")}_Car_${payload.car_id}_${payload.check_date}`;
    const safeFileName = `${safeBaseName}.html`;

    if (downloadOnly) {
      return new NextResponse(html, {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Disposition": `attachment; filename="${safeFileName}"`,
          "Cache-Control": "no-store",
        },
      });
    }

    const gmailUser = process.env.GMAIL_USER?.trim();
    const gmailAppPassword = process.env.GMAIL_APP_PASSWORD?.replace(/\s/g, "");

    if (!gmailUser) {
      return NextResponse.json(
        {
          error: "GMAIL_USER is not configured.",
        },
        { status: 500 },
      );
    }

    if (!gmailAppPassword) {
      return NextResponse.json(
        {
          error: "GMAIL_APP_PASSWORD is not configured.",
        },
        { status: 500 },
      );
    }

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: gmailUser,
        pass: gmailAppPassword,
      },
    });

    await transporter.sendMail({
      from: `"Surface Table Checks" <${gmailUser}>`,
      to,
      subject: `Surface Table Checks - ${payload.circuit} - ${payload.car_name} - ${summary}`,
      text: [
        "Surface Table Checks Report",
        "",
        `Sent to: ${payload.engineer_name} <${to}>`,
        "",
        "Event Details",
        `Date: ${formatReportDate(payload.check_date)}`,
        `Circuit: ${payload.circuit}`,
        `Car: ${payload.car_name}`,
        `Driver: ${payload.driver}`,
        `Corner weights: FL ${formatWeight(payload.corner_weights.fl)} · FR ${formatWeight(payload.corner_weights.fr)} · RL ${formatWeight(payload.corner_weights.rl)} · RR ${formatWeight(payload.corner_weights.rr)} · Total ${formatWeight(payload.corner_weights.total)}`,
        `Camber: FL ${formatCamber(payload.camber_measurements.fl)} · FR ${formatCamber(payload.camber_measurements.fr)} · RL ${formatCamber(payload.camber_measurements.rl)} · RR ${formatCamber(payload.camber_measurements.rr)}`,
        `Wing shims: Main LH ${formatShim(payload.wing_shims.main_lh)} · Main RH ${formatShim(payload.wing_shims.main_rh)} · Spare LH ${formatShim(payload.wing_shims.spare_lh)} · Spare RH ${formatShim(payload.wing_shims.spare_rh)}`,
        "",
        "Status Summary",
        summary,
        "",
        "The completed surface table check is attached as an HTML file.",
      ].join("\n"),
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111;background:#f6f7f9;padding:24px">
          <div style="max-width:760px;margin:0 auto;border:1px solid #ddd;border-radius:14px;overflow:hidden;background:#ffffff">
            <div style="background:#111827;color:white;padding:20px 24px">
              <p style="margin:0 0 6px;color:#f87171;font-size:12px;letter-spacing:0.18em;text-transform:uppercase;font-weight:bold">
                Surface Table Checks Report
              </p>

              <h2 style="margin:0;font-size:24px">
                ${escapeHtml(payload.car_name)}
              </h2>

              <p style="margin:8px 0 0;color:#d1d5db">
                ${escapeHtml(payload.circuit)} · ${escapeHtml(formatReportDate(payload.check_date))} · ${escapeHtml(payload.driver)}
              </p>
            </div>

            <div style="padding:22px 24px">
              <table style="border-collapse:collapse;width:100%;font-size:14px;margin-bottom:20px">
                <tr>
                  <td style="padding:9px 10px;font-weight:bold;border-bottom:1px solid #eee;width:180px">Engineer</td>
                  <td style="padding:9px 10px;border-bottom:1px solid #eee">${escapeHtml(payload.engineer_name)}</td>
                </tr>
                <tr>
                  <td style="padding:9px 10px;font-weight:bold;border-bottom:1px solid #eee">Engineer Email</td>
                  <td style="padding:9px 10px;border-bottom:1px solid #eee">${escapeHtml(to)}</td>
                </tr>
                <tr>
                  <td style="padding:9px 10px;font-weight:bold;border-bottom:1px solid #eee">Summary</td>
                  <td style="padding:9px 10px;border-bottom:1px solid #eee"><strong>${escapeHtml(summary)}</strong></td>
                </tr>
              </table>

              <p style="margin:0 0 14px;font-size:14px;color:#374151">
                A browser-openable HTML copy of the completed surface table check is attached.
              </p>

              ${
                illegalCount > 0
                  ? `<div style="border:1px solid #fecaca;background:#fef2f2;color:#991b1b;border-radius:10px;padding:12px 14px;font-size:14px"><strong>${escapeHtml(illegalCount)} illegal item(s)</strong> were recorded. Open the HTML attachment for the full notes.</div>`
                  : `<div style="border:1px solid #bbf7d0;background:#f0fdf4;color:#166534;border-radius:10px;padding:12px 14px;font-size:14px"><strong>All checked items are legal.</strong></div>`
              }
            </div>
          </div>
        </div>
      `,
      attachments: [
        {
          filename: safeFileName,
          content: htmlBuffer,
          contentType: "text/html; charset=utf-8",
        },
      ],
    });

    return NextResponse.json({
      ok: true,
      sent_to: to,
      engineer_name: payload.engineer_name,
      circuit: payload.circuit,
      check_date: payload.check_date,
      attachment_type: "html",
    });
  } catch (error) {
    const rawMessage =
      error instanceof Error ? error.message : "Unknown email sending error.";

    const friendly = buildFriendlyEmailError(rawMessage);

    return NextResponse.json(
      {
        error: friendly.error,
        likely_cause: friendly.likely_cause,
        fix: friendly.fix,
        technical_error: rawMessage,
        diagnostic: {
          gmail_user_configured: Boolean(process.env.GMAIL_USER?.trim()),
          gmail_app_password_configured: Boolean(
            process.env.GMAIL_APP_PASSWORD?.trim(),
          ),
          drain_out_engineer_email_configured: Boolean(
            process.env.DRAIN_OUT_ENGINEER_EMAIL?.trim(),
          ),
        },
      },
      { status: 500 },
    );
  }
}
