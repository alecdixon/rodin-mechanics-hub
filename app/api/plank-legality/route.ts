import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
export const runtime = "nodejs";

type PlankStatus = "legal" | "warning" | "illegal";

type PlankHolePayload = {
  hole_key: string;
  hole_name: string;
  position: string;
  min_mm: number | string | null;
  max_mm: number | string | null;
  status: PlankStatus;
};

type PlankLegalityEmailPayload = {
  report_id?: string | null;
  car_id: number;
  car_name?: string | null;
  driver?: string | null;
  circuit?: string | null;
  report_date?: string | null;
  session?: string | null;
  engineer_name?: string | null;
  engineer_email?: string | null;
  created_by?: string | null;
  status?: PlankStatus | null;
  minimum_thickness_mm?: number | string | null;
  failed_holes?: number | null;
  near_limit_holes?: number | null;
  notes?: string | null;
  download_only?: boolean | null;
  holes?: PlankHolePayload[];
};

type NormalisedPlankPayload = {
  report_id: string;
  car_id: number;
  car_name: string;
  driver: string;
  circuit: string;
  report_date: string;
  session: string;
  engineer_name: string;
  engineer_email: string;
  created_by: string;
  status: PlankStatus;
  minimum_thickness_mm: string;
  failed_holes: number;
  near_limit_holes: number;
  notes: string;
  holes: Array<{
    hole_key: string;
    hole_name: string;
    position: string;
    min_mm: string;
    max_mm: string;
    status: PlankStatus;
  }>;
};

function getRequestUserEmail(request: NextRequest) {
  return request.cookies.get("user-email")?.value?.trim().toLowerCase() ?? "";
}

function blockUnauthorisedUser(request: NextRequest) {
  const userEmail = getRequestUserEmail(request);

  if (!userEmail) {
    return NextResponse.json(
      {
        error: "You must be logged in to send plank legality PDF emails.",
      },
      { status: 403 },
    );
  }

  return null;
}

function clean(value: string | number | null | undefined) {
  return String(value ?? "").trim();
}

function cleanMm(value: string | number | null | undefined) {
  const cleanValue = String(value ?? "").trim();
  if (!cleanValue) return "";

  const numericValue = Number(cleanValue);
  if (!Number.isFinite(numericValue)) return cleanValue;

  return numericValue.toFixed(2);
}

function formatMm(value: string) {
  return value ? `${value} mm` : "—";
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

function statusLabel(status: PlankStatus) {
  if (status === "illegal") return "ILLEGAL";
  if (status === "warning") return "LEGAL - CLOSE TO LIMIT";
  return "LEGAL";
}

function statusColour(status: PlankStatus) {
  if (status === "illegal") return rgb(1, 0.12, 0.18);
  if (status === "warning") return rgb(1, 0.72, 0.16);
  return rgb(0, 0.78, 0.32);
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
    error: "Plank legality PDF notification failed while sending the engineer email.",
    likely_cause:
      "The plank legality report may have saved, but the PDF email notification failed.",
    fix: "Check the technical_error value, then verify Gmail/Vercel environment variables.",
  };
}

