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
        error: "Only Chief Mechanic users can send legality PDF emails.",
      },
      { status: 403 },
    );
  }

  return null;
}

function clean(value: string | null | undefined) {
  return value?.trim() || "";
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

function wrapText(text: string, maxChars: number) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";

  words.forEach((word) => {
    const nextLine = line ? `${line} ${word}` : word;

    if (nextLine.length > maxChars && line) {
      lines.push(line);
      line = word;
      return;
    }

    line = nextLine;
  });

  if (line) {
    lines.push(line);
  }

  return lines.length > 0 ? lines : [""];
}

function wrapTextByWidth(text: string, font: PDFFont, fontSize: number, maxWidth: number) {
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

async function buildLegalityPdf(payload: NormalisedLegalityEmailPayload) {
  const pdfDoc = await PDFDocument.create();
  const normalFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const rodinLogo = await tryEmbedPng(pdfDoc, "rodin-logo.png");
  const gb3Logo = await tryEmbedPng(pdfDoc, "gb3-logo.png");
  const carOverview = await tryEmbedPng(pdfDoc, "legality-car-overview-inverted.png");

  const green = rgb(0, 0.78, 0.32);
  const red = rgb(1, 0.12, 0.18);
  const dark = rgb(0.93, 0.94, 0.96);
  const grey = rgb(0.58, 0.61, 0.68);
  const lightGrey = rgb(0.06, 0.07, 0.09);
  const borderGrey = rgb(0.25, 0.27, 0.32);
  const sheetBlack = rgb(0.015, 0.02, 0.03);
  const panelBlack = rgb(0.035, 0.045, 0.06);

  const worksheetSize: [number, number] = [595.28, 841.89];
  let page = pdfDoc.addPage(worksheetSize);
  const pageWidth = worksheetSize[0];
  const pageHeight = worksheetSize[1];
  page.drawRectangle({ x: 0, y: 0, width: pageWidth, height: pageHeight, color: sheetBlack });

  const illegalItems = payload.items.filter((item) => item.status === "illegal");
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
    color = dark,
  ) {
    page.drawText(text, {
      x,
      y,
      size,
      font,
      color,
    });
  }

  function drawHeaderInfo(label: string, value: string, x: number, y: number, width: number, height = 34) {
    drawOutlinedBox(page, x, y, width, height, borderGrey, panelBlack);
    drawText(label.toUpperCase(), x + 8, y + height - 12, 6.2, boldFont, grey);
    const valueLines = wrapTextByWidth(value || "—", boldFont, 8.2, width - 16).slice(0, 2);
    valueLines.forEach((line, index) => {
      drawText(line, x + 8, y + height - 24 - index * 9, 8.2, boldFont, dark);
    });
  }

  function drawPill(text: string, x: number, y: number, isIllegal: boolean) {
    const width = 44;
    const fill = isIllegal ? rgb(0.2, 0.035, 0.045) : rgb(0.025, 0.16, 0.08);
    const color = isIllegal ? red : green;

    page.drawRectangle({
      x,
      y,
      width,
      height: 14,
      color: fill,
      borderColor: color,
      borderWidth: 1,
    });
    drawText(text.toUpperCase(), x + width / 2 - fontWidth(text.toUpperCase(), boldFont, 6.2) / 2, y + 4.5, 6.2, boldFont, color);
  }

  function drawStatusButton(text: string, x: number, y: number, width: number, active: boolean, tone: "legal" | "illegal") {
    const activeColor = tone === "legal" ? green : red;
    page.drawRectangle({
      x,
      y,
      width,
      height: 17,
      color: active ? activeColor : panelBlack,
      borderColor: active ? activeColor : borderGrey,
      borderWidth: 0.9,
    });
    const textColor = active ? rgb(1, 1, 1) : dark;
    drawText(text.toUpperCase(), x + width / 2 - fontWidth(text.toUpperCase(), boldFont, 6.5) / 2, y + 5.8, 6.5, boldFont, textColor);
  }

  function fontWidth(text: string, font: PDFFont, size: number) {
    return font.widthOfTextAtSize(text, size);
  }

  function drawTickBox(x: number, y: number, isIllegal: boolean) {
    page.drawRectangle({
      x,
      y,
      width: 32,
      height: 12,
      color: isIllegal ? rgb(0.2, 0.035, 0.045) : panelBlack,
      borderColor: isIllegal ? red : dark,
      borderWidth: 1,
    });
  }

  function drawMeasurementTag(item: LegalityPdfItem, x: number, y: number, width: number) {
    const isIllegal = item.status === "illegal";
    page.drawRectangle({
      x,
      y,
      width,
      height: 22,
      color: panelBlack,
      borderColor: isIllegal ? red : green,
      borderWidth: 1.25,
    });

    const label = item.item_name.replace(/\s+(LH|RH)$/i, "");
    drawText(label.toUpperCase().slice(0, 10), x + 6, y + 7.4, 7, boldFont, dark);
    drawTickBox(x + width - 40, y + 5, isIllegal);
  }

  function drawComponentCard(item: LegalityPdfItem, x: number, y: number, width: number, height: number) {
    const isIllegal = item.status === "illegal";
    const tone = isIllegal ? red : green;

    page.drawRectangle({
      x,
      y,
      width,
      height,
      color: panelBlack,
      borderColor: isIllegal ? red : borderGrey,
      borderWidth: 0.85,
    });

    drawText(item.item_name.toUpperCase(), x + 8, y + height - 15, 9.5, boldFont, dark);
    drawPill(isIllegal ? "Illegal" : "Legal", x + width - 52, y + height - 19, isIllegal);

    const positionLines = wrapTextByWidth(item.item_position || "—", normalFont, 7, width - 16).slice(0, 2);
    positionLines.forEach((line, index) => {
      drawText(line, x + 8, y + height - 31 - index * 9, 7, normalFont, grey);
    });

    drawStatusButton("Legal", x + 8, y + height - 55, (width - 22) / 2, !isIllegal, "legal");
    drawStatusButton("Illegal", x + 14 + (width - 22) / 2, y + height - 55, (width - 22) / 2, isIllegal, "illegal");

    if (isIllegal) {
      drawText("ILLEGAL NOTE REQUIRED", x + 8, y + height - 72, 6.4, boldFont, red);
      page.drawRectangle({
        x: x + 8,
        y: y + 8,
        width: width - 16,
        height: Math.max(22, height - 86),
        color: rgb(0.18, 0.035, 0.045),
        borderColor: red,
        borderWidth: 0.9,
      });

      const noteLines = wrapTextByWidth(item.illegal_note || "Missing note", normalFont, 7, width - 24).slice(0, 4);
      noteLines.forEach((line, index) => {
        drawText(line, x + 12, y + Math.max(12, height - 97 - index * 9), 7, normalFont, dark);
      });
    }
  }

  function sortForSheet(items: LegalityPdfItem[]) {
    const order = ["fw", "fwep", "front", "mid", "rear", "diffuser", "rw"];
    return [...items].sort((a, b) => {
      const aName = a.item_name.toLowerCase();
      const bName = b.item_name.toLowerCase();
      const aSide = a.item_side === "LH" ? 0 : a.item_side === "RH" ? 2 : 1;
      const bSide = b.item_side === "LH" ? 0 : b.item_side === "RH" ? 2 : 1;
      const aOrder = order.findIndex((key) => aName.includes(key));
      const bOrder = order.findIndex((key) => bName.includes(key));
      return aSide - bSide || (aOrder < 0 ? 99 : aOrder) - (bOrder < 0 ? 99 : bOrder) || a.item_name.localeCompare(b.item_name);
    });
  }

  const sortedItems = sortForSheet(payload.items);
  const leftItems = sortedItems.filter((item) => item.item_side === "LH");
  const rightItems = sortedItems.filter((item) => item.item_side === "RH");
  const centreItems = sortedItems.filter((item) => item.item_side !== "LH" && item.item_side !== "RH");

  // Header / worksheet top strip - portrait A4 to make the first page readable.
  page.drawRectangle({ x: 0, y: pageHeight - 92, width: pageWidth, height: 92, color: sheetBlack });
  page.drawLine({ start: { x: 0, y: pageHeight - 92 }, end: { x: pageWidth, y: pageHeight - 92 }, thickness: 0.8, color: borderGrey });

  if (rodinLogo) {
    drawFittedImage(page, rodinLogo, 16, pageHeight - 68, 92, 46);
  } else {
    drawText("RODIN", 18, pageHeight - 40, 20, boldFont, dark);
    drawText("MOTORSPORT", 20, pageHeight - 54, 8, boldFont, grey);
  }

  drawText("LEGALITY CHECK", 128, pageHeight - 38, 18, boldFont, dark);
  drawText(summary, 130, pageHeight - 55, 9, boldFont, illegalItems.length ? red : green);

  const headerGap = 6;
  const topBoxW = 92;
  const topBoxH = 34;
  const startX = pageWidth - (topBoxW * 3 + headerGap * 2) - 14;
  drawHeaderInfo("Date", formatReportDate(payload.check_date), startX, pageHeight - 40, topBoxW, topBoxH);
  drawHeaderInfo("Circuit", payload.circuit, startX + topBoxW + headerGap, pageHeight - 40, topBoxW, topBoxH);
  drawHeaderInfo("Car", payload.car_name || `Car ${payload.car_id}`, startX + (topBoxW + headerGap) * 2, pageHeight - 40, topBoxW, topBoxH);
  drawHeaderInfo("Driver", payload.driver, startX, pageHeight - 80, 134, topBoxH);
  drawHeaderInfo("Engineer", `${payload.engineer_name}
${payload.engineer_email}`, startX + 134 + headerGap, pageHeight - 80, pageWidth - (startX + 134 + headerGap) - 14, topBoxH);

  // Body worksheet - portrait and compact: side cards sit close to a much larger car panel.
  const cardW = 116;
  const cardH = 74;
  const leftX = 14;
  const rightX = pageWidth - leftX - cardW;
  const carPanelX = leftX + cardW + 8;
  const carPanelY = 165;
  const carPanelW = pageWidth - (leftX + cardW + 8) * 2;
  const carPanelH = 580;
  const carX = carPanelX + 16;
  const carY = carPanelY + 18;
  const carW = carPanelW - 32;
  const carH = carPanelH - 36;

  drawOutlinedBox(page, carPanelX, carPanelY, carPanelW, carPanelH, borderGrey, sheetBlack);
  for (let gridX = carPanelX + 35; gridX < carPanelX + carPanelW; gridX += 44) {
    page.drawLine({ start: { x: gridX, y: carPanelY + 10 }, end: { x: gridX, y: carPanelY + carPanelH - 10 }, thickness: 0.25, color: rgb(0.16, 0.17, 0.2) });
  }
  for (let gridY = carPanelY + 38; gridY < carPanelY + carPanelH; gridY += 44) {
    page.drawLine({ start: { x: carPanelX + 10, y: gridY }, end: { x: carPanelX + carPanelW - 10, y: gridY }, thickness: 0.25, color: rgb(0.16, 0.17, 0.2) });
  }
  page.drawLine({ start: { x: carPanelX + 62, y: carPanelY + 18 }, end: { x: carPanelX + 62, y: carPanelY + carPanelH - 18 }, thickness: 0.45, color: borderGrey });
  page.drawLine({ start: { x: carPanelX + carPanelW - 62, y: carPanelY + 18 }, end: { x: carPanelX + carPanelW - 62, y: carPanelY + carPanelH - 18 }, thickness: 0.45, color: borderGrey });

  if (carOverview) {
    drawFittedImage(page, carOverview, carX, carY, carW, carH);
  } else {
    drawText("CAR OVERVIEW IMAGE MISSING", carX + 18, carY + carH / 2, 10, boldFont, red);
  }

  const startY = 650;
  const stepY = 78;

  leftItems.slice(0, 6).forEach((item, index) => {
    drawComponentCard(item, leftX, startY - index * stepY, cardW, cardH);
  });

  rightItems.slice(0, 6).forEach((item, index) => {
    drawComponentCard(item, rightX, startY - index * stepY, cardW, cardH);
  });

  const tagW = 64;
  const tagLeftX = carPanelX + 8;
  const tagRightX = carPanelX + carPanelW - tagW - 8;
  const tagYValues = [696, 630, 552, 474, 396, 318];

  leftItems.slice(0, 6).forEach((item, index) => {
    drawMeasurementTag(item, tagLeftX, tagYValues[index] ?? 290, tagW);
  });

  rightItems.slice(0, 6).forEach((item, index) => {
    drawMeasurementTag(item, tagRightX, tagYValues[index] ?? 290, tagW);
  });

  centreItems.slice(0, 2).forEach((item, index) => {
    drawMeasurementTag(item, carPanelX + carPanelW / 2 - tagW / 2, carPanelY + 10 - index * 28, tagW);
  });

  if (centreItems.length > 0) {
    drawComponentCard(centreItems[0], pageWidth / 2 - 170, 64, 340, 88);
  }

  drawText(`Summary: ${summary}`, 18, 48, 10, boldFont, illegalItems.length ? red : green);
  drawText("PDF layout: portrait-app-v7-black", pageWidth - 124, 18, 5.5, normalFont, grey);

  // Component list pages
  const listPageSize: [number, number] = [595.28, 841.89];
  page = pdfDoc.addPage(listPageSize);
  page.drawRectangle({ x: 0, y: 0, width: listPageSize[0], height: listPageSize[1], color: sheetBlack });
  let y = 796;
  const margin = 34;
  const usableWidth = listPageSize[0] - margin * 2;

  function newListPage() {
    page = pdfDoc.addPage(listPageSize);
    page.drawRectangle({ x: 0, y: 0, width: listPageSize[0], height: listPageSize[1], color: sheetBlack });
    y = 796;
    drawListHeader();
  }

  function drawListText(text: string, x: number, size = 8, font: PDFFont = normalFont, color = dark) {
    page.drawText(text, { x, y, size, font, color });
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
      color: dark,
    });
    y -= 22;

    page.drawRectangle({ x: margin, y: y - 7, width: usableWidth, height: 18, color: lightGrey });
    drawListText("COMPONENT", margin + 6, 7, boldFont, dark);
    drawListText("SIDE", margin + 126, 7, boldFont, dark);
    drawListText("STATUS", margin + 166, 7, boldFont, dark);
    drawListText("POSITION / ILLEGAL NOTE", margin + 230, 7, boldFont, dark);
    y -= 20;
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
      borderColor: borderGrey,
      borderWidth: 0.45,
    });

    drawListText(item.item_name, margin + 6, 8.5, boldFont, dark);
    drawListText(item.item_side || "—", margin + 126, 8, normalFont, dark);
    drawListText(item.status.toUpperCase(), margin + 166, 8, boldFont, isIllegal ? red : green);

    let noteY = y;
    noteLines.forEach((line) => {
      page.drawText(line, {
        x: margin + 230,
        y: noteY,
        size: 8,
        font: normalFont,
        color: dark,
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
          color: dark,
        });
        lineY -= 10;
      });
      y -= blockHeight + 6;
    });
  }

  const pdfBytes = await pdfDoc.save();

  return Buffer.from(pdfBytes);
}

export async function POST(request: NextRequest) {
  const authBlock = blockUnauthorisedUser(request);

  if (authBlock) {
    return authBlock;
  }

  try {
    const rawPayload = (await request.json()) as LegalityEmailPayload;

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

    const fallbackEngineerEmail = getFallbackEngineerEmailForCar(Number(rawPayload.car_id));
    const to = clean(rawPayload.engineer_email) || fallbackEngineerEmail;

    if (!to) {
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
      engineer_email: to,
      created_by: clean(rawPayload.created_by) || getRequestUserEmail(request) || "Unknown",
      items,
    };

    const illegalCount = payload.items.filter((item) => item.status === "illegal").length;
    const summary =
      illegalCount === 0
        ? `${payload.items.length}/${payload.items.length} legal`
        : `${illegalCount} illegal · ${payload.items.length - illegalCount} legal`;

    const pdfBuffer = await buildLegalityPdf(payload);

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
          filename: `Legality_${payload.circuit.replace(/[^a-z0-9]+/gi, "_")}_Car_${payload.car_id}_${payload.check_date}.pdf`,
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
