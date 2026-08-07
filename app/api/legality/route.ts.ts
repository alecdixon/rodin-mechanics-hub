import nodemailer from "nodemailer";
import { PDFDocument, PDFPage, StandardFonts, rgb } from "pdf-lib";
import { supabase } from "@/lib/supabase";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

class DriverInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DriverInputError";
  }
}

type TurnColor = "normal" | "blue" | "green" | "red";

type Corner = {
  id: number;
  x: number;
  y: number;
  labelX?: number;
  labelY?: number;
  color?: TurnColor;
};

type CornerFeedback = {
  cornerId: number;
  entryBalance: string;
  midBalance: string;
  exitBalance: string;
  entryBalanceValue?: number;
  midBalanceValue?: number;
  exitBalanceValue?: number;
  comment: string;
};

type IncidentMarker = {
  id: number;
  x: number;
  y: number;
  note: string;
};

type RequestBody = {
  driverName: string;
  sessionName: string;
  fastestLapTime?: string | null;
  trackName: string;
  trackMapUrl?: string | null;
  corners?: Corner[];
  incidentMarkers?: IncidentMarker[];
  primaryRecipientEmail: string;
  extraRecipientEmail?: string | null;
  primaryLimitation?: string;
  overallComments?: string;
  reliabilityFlags?: Record<string, boolean>;
  cornerFeedback?: CornerFeedback[];
  team?: string;
  templateId?: string;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;

  if (typeof error === "object" && error !== null) {
    if ("message" in error && typeof (error as { message?: unknown }).message === "string") {
      return (error as { message: string }).message;
    }

    try {
      return JSON.stringify(error, null, 2);
    } catch {
      return "Unknown object error";
    }
  }

  return String(error);
}

function escapeHtml(value: string | null | undefined): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function wrapText(text: string, maxCharsPerLine: number): string[] {
  if (!text?.trim()) return ["-"];

  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;

    if (next.length <= maxCharsPerLine) {
      current = next;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }

  if (current) lines.push(current);
  return lines;
}

function estimateReadableCharacters(text: string): number {
  return text.trim().replace(/\s+/g, " ").length;
}

function getBalanceColor(value?: number) {
  if (value === undefined || value === null) return rgb(0.18, 0.68, 0.35);

  if (value <= -2.25) return rgb(0.12, 0.34, 0.78);
  if (value <= -1.25) return rgb(0.18, 0.52, 0.88);
  if (value <= -0.25) return rgb(0.14, 0.72, 0.84);
  if (value < 0.25) return rgb(0.18, 0.68, 0.35);
  if (value < 1.25) return rgb(0.86, 0.71, 0.14);
  if (value < 2.25) return rgb(0.91, 0.48, 0.15);

  return rgb(0.82, 0.19, 0.18);
}

function getTurnColor(color?: TurnColor) {
  switch (color) {
    case "blue":
      return rgb(0.16, 0.39, 0.86);
    case "green":
      return rgb(0.17, 0.69, 0.33);
    case "red":
      return rgb(0.87, 0.21, 0.18);
    default:
      return rgb(0.08, 0.1, 0.13);
  }
}

function formatIncidentLines(
  incidentMarkers: IncidentMarker[],
  maxCharsPerLine: number
): string[] {
  if (incidentMarkers.length === 0) return ["No incident markers added"];

  return incidentMarkers.flatMap((marker, index) =>
    wrapText(
      `H${index + 1}: ${marker.note?.trim() ? marker.note.trim() : "No note"}`,
      maxCharsPerLine
    )
  );
}

function normaliseCorners(corners: Corner[] | undefined): Corner[] {
  if (!Array.isArray(corners)) return [];

  return corners
    .map((corner) => ({
      id: Number(corner.id),
      x: Number(corner.x),
      y: Number(corner.y),
      labelX: typeof corner.labelX === "number" ? corner.labelX : undefined,
      labelY: typeof corner.labelY === "number" ? corner.labelY : undefined,
      color: corner.color ?? "normal",
    }))
    .filter((corner) => {
      return (
        Number.isFinite(corner.id) &&
        Number.isFinite(corner.x) &&
        Number.isFinite(corner.y)
      );
    })
    .sort((a, b) => a.id - b.id);
}

function normaliseIncidentMarkers(markers: IncidentMarker[] | undefined): IncidentMarker[] {
  if (!Array.isArray(markers)) return [];

  return markers
    .map((marker, index) => ({
      id: Number.isFinite(Number(marker.id)) ? Number(marker.id) : index + 1,
      x: Number(marker.x),
      y: Number(marker.y),
      note: String(marker.note ?? ""),
    }))
    .filter((marker) => Number.isFinite(marker.x) && Number.isFinite(marker.y));
}

