import { NextResponse } from "next/server";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

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

    if (!process.env.RESEND_API_KEY) {
      return NextResponse.json(
        { error: "RESEND_API_KEY is not configured." },
        { status: 500 }
      );
    }

    const to = getEngineerEmailForCar(Number(payload.car_id));
    const from = process.env.EMAIL_FROM || "Drain Out Reports <onboarding@resend.dev>";

    if (!to) {
      return NextResponse.json(
        {
          error: `No drain out engineer email configured for car ${payload.car_id}. Add DRAIN_OUT_ENGINEER_EMAIL_CAR_${payload.car_id} in Vercel.`,
        },
        { status: 500 }
      );
    }

    const carLabel = payload.car_name || `Car ${payload.car_id}`;
    const figure = `${payload.drain_out_figure} ${payload.units || ""}`.trim();

    const { error } = await resend.emails.send({
      from,
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

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

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
