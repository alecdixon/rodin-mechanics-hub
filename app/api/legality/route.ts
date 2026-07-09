import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFImage,
  type PDFPage,
  type PDFFont,
} from "pdf-lib";
import { canEditLegality } from "@/lib/userAccess";

export const runtime = "nodejs";

type LegalityStatus = "legal" | "illegal";

type LegalityPdfItem = {
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
  items?: LegalityPdfItem[];
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
  items: LegalityPdfItem[];
};

function getRequestUserEmail(request: NextRequest) {
  return request.cookies.get("user-email")?.value?.trim().toLowerCase() ?? "";
}

function blockUnauthorisedUser(request: NextRequest) {
  const userEmail = getRequestUserEmail(request);

  if (!userEmail || !canEditLegality(userEmail)) {
    return NextResponse.json(
      {
        error: "Only authorised users can send legality PDF emails.",
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

function formatHeightNotation(item: LegalityPdfItem) {
  if (!item.height_notation_enabled || item.status !== "legal") return "";

  const notation = cleanHeightNotation(item.height_notation);
  return notation ? `Height ${notation}/5` : "Height not recorded";
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
    error: "Surface table check PDF notification failed while sending the engineer email.",
    likely_cause:
      "The legality report may have saved, but the PDF email notification failed.",
    fix: "Check the technical_error value, then verify Gmail/Vercel environment variables.",
  };
}

function wrapTextByWidth(
  text: string,
  font: PDFFont,
  fontSize: number,
  maxWidth: number,
) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";

  words.forEach((word) => {
    const nextLine = line ? `${line} ${word}` : word;
    const width = font.widthOfTextAtSize(nextLine, fontSize);

    if (width > maxWidth && line) {
      lines.push(line);
      line = word;
      return;
    }

    line = nextLine;
  });

  if (line) lines.push(line);
  return lines.length > 0 ? lines : [""];
}

async function tryEmbedPng(pdfDoc: PDFDocument, fileName: string) {
  try {
    const filePath = path.join(process.cwd(), "public", fileName);
    const bytes = await readFile(filePath);
    return await pdfDoc.embedPng(bytes);
  } catch {
    return null;
  }
}

function drawFittedImage(
  page: PDFPage,
  image: PDFImage,
  x: number,
  y: number,
  maxWidth: number,
  maxHeight: number,
) {
  const imageRatio = image.width / image.height;
  const boxRatio = maxWidth / maxHeight;
  const width = imageRatio > boxRatio ? maxWidth : maxHeight * imageRatio;
  const height = imageRatio > boxRatio ? maxWidth / imageRatio : maxHeight;

  page.drawImage(image, {
    x: x + (maxWidth - width) / 2,
    y: y + (maxHeight - height) / 2,
    width,
    height,
  });
}

function drawOutlinedBox(
  page: PDFPage,
  x: number,
  y: number,
  width: number,
  height: number,
  border = rgb(0.78, 0.78, 0.82),
  fill = rgb(1, 1, 1),
) {
  page.drawRectangle({
    x,
    y,
    width,
    height,
    color: fill,
    borderColor: border,
    borderWidth: 0.75,
  });
}

function isSpareWingItem(item: LegalityPdfItem) {
  const key = item.item_key.toLowerCase();
  const name = item.item_name.toLowerCase();

  return key.startsWith("spare_") || name.includes("spare front wing");
}

async function buildLegalityPdf(payload: NormalisedLegalityEmailPayload) {
  const pdfDoc = await PDFDocument.create();
  const normalFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const rodinLogo = await tryEmbedPng(pdfDoc, "rodin-logo.png");
  const gb3Logo = await tryEmbedPng(pdfDoc, "gb3-logo.png");

  // Landscape A4 is much closer to the wide mechanics screen than portrait A4.
  const pageSize: [number, number] = [841.89, 595.28];
  const pageWidth = pageSize[0];
  const pageHeight = pageSize[1];
  const page = pdfDoc.addPage(pageSize);

  const green = rgb(0.06, 0.78, 0.34);
  const greenDark = rgb(0.025, 0.16, 0.08);
  const red = rgb(0.88, 0.03, 0.02);
  const redDark = rgb(0.20, 0.035, 0.045);
  const amber = rgb(0.93, 0.67, 0.13);
  const white = rgb(0.94, 0.95, 0.97);
  const grey = rgb(0.63, 0.66, 0.72);
  const muted = rgb(0.42, 0.45, 0.52);
  const borderGrey = rgb(0.22, 0.25, 0.30);
  const sheetBlack = rgb(0.012, 0.016, 0.024);
  const headerBlack = rgb(0.035, 0.041, 0.052);
  const panelBlack = rgb(0.050, 0.060, 0.076);
  const panelBlack2 = rgb(0.035, 0.045, 0.060);
  const cellBlack = rgb(0.020, 0.026, 0.038);

  const illegalItems = payload.items.filter((item) => item.status === "illegal");
  const spareWingItems = payload.items.filter(isSpareWingItem);
  const carItems = payload.items.filter((item) => !isSpareWingItem(item));
  const summary =
    illegalItems.length === 0
      ? `${payload.items.length}/${payload.items.length} legal`
      : `${illegalItems.length} illegal - ${payload.items.length - illegalItems.length} legal`;

  page.drawRectangle({ x: 0, y: 0, width: pageWidth, height: pageHeight, color: sheetBlack });

  function safePdfText(value: string | number | null | undefined) {
    return String(value ?? "")
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2013\u2014]/g, "-")
      .replace(/[\u2022]/g, "-");
  }

  function drawText(
    text: string,
    x: number,
    y: number,
    size = 9,
    font: PDFFont = normalFont,
    color = white,
  ) {
    page.drawText(safePdfText(text), { x, y, size, font, color });
  }

  function fontWidth(text: string, font: PDFFont, size: number) {
    return font.widthOfTextAtSize(safePdfText(text), size);
  }

  function drawCenteredText(
    text: string,
    x: number,
    y: number,
    width: number,
    size: number,
    font: PDFFont,
    color = white,
  ) {
    drawText(text, x + width / 2 - fontWidth(text, font, size) / 2, y, size, font, color);
  }

  function drawWrappedText(
    text: string,
    x: number,
    y: number,
    width: number,
    size: number,
    font: PDFFont = normalFont,
    color = white,
    maxLines = 2,
    lineHeight = size + 2,
  ) {
    const lines = wrapTextByWidth(safePdfText(text || "-"), font, size, width).slice(0, maxLines);
    lines.forEach((line, index) => drawText(line, x, y - index * lineHeight, size, font, color));
  }

  function drawPanel(x: number, y: number, width: number, height: number, fill = panelBlack2) {
    page.drawRectangle({
      x,
      y,
      width,
      height,
      color: fill,
      borderColor: borderGrey,
      borderWidth: 0.85,
    });
  }

  function drawSectionHeader(
    title: string,
    subtitle: string,
    unit: string,
    x: number,
    y: number,
    width: number,
  ) {
    drawText(title.toUpperCase(), x, y, 7.4, boldFont, red);
    if (subtitle) {
      drawWrappedText(subtitle, x, y - 11, width - 54, 5.8, normalFont, grey, 1, 7);
    }

    if (unit) {
      page.drawRectangle({
        x: x + width - 48,
        y: y - 5,
        width: 48,
        height: 15,
        color: cellBlack,
        borderColor: borderGrey,
        borderWidth: 0.55,
      });
      drawCenteredText(unit.toUpperCase(), x + width - 48, y - 0.5, 48, 5.5, boldFont, grey);
    }
  }

  function drawStatusPill(text: string, x: number, y: number, width: number, isIllegal: boolean) {
    const color = isIllegal ? red : green;
    const fill = isIllegal ? redDark : greenDark;
    page.drawRectangle({ x, y, width, height: 15, color: fill, borderColor: color, borderWidth: 0.8 });
    drawCenteredText(text.toUpperCase(), x, y + 4.8, width, 5.7, boldFont, color);
  }

  function drawReportHeader() {
    const headerH = 84;
    page.drawRectangle({ x: 0, y: pageHeight - headerH, width: pageWidth, height: headerH, color: headerBlack });
    page.drawRectangle({ x: 0, y: pageHeight - headerH, width: pageWidth, height: 1, color: borderGrey });

    if (rodinLogo) {
      drawFittedImage(page, rodinLogo, 18, pageHeight - 59, 92, 38);
    } else {
      drawText("RODIN", 22, pageHeight - 33, 17, boldFont, white);
      drawText("MOTORSPORT", 23, pageHeight - 46, 6.8, boldFont, grey);
    }

    if (gb3Logo) {
      drawFittedImage(page, gb3Logo, 21, pageHeight - 78, 58, 15);
    }

    drawText("RODIN MOTORSPORT", 126, pageHeight - 27, 6.8, boldFont, grey);
    drawText("SURFACE TABLE CHECKS", 126, pageHeight - 47, 21, boldFont, white);
    drawText("Completed mechanic sheet copy", 128, pageHeight - 63, 7.6, normalFont, grey);
    drawStatusPill(summary, 128, pageHeight - 80, 134, illegalItems.length > 0);

    const infoX = 326;
    const infoTop = pageHeight - 23;
    const infoH = 26;
    const gap = 6;

    function infoBox(label: string, value: string, x: number, y: number, width: number) {
      page.drawRectangle({
        x,
        y: y - infoH,
        width,
        height: infoH,
        color: cellBlack,
        borderColor: borderGrey,
        borderWidth: 0.6,
      });
      drawText(label.toUpperCase(), x + 7, y - 8.5, 5.4, boldFont, grey);
      drawWrappedText(value || "-", x + 7, y - 19, width - 14, 6.8, boldFont, white, 1, 7);
    }

    infoBox("Date", formatReportDate(payload.check_date), infoX, infoTop, 70);
    infoBox("Circuit", payload.circuit, infoX + 70 + gap, infoTop, 92);
    infoBox("Car", payload.car_name || `Car ${payload.car_id}`, infoX + 168 + gap, infoTop, 76);
    infoBox("Driver", payload.driver, infoX, infoTop - 34, 138);
    infoBox("Engineer", `${payload.engineer_name} / ${payload.engineer_email}`, infoX + 138 + gap, infoTop - 34, 207);
  }

  function drawMeasurementCell(
    label: string,
    helper: string,
    value: string,
    x: number,
    y: number,
    width: number,
    height: number,
  ) {
    page.drawRectangle({
      x,
      y,
      width,
      height,
      color: cellBlack,
      borderColor: borderGrey,
      borderWidth: 0.65,
    });

    drawText(label.toUpperCase(), x + 8, y + height - 11.5, 5.8, boldFont, grey);
    drawText(helper, x + 8, y + height - 21.5, 5.2, normalFont, muted);

    const displayValue = value || "-";
    const valueSize = displayValue.length > 11 ? 8.6 : 10.5;
    drawWrappedText(displayValue, x + 8, y + 8, width - 16, valueSize, boldFont, white, 1, valueSize + 2);
  }

  function drawMeasurementBlock(args: {
    title: string;
    subtitle: string;
    unit: string;
    values: { fl: string; fr: string; rl: string; rr: string };
    formatter: (value: string) => string;
    x: number;
    y: number;
    width: number;
    height: number;
    total?: string;
  }) {
    const { title, subtitle, unit, values, formatter, x, y, width, height, total } = args;
    drawPanel(x, y, width, height, panelBlack);

    const padding = 12;
    drawSectionHeader(title, subtitle, unit, x + padding, y + height - 16, width - padding * 2);

    const gridX = x + padding;
    const gridW = width - padding * 2;
    const gap = 7;
    const cellW = (gridW - gap) / 2;
    const cellH = total !== undefined ? 29 : 32;
    const topY = y + height - 69;
    const rearY = topY - cellH - 7;

    drawMeasurementCell("FL", "Front Left", formatter(values.fl), gridX, topY, cellW, cellH);
    drawMeasurementCell("FR", "Front Right", formatter(values.fr), gridX + cellW + gap, topY, cellW, cellH);
    drawMeasurementCell("RL", "Rear Left", formatter(values.rl), gridX, rearY, cellW, cellH);
    drawMeasurementCell("RR", "Rear Right", formatter(values.rr), gridX + cellW + gap, rearY, cellW, cellH);

    if (total !== undefined) {
      drawMeasurementCell("TOTAL", "Total Weight", formatter(total), gridX, y + padding, gridW, 25);
    }
  }

  function drawShimCell(label: string, value: string, x: number, y: number, width: number, height: number) {
    page.drawRectangle({
      x,
      y,
      width,
      height,
      color: cellBlack,
      borderColor: borderGrey,
      borderWidth: 0.6,
    });
    drawText(label.toUpperCase(), x + 7, y + height - 10.5, 5.5, boldFont, grey);
    drawWrappedText(formatShim(value), x + 7, y + 7.2, width - 14, 8.4, boldFont, white, 1, 10);
  }

  function drawWingShimPanel(x: number, y: number, width: number, height: number) {
    drawPanel(x, y, width, height, panelBlack);
    drawSectionHeader(
      "Front Wing Shim Record",
      "Main and spare front wing shim packs.",
      "shims",
      x + 12,
      y + height - 16,
      width - 24,
    );

    const padding = 12;
    const gap = 7;
    const cellW = (width - padding * 2 - gap) / 2;
    const cellH = 26;
    const topY = y + 38;
    const bottomY = y + 10;

    drawShimCell("Main LH", payload.wing_shims.main_lh, x + padding, topY, cellW, cellH);
    drawShimCell("Main RH", payload.wing_shims.main_rh, x + padding + cellW + gap, topY, cellW, cellH);
    drawShimCell("Spare LH", payload.wing_shims.spare_lh, x + padding, bottomY, cellW, cellH);
    drawShimCell("Spare RH", payload.wing_shims.spare_rh, x + padding + cellW + gap, bottomY, cellW, cellH);
  }

  function shortItemName(item: LegalityPdfItem) {
    const sidePattern = item.item_side === "LH" || item.item_side === "RH" ? new RegExp(`\\s+${item.item_side}$`, "i") : null;
    const withoutSide = sidePattern ? item.item_name.replace(sidePattern, "").trim() : item.item_name.trim();
    const name = withoutSide
      .replace(/spare front wing/gi, "Spare FW")
      .replace(/front wing endplate/gi, "FWEP")
      .replace(/endplate/gi, "EP")
      .replace(/front wing/gi, "FW")
      .trim();

    return name || withoutSide || item.item_name;
  }

  function sortForSheet(items: LegalityPdfItem[]) {
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

  function heightLabel(item: LegalityPdfItem) {
    const height = formatHeightNotation(item).replace("Height ", "");
    return height || "-";
  }

  function drawSpareStatusCard(item: LegalityPdfItem, x: number, y: number, width: number, height: number) {
    const isIllegal = item.status === "illegal";
    page.drawRectangle({
      x,
      y,
      width,
      height,
      color: isIllegal ? redDark : cellBlack,
      borderColor: isIllegal ? red : green,
      borderWidth: 0.85,
    });
    drawWrappedText(shortItemName(item), x + 9, y + height - 13, width - 76, 7.0, boldFont, white, 1, 8);
    drawStatusPill(isIllegal ? "Illegal" : "Legal", x + width - 64, y + height - 18, 54, isIllegal);
    drawText(`Height: ${heightLabel(item)}`, x + 9, y + 8, 5.8, normalFont, grey);
  }

  function orderedSpareWingItems(items: LegalityPdfItem[]) {
    const order = ["spare_fwep_lh", "spare_fw", "spare_fwep_rh"];
    return [...items].sort((a, b) => {
      const aIndex = order.indexOf(a.item_key);
      const bIndex = order.indexOf(b.item_key);
      return (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex) || a.item_name.localeCompare(b.item_name);
    });
  }

  function drawSpareWingPanel(x: number, y: number, width: number, height: number) {
    drawPanel(x, y, width, height, panelBlack);
    drawSectionHeader(
      "Spare Front Wing Checks",
      "Same status cards as the mechanic working sheet.",
      "spare fw",
      x + 12,
      y + height - 16,
      width - 24,
    );

    const spareItems = orderedSpareWingItems(spareWingItems).slice(0, 3);
    const padding = 12;
    const gap = 9;
    const cardW = (width - padding * 2 - gap * 2) / 3;
    const cardH = 34;
    const cardY = y + 12;

    if (spareItems.length === 0) {
      drawWrappedText("No spare front wing checks were supplied.", x + padding, cardY + 11, width - padding * 2, 7, normalFont, grey, 1, 8);
      return;
    }

    spareItems.forEach((item, index) => {
      drawSpareStatusCard(item, x + padding + index * (cardW + gap), cardY, cardW, cardH);
    });
  }

  function drawStatusRow(item: LegalityPdfItem, x: number, y: number, width: number, rowH: number) {
    const isIllegal = item.status === "illegal";
    page.drawRectangle({
      x,
      y,
      width,
      height: rowH,
      color: isIllegal ? redDark : cellBlack,
      borderColor: isIllegal ? red : borderGrey,
      borderWidth: isIllegal ? 0.75 : 0.45,
    });

    const rowFont = rowH < 17 ? 5.3 : 6.0;
    const statusText = isIllegal ? "ILLEGAL" : "LEGAL";
    drawWrappedText(shortItemName(item), x + 7, y + rowH - rowFont - 4, width - 118, rowFont, boldFont, white, 1, rowFont + 1);
    drawText(item.item_side || "-", x + width - 110, y + rowH - rowFont - 4, rowFont, normalFont, grey);
    drawText(heightLabel(item), x + width - 82, y + rowH - rowFont - 4, rowFont, boldFont, grey);
    drawText(statusText, x + width - 48, y + rowH - rowFont - 4, rowFont, boldFont, isIllegal ? red : green);
  }

  function drawTotalCarPanel(x: number, y: number, width: number, height: number) {
    drawPanel(x, y, width, height, panelBlack);
    drawSectionHeader(
      "Total Car Surface Points",
      "Height uses 0 = low touching and 5 = high touching.",
      "total car",
      x + 12,
      y + height - 16,
      width - 24,
    );

    const padding = 12;
    const sortedCarItems = sortForSheet(carItems);
    const leftColumn = sortedCarItems.filter((item) => item.item_side === "LH");
    const rightColumn = sortedCarItems.filter((item) => item.item_side === "RH");
    const centreItems = sortedCarItems.filter((item) => item.item_side !== "LH" && item.item_side !== "RH");
    const maxRows = Math.max(leftColumn.length, rightColumn.length, 1);
    const colGap = 10;
    const colW = (width - padding * 2 - colGap) / 2;
    const headerY = y + height - 62;

    function drawColumnHeader(startX: number) {
      drawText("POINT", startX + 7, headerY, 5.8, boldFont, grey);
      drawText("SIDE", startX + colW - 110, headerY, 5.8, boldFont, grey);
      drawText("HEIGHT", startX + colW - 82, headerY, 5.8, boldFont, grey);
      drawText("STATUS", startX + colW - 48, headerY, 5.8, boldFont, grey);
    }

    drawColumnHeader(x + padding);
    drawColumnHeader(x + padding + colW + colGap);

    const centreReserve = centreItems.length > 0 ? 30 : 0;
    const rowTop = headerY - 22;
    const rowBottom = y + 14 + centreReserve;
    const rowGap = 4;
    const availableRowH = rowTop - rowBottom - Math.max(0, maxRows - 1) * rowGap;
    const rowH = Math.max(13, Math.min(22, Math.floor(availableRowH / maxRows)));

    leftColumn.forEach((item, index) => {
      drawStatusRow(item, x + padding, rowTop - index * (rowH + rowGap), colW, rowH);
    });
    rightColumn.forEach((item, index) => {
      drawStatusRow(item, x + padding + colW + colGap, rowTop - index * (rowH + rowGap), colW, rowH);
    });

    if (centreItems.length > 0) {
      const centreY = y + 12;
      const centreGap = 8;
      const centreW = (width - padding * 2 - centreGap * Math.max(0, centreItems.length - 1)) / centreItems.length;
      centreItems.forEach((item, index) => {
        drawStatusRow(item, x + padding + index * (centreW + centreGap), centreY, centreW, 22);
      });
    }
  }

  function drawNotesPanel(x: number, y: number, width: number, height: number) {
    drawPanel(x, y, width, height, panelBlack);
    drawText("CHECK SUMMARY", x + 12, y + height - 16, 7, boldFont, red);
    drawText(summary.toUpperCase(), x + 12, y + height - 33, 12, boldFont, illegalItems.length ? red : green);

    if (illegalItems.length === 0) {
      drawWrappedText("All recorded surface table check items are legal.", x + 12, y + height - 51, width - 24, 7.4, normalFont, grey, 2, 9);
      return;
    }

    const notes = illegalItems.slice(0, 5);
    notes.forEach((item, index) => {
      const noteY = y + height - 52 - index * 15;
      page.drawRectangle({ x: x + 12, y: noteY - 3, width: width - 24, height: 12, color: redDark, borderColor: red, borderWidth: 0.45 });
      drawWrappedText(`${shortItemName(item)}: ${item.illegal_note || "Missing note"}`, x + 17, noteY + 1, width - 34, 5.8, normalFont, white, 1, 6.5);
    });

    if (illegalItems.length > notes.length) {
      drawText(`+ ${illegalItems.length - notes.length} more illegal note(s)`, x + 14, y + 8, 6.4, boldFont, red);
    }
  }

  drawReportHeader();

  const margin = 18;
  const leftW = 270;
  const gap = 14;
  const rightX = margin + leftW + gap;
  const rightW = pageWidth - margin - rightX;

  drawMeasurementBlock({
    title: "Corner Weight Measurements",
    subtitle: "Front axle over rear axle, matching the input sheet.",
    unit: "kg",
    values: payload.corner_weights,
    total: payload.corner_weights.total,
    formatter: formatWeight,
    x: margin,
    y: 347,
    width: leftW,
    height: 141,
  });

  drawMeasurementBlock({
    title: "Camber Measurements",
    subtitle: "Front axle over rear axle. Negative values shown as entered.",
    unit: "deg",
    values: payload.camber_measurements,
    formatter: formatCamber,
    x: margin,
    y: 217,
    width: leftW,
    height: 116,
  });

  drawWingShimPanel(margin, 116, leftW, 87);
  drawSpareWingPanel(rightX, 408, rightW, 80);
  drawTotalCarPanel(rightX, 118, rightW, 276);
  drawNotesPanel(margin, 24, leftW, 78);
  drawNotesPanel(rightX, 24, rightW, 80);

  drawText("PDF layout: surface-table-v14-page-copy-landscape", pageWidth - 206, 10, 5.2, normalFont, muted);

  return Buffer.from(await pdfDoc.save());
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
          error: "Missing legality payload fields.",
          details: "The request must include car_id, check_date and circuit.",
        },
        { status: 400 },
      );
    }

    const items = rawPayload.items ?? [];

    if (items.length === 0) {
      return NextResponse.json(
        {
          error: "No legality items were supplied for the PDF.",
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

    const payload: NormalisedLegalityEmailPayload = {
      check_id: clean(rawPayload.check_id),
      car_id: Number(rawPayload.car_id),
      car_name: clean(rawPayload.car_name) || `Car ${rawPayload.car_id}`,
      driver: clean(rawPayload.driver) || "Unknown",
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

    const pdfBuffer = await buildLegalityPdf(payload);
    const safeFileName = `Surface_Table_Checks_${payload.circuit.replace(/[^a-z0-9]+/gi, "_")}_Car_${payload.car_id}_${payload.check_date}.pdf`;

    if (downloadOnly) {
      return new NextResponse(pdfBuffer, {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${safeFileName}"`,
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
        illegalCount > 0 ? "Illegal item notes are included in the attached PDF." : "No illegal items were recorded.",
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
                  <td style="padding:9px 10px;font-weight:bold;border-bottom:1px solid #eee">Corner Weights</td>
                  <td style="padding:9px 10px;border-bottom:1px solid #eee">
                    FL ${escapeHtml(formatWeight(payload.corner_weights.fl))} ·
                    FR ${escapeHtml(formatWeight(payload.corner_weights.fr))}<br />
                    RL ${escapeHtml(formatWeight(payload.corner_weights.rl))} ·
                    RR ${escapeHtml(formatWeight(payload.corner_weights.rr))}<br />
                    Total ${escapeHtml(formatWeight(payload.corner_weights.total))}
                  </td>
                </tr>
                <tr>
                  <td style="padding:9px 10px;font-weight:bold;border-bottom:1px solid #eee">Camber</td>
                  <td style="padding:9px 10px;border-bottom:1px solid #eee">
                    FL ${escapeHtml(formatCamber(payload.camber_measurements.fl))} ·
                    FR ${escapeHtml(formatCamber(payload.camber_measurements.fr))}<br />
                    RL ${escapeHtml(formatCamber(payload.camber_measurements.rl))} ·
                    RR ${escapeHtml(formatCamber(payload.camber_measurements.rr))}
                  </td>
                </tr>
                <tr>
                  <td style="padding:9px 10px;font-weight:bold;border-bottom:1px solid #eee">Wing Shims</td>
                  <td style="padding:9px 10px;border-bottom:1px solid #eee">
                    Main LH ${escapeHtml(formatShim(payload.wing_shims.main_lh))} ·
                    Main RH ${escapeHtml(formatShim(payload.wing_shims.main_rh))}<br />
                    Spare LH ${escapeHtml(formatShim(payload.wing_shims.spare_lh))} ·
                    Spare RH ${escapeHtml(formatShim(payload.wing_shims.spare_rh))}
                  </td>
                </tr>
                <tr>
                  <td style="padding:9px 10px;font-weight:bold;border-bottom:1px solid #eee">Summary</td>
                  <td style="padding:9px 10px;border-bottom:1px solid #eee"><strong>${escapeHtml(summary)}</strong></td>
                </tr>
              </table>

              <p style="margin:0 0 14px;font-size:14px;color:#374151">
                A PDF copy of the completed legality sheet is attached.
              </p>

              ${
                illegalCount > 0
                  ? `<div style="border:1px solid #fecaca;background:#fef2f2;color:#991b1b;border-radius:10px;padding:12px 14px;font-size:14px"><strong>${escapeHtml(illegalCount)} illegal item(s)</strong> were recorded. See the PDF attachment for the full notes.</div>`
                  : `<div style="border:1px solid #bbf7d0;background:#f0fdf4;color:#166534;border-radius:10px;padding:12px 14px;font-size:14px"><strong>All checked items are legal.</strong></div>`
              }
            </div>
          </div>
        </div>
      `,
      attachments: [
        {
          filename: safeFileName,
          content: pdfBuffer,
          contentType: "application/pdf",
        },
      ],
    });

    return NextResponse.json({
      ok: true,
      sent_to: to,
      engineer_name: payload.engineer_name,
      circuit: payload.circuit,
      check_date: payload.check_date,
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