function normalisePayload(payload: PlankLegalityEmailPayload): NormalisedPlankPayload {
  const carId = Number(payload.car_id);
  const fallbackEngineerEmail = getFallbackEngineerEmailForCar(carId);
  const fallbackEngineerName = getFallbackEngineerNameForCar(carId);

  const status =
    payload.status === "illegal" || payload.status === "warning" || payload.status === "legal"
      ? payload.status
      : "legal";

  const holes = (payload.holes ?? []).map((hole) => ({
    hole_key: clean(hole.hole_key),
    hole_name: clean(hole.hole_name) || clean(hole.hole_key),
    position: clean(hole.position),
    min_mm: cleanMm(hole.min_mm),
    max_mm: cleanMm(hole.max_mm),
    status:
      hole.status === "illegal" || hole.status === "warning" || hole.status === "legal"
        ? hole.status
        : "legal",
  }));

  return {
    report_id: clean(payload.report_id) || "unsaved",
    car_id: Number.isFinite(carId) ? carId : 0,
    car_name: clean(payload.car_name) || `Car ${carId}`,
    driver: clean(payload.driver) || clean(payload.car_name) || `Car ${carId}`,
    circuit: clean(payload.circuit) || "Not supplied",
    report_date: clean(payload.report_date) || "",
    session: clean(payload.session) || "Not supplied",
    engineer_name: clean(payload.engineer_name) || fallbackEngineerName,
    engineer_email: clean(payload.engineer_email) || fallbackEngineerEmail,
    created_by: clean(payload.created_by),
    status,
    minimum_thickness_mm: cleanMm(payload.minimum_thickness_mm),
    failed_holes: Number(payload.failed_holes ?? 0) || 0,
    near_limit_holes: Number(payload.near_limit_holes ?? 0) || 0,
    notes: clean(payload.notes),
    holes,
  };
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

function fontWidth(text: string, font: PDFFont, size: number) {
  return font.widthOfTextAtSize(text, size);
}

function drawText(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  font: PDFFont,
  size: number,
  color = rgb(0.93, 0.94, 0.96),
) {
  page.drawText(text, {
    x,
    y,
    font,
    size,
    color,
  });
}

function drawInfoBox(
  page: PDFPage,
  label: string,
  value: string,
  x: number,
  y: number,
  width: number,
  height: number,
  normalFont: PDFFont,
  boldFont: PDFFont,
) {
  const panelBlack = rgb(0.035, 0.045, 0.06);
  const borderGrey = rgb(0.25, 0.27, 0.32);
  const grey = rgb(0.58, 0.61, 0.68);
  const light = rgb(0.93, 0.94, 0.96);

  page.drawRectangle({
    x,
    y,
    width,
    height,
    color: panelBlack,
    borderColor: borderGrey,
    borderWidth: 0.75,
  });

  drawText(page, label.toUpperCase(), x + 8, y + height - 12, boldFont, 6.2, grey);

  const lines = wrapTextByWidth(value || "—", boldFont, 8.2, width - 16).slice(0, 2);
  lines.forEach((line, index) => {
    drawText(page, line, x + 8, y + height - 24 - index * 9, index === 0 ? boldFont : normalFont, 8.2, light);
  });
}

async function buildPlankLegalityPdf(payload: NormalisedPlankPayload) {
  const pdfDoc = await PDFDocument.create();
  const normalFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const page = pdfDoc.addPage([595.28, 841.89]);
  const pageWidth = page.getWidth();
  const pageHeight = page.getHeight();

  const sheetBlack = rgb(0.015, 0.02, 0.03);
  const panelBlack = rgb(0.035, 0.045, 0.06);
  const borderGrey = rgb(0.25, 0.27, 0.32);
  const light = rgb(0.93, 0.94, 0.96);
  const grey = rgb(0.58, 0.61, 0.68);
  const red = rgb(1, 0.12, 0.18);
  const green = rgb(0, 0.78, 0.32);
  const yellow = rgb(1, 0.72, 0.16);

  page.drawRectangle({ x: 0, y: 0, width: pageWidth, height: pageHeight, color: sheetBlack });

  drawText(page, "RODIN MOTORSPORT · GB3", 34, 792, boldFont, 8, red);
  drawText(page, "PLANK LEGALITY REPORT", 34, 765, boldFont, 22, light);
  drawText(
    page,
    "Skid plank thickness check · at least one point around each hole must be 3.00 mm or more",
    34,
    746,
    normalFont,
    8.2,
    grey,
  );

  const status = statusLabel(payload.status);
  const badgeColour = statusColour(payload.status);
  page.drawRectangle({
    x: 404,
    y: 758,
    width: 155,
    height: 33,
    color: rgb(0.02, 0.025, 0.035),
    borderColor: badgeColour,
    borderWidth: 1.4,
  });
  drawText(
    page,
    status,
    404 + 77.5 - fontWidth(status, boldFont, 9.5) / 2,
    770,
    boldFont,
    9.5,
    badgeColour,
  );

  const infoY = 692;
  drawInfoBox(page, "Car", payload.car_name, 34, infoY, 94, 40, normalFont, boldFont);
  drawInfoBox(page, "Driver", payload.driver, 136, infoY, 94, 40, normalFont, boldFont);
  drawInfoBox(page, "Circuit", payload.circuit, 238, infoY, 118, 40, normalFont, boldFont);
  drawInfoBox(page, "Session", payload.session, 364, infoY, 84, 40, normalFont, boldFont);
  drawInfoBox(page, "Date", formatReportDate(payload.report_date), 456, infoY, 103, 40, normalFont, boldFont);

  drawInfoBox(page, "Engineer", payload.engineer_name, 34, 642, 175, 38, normalFont, boldFont);
  drawInfoBox(page, "Engineer Email", payload.engineer_email, 217, 642, 210, 38, normalFont, boldFont);
  drawInfoBox(page, "Submitted By", payload.created_by || "—", 435, 642, 124, 38, normalFont, boldFont);

  page.drawRectangle({
    x: 34,
    y: 565,
    width: 525,
    height: 58,
    color: panelBlack,
    borderColor: borderGrey,
    borderWidth: 0.85,
  });

  const summaryCells = [
    ["Lowest", formatMm(payload.minimum_thickness_mm), red],
    ["Failed Holes", String(payload.failed_holes), payload.failed_holes > 0 ? red : green],
    ["Near Limit", String(payload.near_limit_holes), payload.near_limit_holes > 0 ? yellow : grey],
    ["Rule Limit", "3.00 mm", light],
  ] as const;

  summaryCells.forEach(([label, value, colour], index) => {
    const x = 48 + index * 128;
    drawText(page, label.toUpperCase(), x, 601, boldFont, 6.5, grey);
    drawText(page, value, x, 580, boldFont, 14, colour);
  });

  drawText(page, "HOLE MEASUREMENTS", 34, 534, boldFont, 10, grey);

  const tableX = 34;
  const tableTop = 514;
  const rowH = 38;
  const columns = [
    ["Hole", 82],
    ["Position", 188],
    ["Min", 72],
    ["Max", 72],
    ["Result", 111],
  ] as const;

  let x = tableX;
  columns.forEach(([title, width]) => {
    page.drawRectangle({
      x,
      y: tableTop,
      width,
      height: 22,
      color: rgb(0.06, 0.07, 0.09),
      borderColor: borderGrey,
      borderWidth: 0.65,
    });
    drawText(page, title.toUpperCase(), x + 7, tableTop + 8, boldFont, 6.5, grey);
    x += width;
  });

  payload.holes.forEach((hole, index) => {
    const y = tableTop - (index + 1) * rowH;
    let colX = tableX;
    const resultColour = statusColour(hole.status);

    columns.forEach(([, width]) => {
      page.drawRectangle({
        x: colX,
        y,
        width,
        height: rowH,
        color: panelBlack,
        borderColor: borderGrey,
        borderWidth: 0.5,
      });
      colX += width;
    });

    drawText(page, hole.hole_name, tableX + 7, y + 22, boldFont, 9, light);
    drawText(page, hole.position || "—", tableX + 89, y + 22, normalFont, 8, light);
    drawText(page, formatMm(hole.min_mm), tableX + 277, y + 22, boldFont, 8.5, light);
    drawText(page, formatMm(hole.max_mm), tableX + 349, y + 22, boldFont, 8.5, light);

    const result = statusLabel(hole.status);
    page.drawRectangle({
      x: tableX + 421,
      y: y + 10,
      width: 90,
      height: 18,
      color: rgb(0.02, 0.025, 0.035),
      borderColor: resultColour,
      borderWidth: 0.75,
    });
    drawText(
      page,
      result,
      tableX + 466 - fontWidth(result, boldFont, 6.2) / 2,
      y + 16,
      boldFont,
      6.2,
      resultColour,
    );
  });

  const ruleY = 286;
  page.drawRectangle({
    x: 34,
    y: ruleY,
    width: 525,
    height: 74,
    color: panelBlack,
    borderColor: payload.status === "illegal" ? red : borderGrey,
    borderWidth: payload.status === "illegal" ? 1.1 : 0.75,
  });

  drawText(page, "RULE SUMMARY", 48, ruleY + 54, boldFont, 7, grey);
  const ruleLines = wrapTextByWidth(
    "The skid plank must have a thickness of at least 3.00 mm. After use, each of the four holes must have at least one point around its circumference at or above 3.00 mm. If the maximum measured value at any hole is below 3.00 mm, that hole fails.",
    normalFont,
    8.2,
    495,
  ).slice(0, 4);
  ruleLines.forEach((line, index) => {
    drawText(page, line, 48, ruleY + 39 - index * 11, normalFont, 8.2, light);
  });

  const notesY = 154;
  page.drawRectangle({
    x: 34,
    y: notesY,
    width: 525,
    height: 112,
    color: panelBlack,
    borderColor: borderGrey,
    borderWidth: 0.75,
  });

  drawText(page, "NOTES", 48, notesY + 91, boldFont, 7, grey);
  const noteLines = wrapTextByWidth(payload.notes || "No notes supplied.", normalFont, 8.4, 495).slice(0, 8);
  noteLines.forEach((line, index) => {
    drawText(page, line, 48, notesY + 73 - index * 11, normalFont, 8.4, light);
  });

  drawText(page, `Report ID: ${payload.report_id}`, 34, 37, normalFont, 6.5, grey);
  drawText(page, "Generated by Rodin Mechanics Hub", 410, 37, normalFont, 6.5, grey);

  return pdfDoc.save();
}

async function sendEmail(payload: NormalisedPlankPayload, pdfBytes: Uint8Array) {
  const user = process.env.GMAIL_USER?.trim();
  const pass = process.env.GMAIL_APP_PASSWORD?.trim();

  if (!user || !pass) {
    throw new Error("Missing GMAIL_USER or GMAIL_APP_PASSWORD environment variable.");
  }

  const to = payload.engineer_email || getFallbackEngineerEmailForCar(payload.car_id);

  if (!to) {
    throw new Error("No recipients defined for this plank legality report.");
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user,
      pass,
    },
  });

  const subject = `Plank Legality - ${payload.car_name} - ${payload.session} - ${payload.circuit} - ${statusLabel(payload.status)}`;

  const html = `
    <div style="font-family:Arial,sans-serif;color:#111;line-height:1.45">
      <h2 style="margin:0 0 8px">Plank Legality Report</h2>
      <p style="margin:0 0 18px;color:#555">A PDF copy of the plank legality report is attached.</p>

      <table style="border-collapse:collapse;width:100%;max-width:760px;border:1px solid #ddd">
        <tr>
          <td style="padding:9px 10px;font-weight:bold;border-bottom:1px solid #eee;width:180px">Car</td>
          <td style="padding:9px 10px;border-bottom:1px solid #eee">${escapeHtml(payload.car_name)}</td>
        </tr>
        <tr>
          <td style="padding:9px 10px;font-weight:bold;border-bottom:1px solid #eee">Driver</td>
          <td style="padding:9px 10px;border-bottom:1px solid #eee">${escapeHtml(payload.driver)}</td>
        </tr>
        <tr>
          <td style="padding:9px 10px;font-weight:bold;border-bottom:1px solid #eee">Circuit / Session</td>
          <td style="padding:9px 10px;border-bottom:1px solid #eee">${escapeHtml(payload.circuit)} · ${escapeHtml(payload.session)}</td>
        </tr>
        <tr>
          <td style="padding:9px 10px;font-weight:bold;border-bottom:1px solid #eee">Result</td>
          <td style="padding:9px 10px;border-bottom:1px solid #eee">${escapeHtml(statusLabel(payload.status))}</td>
        </tr>
        <tr>
          <td style="padding:9px 10px;font-weight:bold;border-bottom:1px solid #eee">Lowest Reading</td>
          <td style="padding:9px 10px;border-bottom:1px solid #eee">${escapeHtml(formatMm(payload.minimum_thickness_mm))}</td>
        </tr>
        <tr>
          <td style="padding:9px 10px;font-weight:bold;border-bottom:1px solid #eee">Failed Holes</td>
          <td style="padding:9px 10px;border-bottom:1px solid #eee">${escapeHtml(payload.failed_holes)}</td>
        </tr>
        <tr>
          <td style="padding:9px 10px;font-weight:bold">Engineer</td>
          <td style="padding:9px 10px">${escapeHtml(payload.engineer_name)} · ${escapeHtml(to)}</td>
        </tr>
      </table>

      ${payload.notes ? `<p style="margin-top:18px"><strong>Notes:</strong><br>${escapeHtml(payload.notes)}</p>` : ""}
    </div>
  `;

  await transporter.sendMail({
    from: user,
    to,
    subject,
    html,
    attachments: [
      {
        filename: `plank-legality-car-${payload.car_id}-${payload.session || "session"}.pdf`.replace(/\s+/g, "-"),
        content: Buffer.from(pdfBytes),
        contentType: "application/pdf",
      },
    ],
  });

  return to;
}

