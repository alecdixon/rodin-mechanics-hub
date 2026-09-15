import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

export type SurfaceTablePdfItem = {
  item_key: string;
  item_name: string;
  item_side: string;
  item_position: string;
  status: "legal" | "illegal";
  illegal_note: string | null;
  height_notation_enabled?: boolean | null;
  height_notation?: string | number | null;
};

export type SurfaceTablePdfPayload = {
  car_id: number;
  car_name: string;
  driver: string;
  circuit: string;
  check_date: string;
  engineer_name: string;
  created_by: string;
  submitted_at: string;
  corner_weights: Record<"fl" | "fr" | "rl" | "rr" | "total", string>;
  camber_measurements: Record<"fl" | "fr" | "rl" | "rr", string>;
  wing_shims: Record<"main_lh" | "main_rh" | "spare_lh" | "spare_rh", string>;
  items: SurfaceTablePdfItem[];
};

const A4: [number, number] = [595.28, 841.89];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function dateParts(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

export function formatSurfaceTableDate(value: string) {
  const parts = dateParts(value);
  return parts && MONTHS[parts.month - 1]
    ? `${parts.day} ${MONTHS[parts.month - 1]} ${parts.year}`
    : value || "Not supplied";
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "Not supplied";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/London",
  }).format(date);
}

function cleanFilePart(value: string) {
  return value.trim().replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "") || "Unknown";
}

export function surfaceTablePdfFilename(payload: Pick<SurfaceTablePdfPayload, "car_id" | "check_date">) {
  return `Surface_Table_Car_${cleanFilePart(String(payload.car_id))}_${cleanFilePart(payload.check_date)}.pdf`;
}

export function surfaceTableEmailSubject(payload: Pick<SurfaceTablePdfPayload, "car_name" | "car_id" | "check_date">) {
  const car = payload.car_name.trim() || `Car ${payload.car_id}`;
  return `Surface Table Check - ${car} - ${formatSurfaceTableDate(payload.check_date)}`;
}

export function buildSurfaceTableMail(args: {
  payload: SurfaceTablePdfPayload;
  recipient: string;
  pdf: Uint8Array;
  reportUrl?: string;
}) {
  const { payload, recipient, pdf, reportUrl } = args;
  const viewLine = reportUrl ? `\nView in Mechanics Hub: ${reportUrl}` : "";
  const escapedUrl = reportUrl?.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return {
    to: recipient,
    subject: surfaceTableEmailSubject(payload),
    text: [
      "Surface Table Check",
      "",
      `Car: ${payload.car_name || `Car ${payload.car_id}`}`,
      `Circuit/event: ${payload.circuit || "Not supplied"}`,
      `Date: ${formatSurfaceTableDate(payload.check_date)}`,
      `Submitted by: ${payload.created_by || "Not supplied"}`,
      `Submitted: ${formatTimestamp(payload.submitted_at)}`,
      "",
      "The submitted Surface Table Check is attached as a PDF.",
      viewLine,
    ].filter(Boolean).join("\n"),
    html: `<p>The submitted <strong>Surface Table Check</strong> for <strong>${escapeHtml(payload.car_name || `Car ${payload.car_id}`)}</strong> is attached as a PDF.</p>${escapedUrl ? `<p><a href="${escapedUrl}">View in Mechanics Hub</a></p>` : ""}`,
    attachments: [{
      filename: surfaceTablePdfFilename(payload),
      content: Buffer.from(pdf),
      contentType: "application/pdf",
    }],
  };
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] ?? character);
}

function pdfSafe(value: string) {
  return value
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[^\x20-\x7e\u00b0]/g, "?");
}

