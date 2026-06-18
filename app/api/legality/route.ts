import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from "pdf-lib";
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

async function buildLegalityPdf(payload: NormalisedLegalityEmailPayload) {
  const pdfDoc = await PDFDocument.create();
  const normalFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const pageSize: [number, number] = [595.28, 841.89];
  const margin = 42;
  const pageBottom = 46;
  let page: PDFPage = pdfDoc.addPage(pageSize);
  let y = 800;

  function addPage() {
    page = pdfDoc.addPage(pageSize);
    y = 800;
  }

  function ensureSpace(required: number) {
    if (y - required < pageBottom) {
      addPage();
    }
  }

  function drawText(
    text: string,
    x: number,
    size = 10,
    font: PDFFont = normalFont,
    colour = rgb(0.08, 0.08, 0.1),
  ) {
    page.drawText(text, {
      x,
      y,
      size,
      font,
      color: colour,
    });
  }

  function drawWrappedText(
    text: string,
    x: number,
    maxChars: number,
    size = 9,
    font: PDFFont = normalFont,
  ) {
    const lines = wrapText(text, maxChars);

    lines.forEach((line) => {
      ensureSpace(14);
      page.drawText(line, {
        x,
        y,
        size,
        font,
        color: rgb(0.08, 0.08, 0.1),
      });
      y -= 13;
    });
  }

  function drawLabelValue(label: string, value: string, x: number, labelWidth = 105) {
    ensureSpace(18);
    page.drawText(label, {
      x,
      y,
      size: 9,
      font: boldFont,
      color: rgb(0.32, 0.32, 0.36),
    });
    page.drawText(value || "—", {
      x: x + labelWidth,
      y,
      size: 10,
      font: normalFont,
      color: rgb(0.08, 0.08, 0.1),
    });
    y -= 18;
  }

  const illegalItems = payload.items.filter((item) => item.status === "illegal");
  const summary =
    illegalItems.length === 0
      ? `${payload.items.length}/${payload.items.length} legal`
      : `${illegalItems.length} illegal · ${payload.items.length - illegalItems.length} legal`;

  page.drawRectangle({
    x: 0,
    y: 760,
    width: pageSize[0],
    height: 82,
    color: rgb(0.06, 0.07, 0.08),
  });
  page.drawText("RODIN MOTORSPORT · GB3", {
    x: margin,
    y: 810,
    size: 10,
    font: boldFont,
    color: rgb(0.95, 0.27, 0.27),
  });
  page.drawText("Legality Check Report", {
    x: margin,
    y: 782,
    size: 24,
    font: boldFont,
    color: rgb(1, 1, 1),
  });
  page.drawText(summary, {
    x: 390,
    y: 787,
    size: 12,
    font: boldFont,
    color: illegalItems.length > 0 ? rgb(1, 0.35, 0.35) : rgb(0.35, 0.9, 0.5),
  });

  y = 730;
  drawLabelValue("Date", formatReportDate(payload.check_date), margin);
  drawLabelValue("Circuit", payload.circuit, margin);
  drawLabelValue("Car", payload.car_name || `Car ${payload.car_id}`, margin);
  drawLabelValue("Driver", payload.driver, margin);
  drawLabelValue("Engineer", payload.engineer_name, margin);
  drawLabelValue("Engineer Email", payload.engineer_email, margin);
  drawLabelValue("Submitted By", payload.created_by || "Unknown", margin);
  drawLabelValue("Check ID", payload.check_id || "—", margin);

  y -= 14;
  ensureSpace(42);
  page.drawText("Legality Items", {
    x: margin,
    y,
    size: 15,
    font: boldFont,
    color: rgb(0.08, 0.08, 0.1),
  });
  y -= 20;

  const tableX = margin;
  const colItem = tableX;
  const colSide = tableX + 90;
  const colStatus = tableX + 145;
  const colNote = tableX + 230;

  page.drawRectangle({
    x: tableX - 8,
    y: y - 5,
    width: 520,
    height: 22,
    color: rgb(0.93, 0.94, 0.95),
  });
  drawText("Item", colItem, 9, boldFont, rgb(0.08, 0.08, 0.1));
  drawText("Side", colSide, 9, boldFont, rgb(0.08, 0.08, 0.1));
  drawText("Status", colStatus, 9, boldFont, rgb(0.08, 0.08, 0.1));
  drawText("Note / Position", colNote, 9, boldFont, rgb(0.08, 0.08, 0.1));
  y -= 22;

  payload.items.forEach((item) => {
    const note = item.status === "illegal" ? item.illegal_note || "Missing note" : item.item_position;
    const noteLines = wrapText(note, 48);
    const rowHeight = Math.max(28, noteLines.length * 12 + 12);

    ensureSpace(rowHeight + 6);

    page.drawLine({
      start: { x: tableX - 8, y: y + 8 },
      end: { x: tableX + 512, y: y + 8 },
      thickness: 0.6,
      color: rgb(0.83, 0.84, 0.86),
    });

    drawText(item.item_name, colItem, 9, boldFont);
    drawText(item.item_side || "—", colSide, 9, normalFont);
    drawText(
      item.status.toUpperCase(),
      colStatus,
      9,
      boldFont,
      item.status === "illegal" ? rgb(0.75, 0.08, 0.08) : rgb(0.05, 0.5, 0.18),
    );

    let noteY = y;
    noteLines.forEach((line) => {
      page.drawText(line, {
        x: colNote,
        y: noteY,
        size: 8.5,
        font: normalFont,
        color: rgb(0.08, 0.08, 0.1),
      });
      noteY -= 11;
    });

    y -= rowHeight;
  });

  if (illegalItems.length > 0) {
    y -= 12;
    ensureSpace(44);
    page.drawText("Illegal Item Notes", {
      x: margin,
      y,
      size: 15,
      font: boldFont,
      color: rgb(0.75, 0.08, 0.08),
    });
    y -= 22;

    illegalItems.forEach((item) => {
      ensureSpace(48);
      drawText(`${item.item_name}:`, margin, 10, boldFont, rgb(0.75, 0.08, 0.08));
      y -= 14;
      drawWrappedText(item.illegal_note || "Missing note", margin + 18, 75, 9, normalFont);
      y -= 6;
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
