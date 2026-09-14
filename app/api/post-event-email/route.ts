import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { canAccessCarPages, canEditPostEvent } from "@/lib/userAccess";
import {
  buildPostEventRecipients,
  parseAdditionalRecipients,
} from "@/lib/postEventEmail";

export const runtime = "nodejs";

type AuthUser = {
  email?: string;
  user_metadata?: { full_name?: string; name?: string };
};

type PostEventEmailPayload = {
  car_id?: number;
  circuit?: string;
  post_event_date?: string;
  submitted_at?: string;
  additional_recipients?: string[];
  pdf_base64?: string;
  pdf_filename?: string;
};

function cleanHeaderValue(value: string | undefined, fallback: string) {
  return (value ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, 200) || fallback;
}

async function getAuthenticatedUser(request: NextRequest): Promise<AuthUser | null> {
  const authorization = request.headers.get("authorization");
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!authorization?.startsWith("Bearer ") || !supabaseUrl || !anonKey) return null;

  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: authorization, apikey: anonKey },
      cache: "no-store",
    });

    if (!response.ok) return null;
    return (await response.json()) as AuthUser;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser(request);
    const email = user?.email?.trim().toLowerCase() ?? "";
    const payload = (await request.json()) as PostEventEmailPayload;
    const carId = Number(payload.car_id);

    if (
      !email ||
      !Number.isInteger(carId) ||
      !canEditPostEvent(email) ||
      !canAccessCarPages(email, carId)
    ) {
      return NextResponse.json(
        { error: "You do not have permission to email this Post Event sheet." },
        { status: 403 },
      );
    }

    const circuit = cleanHeaderValue(payload.circuit, "Circuit not supplied");
    const postEventDate = cleanHeaderValue(payload.post_event_date, "Date not supplied");
    const submittedAt = payload.submitted_at && !Number.isNaN(Date.parse(payload.submitted_at))
      ? new Date(payload.submitted_at).toLocaleString("en-GB")
      : "Timestamp not supplied";
    const additional = Array.isArray(payload.additional_recipients)
      ? payload.additional_recipients.join(",")
      : "";
    const parsed = parseAdditionalRecipients(additional);

    if (parsed.invalid.length > 0) {
      return NextResponse.json(
        { error: `Invalid additional email address${parsed.invalid.length === 1 ? "" : "es"}: ${parsed.invalid.join(", ")}` },
        { status: 400 },
      );
    }

    if (!payload.pdf_base64 || payload.pdf_base64.length > 14_000_000) {
      return NextResponse.json({ error: "The Post Event PDF is missing or too large." }, { status: 400 });
    }

    const pdfBuffer = Buffer.from(payload.pdf_base64, "base64");
    if (pdfBuffer.length < 5 || pdfBuffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
      return NextResponse.json({ error: "The Post Event PDF attachment is invalid." }, { status: 400 });
    }

    const gmailUser = process.env.GMAIL_USER?.trim();
    const gmailAppPassword = process.env.GMAIL_APP_PASSWORD?.replace(/\s/g, "");
    if (!gmailUser || !gmailAppPassword) {
      return NextResponse.json({ error: "Post Event email is not configured." }, { status: 500 });
    }

    const recipients = buildPostEventRecipients(parsed.recipients);
    const submittedBy = cleanHeaderValue(
      user?.user_metadata?.full_name || user?.user_metadata?.name || email,
      email,
    );
    const carLabel = `Car ${carId}`;
    const filename = cleanHeaderValue(payload.pdf_filename, `car-${carId}-post-event.pdf`)
      .replace(/[^a-z0-9._-]+/gi, "-");

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: gmailUser, pass: gmailAppPassword },
    });

    const result = await transporter.sendMail({
      from: `"Post Event Sheets" <${gmailUser}>`,
      to: recipients,
      subject: `Post Event Sheet - ${carLabel} - ${circuit} - ${postEventDate}`,
      text: [
        "Post Event Sheet",
        "",
        `Car: ${carLabel}`,
        `Circuit: ${circuit}`,
        `Post Event date: ${postEventDate}`,
        `Submitted: ${submittedAt}`,
        `Submitted by: ${submittedBy}`,
        "",
        "The submitted Post Event sheet is attached as a PDF.",
      ].join("\n"),
      attachments: [{ filename, content: pdfBuffer, contentType: "application/pdf" }],
    });

    const accepted = Array.isArray(result.accepted) ? result.accepted.map(String) : [];
    const rejected = Array.isArray(result.rejected) ? result.rejected.map(String) : [];
    if (accepted.length === 0 || rejected.length > 0) {
      return NextResponse.json(
        { error: "The Post Event email was rejected by the mail server.", accepted, rejected },
        { status: 502 },
      );
    }

    return NextResponse.json({ success: true, sent_to: recipients });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Post Event email failed." },
      { status: 500 },
    );
  }
}