export async function POST(request: NextRequest) {
  const unauthorised = blockUnauthorisedUser(request);

  if (unauthorised) {
    return unauthorised;
  }

  let payload: PlankLegalityEmailPayload;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      {
        error: "Invalid JSON payload.",
      },
      { status: 400 },
    );
  }

  const normalisedPayload = normalisePayload(payload);

  if (!normalisedPayload.engineer_email) {
    return NextResponse.json(
      {
        error: "No valid engineer recipient email was found.",
        likely_cause:
          "The selected car did not provide engineer_email, and no fallback email is configured.",
        fix:
          "Check NEXT_PUBLIC_DRAIN_OUT_ENGINEER_EMAIL_CAR_X and DRAIN_OUT_ENGINEER_EMAIL_CAR_X in Vercel/.env.local.",
      },
      { status: 400 },
    );
  }

  if (normalisedPayload.holes.length === 0) {
    return NextResponse.json(
      {
        error: "No plank hole measurements were provided.",
      },
      { status: 400 },
    );
  }

  try {
    const pdfBytes = await buildPlankLegalityPdf(normalisedPayload);

    if (payload.download_only) {
      return new NextResponse(Buffer.from(pdfBytes), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="plank-legality-car-${normalisedPayload.car_id}.pdf"`,
        },
      });
    }

    const sentTo = await sendEmail(normalisedPayload, pdfBytes);

    return NextResponse.json({
      ok: true,
      sent_to: sentTo,
      engineer_name: normalisedPayload.engineer_name,
    });
  } catch (error) {
    const technicalError = error instanceof Error ? error.message : String(error);
    const friendly = buildFriendlyEmailError(technicalError);

    return NextResponse.json(
      {
        ...friendly,
        technical_error: technicalError,
      },
      { status: 500 },
    );
  }
}
