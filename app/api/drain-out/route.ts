import { NextResponse } from "next/server";
import nodemailer from "nodemailer";

type DrainOutPayload = {
  id?: string;
  car_id: number;
  car_name?: string | null;
  rig: string;
  drain_out_figure: number;
  units: string;
  notes?: string | null;
  created_by?: string | null;
  created_at?: string | null;
};

function getEngineerEmailForCar(carId: number) {
  const specific = process.env[`DRAIN_OUT_ENGINEER_EMAIL_CAR_${carId}`];

  if (specific && specific.trim()) {
    return specific.trim();
  }

  return process.env.DRAIN_OUT_ENGINEER_EMAIL || "";
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as DrainOutPayload;

    if (!payload.car_id || !payload.rig || payload.drain_out_figure === undefined) {
      return NextResponse.json(
        { error: "Missing drain out payload fields." },
        { status: 400 }
      );
    }

    const gmailUser = process.env.GMAIL_USER;
    const gmailAppPassword = process.env.GMAIL_APP_PASSWORD;

    if (!gmailUser) {
      return NextResponse.json(
        { error: "GMAIL_USER is not configured in Vercel." },
        { status: 500 }
      );
    }

    if (!gmailAppPassword) {
      return NextResponse.json(
        { error: "GMAIL_APP_PASSWORD is not configured in Vercel." },
        { status: 500 }
      );
    }

    const to = getEngineerEmailForCar(Number(payload.car_id));

    if (!to) {
      return NextResponse.json(
        {
          error: `No drain out engineer email configured for car ${payload.car_id}. Add DRAIN_OUT_ENGINEER_EMAIL_CAR_${payload.car_id} in Vercel.`,
        },
        { status: 500 }
      );
    }

    const carLabel = payload.car_name || `Car ${payload.car_id}`;
    const figure = `${payload.drain_out_figure} ${payload.units || "kg"}`.trim();

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: gmailUser,
        pass: gmailAppPassword,
      },
    });

    await transporter.sendMail({
      from: `"Drain Out Reports" <${gmailUser}>`,
      to,
      subject: `Drain Out Report - ${carLabel} - ${payload.rig} - ${figure}`,
      text: [
        "Drain Out Report",
        "",
        `Car: ${carLabel}`,
        `Car ID: ${payload.car_id}`,
        `Rig: ${payload.rig}`,
        `Drain out figure: ${figure}`,
        `Submitted by: ${payload.created_by || "Unknown"}`,
        `Submitted at: ${payload.created_at || new Date().toISOString()}`,
        "",
        `Notes: ${payload.notes || "-"}`,
      ].join("\n"),
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.5">
          <h2>Drain Out Report</h2>
          <table style="border-collapse:collapse">
            <tr><td style="padding:6px 12px;font-weight:bold">Car</td><td>${carLabel}</td></tr>
            <tr><td style="padding:6px 12px;font-weight:bold">Car ID</td><td>${payload.car_id}</td></tr>
            <tr><td style="padding:6px 12px;font-weight:bold">Rig</td><td>${payload.rig}</td></tr>
            <tr><td style="padding:6px 12px;font-weight:bold">Drain out figure</td><td><strong>${figure}</strong></td></tr>
            <tr><td style="padding:6px 12px;font-weight:bold">Submitted by</td><td>${payload.created_by || "Unknown"}</td></tr>
            <tr><td style="padding:6px 12px;font-weight:bold">Submitted at</td><td>${payload.created_at || new Date().toISOString()}</td></tr>
            <tr><td style="padding:6px 12px;font-weight:bold">Notes</td><td>${payload.notes || "-"}</td></tr>
          </table>
        </div>
      `,
    });

    return NextResponse.json({ ok: true, sent_to: to });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Drain out notification failed.",
      },
      { status: 500 }
    );
  }
}