function wrap(text: string, font: PDFFont, size: number, width: number) {
  const words = pdfSafe(String(text || "-")).split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const originalWord of words) {
    const chunks: string[] = [];
    let word = originalWord;
    while (font.widthOfTextAtSize(word, size) > width && word.length > 1) {
      let split = word.length - 1;
      while (split > 1 && font.widthOfTextAtSize(word.slice(0, split), size) > width) split -= 1;
      chunks.push(word.slice(0, split));
      word = word.slice(split);
    }
    chunks.push(word);
    for (const chunk of chunks) {
      const candidate = line ? `${line} ${chunk}` : chunk;
      if (!line || font.widthOfTextAtSize(candidate, size) <= width) line = candidate;
      else { lines.push(line); line = chunk; }
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : ["-"];
}

function displayNumber(value: string, unit: string) {
  const clean = value.trim();
  if (!clean) return "-";
  const numeric = Number(clean);
  const formatted = Number.isFinite(numeric) ? numeric.toFixed(1).replace(/\.0$/, "") : clean;
  return `${formatted} ${unit}`;
}

export async function buildSurfaceTablePdf(payload: SurfaceTablePdfPayload, generatedAt = new Date().toISOString()) {
  const document = await PDFDocument.create();
  document.setTitle(surfaceTableEmailSubject(payload));
  document.setAuthor("Rodin Motorsport");
  document.setSubject(`${payload.car_name || `Car ${payload.car_id}`} | ${payload.circuit || "Circuit not supplied"} | submitted ${payload.submitted_at}`);
  document.setCreator("Rodin Mechanics Hub");
  document.setProducer("Rodin Mechanics Hub");
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const margin = 38;
  const contentWidth = A4[0] - margin * 2;
  const ink = rgb(0.09, 0.11, 0.14);
  const muted = rgb(0.38, 0.41, 0.46);
  const pale = rgb(0.96, 0.97, 0.98);
  const border = rgb(0.81, 0.83, 0.86);
  const red = rgb(0.74, 0.05, 0.09);
  const green = rgb(0.07, 0.45, 0.24);
  let page!: PDFPage;
  let y = 0;

  function addPage(continuation = false) {
    page = document.addPage(A4);
    page.drawRectangle({ x: 0, y: A4[1] - 9, width: A4[0], height: 9, color: red });
    page.drawText("RODIN MOTORSPORT", { x: margin, y: A4[1] - 39, size: 10, font: bold, color: red });
    page.drawText(continuation ? "Surface Table Check - Measurements" : "Surface Table Check", {
      x: margin, y: A4[1] - 64, size: continuation ? 17 : 22, font: bold, color: ink,
    });
    page.drawText(pdfSafe(`${payload.car_name || `Car ${payload.car_id}`}  |  ${formatSurfaceTableDate(payload.check_date)}`), {
      x: margin, y: A4[1] - 81, size: 8.5, font: regular, color: muted,
    });
    y = A4[1] - 108;
  }

  function section(title: string) {
    page.drawText(title.toUpperCase(), { x: margin, y, size: 8, font: bold, color: red });
    y -= 14;
  }

  function grid(entries: Array<[string, string]>, columns: number) {
    const gap = 7;
    const width = (contentWidth - gap * (columns - 1)) / columns;
    entries.forEach(([label, value], index) => {
      const row = Math.floor(index / columns);
      const column = index % columns;
      const x = margin + column * (width + gap);
      const top = y - row * 48;
      page.drawRectangle({ x, y: top - 39, width, height: 39, color: pale, borderColor: border, borderWidth: 0.6 });
      page.drawText(label.toUpperCase(), { x: x + 7, y: top - 12, size: 6.3, font: bold, color: muted });
      wrap(value || "-", bold, 9, width - 14).slice(0, 2).forEach((line, lineIndex) => {
        page.drawText(line, { x: x + 7, y: top - 27 - lineIndex * 9, size: 9, font: bold, color: ink });
      });
    });
    y -= Math.ceil(entries.length / columns) * 48 + 9;
  }

  addPage();
  const illegalCount = payload.items.filter((item) => item.status === "illegal").length;
  grid([
    ["Car", payload.car_name || `Car ${payload.car_id}`],
    ["Date", formatSurfaceTableDate(payload.check_date)],
    ["Circuit / event", payload.circuit || "Not supplied"],
    ["Submitted by", payload.created_by || "Not supplied"],
    ["Submission timestamp", formatTimestamp(payload.submitted_at)],
    ["Overall status", illegalCount ? `${illegalCount} item${illegalCount === 1 ? "" : "s"} illegal` : "Pass - all items legal"],
    ["Driver", payload.driver || "Not supplied"],
    ["Engineer", payload.engineer_name || "Not supplied"],
  ], 2);
  section("Corner weights");
  grid([
    ["Front left", displayNumber(payload.corner_weights.fl, "kg")], ["Front right", displayNumber(payload.corner_weights.fr, "kg")],
    ["Rear left", displayNumber(payload.corner_weights.rl, "kg")], ["Rear right", displayNumber(payload.corner_weights.rr, "kg")],
    ["Total", displayNumber(payload.corner_weights.total, "kg")],
  ], 3);
  section("Camber measurements");
  grid([
    ["Front left", displayNumber(payload.camber_measurements.fl, "deg")], ["Front right", displayNumber(payload.camber_measurements.fr, "deg")],
    ["Rear left", displayNumber(payload.camber_measurements.rl, "deg")], ["Rear right", displayNumber(payload.camber_measurements.rr, "deg")],
  ], 4);
  section("Front wing shim record");
  grid([
    ["Main LH", payload.wing_shims.main_lh || "-"], ["Main RH", payload.wing_shims.main_rh || "-"],
    ["Spare LH", payload.wing_shims.spare_lh || "-"], ["Spare RH", payload.wing_shims.spare_rh || "-"],
  ], 4);

  const widths = [144, 42, 54, 56, 223];
  const headings = ["Measurement", "Side", "Status", "Height", "Position / notes"];
  function tableHeader() {
    let x = margin;
    headings.forEach((heading, index) => {
      page.drawRectangle({ x, y: y - 22, width: widths[index], height: 22, color: ink });
      page.drawText(heading.toUpperCase(), { x: x + 5, y: y - 14, size: 6.2, font: bold, color: rgb(1, 1, 1) });
      x += widths[index];
    });
    y -= 22;
  }

  addPage(true);
  tableHeader();
  for (const item of payload.items) {
    const notes = item.status === "illegal" ? item.illegal_note || "No note supplied" : item.item_position || "-";
    const nameLines = wrap(item.item_name, regular, 7.3, widths[0] - 10);
    const noteLines = wrap(notes, regular, 7.3, widths[4] - 10);
    const rowHeight = Math.max(28, Math.max(nameLines.length, noteLines.length) * 9 + 10);
    if (y - rowHeight < 48) { addPage(true); tableHeader(); }
    let x = margin;
    widths.forEach((width) => {
      page.drawRectangle({ x, y: y - rowHeight, width, height: rowHeight, color: rgb(1, 1, 1), borderColor: border, borderWidth: 0.55 });
      x += width;
    });
    nameLines.forEach((line, index) => page.drawText(line, { x: margin + 5, y: y - 13 - index * 9, size: 7.3, font: regular, color: ink }));
    page.drawText(pdfSafe(item.item_side || "-"), { x: margin + widths[0] + 5, y: y - 15, size: 7.1, font: regular, color: ink });
    page.drawText(item.status === "illegal" ? "FAIL" : "PASS", {
      x: margin + widths[0] + widths[1] + 5, y: y - 15, size: 6.8, font: bold, color: item.status === "illegal" ? red : green,
    });
    const height = item.height_notation_enabled && item.status === "legal" && /^[0-5]$/.test(String(item.height_notation ?? ""))
      ? `${item.height_notation}/5`
      : "-";
    page.drawText(height, { x: margin + widths[0] + widths[1] + widths[2] + 5, y: y - 15, size: 7.1, font: regular, color: ink });
    const notesX = margin + widths.slice(0, 4).reduce((sum, width) => sum + width, 0) + 5;
    noteLines.forEach((line, index) => page.drawText(line, { x: notesX, y: y - 13 - index * 9, size: 7.3, font: regular, color: ink }));
    y -= rowHeight;
  }

  const pages = document.getPages();
  pages.forEach((currentPage, index) => {
    currentPage.drawLine({ start: { x: margin, y: 30 }, end: { x: A4[0] - margin, y: 30 }, thickness: 0.5, color: border });
    currentPage.drawText(pdfSafe(`Generated ${formatTimestamp(generatedAt)}  |  ${payload.car_name || `Car ${payload.car_id}`}`), {
      x: margin, y: 17, size: 6.8, font: regular, color: muted,
    });
    const pageLabel = `Page ${index + 1} of ${pages.length}`;
    currentPage.drawText(pageLabel, { x: A4[0] - margin - regular.widthOfTextAtSize(pageLabel, 6.8), y: 17, size: 6.8, font: regular, color: muted });
  });

  return Buffer.from(await document.save());
}