function normaliseCornerFeedback(feedback: CornerFeedback[] | undefined): CornerFeedback[] {
  if (!Array.isArray(feedback)) return [];

  return feedback
    .map((row) => ({
      cornerId: Number(row.cornerId),
      entryBalance: String(row.entryBalance ?? ""),
      midBalance: String(row.midBalance ?? ""),
      exitBalance: String(row.exitBalance ?? ""),
      entryBalanceValue:
        typeof row.entryBalanceValue === "number" ? row.entryBalanceValue : undefined,
      midBalanceValue:
        typeof row.midBalanceValue === "number" ? row.midBalanceValue : undefined,
      exitBalanceValue:
        typeof row.exitBalanceValue === "number" ? row.exitBalanceValue : undefined,
      comment: String(row.comment ?? ""),
    }))
    .filter((row) => Number.isFinite(row.cornerId))
    .sort((a, b) => a.cornerId - b.cornerId);
}

function isValidTurnColor(value: unknown): value is TurnColor {
  return value === "normal" || value === "blue" || value === "green" || value === "red";
}

async function buildDebriefPdf(payload: {
  driverName: string;
  sessionName: string;
  fastestLapTime?: string | null;
  trackName: string;
  trackMapUrl?: string | null;
  corners: Corner[];
  incidentMarkers: IncidentMarker[];
  primaryLimitation?: string;
  overallComments?: string;
  reliabilityFlags: Record<string, boolean>;
  cornerFeedback: CornerFeedback[];
}) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const pageWidth = 842;
  const pageHeight = 595;
  const margin = 24;

  const colors = {
    bg: rgb(0.08, 0.1, 0.13),
    panel: rgb(0.11, 0.14, 0.19),
    border: rgb(0.19, 0.23, 0.29),
    text: rgb(1, 1, 1),
    muted: rgb(0.65, 0.68, 0.73),
    accent: rgb(0.88, 0.02, 0.0),
    issue: rgb(0.78, 0.18, 0.18),
    incident: rgb(0.95, 0.8, 0.15),
    black: rgb(0, 0, 0),
  };

  function addPage(): PDFPage {
    const page = pdf.addPage([pageWidth, pageHeight]);

    page.drawRectangle({
      x: 0,
      y: 0,
      width: pageWidth,
      height: pageHeight,
      color: colors.bg,
    });

    return page;
  }

  function drawPanel(
    page: PDFPage,
    x: number,
    y: number,
    width: number,
    height: number,
    title: string
  ) {
    page.drawRectangle({
      x,
      y,
      width,
      height,
      color: colors.panel,
      borderColor: colors.border,
      borderWidth: 1,
    });

    page.drawText(title, {
      x: x + 14,
      y: y + height - 26,
      size: 14,
      font: bold,
      color: colors.text,
    });
  }

  function drawBalanceChip(
    page: PDFPage,
    x: number,
    y: number,
    width: number,
    height: number,
    label: string,
    value?: number,
    fontSize = 7.8
  ) {
    const safeLabel = label || "-";

    page.drawRectangle({
      x,
      y,
      width,
      height,
      color: getBalanceColor(value),
      borderColor: colors.border,
      borderWidth: 0.8,
    });

    const textWidth = bold.widthOfTextAtSize(safeLabel, fontSize);

    page.drawText(safeLabel, {
      x: x + (width - textWidth) / 2,
      y: y + height / 2 - fontSize / 2 + 1,
      size: fontSize,
      font: bold,
      color: colors.text,
    });
  }

  function drawTurnChip(
    page: PDFPage,
    x: number,
    y: number,
    width: number,
    height: number,
    label: string,
    color?: TurnColor,
    fontSize = 7.8
  ) {
    page.drawRectangle({
      x,
      y,
      width,
      height,
      color: getTurnColor(color),
      borderColor: colors.border,
      borderWidth: 0.8,
    });

    const textWidth = bold.widthOfTextAtSize(label, fontSize);

    page.drawText(label, {
      x: x + (width - textWidth) / 2,
      y: y + height / 2 - fontSize / 2 + 1,
      size: fontSize,
      font: bold,
      color: colors.text,
    });
  }

  function splitOversizeWord(
    word: string,
    maxWidth: number,
    textFont = font,
    fontSize = 9
  ): string[] {
    const pieces: string[] = [];
    let current = "";

    for (const char of word) {
      const next = `${current}${char}`;

      if (textFont.widthOfTextAtSize(next, fontSize) <= maxWidth || !current) {
        current = next;
      } else {
        pieces.push(current);
        current = char;
      }
    }

    if (current) pieces.push(current);
    return pieces;
  }

  function wrapTextToWidth(
    value: string | null | undefined,
    maxWidth: number,
    textFont = font,
    fontSize = 9
  ): string[] {
    const text = String(value ?? "").trim();

    if (!text) return ["-"];

    const paragraphs = text.split(/\r?\n/);
    const lines: string[] = [];

    for (const paragraph of paragraphs) {
      const words = paragraph.trim().split(/\s+/).filter(Boolean);

      if (words.length === 0) {
        lines.push("");
        continue;
      }

      let current = "";

      for (const rawWord of words) {
        const wordPieces =
          textFont.widthOfTextAtSize(rawWord, fontSize) > maxWidth
            ? splitOversizeWord(rawWord, maxWidth, textFont, fontSize)
            : [rawWord];

        for (const word of wordPieces) {
          const next = current ? `${current} ${word}` : word;

          if (textFont.widthOfTextAtSize(next, fontSize) <= maxWidth) {
            current = next;
          } else {
            if (current) lines.push(current);
            current = word;
          }
        }
      }

      if (current) lines.push(current);
    }

    return lines.length ? lines : ["-"];
  }

  function drawWrappedText(
    page: PDFPage,
    lines: string[],
    x: number,
    startY: number,
    lineHeight: number,
    fontSize: number,
    textFont = font,
    color = colors.muted
  ) {
    lines.forEach((line, index) => {
      page.drawText(line, {
        x,
        y: startY - index * lineHeight,
        size: fontSize,
        font: textFont,
        color,
      });
    });
  }

  function drawContinuationPages(title: string, sourceText: string | null | undefined) {
    const cleanText = String(sourceText ?? "").trim();
    if (!cleanText) return;

    let page = addPage();
    let cursorY = pageHeight - 42;

    page.drawText(title, {
      x: margin,
      y: cursorY,
      size: 18,
      font: bold,
      color: colors.text,
    });

    cursorY -= 30;

    const textX = margin + 14;
    const textW = pageWidth - margin * 2 - 28;
    const fontSize = 10;
    const lineHeight = 14;
    const lines = wrapTextToWidth(cleanText, textW, font, fontSize);

    for (const line of lines) {
      if (cursorY < 36) {
        page = addPage();
        cursorY = pageHeight - 42;

        page.drawText(`${title} continued`, {
          x: margin,
          y: cursorY,
          size: 18,
          font: bold,
          color: colors.text,
        });

        cursorY -= 30;
      }

      page.drawText(line || " ", {
        x: textX,
        y: cursorY,
        size: fontSize,
        font,
        color: colors.muted,
      });

      cursorY -= lineHeight;
    }
  }


  async function loadTrackMapImage(imageSource: string | null | undefined) {
    if (!imageSource) return null;

    const source = imageSource.trim();
    if (!source) return null;

    if (source.startsWith("data:image/")) {
      const match = source.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);

      if (!match) {
        throw new Error("Invalid base64 track map data URL.");
      }

      const contentType = match[1].toLowerCase();
      const base64Data = match[2];

      if (
        !contentType.includes("png") &&
        !contentType.includes("jpeg") &&
        !contentType.includes("jpg")
      ) {
        throw new Error(
          `Unsupported embedded track map format: ${contentType}. PDF export only supports PNG/JPG.`
        );
      }

      const imageBytes = Buffer.from(base64Data, "base64");

      if (contentType.includes("png")) {
        return await pdf.embedPng(imageBytes);
      }

      return await pdf.embedJpg(imageBytes);
    }

    const response = await fetch(source, {
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Track map fetch failed: ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get("content-type")?.toLowerCase() || "";

    if (!contentType.includes("image/")) {
      throw new Error(`Track map URL did not return an image. Content-Type: ${contentType}`);
    }

    if (
      !contentType.includes("png") &&
      !contentType.includes("jpeg") &&
      !contentType.includes("jpg")
    ) {
      throw new Error(
        `Unsupported track map format: ${contentType}. PDF export only supports PNG/JPG.`
      );
    }

    const imageBytes = await response.arrayBuffer();

    if (contentType.includes("png")) {
      return await pdf.embedPng(imageBytes);
    }

    return await pdf.embedJpg(imageBytes);
  }

  async function drawTrackMapPanel(
    page: PDFPage,
    x: number,
    y: number,
    width: number,
    height: number,
    imageSource?: string | null,
    corners: Corner[] = [],
    incidentMarkers: IncidentMarker[] = [],
    title = "Track Map"
  ) {
    drawPanel(page, x, y, width, height, title);

    if (!imageSource) {
      page.drawText("No track map available", {
        x: x + 14,
        y: y + height / 2,
        size: 11,
        font,
        color: colors.muted,
      });
      return;
    }

    try {
      const image = await loadTrackMapImage(imageSource);

      if (!image) {
        throw new Error("Track map image could not be embedded.");
      }

      const boxX = x + 14;
      const boxY = y + 14;
      const boxW = width - 28;
      const boxH = height - 44;

      const scale = Math.min(boxW / image.width, boxH / image.height);

      const drawW = image.width * scale;
      const drawH = image.height * scale;
      const drawX = boxX + (boxW - drawW) / 2;
      const drawY = boxY + (boxH - drawH) / 2;

      page.drawImage(image, {
        x: drawX,
        y: drawY,
        width: drawW,
        height: drawH,
      });

      for (const corner of corners) {
        const turnColor = isValidTurnColor(corner.color) ? corner.color : "normal";

        const labelXPercent =
          typeof corner.labelX === "number" ? corner.labelX : corner.x;

        const labelYPercent =
          typeof corner.labelY === "number" ? corner.labelY : corner.y;

        const anchorX = drawX + (corner.x / 100) * drawW;
        const anchorY = drawY + drawH - (corner.y / 100) * drawH;

        const labelX = drawX + (labelXPercent / 100) * drawW;
        const labelY = drawY + drawH - (labelYPercent / 100) * drawH;

        const markerRadius = width < 230 ? 9 : 12;
        const anchorRadius = width < 230 ? 2.2 : 3.2;

        const hasLeaderLine =
          Math.abs(labelXPercent - corner.x) > 0.1 ||
          Math.abs(labelYPercent - corner.y) > 0.1;

        if (hasLeaderLine) {
          page.drawLine({
            start: { x: anchorX, y: anchorY },
            end: { x: labelX, y: labelY },
            thickness: width < 230 ? 0.7 : 1,
            color: rgb(0.95, 0.95, 0.95),
            opacity: 0.72,
          });

          page.drawCircle({
            x: anchorX,
            y: anchorY,
            size: anchorRadius,
            color: colors.text,
            borderColor: colors.black,
            borderWidth: 0.7,
          });
        }

        page.drawCircle({
          x: labelX,
          y: labelY,
          size: markerRadius,
          color: getTurnColor(turnColor),
          borderColor: colors.text,
          borderWidth: 1.3,
        });

        const label = String(corner.id);

        const fontSize =
          width < 230
            ? label.length >= 2
              ? 6.5
              : 7.5
            : label.length >= 2
              ? 8
              : 9;

        const textWidth = bold.widthOfTextAtSize(label, fontSize);

        page.drawText(label, {
          x: labelX - textWidth / 2,
          y: labelY - fontSize / 2 + 1,
          size: fontSize,
          font: bold,
          color: colors.text,
        });
      }

      for (let i = 0; i < incidentMarkers.length; i++) {
        const marker = incidentMarkers[i];
        const markerX = drawX + (marker.x / 100) * drawW;
        const markerY = drawY + drawH - (marker.y / 100) * drawH;
        const markerRadius = width < 230 ? 6 : 8;

        page.drawCircle({
          x: markerX,
          y: markerY,
          size: markerRadius,
          color: colors.incident,
          borderColor: colors.black,
          borderWidth: 1,
        });

        const label = `H${i + 1}`;
        const fontSize = width < 230 ? 5.5 : 6.5;
        const textWidth = bold.widthOfTextAtSize(label, fontSize);

        page.drawText(label, {
          x: markerX - textWidth / 2,
          y: markerY - fontSize / 2 + 0.5,
          size: fontSize,
          font: bold,
          color: colors.black,
        });
      }
    } catch (error) {
      console.error("Track map could not be loaded:", {
        sourceStartsWith: imageSource.slice(0, 40),
        sourceLength: imageSource.length,
        error: getErrorMessage(error),
      });

      page.drawText("Track map could not be loaded", {
        x: x + 14,
        y: y + height / 2,
        size: 11,
        font,
        color: colors.muted,
      });

      page.drawText("Use PNG/JPG images only", {
        x: x + 14,
        y: y + height / 2 - 18,
        size: 8,
        font,
        color: colors.muted,
      });
    }
  }

  const page1 = addPage();

  page1.drawRectangle({
    x: margin,
    y: pageHeight - 88,
    width: pageWidth - margin * 2,
    height: 64,
    color: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
  });

  page1.drawText("Rodin Motorsport", {
    x: margin + 16,
    y: pageHeight - 52,
    size: 11,
    font: bold,
    color: colors.accent,
  });

  page1.drawText("Driver Debrief", {
    x: margin + 16,
    y: pageHeight - 74,
    size: 24,
    font: bold,
    color: colors.text,
  });

  page1.drawText(payload.trackName || "-", {
    x: pageWidth - 220,
    y: pageHeight - 68,
    size: 16,
    font: bold,
    color: colors.text,
  });

  drawPanel(page1, margin, pageHeight - 220, 250, 112, "Session Info");

  const infoLines = [
    `Driver: ${payload.driverName || "-"}`,
    `Session: ${payload.sessionName || "-"}`,
    `Track: ${payload.trackName || "-"}`,
    `Fastest lap: ${payload.fastestLapTime?.trim() ? payload.fastestLapTime.trim() : "-"}`,
  ];

  infoLines.forEach((line, i) => {
    page1.drawText(line, {
      x: margin + 14,
      y: pageHeight - 154 - i * 18,
      size: 10.5,
      font,
      color: colors.muted,
    });
  });

  drawPanel(page1, 290, pageHeight - 220, pageWidth - 314, 112, "Reliability / Issues");

  const activeIssues = Object.entries(payload.reliabilityFlags ?? {})
    .filter(([, value]) => value)
    .map(([key]) => key);

  const issueLines = wrapText(
    activeIssues.length ? activeIssues.join(" • ") : "No issues flagged",
    70
  );

  issueLines.slice(0, 4).forEach((line, i) => {
    page1.drawText(line, {
      x: 304,
      y: pageHeight - 154 - i * 18,
      size: 11,
      font,
      color: activeIssues.length ? colors.issue : colors.muted,
    });
  });

  const leftX = margin;
  const leftW = 380;
  const rightX = 420;
  const rightW = pageWidth - rightX - margin;

  drawPanel(page1, leftX, 220, leftW, 120, "Primary Limitation");

  wrapText(payload.primaryLimitation || "-", 50)
    .slice(0, 4)
    .forEach((line, i) => {
      page1.drawText(line, {
        x: leftX + 14,
        y: 294 - i * 18,
        size: 11,
        font,
        color: colors.muted,
      });
    });

  drawPanel(page1, leftX, 70, leftW, 120, "Incident Notes");

  const pageOneIncidentLines = formatIncidentLines(payload.incidentMarkers, 50);

  pageOneIncidentLines.slice(0, 5).forEach((line, i) => {
    page1.drawText(line, {
      x: leftX + 14,
      y: 144 - i * 16,
      size: 10,
      font,
      color: colors.muted,
    });
  });

  await drawTrackMapPanel(
    page1,
    rightX,
    70,
    rightW,
    270,
    payload.trackMapUrl,
    payload.corners,
    payload.incidentMarkers,
    "Track Map"
  );

  const cornerLookup = new Map(payload.corners.map((corner) => [corner.id, corner]));
  const sortedRows = [...payload.cornerFeedback].sort((a, b) => a.cornerId - b.cornerId);

  type SummaryPageLayout = {
    page: PDFPage;
    tableX: number;
    tableW: number;
    mapX: number;
    mapW: number;
    cursorY: number;
    tableBottomY: number;
    headerY: number;
    commentX: number;
    commentW: number;
    rowHeight: number;
    rowGap: number;
    chipHeight: number;
    chipWidthTurn: number;
    chipWidthBalance: number;
    chipFontSize: number;
    bodyFontSize: number;
    commentFontSize: number;
    commentLineHeight: number;
    maxCommentLines: number;
  };

  function fitGeneralCommentsForSummaryBox(
    comments: string | null | undefined,
    usableWidth: number,
    usableHeight: number
  ) {
    const cleanComments = comments?.trim() ? comments.trim() : "-";
    const candidateFontSizes = [8.2, 7.6, 7.0, 6.4, 5.8];

    for (const fontSize of candidateFontSizes) {
      const lineHeight = fontSize + 2.2;
      const lines = wrapTextToWidth(cleanComments, usableWidth, font, fontSize);

      if (lines.length * lineHeight <= usableHeight) {
        return {
          lines,
          fontSize,
          lineHeight,
        };
      }
    }

    const fontSize = 5.8;
    const lineHeight = fontSize + 2.2;
    const lines = wrapTextToWidth(cleanComments, usableWidth, font, fontSize);
    const maxLines = Math.max(1, Math.floor(usableHeight / lineHeight));
    const visibleLines = lines.slice(0, maxLines);

    if (lines.length > maxLines) {
      const finalLine = visibleLines[visibleLines.length - 1] ?? "";
      visibleLines[visibleLines.length - 1] = `${finalLine.replace(/\s+$/, "")}…`;
    }

    return {
      lines: visibleLines,
      fontSize,
      lineHeight,
    };
  }

  function limitLinesForRow(lines: string[], maxLines: number): string[] {
    if (lines.length <= maxLines) return lines;

    const visibleLines = lines.slice(0, maxLines);
    const finalLine = visibleLines[visibleLines.length - 1] ?? "";
    visibleLines[visibleLines.length - 1] = `${finalLine.replace(/\s+$/, "")}…`;

    return visibleLines;
  }

  function drawTableHeader(
    page: PDFPage,
    tableX: number,
    tableW: number,
    y: number
  ) {
    page.drawRectangle({
      x: tableX,
      y: y - 18,
      width: tableW,
      height: 24,
      color: colors.panel,
      borderColor: colors.border,
      borderWidth: 1,
    });

    const headerSize = 7.8;

    page.drawText("Corner", {
      x: tableX + 8,
      y: y - 8,
      size: headerSize,
      font: bold,
      color: colors.muted,
    });

    page.drawText("Entry", {
      x: tableX + 58,
      y: y - 8,
      size: headerSize,
      font: bold,
      color: colors.muted,
    });

    page.drawText("Mid", {
      x: tableX + 110,
      y: y - 8,
      size: headerSize,
      font: bold,
      color: colors.muted,
    });

    page.drawText("Exit", {
      x: tableX + 162,
      y: y - 8,
      size: headerSize,
      font: bold,
      color: colors.muted,
    });

    page.drawText("Comment", {
      x: tableX + 218,
      y: y - 8,
      size: headerSize,
      font: bold,
      color: colors.muted,
    });
  }

  async function startCornerSummaryPage(): Promise<SummaryPageLayout> {
    const page = addPage();

    page.drawText("Corner Summary", {
      x: margin,
      y: pageHeight - 40,
      size: 18,
      font: bold,
      color: colors.text,
    });

    const tableX = margin;
    const tableW = 462;
    const mapGap = 14;
    const mapX = tableX + tableW + mapGap;
    const mapW = pageWidth - margin - mapX;

    const commentsY = 24;
    const commentsH = 86;
    const mapY = commentsY + commentsH + 10;
    const mapH = pageHeight - mapY - 82;

    await drawTrackMapPanel(
      page,
      mapX,
      mapY,
      mapW,
      mapH,
      payload.trackMapUrl,
      payload.corners,
      payload.incidentMarkers,
      "Track Map"
    );

    drawPanel(page, mapX, commentsY, mapW, commentsH, "General Comments");

    const generalText = fitGeneralCommentsForSummaryBox(
      payload.overallComments || "-",
      mapW - 28,
      commentsH - 44
    );

    drawWrappedText(
      page,
      generalText.lines,
      mapX + 14,
      commentsY + commentsH - 38,
      generalText.lineHeight,
      generalText.fontSize
    );

    const headerY = pageHeight - 68;
    const cursorY = headerY - 26;
    const tableBottomY = 24;
    const rowCount = Math.max(sortedRows.length, 1);
    const rowGap = rowCount > 24 ? 0.8 : rowCount > 18 ? 1.2 : 2;
    const availableRowsHeight = cursorY - tableBottomY - rowGap * Math.max(rowCount - 1, 0);
    const rowHeight = Math.max(6.2, Math.min(24, availableRowsHeight / rowCount));
    const chipHeight = Math.max(5.2, Math.min(18, rowHeight - 4));
    const chipFontSize = Math.max(4.4, Math.min(7.0, chipHeight * 0.42));
    const bodyFontSize = Math.max(4.8, Math.min(7.8, rowHeight * 0.36));
    const commentFontSize = Math.max(4.6, Math.min(7.2, rowHeight * 0.32));
    const commentLineHeight = commentFontSize + 1.6;
    const maxCommentLines = Math.max(1, Math.floor((rowHeight - 5) / commentLineHeight));

    drawTableHeader(page, tableX, tableW, headerY);

    return {
      page,
      tableX,
      tableW,
      mapX,
      mapW,
      cursorY,
      tableBottomY,
      headerY,
      commentX: tableX + 218,
      commentW: tableW - 228,
      rowHeight,
      rowGap,
      chipHeight,
      chipWidthTurn: 38,
      chipWidthBalance: 42,
      chipFontSize,
      bodyFontSize,
      commentFontSize,
      commentLineHeight,
      maxCommentLines,
    };
  }

  const summaryLayout = await startCornerSummaryPage();

  if (sortedRows.length === 0) {
    summaryLayout.page.drawRectangle({
      x: summaryLayout.tableX,
      y: summaryLayout.cursorY - 28,
      width: summaryLayout.tableW,
      height: 28,
      color: colors.panel,
      borderColor: colors.border,
      borderWidth: 1,
    });

    summaryLayout.page.drawText("No corner feedback recorded", {
      x: summaryLayout.tableX + 10,
      y: summaryLayout.cursorY - 17,
      size: 9,
      font,
      color: colors.muted,
    });
  }

  for (const row of sortedRows) {
    const rawCommentLines = wrapTextToWidth(
      row.comment?.trim() || "-",
      summaryLayout.commentW,
      font,
      summaryLayout.commentFontSize
    );

    const commentLines = limitLinesForRow(rawCommentLines, summaryLayout.maxCommentLines);
    const rowTopY = summaryLayout.cursorY;
    const rowBottomY = rowTopY - summaryLayout.rowHeight;

    summaryLayout.page.drawRectangle({
      x: summaryLayout.tableX,
      y: rowBottomY,
      width: summaryLayout.tableW,
      height: summaryLayout.rowHeight,
      color: colors.panel,
      borderColor: colors.border,
      borderWidth: 1,
    });

    const cornerMeta = cornerLookup.get(row.cornerId);
    const chipY = rowBottomY + summaryLayout.rowHeight / 2 - summaryLayout.chipHeight / 2;

    drawTurnChip(
      summaryLayout.page,
      summaryLayout.tableX + 8,
      chipY,
      summaryLayout.chipWidthTurn,
      summaryLayout.chipHeight,
      `T${row.cornerId}`,
      cornerMeta?.color,
      summaryLayout.chipFontSize
    );

    drawBalanceChip(
      summaryLayout.page,
      summaryLayout.tableX + 56,
      chipY,
      summaryLayout.chipWidthBalance,
      summaryLayout.chipHeight,
      row.entryBalance || "-",
      row.entryBalanceValue,
      summaryLayout.chipFontSize
    );

    drawBalanceChip(
      summaryLayout.page,
      summaryLayout.tableX + 108,
      chipY,
      summaryLayout.chipWidthBalance,
      summaryLayout.chipHeight,
      row.midBalance || "-",
      row.midBalanceValue,
      summaryLayout.chipFontSize
    );

    drawBalanceChip(
      summaryLayout.page,
      summaryLayout.tableX + 160,
      chipY,
      summaryLayout.chipWidthBalance,
      summaryLayout.chipHeight,
      row.exitBalance || "-",
      row.exitBalanceValue,
      summaryLayout.chipFontSize
    );

    drawWrappedText(
      summaryLayout.page,
      commentLines,
      summaryLayout.commentX,
      rowTopY - Math.max(8, summaryLayout.rowHeight * 0.42),
      summaryLayout.commentLineHeight,
      summaryLayout.commentFontSize
    );

    summaryLayout.cursorY -= summaryLayout.rowHeight + summaryLayout.rowGap;
  }

  if (payload.primaryLimitation?.trim()) {
    const primaryPreviewLines = wrapTextToWidth(payload.primaryLimitation, leftW - 28, font, 11);
    const maxPrimaryPreviewLines = 4;

    if (primaryPreviewLines.length > maxPrimaryPreviewLines) {
      drawContinuationPages("Primary Limitation", payload.primaryLimitation);
    }
  }

  if (activeIssues.length > 0 && issueLines.length > 4) {
    drawContinuationPages("Reliability / Issues", activeIssues.join(" • "));
  }

  if (payload.incidentMarkers.length > 0) {
    let incidentPage = addPage();
    let incidentY = pageHeight - 40;

    incidentPage.drawText("Incident Marker Notes", {
      x: margin,
      y: incidentY,
      size: 18,
      font: bold,
      color: colors.text,
    });

    incidentY -= 30;

    for (let i = 0; i < payload.incidentMarkers.length; i++) {
      const marker = payload.incidentMarkers[i];
      const lines = wrapText(marker.note?.trim() ? marker.note.trim() : "No note", 95);
      const blockHeight = Math.max(34, lines.length * 14 + 16);

      if (incidentY - blockHeight < 30) {
        incidentPage = addPage();
        incidentY = pageHeight - 40;

        incidentPage.drawText("Incident Marker Notes", {
          x: margin,
          y: incidentY,
          size: 18,
          font: bold,
          color: colors.text,
        });

        incidentY -= 30;
      }

      incidentPage.drawRectangle({
        x: margin,
        y: incidentY - blockHeight + 8,
        width: pageWidth - margin * 2,
        height: blockHeight,
        color: colors.panel,
        borderColor: colors.border,
        borderWidth: 1,
      });

      incidentPage.drawText(`H${i + 1}`, {
        x: margin + 12,
        y: incidentY - 10,
        size: 11,
        font: bold,
        color: colors.incident,
      });

      lines.forEach((line, lineIndex) => {
        incidentPage.drawText(line, {
          x: margin + 50,
          y: incidentY - 10 - lineIndex * 14,
          size: 10,
          font,
          color: colors.muted,
        });
      });

      incidentY -= blockHeight + 10;
    }
  }

  const bytes = await pdf.save();
  return Buffer.from(bytes);
}

