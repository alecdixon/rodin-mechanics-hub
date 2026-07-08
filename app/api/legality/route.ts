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
  const carOverview = await tryEmbedPng(pdfDoc, "legality-car-overview-inverted.png");
  const spareFrontWing =
    (await tryEmbedPng(pdfDoc, "legality-spare-front-wing.png")) ||
    (await tryEmbedPng(pdfDoc, "legality-spare-fron-wing.png"));

  const pageSize: [number, number] = [595.28, 841.89];
  const pageWidth = pageSize[0];
  const pageHeight = pageSize[1];
  let page = pdfDoc.addPage(pageSize);

  const green = rgb(0.0, 0.78, 0.32);
  const red = rgb(1.0, 0.12, 0.18);
  const white = rgb(0.94, 0.95, 0.97);
  const grey = rgb(0.58, 0.61, 0.68);
  const muted = rgb(0.40, 0.43, 0.50);
  const borderGrey = rgb(0.25, 0.27, 0.32);
  const sheetBlack = rgb(0.012, 0.016, 0.024);
  const panelBlack = rgb(0.035, 0.045, 0.060);
  const cellBlack = rgb(0.020, 0.026, 0.038);
  const gridGrey = rgb(0.16, 0.17, 0.20);

  const illegalItems = payload.items.filter((item) => item.status === "illegal");
  const spareWingItems = payload.items.filter(isSpareWingItem);
  const carItems = payload.items.filter((item) => !isSpareWingItem(item));
  const summary =
    illegalItems.length === 0
      ? `${payload.items.length}/${payload.items.length} legal`
      : `${illegalItems.length} illegal - ${payload.items.length - illegalItems.length} legal`;

  function drawText(
    text: string,
    x: number,
    y: number,
    size = 9,
    font: PDFFont = normalFont,
    color = white,
  ) {
    page.drawText(text, { x, y, size, font, color });
  }

  function fontWidth(text: string, font: PDFFont, size: number) {
    return font.widthOfTextAtSize(text, size);
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
    const lines = wrapTextByWidth(text || "-", font, size, width).slice(0, maxLines);
    lines.forEach((line, index) => drawText(line, x, y - index * lineHeight, size, font, color));
  }

  function addBackground() {
    page.drawRectangle({ x: 0, y: 0, width: pageWidth, height: pageHeight, color: sheetBlack });
  }

  function newPage() {
    page = pdfDoc.addPage(pageSize);
    addBackground();
  }

  function drawPanel(x: number, y: number, width: number, height: number, fill = panelBlack) {
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

  function drawReportHeader() {
    page.drawRectangle({ x: 0, y: pageHeight - 92, width: pageWidth, height: 92, color: sheetBlack });
    page.drawLine({
      start: { x: 0, y: pageHeight - 92 },
      end: { x: pageWidth, y: pageHeight - 92 },
      thickness: 0.8,
      color: borderGrey,
    });

    if (rodinLogo) {
      drawFittedImage(page, rodinLogo, 18, pageHeight - 66, 86, 42);
    } else {
      drawText("RODIN", 20, pageHeight - 40, 18, boldFont, white);
      drawText("MOTORSPORT", 21, pageHeight - 54, 7, boldFont, grey);
    }

    if (gb3Logo) {
      drawFittedImage(page, gb3Logo, 22, pageHeight - 88, 58, 16);
    }

    drawText("SURFACE TABLE CHECKS", 126, pageHeight - 37, 17.5, boldFont, white);
    drawText(summary, 128, pageHeight - 54, 8.5, boldFont, illegalItems.length ? red : green);

    const infoX = 370;
    const infoY = pageHeight - 31;
    const boxW = 68;
    const boxH = 26;
    const gap = 5;

    function infoBox(label: string, value: string, x: number, y: number, width: number, height = boxH) {
      drawPanel(x, y - height, width, height, cellBlack);
      drawText(label.toUpperCase(), x + 5, y - 9, 5.4, boldFont, grey);
      drawWrappedText(value || "-", x + 5, y - 19, width - 10, 6.5, boldFont, white, 1, 7);
    }

    infoBox("Date", formatReportDate(payload.check_date), infoX, infoY, boxW);
    infoBox("Circuit", payload.circuit, infoX + boxW + gap, infoY, boxW + 8);
    infoBox("Car", payload.car_name || `Car ${payload.car_id}`, infoX + boxW * 2 + gap * 2 + 8, infoY, 98);
    infoBox("Driver", payload.driver, infoX, infoY - 32, 116);
    infoBox("Engineer", `${payload.engineer_name} / ${payload.engineer_email}`, infoX + 121, infoY - 32, 167);
  }

  function drawSectionTitle(title: string, subtitle: string, unit: string, x: number, y: number, width: number) {
    drawText(title.toUpperCase(), x, y, 7.4, boldFont, red);
    drawWrappedText(subtitle, x, y - 11, width - 56, 6.2, normalFont, grey, 1, 7);
    page.drawRectangle({
      x: x + width - 44,
      y: y - 4,
      width: 44,
      height: 15,
      color: cellBlack,
      borderColor: borderGrey,
      borderWidth: 0.65,
    });
    drawCenteredText(unit.toUpperCase(), x + width - 44, y + 1.2, 44, 5.8, boldFont, grey);
  }

  function drawMeasurementCell(label: string, helper: string, value: string, x: number, y: number, width: number, height: number) {
    page.drawRectangle({
      x,
      y,
      width,
      height,
      color: cellBlack,
      borderColor: borderGrey,
      borderWidth: 0.65,
    });
    drawText(label.toUpperCase(), x + 8, y + height - 12, 6.5, boldFont, grey);
    drawText(helper, x + 8, y + height - 22, 5.7, normalFont, muted);
    const valueSize = value.length > 12 ? 8.5 : 12.4;
    drawWrappedText(value || "-", x + 8, y + 9, width - 16, valueSize, boldFont, white, 1, valueSize + 2);
  }

  function drawMeasurementPanel(args: {
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
    drawPanel(x, y, width, height);
    const padding = 14;
    drawSectionTitle(title, subtitle, unit, x + padding, y + height - 17, width - padding * 2);

    const gridX = x + padding;
    const gridW = width - padding * 2;
    const gap = 10;
    const cellW = (gridW - gap) / 2;
    const totalHeight = total !== undefined ? 29 : 0;
    const rowGap = 8;
    const cellH = total !== undefined ? 38 : 40;
    const topY = y + height - 64;
    const rearY = topY - cellH - rowGap;

    drawMeasurementCell("FL", "Front Left", formatter(values.fl), gridX, topY, cellW, cellH);
    drawMeasurementCell("FR", "Front Right", formatter(values.fr), gridX + cellW + gap, topY, cellW, cellH);
    drawMeasurementCell("RL", "Rear Left", formatter(values.rl), gridX, rearY, cellW, cellH);
    drawMeasurementCell("RR", "Rear Right", formatter(values.rr), gridX + cellW + gap, rearY, cellW, cellH);

    if (total !== undefined) {
      drawMeasurementCell("TOTAL", "Total Weight", formatter(total), gridX, y + padding, gridW, totalHeight);
    }
  }

  function drawShimValue(label: string, value: string, x: number, y: number, width: number, height: number) {
    page.drawRectangle({
      x,
      y,
      width,
      height,
      color: cellBlack,
      borderColor: borderGrey,
      borderWidth: 0.65,
    });
    drawText(label.toUpperCase(), x + 8, y + height - 12, 6.3, boldFont, grey);
    drawWrappedText(formatShim(value), x + 8, y + 9, width - 16, 10, boldFont, white, 1, 11);
  }

  function drawWingShimPanel(x: number, y: number, width: number, height: number) {
    drawPanel(x, y, width, height);
    drawSectionTitle(
      "Front Wing Shim Record",
      "Chief mechanic record for main and spare front wing shim packs.",
      "shims",
      x + 14,
      y + height - 18,
      width - 28,
    );

    const padding = 14;
    const halfGap = 14;
    const sectionW = (width - padding * 2 - halfGap) / 2;
    const cellGap = 8;
    const cellW = (sectionW - cellGap) / 2;
    const cellH = 32;
    const cellY = y + 15;

    const sections: Array<[string, string, string, number]> = [
      ["Main Front Wing", payload.wing_shims.main_lh, payload.wing_shims.main_rh, x + padding],
      ["Spare Front Wing", payload.wing_shims.spare_lh, payload.wing_shims.spare_rh, x + padding + sectionW + halfGap],
    ];

    sections.forEach(([title, lh, rh, sectionX]) => {
      drawText(title.toUpperCase(), sectionX, cellY + cellH + 8, 6.8, boldFont, red);
      drawShimValue("LH", lh, sectionX, cellY, cellW, cellH);
      drawShimValue("RH", rh, sectionX + cellW + cellGap, cellY, cellW, cellH);
    });
  }

  function drawStatusPill(text: string, x: number, y: number, width: number, isIllegal: boolean) {
    const fill = isIllegal ? rgb(0.20, 0.035, 0.045) : rgb(0.025, 0.16, 0.08);
    const color = isIllegal ? red : green;
    page.drawRectangle({ x, y, width, height: 14, color: fill, borderColor: color, borderWidth: 0.85 });
    drawCenteredText(text.toUpperCase(), x, y + 4.2, width, 5.9, boldFont, color);
  }

  function shortItemName(item: LegalityPdfItem) {
    const withoutSide = item.item_name.replace(/\s+(LH|RH)$/i, "").trim();
    const name = withoutSide
      .replace(/spare front wing/gi, "Spare FW")
      .replace(/endplate/gi, "EP")
      .replace(/front wing/gi, "FW")
      .trim();
    return name || withoutSide || item.item_name;
  }

  function drawStatusTag(item: LegalityPdfItem, x: number, y: number, width: number) {
    const isIllegal = item.status === "illegal";
    page.drawRectangle({
      x,
      y,
      width,
      height: 27,
      color: panelBlack,
      borderColor: isIllegal ? red : green,
      borderWidth: 1.1,
    });
    drawWrappedText(shortItemName(item).toUpperCase(), x + 6, y + 15, width - 44, 6.5, boldFont, white, 1, 7);
    const heightText = formatHeightNotation(item);
    if (heightText) {
      drawWrappedText(heightText.toUpperCase(), x + 6, y + 6, width - 44, 5.2, boldFont, grey, 1, 6);
    }
    drawStatusPill(isIllegal ? "Red" : "Legal", x + width - 38, y + 6.5, 32, isIllegal);
  }

  function drawImagePanelBackground(x: number, y: number, width: number, height: number) {
    drawOutlinedBox(page, x, y, width, height, borderGrey, sheetBlack);
    for (let gridX = x + 28; gridX < x + width; gridX += 36) {
      page.drawLine({
        start: { x: gridX, y: y + 10 },
        end: { x: gridX, y: y + height - 10 },
        thickness: 0.25,
        color: gridGrey,
      });
    }
    for (let gridY = y + 28; gridY < y + height; gridY += 36) {
      page.drawLine({
        start: { x: x + 10, y: gridY },
        end: { x: x + width - 10, y: gridY },
        thickness: 0.25,
        color: gridGrey,
      });
    }
  }

  function drawFallbackSpareWing(x: number, y: number, width: number, height: number) {
    const cx = x + width / 2;
    const cy = y + height / 2;
    page.drawLine({ start: { x: x + 70, y: cy }, end: { x: x + width - 70, y: cy }, thickness: 1.1, color: white });
    page.drawLine({ start: { x: x + 70, y: cy }, end: { x: cx - 55, y: cy + 35 }, thickness: 1.0, color: white });
    page.drawLine({ start: { x: x + width - 70, y: cy }, end: { x: cx + 55, y: cy + 35 }, thickness: 1.0, color: white });
    page.drawLine({ start: { x: x + 70, y: cy - 22 }, end: { x: cx - 45, y: cy - 5 }, thickness: 1.0, color: white });
    page.drawLine({ start: { x: x + width - 70, y: cy - 22 }, end: { x: cx + 45, y: cy - 5 }, thickness: 1.0, color: white });
    page.drawRectangle({ x: x + 58, y: cy - 30, width: 5, height: 65, borderColor: white, borderWidth: 1.0 });
    page.drawRectangle({ x: x + width - 63, y: cy - 30, width: 5, height: 65, borderColor: white, borderWidth: 1.0 });
    page.drawRectangle({ x: cx - 26, y: cy - 42, width: 52, height: 84, borderColor: white, borderWidth: 1.0 });
  }

  function sortSpareWingItems(items: LegalityPdfItem[]) {
    return [...items].sort((a, b) => {
      const aKey = `${a.item_key} ${a.item_name}`.toLowerCase();
      const bKey = `${b.item_key} ${b.item_name}`.toLowerCase();
      const score = (value: string) => {
        if (value.includes("lh") || value.includes("lfwep")) return 0;
        if (value.includes("spare_fw") || value.includes("centre")) return 1;
        if (value.includes("rh") || value.includes("rfwep")) return 2;
        return 3;
      };
      return score(aKey) - score(bKey) || a.item_name.localeCompare(b.item_name);
    });
  }

  function drawSpareWingPanel(x: number, y: number, width: number, height: number) {
    drawImagePanelBackground(x, y, width, height);
    drawText("SPARE FRONT WING", x + 14, y + height - 18, 8, boldFont, red);
    drawText("LFWEP / FW / RFWEP", x + 14, y + height - 31, 6.3, normalFont, grey);

    if (spareFrontWing) {
      drawFittedImage(page, spareFrontWing, x + 92, y + 26, width - 184, height - 50);
    } else {
      drawFallbackSpareWing(x + 90, y + 26, width - 180, height - 50);
    }

    const orderedItems = sortSpareWingItems(spareWingItems).slice(0, 3);
    const tagW = 100;
    const tagY = y + 42;
    const positions = [x + 20, x + width / 2 - tagW / 2, x + width - tagW - 20];
    orderedItems.forEach((item, index) => drawStatusTag(item, positions[index] ?? positions[1], tagY, tagW));
  }

  function sortForSheet(items: LegalityPdfItem[]) {
    const order = ["spare", "fw", "fwep", "front", "mid", "rear", "diffuser", "rw"];
    return [...items].sort((a, b) => {
      const aName = `${a.item_key} ${a.item_name}`.toLowerCase();
      const bName = `${b.item_key} ${b.item_name}`.toLowerCase();
      const aSide = a.item_side === "LH" ? 0 : a.item_side === "RH" ? 2 : 1;
      const bSide = b.item_side === "LH" ? 0 : b.item_side === "RH" ? 2 : 1;
      const aOrder = order.findIndex((key) => aName.includes(key));
      const bOrder = order.findIndex((key) => bName.includes(key));
      return aSide - bSide || (aOrder < 0 ? 99 : aOrder) - (bOrder < 0 ? 99 : bOrder) || a.item_name.localeCompare(b.item_name);
    });
  }

  function drawTotalCarPanel(x: number, y: number, width: number, height: number) {
    drawImagePanelBackground(x, y, width, height);
    drawText("TOTAL CAR", x + 14, y + height - 18, 8, boldFont, red);
    drawText("Full-car surface table points", x + 14, y + height - 31, 6.3, normalFont, grey);
    drawStatusPill(summary, x + width - 126, y + height - 26, 108, illegalItems.length > 0);

    const imageX = x + 136;
    const imageY = y + 34;
    const imageW = width - 272;
    const imageH = height - 72;
    if (carOverview) {
      drawFittedImage(page, carOverview, imageX, imageY, imageW, imageH);
    } else {
      drawText("CAR OVERVIEW IMAGE MISSING", imageX + 16, imageY + imageH / 2, 8.5, boldFont, red);
    }

    const sortedCarItems = sortForSheet(carItems);
    const leftItems = sortedCarItems.filter((item) => item.item_side === "LH").slice(0, 6);
    const rightItems = sortedCarItems.filter((item) => item.item_side === "RH").slice(0, 6);
    const centreItems = sortedCarItems.filter((item) => item.item_side !== "LH" && item.item_side !== "RH").slice(0, 2);
    const tagW = 106;
    const startY = y + height - 80;
    const step = 44;

    leftItems.forEach((item, index) => drawStatusTag(item, x + 18, startY - index * step, tagW));
    rightItems.forEach((item, index) => drawStatusTag(item, x + width - tagW - 18, startY - index * step, tagW));
    centreItems.forEach((item, index) => drawStatusTag(item, x + width / 2 - tagW / 2, y + 24 + index * 34, tagW));
  }

  function drawSummaryPanel(x: number, y: number, width: number, height: number) {
    drawPanel(x, y, width, height);
    drawText("CHECK SUMMARY", x + 14, y + height - 18, 7.4, boldFont, red);
    drawText(summary.toUpperCase(), x + 14, y + height - 36, 14, boldFont, illegalItems.length ? red : green);
    const note = illegalItems.length
      ? "Illegal notes are listed on the component list page."
      : "All recorded surface table check items are legal.";
    drawWrappedText(note, x + 14, y + height - 54, width - 28, 8, normalFont, grey, 2, 10);

    const preview = illegalItems.slice(0, 4);
    preview.forEach((item, index) => {
      const rowY = y + height - 84 - index * 22;
      page.drawRectangle({ x: x + 14, y: rowY, width: width - 28, height: 17, color: rgb(0.16, 0.035, 0.045), borderColor: red, borderWidth: 0.5 });
      drawWrappedText(`${shortItemName(item)} - ${item.illegal_note || "Missing note"}`, x + 22, rowY + 5, width - 44, 6.6, normalFont, white, 1, 7);
    });
  }

  function drawFooter(text = "PDF layout: surface-table-v12") {
    drawText(text, pageWidth - 120, 18, 5.3, normalFont, grey);
  }

  addBackground();
  drawReportHeader();
  drawMeasurementPanel({
    title: "Corner Weight Measurements",
    subtitle: "Front axle over rear axle, matching the input sheet.",
    unit: "kg",
    values: payload.corner_weights,
    total: payload.corner_weights.total,
    formatter: formatWeight,
    x: 22,
    y: 548,
    width: pageWidth - 44,
    height: 174,
  });
  drawMeasurementPanel({
    title: "Camber Measurements",
    subtitle: "Front axle over rear axle. Negative values are shown as entered.",
    unit: "deg",
    values: payload.camber_measurements,
    formatter: formatCamber,
    x: 22,
    y: 394,
    width: pageWidth - 44,
    height: 132,
  });
  drawWingShimPanel(22, 268, pageWidth - 44, 104);
  drawSummaryPanel(22, 112, pageWidth - 44, 128);
  drawFooter();

  newPage();
  drawReportHeader();
  drawSpareWingPanel(22, 520, pageWidth - 44, 172);
  drawTotalCarPanel(22, 58, pageWidth - 44, 430);
  drawFooter("PDF layout: surface-table-v12 - visual checks");

  const sortedItems = sortForSheet(payload.items);
  newPage();
  let y = 786;
  const margin = 34;
  const usableWidth = pageWidth - margin * 2;

  function drawCompactMeasurementLine(title: string, values: Array<[string, string]>, formatter: (value: string) => string) {
    page.drawRectangle({ x: margin, y: y - 28, width: usableWidth, height: 25, color: panelBlack, borderColor: borderGrey, borderWidth: 0.55 });
    drawText(title.toUpperCase(), margin + 8, y - 13, 6.8, boldFont, grey);
    values.forEach(([label, value], index) => {
      const cellX = margin + 142 + index * 72;
      drawText(label.toUpperCase(), cellX, y - 10, 5.8, boldFont, grey);
      drawText(formatter(value), cellX, y - 22, 7.4, boldFont, white);
    });
    y -= 31;
  }

  function drawListHeader() {
    drawText("RODIN MOTORSPORT - SURFACE TABLE COMPONENT LIST", margin, y, 9, boldFont, red);
    y -= 18;
    drawWrappedText(`${payload.car_name} - ${payload.driver} - ${payload.circuit} - ${formatReportDate(payload.check_date)}`, margin, y, usableWidth, 13, boldFont, white, 2, 15);
    y -= 36;

    drawCompactMeasurementLine(
      "Corner weights",
      [["FL", payload.corner_weights.fl], ["FR", payload.corner_weights.fr], ["RL", payload.corner_weights.rl], ["RR", payload.corner_weights.rr], ["TOTAL", payload.corner_weights.total]],
      formatWeight,
    );
    drawCompactMeasurementLine(
      "Camber",
      [["FL", payload.camber_measurements.fl], ["FR", payload.camber_measurements.fr], ["RL", payload.camber_measurements.rl], ["RR", payload.camber_measurements.rr]],
      formatCamber,
    );
    drawCompactMeasurementLine(
      "Wing shims",
      [["Main LH", payload.wing_shims.main_lh], ["Main RH", payload.wing_shims.main_rh], ["Spare LH", payload.wing_shims.spare_lh], ["Spare RH", payload.wing_shims.spare_rh]],
      formatShim,
    );

    page.drawRectangle({ x: margin, y: y - 7, width: usableWidth, height: 18, color: panelBlack, borderColor: borderGrey, borderWidth: 0.45 });
    drawText("COMPONENT", margin + 7, y, 6.7, boldFont, white);
    drawText("SIDE", margin + 164, y, 6.7, boldFont, white);
    drawText("STATUS", margin + 205, y, 6.7, boldFont, white);
    drawText("HEIGHT", margin + 262, y, 6.7, boldFont, white);
    drawText("POSITION / ILLEGAL NOTE", margin + 318, y, 6.7, boldFont, white);
    y -= 20;
  }

  function newListPage() {
    newPage();
    y = 786;
    drawListHeader();
  }

  drawListHeader();

  sortedItems.forEach((item) => {
    const isIllegal = item.status === "illegal";
    const heightText = formatHeightNotation(item).replace("Height ", "");
    const noteText = isIllegal ? item.illegal_note || "Missing note" : item.item_position || "-";
    const noteLines = wrapTextByWidth(noteText, normalFont, 7.6, usableWidth - 330);
    const rowHeight = Math.max(30, noteLines.length * 9 + 15);

    if (y - rowHeight < 44) newListPage();

    page.drawRectangle({
      x: margin,
      y: y - rowHeight + 8,
      width: usableWidth,
      height: rowHeight,
      color: isIllegal ? rgb(0.16, 0.035, 0.045) : panelBlack,
      borderColor: isIllegal ? red : borderGrey,
      borderWidth: isIllegal ? 0.75 : 0.45,
    });

    drawWrappedText(shortItemName(item), margin + 7, y, 148, 7.7, boldFont, white, 2, 9);
    drawText(item.item_side || "-", margin + 164, y, 7.3, normalFont, white);
    drawText(item.status.toUpperCase(), margin + 205, y, 7.3, boldFont, isIllegal ? red : green);
    drawText(heightText || "-", margin + 262, y, 7.3, boldFont, heightText ? white : grey);

    let noteY = y;
    noteLines.forEach((line) => {
      drawText(line, margin + 318, noteY, 7.6, normalFont, white);
      noteY -= 9;
    });

    y -= rowHeight + 4;
  });

  if (illegalItems.length > 0) {
    if (y < 128) newListPage();
    y -= 12;
    drawText("Illegal Item Notes Summary", margin, y, 13, boldFont, red);
    y -= 20;

    illegalItems.forEach((item) => {
      const lines = wrapTextByWidth(item.illegal_note || "Missing note", normalFont, 8.4, usableWidth - 28);
      const blockHeight = Math.max(34, lines.length * 10 + 24);
      if (y - blockHeight < 44) newListPage();
      page.drawRectangle({ x: margin, y: y - blockHeight + 8, width: usableWidth, height: blockHeight, color: rgb(0.16, 0.035, 0.045), borderColor: red, borderWidth: 0.55 });
      drawText(shortItemName(item), margin + 10, y, 8.8, boldFont, red);
      let lineY = y - 13;
      lines.forEach((line) => {
        drawText(line, margin + 18, lineY, 8.4, normalFont, white);
        lineY -= 10;
      });
      y -= blockHeight + 6;
    });
  }

  drawFooter("PDF layout: surface-table-v12 - component list");

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
