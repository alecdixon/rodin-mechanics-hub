import { NextResponse } from "next/server";
import nodemailer from "nodemailer";

export const runtime = "nodejs";

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

  // Selected from the mechanic dropdown
  engineer_name?: string | null;
  engineer_email?: string | null;
};

function clean(value: string | null | undefined) {
  return value?.trim() || "";
}

function getFallbackEngineerEmailForCar(carId: number) {
  const specific = process.env[`DRAIN_OUT_ENGINEER_EMAIL_CAR_${carId}`];

  if (specific && specific.trim()) {
    return specific.trim();
  }

  return process.env.DRAIN_OUT_ENGINEER_EMAIL?.trim() || "";
}

function escapeHtml(value: string | number | null | undefined) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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
        "Gmail rejected the SMTP username/password. This normally means GMAIL_USER and GMAIL_APP_PASSWORD do not match.",
      likely_cause:
        "The app password was generated from a different Google account, the wrong Gmail address is in GMAIL_USER, the app password was copied incorrectly, or the normal Gmail password is being used instead of a Google App Password.",
      fix:
        "Log into the exact Google account used in GMAIL_USER, create a new 16-character App Password, paste it into GMAIL_APP_PASSWORD with no spaces, save the Vercel variables, then redeploy.",
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
      likely_cause:
        "Google does not currently trust this SMTP login from Vercel. This can happen even when the app password is correct.",
      fix:
        "Open a normal browser, log into the Gmail account used in GMAIL_USER, open Gmail, approve any 'Was this you?' or security warning, then redeploy Vercel and test again. If it keeps happening, switch the drain-out notification route to Resend because Gmail SMTP is unreliable from serverless deployments.",
    };
  }

  if (
    lower.includes("invalid login") ||
    lower.includes("authentication failed") ||
    lower.includes("auth")
  ) {
    return {
      error:
        "The SMTP login failed before the email could be sent.",
      likely_cause:
        "The Gmail credentials are wrong, the app password has been revoked, the account has extra security blocking SMTP, or the environment variables were changed but the project was not redeployed.",
      fix:
        "Check GMAIL_USER, regenerate GMAIL_APP_PASSWORD from that exact account, save the Vercel variables, then redeploy.",
    };
  }

  if (
    lower.includes("no recipients defined") ||
    lower.includes("recipient") ||
    lower.includes("invalid address")
  ) {
    return {
      error:
        "The email could not be sent because no valid engineer recipient address was found.",
      likely_cause:
        "The mechanic dropdown did not send engineer_email, or the fallback Vercel variables are missing.",
      fix:
        "Check the selected engineer email on the drain-out page. Also check DRAIN_OUT_ENGINEER_EMAIL_CAR_X and DRAIN_OUT_ENGINEER_EMAIL in Vercel.",
    };
  }

  if (
    lower.includes("connection") ||
    lower.includes("timeout") ||
    lower.includes("etimedout") ||
    lower.includes("econnrefused") ||
    lower.includes("enotfound")
  ) {
    return {
      error:
        "The app could not connect to Gmail SMTP.",
      likely_cause:
        "Gmail SMTP may be temporarily unavailable, blocked, rate-limited, or unreachable from the Vercel serverless function.",
      fix:
        "Try again after redeploying. If the issue repeats, use Resend or another transactional email provider instead of Gmail SMTP.",
    };
  }

  return {
    error:
      "Drain out notification failed while trying to send the engineer email.",
    likely_cause:
      "The drain-out report may have been saved, but the email notification failed in the API route.",
    fix:
      "Check the technical_error value below, then verify Gmail/Vercel environment variables and redeploy.",
  };
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as DrainOutPayload;

    if (
      !payload.car_id ||
      !payload.rig ||
      payload.drain_out_figure === undefined
    ) {
      return NextResponse.json(
        {
          error: "Missing drain out payload fields.",
          details:
            "The request must include car_id, rig and drain_out_figure.",
        },
        { status: 400 },
      );
    }

    const gmailUser = process.env.GMAIL_USER?.trim();
    const gmailAppPassword = process.env.GMAIL_APP_PASSWORD?.replace(/\s/g, "");

    if (!gmailUser) {
      return NextResponse.json(
        {
          error: "GMAIL_USER is not configured in Vercel.",
          details:
            "Add GMAIL_USER to the Vercel environment variables. This must be the Gmail address that generated the Google App Password.",
        },
        { status: 500 },
      );
    }

    if (!gmailAppPassword) {
      return NextResponse.json(
        {
          error: "GMAIL_APP_PASSWORD is not configured in Vercel.",
          details:
            "Add GMAIL_APP_PASSWORD to the Vercel environment variables. Use a Google App Password, not the normal Gmail password.",
        },
        { status: 500 },
      );
    }

    const selectedEngineerEmail = clean(payload.engineer_email);
    const fallbackEngineerEmail = getFallbackEngineerEmailForCar(
      Number(payload.car_id),
    );

    const to = selectedEngineerEmail || fallbackEngineerEmail;

    if (!to) {
      return NextResponse.json(
        {
          error:
            "No engineer email selected and no fallback engineer email is configured.",
          details: `The page did not send engineer_email, and no fallback was found for car ${payload.car_id}.`,
          fix: `Add DRAIN_OUT_ENGINEER_EMAIL_CAR_${payload.car_id} or DRAIN_OUT_ENGINEER_EMAIL in Vercel, or check that the mechanic dropdown is sending engineer_email.`,
        },
        { status: 500 },
      );
    }

    const engineerName = clean(payload.engineer_name) || "Selected Engineer";
    const carLabel = payload.car_name || `Car ${payload.car_id}`;
    const units = payload.units || "kg";
    const figure = `${payload.drain_out_figure} ${units}`.trim();
    const submittedAt = payload.created_at || new Date().toISOString();
    const notes = payload.notes || "-";

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
        `Sent to: ${engineerName} <${to}>`,
        "",
        `Car: ${carLabel}`,
        `Car ID: ${payload.car_id}`,
        `Rig: ${payload.rig}`,
        `Drain out figure: ${figure}`,
        `Submitted by: ${payload.created_by || "Unknown"}`,
        `Submitted at: ${submittedAt}`,
        "",
        `Notes: ${notes}`,
      ].join("\n"),
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111">
          <div style="max-width:680px;border:1px solid #ddd;border-radius:12px;overflow:hidden">
            <div style="background:#111827;color:white;padding:18px 22px">
              <h2 style="margin:0;font-size:22px">Drain Out Report</h2>
              <p style="margin:6px 0 0;color:#d1d5db">
                ${escapeHtml(carLabel)} · ${escapeHtml(payload.rig)} · ${escapeHtml(figure)}
              </p>
            </div>

            <div style="padding:20px 22px">
              <table style="border-collapse:collapse;width:100%;font-size:14px">
                <tr>
                  <td style="padding:8px 10px;font-weight:bold;border-bottom:1px solid #eee;width:170px">Engineer</td>
                  <td style="padding:8px 10px;border-bottom:1px solid #eee">${escapeHtml(engineerName)}</td>
                </tr>
                <tr>
                  <td style="padding:8px 10px;font-weight:bold;border-bottom:1px solid #eee">Engineer Email</td>
                  <td style="padding:8px 10px;border-bottom:1px solid #eee">${escapeHtml(to)}</td>
                </tr>
                <tr>
                  <td style="padding:8px 10px;font-weight:bold;border-bottom:1px solid #eee">Car</td>
                  <td style="padding:8px 10px;border-bottom:1px solid #eee">${escapeHtml(carLabel)}</td>
                </tr>
                <tr>
                  <td style="padding:8px 10px;font-weight:bold;border-bottom:1px solid #eee">Car ID</td>
                  <td style="padding:8px 10px;border-bottom:1px solid #eee">${escapeHtml(payload.car_id)}</td>
                </tr>
                <tr>
                  <td style="padding:8px 10px;font-weight:bold;border-bottom:1px solid #eee">Rig</td>
                  <td style="padding:8px 10px;border-bottom:1px solid #eee">${escapeHtml(payload.rig)}</td>
                </tr>
                <tr>
                  <td style="padding:8px 10px;font-weight:bold;border-bottom:1px solid #eee">Drain Out Figure</td>
                  <td style="padding:8px 10px;border-bottom:1px solid #eee"><strong>${escapeHtml(figure)}</strong></td>
                </tr>
                <tr>
                  <td style="padding:8px 10px;font-weight:bold;border-bottom:1px solid #eee">Submitted By</td>
                  <td style="padding:8px 10px;border-bottom:1px solid #eee">${escapeHtml(payload.created_by || "Unknown")}</td>
                </tr>
                <tr>
                  <td style="padding:8px 10px;font-weight:bold;border-bottom:1px solid #eee">Submitted At</td>
                  <td style="padding:8px 10px;border-bottom:1px solid #eee">${escapeHtml(submittedAt)}</td>
                </tr>
                <tr>
                  <td style="padding:8px 10px;font-weight:bold;vertical-align:top">Notes</td>
                  <td style="padding:8px 10px">${escapeHtml(notes)}</td>
                </tr>
              </table>
            </div>
          </div>
        </div>
      `,
    });

    return NextResponse.json({
      ok: true,
      sent_to: to,
      engineer_name: engineerName,
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
          note:
            "Vercel hides saved environment variable values, so blank-looking/hidden values in the dashboard do not necessarily mean they disappeared. Environment variable changes only apply after redeploying.",
        },
      },
      { status: 500 },
    );
  }
}