export async function POST(request: Request) {
  try {
    const gmailUser = process.env.GMAIL_USER;
    const gmailAppPassword = process.env.GMAIL_APP_PASSWORD;

    if (!gmailUser || !gmailAppPassword) {
      return NextResponse.json(
        { error: "GMAIL_USER or GMAIL_APP_PASSWORD is not configured." },
        { status: 500 }
      );
    }

    const body = (await request.json()) as RequestBody;

    const {
      driverName,
      sessionName,
      fastestLapTime,
      trackName,
      trackMapUrl,
      corners,
      incidentMarkers,
      primaryRecipientEmail,
      extraRecipientEmail,
      primaryLimitation,
      overallComments,
      reliabilityFlags,
      cornerFeedback,
      team,
      templateId,
    } = body;

    if (!driverName?.trim()) {
      return NextResponse.json({ error: "Missing driver name." }, { status: 400 });
    }

    if (!trackName?.trim()) {
      return NextResponse.json({ error: "Missing track name." }, { status: 400 });
    }

    if (!primaryRecipientEmail?.trim()) {
      return NextResponse.json(
        { error: "Missing primary recipient email." },
        { status: 400 }
      );
    }

    const normalisedCorners = normaliseCorners(corners);
    const normalisedIncidentMarkers = normaliseIncidentMarkers(incidentMarkers);
    const normalisedCornerFeedback = normaliseCornerFeedback(cornerFeedback);
    const normalisedReliabilityFlags = reliabilityFlags ?? {};

    console.log("Debrief PDF request:", {
      driverName,
      trackName,
      templateId,
      trackMapType: trackMapUrl?.startsWith("data:image/")
        ? "data-url"
        : trackMapUrl
          ? "url-or-other"
          : "none",
      trackMapLength: trackMapUrl?.length ?? 0,
      corners: normalisedCorners.length,
      incidents: normalisedIncidentMarkers.length,
      feedbackRows: normalisedCornerFeedback.length,
    });

    const intendedRecipients = [
      primaryRecipientEmail?.trim(),
      extraRecipientEmail?.trim(),
    ].filter((value, index, array): value is string => {
      return Boolean(value) && array.indexOf(value) === index;
    });

    const actualRecipients =
      intendedRecipients.length > 0
        ? intendedRecipients
        : ["alec.dixon@rodinmotorsport.com"];

    const ccRecipients = [
      "alec.dixon@rodinmotorsport.com",
      "cgehancock@icloud.com",
    ];

    const pdfBuffer = await buildDebriefPdf({
      driverName: driverName.trim(),
      sessionName: sessionName?.trim() || "-",
      fastestLapTime,
      trackName: trackName.trim(),
      trackMapUrl,
      corners: normalisedCorners,
      incidentMarkers: normalisedIncidentMarkers,
      primaryLimitation,
      overallComments,
      reliabilityFlags: normalisedReliabilityFlags,
      cornerFeedback: normalisedCornerFeedback,
    });

    const { error: saveError } = await supabase.from("submitted_debriefs").insert({
      team: team ?? null,
      template_id: templateId ?? null,
      track_name: trackName,
      session_name: sessionName ?? null,
      fastest_lap_time: fastestLapTime?.trim() ? fastestLapTime.trim() : null,
      driver_name: driverName,
      primary_limitation: primaryLimitation ?? null,
      overall_comments: overallComments ?? null,
      reliability_flags: normalisedReliabilityFlags,
      corner_feedback: normalisedCornerFeedback,
      incident_markers: normalisedIncidentMarkers,
    });

    if (saveError) {
      return NextResponse.json(
        { error: `Failed to save debrief: ${saveError.message}` },
        { status: 500 }
      );
    }

    const safeFileName =
      `${new Date().toISOString().split("T")[0]}_${driverName}_${trackName}_DebriefSheet_${
        sessionName || "Session"
      }_${fastestLapTime?.trim() || "NoLap"}.pdf`
        .replace(/[\/\\:*?"<>|]/g, "-")
        .replace(/\s+/g, "_")
        .replace(/\.+/g, ".")
        .toLowerCase();

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: gmailUser,
        pass: gmailAppPassword,
      },
    });

    await transporter.sendMail({
      from: `"Debrief App" <${gmailUser}>`,
      to: actualRecipients,
      cc: ccRecipients,
      subject: `[${team ?? "UNKNOWN"}] ${trackName} debrief - ${driverName}`,
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.5;">
          <h2>Driver Debrief Submitted</h2>
          <p><strong>Team:</strong> ${escapeHtml(team ?? "Not provided")}</p>
          <p><strong>Track:</strong> ${escapeHtml(trackName)}</p>
          <p><strong>Driver:</strong> ${escapeHtml(driverName)}</p>
          <p><strong>Session:</strong> ${escapeHtml(sessionName || "Not provided")}</p>
          <p><strong>Fastest lap:</strong> ${
            fastestLapTime?.trim()
              ? escapeHtml(fastestLapTime.trim())
              : "Not provided"
          }</p>
          <p>The completed debrief PDF is attached.</p>
        </div>
      `,
      attachments: [
        {
          filename: safeFileName,
          content: pdfBuffer,
        },
      ],
    });

    return NextResponse.json({
      success: true,
      sentTo: actualRecipients,
      cc: ccRecipients,
    });
  } catch (error) {
    console.error("send-debrief route failed:", error);

    if (error instanceof DriverInputError) {
      return NextResponse.json(
        {
          error: error.message,
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        error: getErrorMessage(error),
      },
      { status: 500 }
    );
  }
}