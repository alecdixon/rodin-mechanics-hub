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
    error: "Legality PDF notification failed while sending the engineer email.",
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
  const spareFrontWing = await tryEmbedPng(pdfDoc, "legality-spare-front-wing.png");

  const green = rgb(0, 0.78, 0.32);
  const red = rgb(1, 0.12, 0.18);
  const white = rgb(0.93, 0.94, 0.96);
  const grey = rgb(0.58, 0.61, 0.68);
  const muted = rgb(0.42, 0.45, 0.52);
  const borderGrey = rgb(0.25, 0.27, 0.32);
  const sheetBlack = rgb(0.015, 0.02, 0.03);
  const panelBlack = rgb(0.035, 0.045, 0.06);
  const cellBlack = rgb(0.02, 0.028, 0.04);
  const gridGrey = rgb(0.16, 0.17, 0.2);

  const pageSize: [number, number] = [595.28, 841.89];
  let page = pdfDoc.addPage(pageSize);
  const pageWidth = pageSize[0];
  const pageHeight = pageSize[1];

  const illegalItems = payload.items.filter((item) => item.status === "illegal");
  const spareWingItems = payload.items.filter(isSpareWingItem);
  const carItems = payload.items.filter((item) => !isSpareWingItem(item));
  const summary =
    illegalItems.length === 0
      ? `${payload.items.length}/${payload.items.length} legal`
      : `${illegalItems.length} illegal · ${payload.items.length - illegalItems.length} legal`;

  function drawText(
    text: string,
    x: number,
    y: number,
    size = 9,
    font: PDFFont = normalFont,
    color = white,
  ) {
    page.drawText(text, {
      x,
      y,
      size,
      font,
      color,
    });
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

  function drawHeaderInfo(
    label: string,
    value: string,
    x: number,
    y: number,
    width: number,
    height = 34,
  ) {
    drawOutlinedBox(page, x, y, width, height, borderGrey, panelBlack);
    drawText(label.toUpperCase(), x + 8, y + height - 12, 6.2, boldFont, grey);
    const valueLines = wrapTextByWidth(value || "—", boldFont, 8.2, width - 16).slice(0, 2);
    valueLines.forEach((line, index) => {
      drawText(line, x + 8, y + height - 24 - index * 9, 8.2, boldFont, white);
    });
  }

  function drawSectionTitle(title: string, subtitle: string, unit: string, x: number, y: number, width: number) {
    drawText(title.toUpperCase(), x, y, 7.2, boldFont, red);
    drawText(subtitle, x, y - 11, 6.2, normalFont, grey);

    page.drawRectangle({
      x: x + width - 42,
      y: y - 4,
      width: 42,
      height: 14,
      color: cellBlack,
      borderColor: borderGrey,
      borderWidth: 0.65,
    });
    drawCenteredText(unit.toUpperCase(), x + width - 42, y + 0.5, 42, 5.8, boldFont, grey);
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

    drawText(label.toUpperCase(), x + 7, y + height - 12, 6.1, boldFont, grey);
    drawText(helper, x + 7, y + height - 22, 5.3, normalFont, muted);

    const valueSize = value.length > 10 ? 8.5 : 10.5;
    const safeValue = wrapTextByWidth(value, boldFont, valueSize, width - 14).slice(0, 1)[0] || "—";
    drawText(safeValue, x + 7, y + 7, valueSize, boldFont, white);
  }

  function drawMeasurementPanel({
    title,
    subtitle,
    unit,
    values,
    formatter,
    x,
    y,
    width,
    height,
    total,
  }: {
    title: string;
    subtitle: string;
    unit: string;
    values: {
      fl: string;
      fr: string;
      rl: string;
      rr: string;
    };
    formatter: (value: string) => string;
    x: number;
    y: number;
    width: number;
    height: number;
    total?: string;
  }) {
    page.drawRectangle({
      x,
      y,
      width,
      height,
      color: panelBlack,
      borderColor: borderGrey,
      borderWidth: 0.85,
    });

    const padding = 12;
    drawSectionTitle(title, subtitle, unit, x + padding, y + height - 15, width - padding * 2);

    const gridX = x + padding;
    const gridW = width - padding * 2;
    const gap = 8;
    const cellW = (gridW - gap) / 2;
    const cellH = total !== undefined ? 24 : 25;
    const topRowY = y + height - 52;
    const bottomRowY = topRowY - cellH - gap;

    drawMeasurementCell("FL", "Front Left", formatter(values.fl), gridX, topRowY, cellW, cellH);
    drawMeasurementCell("FR", "Front Right", formatter(values.fr), gridX + cellW + gap, topRowY, cellW, cellH);
    drawMeasurementCell("RL", "Rear Left", formatter(values.rl), gridX, bottomRowY, cellW, cellH);
    drawMeasurementCell("RR", "Rear Right", formatter(values.rr), gridX + cellW + gap, bottomRowY, cellW, cellH);

    if (total !== undefined) {
      drawMeasurementCell("TOTAL", "Total Weight", formatter(total), gridX, y + padding, gridW, 22);
    }
  }

  function drawStatusPill(text: string, x: number, y: number, width: number, isIllegal: boolean) {
    const fill = isIllegal ? rgb(0.2, 0.035, 0.045) : rgb(0.025, 0.16, 0.08);
    const color = isIllegal ? red : green;

    page.drawRectangle({
      x,
      y,
      width,
      height: 14,
      color: fill,
      borderColor: color,
      borderWidth: 0.85,
    });
    drawCenteredText(text.toUpperCase(), x, y + 4.4, width, 6.1, boldFont, color);
  }

  function drawStatusTag(item: LegalityPdfItem, x: number, y: number, width: number) {
    const isIllegal = item.status === "illegal";
    const shortName = item.item_name
      .replace(/spare front wing/gi, "")
      .replace(/endplate/gi, "EP")
      .replace(/\s+(LH|RH)$/i, "")
      .trim() || item.item_name;

    page.drawRectangle({
      x,
      y,
      width,
      height: 24,
      color: panelBlack,
      borderColor: isIllegal ? red : green,
      borderWidth: 1.1,
    });

    const safeName = wrapTextByWidth(shortName.toUpperCase(), boldFont, 6.6, width - 38).slice(0, 1)[0] || shortName.toUpperCase();
    drawText(safeName, x + 6, y + 9, 6.6, boldFont, white);
    drawStatusPill(isIllegal ? "Red" : "Legal", x + width - 34, y + 5, 28, isIllegal);
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

  function sortSpareWingItems(items: LegalityPdfItem[]) {
    return [...items].sort((a, b) => {
      const aKey = `${a.item_key} ${a.item_name}`.toLowerCase();
      const bKey = `${b.item_key} ${b.item_name}`.toLowerCase();
      const score = (value: string) => {
        if (value.includes("lh") || value.includes("lfwep")) return 0;
        if (value.includes("fw")) return 1;
        if (value.includes("rh") || value.includes("rfwep")) return 2;
        return 3;
      };
      return score(aKey) - score(bKey) || a.item_name.localeCompare(b.item_name);
    });
  }

  function drawSpareWingPanel(x: number, y: number, width: number, height: number) {
    drawImagePanelBackground(x, y, width, height);
    drawText("SPARE FRONT WING", x + 12, y + height - 16, 7.2, boldFont, red);
    drawText("LFWEP · FW · RFWEP", x + 12, y + height - 28, 6.2, normalFont, grey);

    if (spareFrontWing) {
      drawFittedImage(page, spareFrontWing, x + 66, y + 20, width - 132, height - 36);
    } else {
      drawText("SPARE FRONT WING IMAGE MISSING", x + 170, y + height / 2, 8, boldFont, red);
    }

    const orderedItems = sortSpareWingItems(spareWingItems).slice(0, 3);
    const tagW = 88;
    const tagY = y + 44;
    const tagPositions = [x + 18, x + width / 2 - tagW / 2, x + width - tagW - 18];

    orderedItems.forEach((item, index) => {
      drawStatusTag(item, tagPositions[index] ?? tagPositions[1], tagY, tagW);
    });
  }

  function sortForSheet(items: LegalityPdfItem[]) {
    const order = [
      "spare",
      "fw",
      "fwep",
      "front",
      "mid",
      "rear",
      "diffuser",
      "rw",
    ];

    return [...items].sort((a, b) => {
      const aName = `${a.item_key} ${a.item_name}`.toLowerCase();
      const bName = `${b.item_key} ${b.item_name}`.toLowerCase();
      const aSide = a.item_side === "LH" ? 0 : a.item_side === "RH" ? 2 : 1;
      const bSide = b.item_side === "LH" ? 0 : b.item_side === "RH" ? 2 : 1;
      const aOrder = order.findIndex((key) => aName.includes(key));
      const bOrder = order.findIndex((key) => bName.includes(key));

      return (
        aSide - bSide ||
        (aOrder < 0 ? 99 : aOrder) - (bOrder < 0 ? 99 : bOrder) ||
        a.item_name.localeCompare(b.item_name)
      );
    });
  }

  function drawTotalCarPanel(x: number, y: number, width: number, height: number) {
    drawImagePanelBackground(x, y, width, height);
    drawText("TOTAL CAR", x + 12, y + height - 16, 7.2, boldFont, red);
    drawText("Full-car legality points", x + 12, y + height - 28, 6.2, normalFont, grey);
    drawStatusPill(summary, x + width - 112, y + height - 24, 96, illegalItems.length > 0);

    const imageX = x + 128;
    const imageY = y + 24;
    const imageW = width - 256;
    const imageH = height - 50;

    if (carOverview) {
      drawFittedImage(page, carOverview, imageX, imageY, imageW, imageH);
    } else {
      drawText("CAR OVERVIEW IMAGE MISSING", imageX + 18, imageY + imageH / 2, 9, boldFont, red);
    }

    const sortedCarItems = sortForSheet(carItems);
    const leftItems = sortedCarItems.filter((item) => item.item_side === "LH").slice(0, 6);
    const rightItems = sortedCarItems.filter((item) => item.item_side === "RH").slice(0, 6);
    const centreItems = sortedCarItems.filter((item) => item.item_side !== "LH" && item.item_side !== "RH").slice(0, 2);
    const tagW = 100;
    const startY = y + height - 64;
    const step = 34;

    leftItems.forEach((item, index) => {
      drawStatusTag(item, x + 14, startY - index * step, tagW);
    });

    rightItems.forEach((item, index) => {
      drawStatusTag(item, x + width - tagW - 14, startY - index * step, tagW);
    });

    centreItems.forEach((item, index) => {
      drawStatusTag(item, x + width / 2 - tagW / 2, y + 18 + index * 30, tagW);
    });
  }

  function drawFooter(text = "PDF layout: legality-v10-camber-spare-wing") {
    drawText(text, pageWidth - 154, 18, 5.5, normalFont, grey);
  }

  page.drawRectangle({ x: 0, y: 0, width: pageWidth, height: pageHeight, color: sheetBlack });

  // Header
  page.drawRectangle({ x: 0, y: pageHeight - 96, width: pageWidth, height: 96, color: sheetBlack });
  page.drawLine({
    start: { x: 0, y: pageHeight - 96 },
    end: { x: pageWidth, y: pageHeight - 96 },
    thickness: 0.8,
    color: borderGrey,
  });

  if (rodinLogo) {
    drawFittedImage(page, rodinLogo, 16, pageHeight - 70, 92, 46);
  } else {
    drawText("RODIN", 18, pageHeight - 40, 20, boldFont, white);
    drawText("MOTORSPORT", 20, pageHeight - 54, 8, boldFont, grey);
  }

  if (gb3Logo) {
    drawFittedImage(page, gb3Logo, 18, pageHeight - 92, 70, 20);
  }

  drawText("LEGALITY CHECK", 126, pageHeight - 38, 18, boldFont, white);
  drawText(summary, 128, pageHeight - 55, 9, boldFont, illegalItems.length ? red : green);

  const headerGap = 6;
  const topBoxW = 92;
  const topBoxH = 34;
  const startX = pageWidth - (topBoxW * 3 + headerGap * 2) - 14;
  drawHeaderInfo("Date", formatReportDate(payload.check_date), startX, pageHeight - 42, topBoxW, topBoxH);
  drawHeaderInfo("Circuit", payload.circuit, startX + topBoxW + headerGap, pageHeight - 42, topBoxW, topBoxH);
  drawHeaderInfo("Car", payload.car_name || `Car ${payload.car_id}`, startX + (topBoxW + headerGap) * 2, pageHeight - 42, topBoxW, topBoxH);
  drawHeaderInfo("Driver", payload.driver, startX, pageHeight - 82, 134, topBoxH);
  drawHeaderInfo("Engineer", `${payload.engineer_name} ${payload.engineer_email}`, startX + 134 + headerGap, pageHeight - 82, pageWidth - (startX + 134 + headerGap) - 14, topBoxH);

  // Measurements are stacked, and each panel is front axle over rear axle.
  drawMeasurementPanel({
    title: "Corner Weight Measurements",
    subtitle: "Front axle over rear axle, matching the input sheet.",
    unit: "kg",
    values: payload.corner_weights,
    total: payload.corner_weights.total,
    formatter: formatWeight,
    x: 18,
    y: 600,
    width: pageWidth - 36,
    height: 128,
  });

  drawMeasurementPanel({
    title: "Camber Measurements",
    subtitle: "Front axle over rear axle. Negative values are shown as entered.",
    unit: "deg",
    values: payload.camber_measurements,
    formatter: formatCamber,
    x: 18,
    y: 486,
    width: pageWidth - 36,
    height: 98,
  });

  if (spareWingItems.length > 0) {
    drawSpareWingPanel(18, 350, pageWidth - 36, 116);
    drawTotalCarPanel(18, 42, pageWidth - 36, 288);
  } else {
    drawTotalCarPanel(18, 42, pageWidth - 36, 424);
  }

  drawText(`Summary: ${summary}`, 18, 24, 9, boldFont, illegalItems.length ? red : green);
  drawFooter();

  // Component list pages
  const sortedItems = sortForSheet(payload.items);
  page = pdfDoc.addPage(pageSize);
  page.drawRectangle({ x: 0, y: 0, width: pageSize[0], height: pageSize[1], color: sheetBlack });
  let y = 796;
  const margin = 34;
  const usableWidth = pageSize[0] - margin * 2;

  function drawListText(text: string, x: number, size = 8, font: PDFFont = normalFont, color = white) {
    page.drawText(text, { x, y, size, font, color });
  }

  function drawCompactMeasurementLine(
    title: string,
    values: Array<[string, string]>,
    formatter: (value: string) => string,
  ) {
    page.drawRectangle({
      x: margin,
      y: y - 28,
      width: usableWidth,
      height: 25,
      color: panelBlack,
      borderColor: borderGrey,
      borderWidth: 0.55,
    });

    page.drawText(title.toUpperCase(), {
      x: margin + 8,
      y: y - 13,
      size: 7,
      font: boldFont,
      color: grey,
    });

    values.forEach(([label, value], index) => {
      const cellX = margin + 142 + index * 72;
      page.drawText(label, {
        x: cellX,
        y: y - 10,
        size: 6,
        font: boldFont,
        color: grey,
      });
      page.drawText(formatter(value), {
        x: cellX,
        y: y - 22,
        size: 7.5,
        font: boldFont,
        color: white,
      });
    });

    y -= 31;
  }

  function drawListHeader() {
    page.drawText("RODIN MOTORSPORT · LEGALITY COMPONENT LIST", {
      x: margin,
      y,
      size: 9,
      font: boldFont,
      color: red,
    });
    y -= 18;

    page.drawText(`${payload.car_name} · ${payload.driver} · ${payload.circuit} · ${formatReportDate(payload.check_date)}`, {
      x: margin,
      y,
      size: 14,
      font: boldFont,
      color: white,
    });
    y -= 22;

    drawCompactMeasurementLine(
      "Corner weights",
      [
        ["FL", payload.corner_weights.fl],
        ["FR", payload.corner_weights.fr],
        ["RL", payload.corner_weights.rl],
        ["RR", payload.corner_weights.rr],
        ["TOTAL", payload.corner_weights.total],
      ],
      formatWeight,
    );

    drawCompactMeasurementLine(
      "Camber",
      [
        ["FL", payload.camber_measurements.fl],
        ["FR", payload.camber_measurements.fr],
        ["RL", payload.camber_measurements.rl],
        ["RR", payload.camber_measurements.rr],
      ],
      formatCamber,
    );

    page.drawRectangle({ x: margin, y: y - 7, width: usableWidth, height: 18, color: panelBlack });
    drawListText("COMPONENT", margin + 6, 7, boldFont, white);
    drawListText("SIDE", margin + 126, 7, boldFont, white);
    drawListText("STATUS", margin + 166, 7, boldFont, white);
    drawListText("POSITION / ILLEGAL NOTE", margin + 230, 7, boldFont, white);
    y -= 20;
  }

  function newListPage() {
    page = pdfDoc.addPage(pageSize);
    page.drawRectangle({ x: 0, y: 0, width: pageSize[0], height: pageSize[1], color: sheetBlack });
    y = 796;
    drawListHeader();
  }

  drawListHeader();

  sortedItems.forEach((item) => {
    const isIllegal = item.status === "illegal";
    const noteText = isIllegal ? item.illegal_note || "Missing note" : item.item_position || "—";
    const noteLines = wrapTextByWidth(noteText, normalFont, 8, 290);
    const rowHeight = Math.max(28, noteLines.length * 10 + 14);

    if (y - rowHeight < 42) {
      newListPage();
    }

    page.drawRectangle({
      x: margin,
      y: y - rowHeight + 8,
      width: usableWidth,
      height: rowHeight,
      color: isIllegal ? rgb(0.16, 0.035, 0.045) : panelBlack,
      borderColor: isIllegal ? red : borderGrey,
      borderWidth: isIllegal ? 0.75 : 0.45,
    });

    drawListText(item.item_name, margin + 6, 8.5, boldFont, white);
    drawListText(item.item_side || "—", margin + 126, 8, normalFont, white);
    drawListText(item.status.toUpperCase(), margin + 166, 8, boldFont, isIllegal ? red : green);

    let noteY = y;
    noteLines.forEach((line) => {
      page.drawText(line, {
        x: margin + 230,
        y: noteY,
        size: 8,
        font: normalFont,
        color: white,
      });
      noteY -= 10;
    });

    y -= rowHeight + 4;
  });

  if (illegalItems.length > 0) {
    if (y < 135) {
      newListPage();
    }

    y -= 12;
    page.drawText("Illegal Item Notes Summary", {
      x: margin,
      y,
      size: 13,
      font: boldFont,
      color: red,
    });
    y -= 18;

    illegalItems.forEach((item) => {
      const lines = wrapTextByWidth(item.illegal_note || "Missing note", normalFont, 8.5, usableWidth - 26);
      const blockHeight = Math.max(30, lines.length * 10 + 20);

      if (y - blockHeight < 42) {
        newListPage();
      }

      page.drawRectangle({
        x: margin,
        y: y - blockHeight + 8,
        width: usableWidth,
        height: blockHeight,
        color: rgb(0.16, 0.035, 0.045),
        borderColor: red,
        borderWidth: 0.55,
      });
      page.drawText(item.item_name, {
        x: margin + 8,
        y,
        size: 9,
        font: boldFont,
        color: red,
      });
      let lineY = y - 12;
      lines.forEach((line) => {
        page.drawText(line, {
          x: margin + 16,
          y: lineY,
          size: 8.5,
          font: normalFont,
          color: white,
        });
        lineY -= 10;
      });
      y -= blockHeight + 6;
    });
  }

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
      items,
    };

    const illegalCount = payload.items.filter((item) => item.status === "illegal").length;
    const summary =
      illegalCount === 0
        ? `${payload.items.length}/${payload.items.length} legal`
        : `${illegalCount} illegal · ${payload.items.length - illegalCount} legal`;

    const pdfBuffer = await buildLegalityPdf(payload);
    const safeFileName = `Legality_${payload.circuit.replace(/[^a-z0-9]+/gi, "_")}_Car_${payload.car_id}_${payload.check_date}.pdf`;

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
      from: `"Legality Reports" <${gmailUser}>`,
      to,
      subject: `Legality - ${payload.circuit} - ${payload.car_name} - ${summary}`,
      text: [
        "Legality Check Report",
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
                Legality Check Report
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
