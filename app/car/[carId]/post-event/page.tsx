"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { supabase } from "@/lib/supabase";
import {
  getAssignedCar,
  getUserRole,
  hasPermission,
} from "@/lib/userAccess";
import LogoutButton from "@/app/components/LogoutButton";

type PostEventForm = {
  post_event_date: string;
  track_name: string;
  chassis: string;
  driver: string;
  engine_no: string;
  hours_remaining: string;
  gearbox_no: string;
  fuel_drained_kg: string;
  front_ride_height: string;
  rear_ride_height: string;
  diff_break_off: string;
  diff_dynamic: string;
  notes: string;
};

const EMPTY_FORM: PostEventForm = {
  post_event_date: "",
  track_name: "",
  chassis: "",
  driver: "",
  engine_no: "",
  hours_remaining: "",
  gearbox_no: "",
  fuel_drained_kg: "",
  front_ride_height: "",
  rear_ride_height: "",
  diff_break_off: "",
  diff_dynamic: "",
  notes: "",
};

const CHECK_LABELS = {
  chassis: "Chassis", driver: "Driver", engine_no: "Engine No.",
  hours_remaining: "Hours Remaining", gearbox_no: "Gearbox No.",
  fuel_drained_kg: "Fuel Drained KG", front_ride_height: "Front Ride Height",
  rear_ride_height: "Rear Ride Height", diff_break_off: "Diff Break-Off",
  diff_dynamic: "Diff Dynamic", notes: "Notes",
} as const;

type SubmissionSnapshot = {
  version: 1;
  submitted_by: string;
  user_id: string;
  checks: { name: string; value: string }[];
};

type HistoricSheet = Partial<PostEventForm> & {
  id: string;
  car_id: number;
  created_by: string | null;
  created_at: string;
  submission_snapshot?: SubmissionSnapshot | null;
};

function newForm(): PostEventForm {
  const today = new Date();
  return { ...EMPTY_FORM, post_event_date: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}` };
}

function sheetDate(value?: string) {
  return value ? new Date(`${value}T12:00:00`).toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric",
  }) : "Date not recorded";
}

async function fetchHistory(carId: number): Promise<HistoricSheet[]> {
  const sheets: HistoricSheet[] = [];
  // Fetch every page, including cars with more than Supabase's response limit.
  const pageSize = 100;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.from("post_event_sheets")
      .select("*").eq("car_id", carId)
      .order("created_at", { ascending: false }).order("id", { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error(error.message);
    sheets.push(...(data as HistoricSheet[]));
    if (data.length < pageSize) return sheets;
  }
}

async function generatePostEventPdf({
  carId,
  form,
  userEmail,
}: {
  carId: number;
  form: PostEventForm;
  userEmail: string;
}) {
  const pdfDoc = await PDFDocument.create();

  const page = pdfDoc.addPage([595.28, 841.89]);
  const { width, height } = page.getSize();

  const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const red = rgb(0.72, 0.11, 0.11);
  const dark = rgb(0.08, 0.09, 0.1);
  const grey = rgb(0.35, 0.35, 0.35);

  let y = height - 60;

  function drawText(
    text: string,
    x: number,
    yPos: number,
    size = 11,
    font = regularFont,
    colour = dark,
  ) {
    page.drawText(text || "-", {
      x,
      y: yPos,
      size,
      font,
      color: colour,
    });
  }

  function drawField(label: string, value: string, x: number, yPos: number) {
    drawText(label.toUpperCase(), x, yPos, 8, boldFont, grey);

    page.drawRectangle({
      x,
      y: yPos - 34,
      width: 245,
      height: 26,
      borderColor: rgb(0.75, 0.75, 0.75),
      borderWidth: 1,
    });

    drawText(value || "-", x + 8, yPos - 26, 11, regularFont, dark);
  }

  page.drawRectangle({
    x: 0,
    y: height - 90,
    width,
    height: 90,
    color: rgb(0.06, 0.07, 0.08),
  });

  drawText("RODIN MOTORSPORT", 40, height - 35, 10, boldFont, red);
  drawText(
    `Car ${carId} Post-Event Sheet`,
    40,
    height - 62,
    24,
    boldFont,
    rgb(1, 1, 1),
  );

  drawText(
    `Generated: ${new Date().toLocaleString("en-GB")}`,
    40,
    height - 82,
    9,
    regularFont,
    rgb(0.75, 0.75, 0.75),
  );

  y -= 120;

  drawField("Chassis", form.chassis, 40, y);
  drawField("Driver", form.driver, 310, y);

  y -= 70;

  drawField("Engine No.", form.engine_no, 40, y);
  drawField("Hours Remaining", form.hours_remaining, 310, y);

  y -= 70;

  drawField("Gearbox No.", form.gearbox_no, 40, y);
  drawField("Fuel Drained KG", form.fuel_drained_kg, 310, y);

  y -= 70;

  drawField("Front Ride Height", form.front_ride_height, 40, y);
  drawField("Rear Ride Height", form.rear_ride_height, 310, y);

  y -= 70;

  drawField("Diff Break-Off", form.diff_break_off, 40, y);
  drawField("Diff Dynamic", form.diff_dynamic, 310, y);

  y -= 80;

  drawText("NOTES", 40, y, 9, boldFont, grey);

  page.drawRectangle({
    x: 40,
    y: y - 145,
    width: 515,
    height: 130,
    borderColor: rgb(0.75, 0.75, 0.75),
    borderWidth: 1,
  });

  const notes = form.notes || "-";
  const maxCharsPerLine = 85;
  const noteLines = notes.match(new RegExp(`.{1,${maxCharsPerLine}}`, "g")) ?? [
    "-",
  ];

  let noteY = y - 35;

  noteLines.slice(0, 7).forEach((line) => {
    drawText(line, 52, noteY, 10, regularFont, dark);
    noteY -= 16;
  });

  y -= 190;

  drawText("Created By", 40, y, 9, boldFont, grey);
  drawText(userEmail || "Unknown", 40, y - 18, 10, regularFont, dark);

  drawText("Car ID", 310, y, 9, boldFont, grey);
  drawText(String(carId), 310, y - 18, 10, regularFont, dark);

  page.drawLine({
    start: { x: 40, y: 70 },
    end: { x: 555, y: 70 },
    thickness: 1,
    color: rgb(0.8, 0.8, 0.8),
  });

  drawText(
    "Post-event sheet generated by Rodin Motorsport Mechanics Hub",
    40,
    50,
    8,
    regularFont,
    grey,
  );

  const eventPage = pdfDoc.addPage([595.28, 841.89]);
  eventPage.drawText("Post-Event Details", { x: 40, y: 790, size: 20, font: boldFont });
  eventPage.drawText(`Car ${carId} | Date: ${form.post_event_date}`, { x: 40, y: 755, size: 11, font: regularFont });
  eventPage.drawText("After Event", { x: 40, y: 725, size: 11, font: boldFont });
  eventPage.drawText(form.track_name, { x: 40, y: 700, size: 11, font: regularFont, maxWidth: 515, lineHeight: 16 });
  return pdfDoc.save();
}

export default function PostEventSheetPage() {
  const params = useParams();
  const router = useRouter();

  const carId = Number(params.carId);

  const [form, setForm] = useState<PostEventForm>(newForm);
  const [history, setHistory] = useState<HistoricSheet[]>([]);
  const [historyError, setHistoryError] = useState("");
  const [selectedSheet, setSelectedSheet] = useState<HistoricSheet | null>(null);
  const [userEmail, setUserEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadingLatest, setLoadingLatest] = useState(true);
  const [canEditPostEvent, setCanEditPostEvent] = useState(false);

  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const completionPercent = useMemo(() => {
    const requiredFields = [
      form.chassis,
      form.driver,
      form.engine_no,
      form.hours_remaining,
      form.gearbox_no,
      form.fuel_drained_kg,
      form.front_ride_height,
      form.rear_ride_height,
      form.diff_break_off,
      form.diff_dynamic,
    ];

    const filled = requiredFields.filter((value) => value.trim()).length;
    return Math.round((filled / requiredFields.length) * 100);
  }, [form]);

  async function checkAccess() {
    if (!Number.isFinite(carId)) {
      router.replace("/login");
      return null;
    }

    const { data: userData, error: userError } = await supabase.auth.getUser();

    if (userError || !userData.user?.email) {
      router.replace("/login");
      return null;
    }

    const email = userData.user.email.trim().toLowerCase();
    const role = getUserRole(email);
    const assignedCar = getAssignedCar(email);

    if (role === "number2_mechanic") {
      router.replace("/team-jobs");
      return null;
    }

    if (!hasPermission(email, "post_event:view")) {
      router.replace("/login");
      return null;
    }

    if (role === "number1_mechanic") {
      if (!assignedCar) {
        router.replace("/login");
        return null;
      }

      if (Number(assignedCar) !== carId) {
        router.replace(`/car/${assignedCar}/post-event`);
        return null;
      }
    }

    setCanEditPostEvent(hasPermission(email, "post_event:edit"));
    setUserEmail(email);

    return email;
  }

  useEffect(() => {
    async function init() {
      if (!carId) return;

      setLoadingLatest(true);
      setErrorMessage("");

      const email = await checkAccess();

      if (!email) {
        return;
      }

      setSelectedSheet(null);
      setHistory([]);
      setForm(newForm());
      setHistoryError("");
      try {
        const sheets = await fetchHistory(carId);
        setHistory(sheets);
        const latest = sheets[0];
        if (latest) {
          // Preserve the existing carry-forward of check values, with fresh event details.
          setForm({ ...newForm(), ...Object.fromEntries(
            Object.keys(CHECK_LABELS).map((key) => [key, String(latest[key as keyof typeof CHECK_LABELS] ?? "")]),
          ) });
        }
      } catch (error) {
        setHistoryError(error instanceof Error ? error.message : "Could not load previous sheets.");
      }

      setLoadingLatest(false);
    }

    init();

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carId]);

  function updateField(field: keyof PostEventForm, value: string) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function saveSheet() {
    if (!canEditPostEvent) {
      setErrorMessage("You do not have permission to save post-event sheets.");
      return;
    }

    if (saving) return;
    if (!form.post_event_date || !form.track_name.trim()) {
      setErrorMessage("Enter Date and After Event before saving.");
      return;
    }
    setSaving(true);
    setMessage("");
    setErrorMessage("");

    try {
      const email = await checkAccess();

      if (!email) {
        setSaving(false);
        return;
      }

      const { data: identity, error: identityError } = await supabase.auth.getUser();
      if (identityError || !identity.user) throw new Error("Could not verify the submitting user.");
      const submissionSnapshot: SubmissionSnapshot = {
        version: 1,
        user_id: identity.user.id,
        submitted_by: identity.user.user_metadata?.full_name || identity.user.user_metadata?.name || email,
        checks: Object.entries(CHECK_LABELS).map(([key, name]) => ({
          name, value: form[key as keyof typeof CHECK_LABELS],
        })),
      };
      const pdfBytes = await generatePostEventPdf({
        carId,
        form,
        userEmail: email,
      });

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

      const pdfFilename = `car-${carId}-post-event-${timestamp}.pdf`;
      const pdfPath = `car-${carId}/${pdfFilename}`;

      const { error: uploadError } = await supabase.storage
        .from("post-event-sheets")
        .upload(pdfPath, pdfBytes, {
          contentType: "application/pdf",
          upsert: false,
        });

      if (uploadError) {
        throw new Error(uploadError.message);
      }

      const { error: insertError } = await supabase
        .from("post_event_sheets")
        .insert({
          car_id: carId,
          post_event_date: form.post_event_date,
          track_name: form.track_name.trim(),
          submission_snapshot: submissionSnapshot,
          chassis: form.chassis.trim(),
          driver: form.driver.trim(),
          engine_no: form.engine_no.trim(),
          hours_remaining: form.hours_remaining.trim(),
          gearbox_no: form.gearbox_no.trim(),
          fuel_drained_kg: form.fuel_drained_kg.trim(),
          front_ride_height: form.front_ride_height.trim(),
          rear_ride_height: form.rear_ride_height.trim(),
          diff_break_off: form.diff_break_off.trim(),
          diff_dynamic: form.diff_dynamic.trim(),
          notes: form.notes.trim(),
          created_by: email || null,
          created_at: new Date().toISOString(),
          pdf_path: pdfPath,
          pdf_filename: pdfFilename,
        });

      if (insertError) {
        throw new Error(insertError.message);
      }

      setMessage("Post-event sheet saved as a new submission and PDF successfully.");
      try {
        setHistory(await fetchHistory(carId));
        setHistoryError("");
      } catch (error) {
        setHistoryError(`Sheet saved, but history could not refresh: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Failed to save post-event PDF.",
      );
    }

    setSaving(false);
  }

  function clearForm() {
    if (!canEditPostEvent) {
      setErrorMessage("You do not have permission to clear this form.");
      return;
    }

    const confirmed = window.confirm(
      "Clear the current post-event sheet on screen? This will not delete saved records.",
    );

    if (!confirmed) return;

    setForm(newForm());
    setMessage("");
    setErrorMessage("");
  }

  if (loadingLatest) {
    return (
      <main className="min-h-screen min-w-0 bg-[#0d0f12] p-3 text-zinc-100 [overflow-wrap:anywhere] sm:p-6">
        <div className="rounded-3xl border border-zinc-800 bg-[#14181d] p-6">
          Loading post-event sheet...
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen min-w-0 bg-[#0d0f12] p-3 text-zinc-100 [overflow-wrap:anywhere] sm:p-6">
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4 rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-red-400">
            Rodin Motorsport
          </p>

          <h1 className="mt-3 text-4xl font-semibold tracking-tight">
            Car {carId} Post-Event Sheet
          </h1>

          <p className="mt-3 max-w-3xl text-sm text-zinc-400">
            Record the key post-event details for chassis, engine, gearbox, fuel
            drained, ride heights and diff checks.
          </p>

          {!canEditPostEvent && (
            <p className="mt-4 rounded-xl border border-yellow-800 bg-yellow-950/30 px-4 py-3 text-sm text-yellow-200">
              Your login can view this sheet, but cannot save or edit
              post-event records.
            </p>
          )}
        </div>

        <LogoutButton />
      </header>

      {message && (
        <div className="mb-6 rounded-2xl border border-green-800 bg-green-950/20 p-4 text-sm text-green-300">
          {message}
        </div>
      )}

      {errorMessage && (
        <div className="mb-6 rounded-2xl border border-red-900 bg-red-950/40 p-4 text-sm text-red-200">
          {errorMessage}
        </div>
      )}

      <section className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold">Event Details</h2>

              <p className="mt-1 text-sm text-zinc-500">
                Main post-event identity and running details.
              </p>
            </div>

            <div className="rounded-2xl border border-zinc-700 bg-[#0d0f12] px-5 py-3 text-right">
              <p className="text-xs uppercase tracking-[0.25em] text-zinc-500">
                Complete
              </p>

              <p className="text-2xl font-semibold text-red-400">
                {completionPercent}%
              </p>
            </div>
          </div>

          <div className="mb-4 grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
            <InputCard label="Date" type="date" value={form.post_event_date} disabled={!canEditPostEvent || saving} onChange={(value) => updateField("post_event_date", value)} />
            <InputCard label="After Event" value={form.track_name} disabled={!canEditPostEvent || saving} onChange={(value) => updateField("track_name", value)} />
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
            <InputCard
              label="Chassis"
              value={form.chassis}
              placeholder="#022"
              disabled={!canEditPostEvent || saving}
              onChange={(value) => updateField("chassis", value)}
            />

            <InputCard
              label="Driver"
              value={form.driver}
              placeholder="M. Rehm"
              disabled={!canEditPostEvent || saving}
              onChange={(value) => updateField("driver", value)}
            />

            <InputCard
              label="Engine No."
              value={form.engine_no}
              placeholder="Engine number"
              disabled={!canEditPostEvent || saving}
              onChange={(value) => updateField("engine_no", value)}
            />

            <InputCard
              label="Hours Remaining"
              value={form.hours_remaining}
              placeholder="0.0"
              disabled={!canEditPostEvent || saving}
              onChange={(value) => updateField("hours_remaining", value)}
            />

            <InputCard
              label="Gearbox No."
              value={form.gearbox_no}
              placeholder="Gearbox number"
              disabled={!canEditPostEvent || saving}
              onChange={(value) => updateField("gearbox_no", value)}
            />
          </div>
        </div>

        <div className="rounded-3xl border border-red-900/40 bg-[#181315] p-6 shadow-xl">
          <p className="text-xs uppercase tracking-[0.3em] text-red-300">
            Sheet Status
          </p>

          <div className="mt-6 h-3 overflow-hidden rounded-full bg-red-950/50">
            <div
              className="h-full rounded-full bg-red-600 transition-all"
              style={{ width: `${completionPercent}%` }}
            />
          </div>

          <p className="mt-4 text-sm text-zinc-400">
            Fill in the fields, then save the sheet. Each save creates a new
            timestamped post-event record.
          </p>

          <div className="mt-6 rounded-2xl border border-red-900/50 bg-[#0d0f12] p-4 text-sm text-zinc-400">
            <p>
              Car:{" "}
              <span className="font-semibold text-zinc-100">Car {carId}</span>
            </p>

            <p className="mt-1">
              User:{" "}
              <span className="font-semibold text-zinc-100">
                {userEmail || "Unknown"}
              </span>
            </p>
          </div>
        </div>
      </section>

      <section className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
          <div className="mb-5">
            <p className="text-xs uppercase tracking-[0.3em] text-red-400">
              Fuel
            </p>

            <h2 className="mt-2 text-2xl font-semibold">Fuel Drained</h2>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-[#0d0f12] p-5">
            <label className="block text-sm font-semibold text-zinc-300">
              Fuel Drained
            </label>

            <div className="mt-3 flex items-end gap-3">
              <input
                value={form.fuel_drained_kg}
                onChange={(event) =>
                  updateField("fuel_drained_kg", event.target.value)
                }
                disabled={!canEditPostEvent || saving}
                placeholder="0.00"
                inputMode="decimal"
                className="min-w-0 w-full rounded-xl border border-zinc-700 bg-[#111418] px-4 py-4 text-3xl font-semibold text-zinc-100 outline-none transition focus:border-red-500 disabled:cursor-not-allowed disabled:opacity-50"
              />

              <span className="shrink-0 pb-4 text-sm font-semibold uppercase tracking-widest text-zinc-500">
                KG
              </span>
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl lg:col-span-2">
          <div className="mb-5">
            <p className="text-xs uppercase tracking-[0.3em] text-red-400">
              Platform
            </p>

            <h2 className="mt-2 text-2xl font-semibold">Ride Heights</h2>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <InputCard
              label="Front Ride Height"
              value={form.front_ride_height}
              placeholder="Front ride height"
              disabled={!canEditPostEvent || saving}
              onChange={(value) => updateField("front_ride_height", value)}
            />

            <InputCard
              label="Rear Ride Height"
              value={form.rear_ride_height}
              placeholder="Rear ride height"
              disabled={!canEditPostEvent || saving}
              onChange={(value) => updateField("rear_ride_height", value)}
            />
          </div>
        </div>
      </section>

      <section className="mb-6 rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
        <div className="mb-5">
          <p className="text-xs uppercase tracking-[0.3em] text-red-400">
            Differential
          </p>

          <h2 className="mt-2 text-2xl font-semibold">Diff Checks</h2>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <InputCard
            label="Diff Break-Off"
            value={form.diff_break_off}
            placeholder="Value / comment"
            disabled={!canEditPostEvent || saving}
            onChange={(value) => updateField("diff_break_off", value)}
          />

          <InputCard
            label="Diff Dynamic"
            value={form.diff_dynamic}
            placeholder="Value / comment"
            disabled={!canEditPostEvent || saving}
            onChange={(value) => updateField("diff_dynamic", value)}
          />
        </div>
      </section>

      <section className="mb-6 rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
        <h2 className="text-2xl font-semibold">Notes</h2>

        <p className="mt-1 text-sm text-zinc-500">
          Add any extra comments, damage notes, mechanic observations or
          follow-up actions.
        </p>

        <textarea
          value={form.notes}
          onChange={(event) => updateField("notes", event.target.value)}
          disabled={!canEditPostEvent || saving}
          placeholder="Type post-event notes here..."
          rows={6}
          className="mt-5 w-full resize-none rounded-2xl border border-zinc-700 bg-[#0d0f12] px-4 py-4 text-sm text-zinc-100 outline-none transition focus:border-red-500 disabled:cursor-not-allowed disabled:opacity-50"
        />
      </section>

      <section className="rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold">Save Sheet</h2>

            <p className="mt-1 text-sm text-zinc-500">
              Saves this as a new post-event sheet record for Car {carId}.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={clearForm}
              disabled={!canEditPostEvent || saving}
              className="rounded-xl border border-zinc-700 px-5 py-3 text-sm font-semibold text-zinc-300 hover:border-red-500 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Clear Form
            </button>

            <button
              type="button"
              onClick={saveSheet}
              disabled={saving || !canEditPostEvent}
              className="rounded-xl bg-red-700 px-6 py-3 text-sm font-semibold text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Post-Event Sheet"}
            </button>
          </div>
        </div>
      </section>
      <section className="mt-6 min-w-0 rounded-3xl border border-zinc-800 bg-[#14181d] p-4 shadow-xl sm:p-6">
        <h2 className="text-2xl font-semibold">Previous Post-Event Sheets</h2>
        {historyError && <p role="alert" className="mt-4 break-words text-red-300">{historyError}</p>}
        {!historyError && history.length === 0 && <p className="mt-4 text-zinc-400">No previous sheets for this car.</p>}
        <div className="mt-4 grid min-w-0 grid-cols-1 gap-3">
          {history.map((sheet) => (
            <div key={sheet.id} className="min-w-0 rounded-2xl border border-zinc-700">
              <button type="button" aria-expanded={selectedSheet?.id === sheet.id}
                onClick={() => setSelectedSheet(selectedSheet?.id === sheet.id ? null : sheet)}
                className="w-full min-w-0 rounded-2xl p-4 text-left hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-red-500">
                <span className="block whitespace-pre-wrap break-words font-semibold [overflow-wrap:anywhere]">{sheet.track_name || "After Event not recorded"}</span>
                <span className="mt-1 block break-words text-sm text-zinc-400 [overflow-wrap:anywhere]">{sheetDate(sheet.post_event_date)} &middot; {sheet.submission_snapshot?.submitted_by || sheet.created_by || "Unknown mechanic"}</span>
              </button>
              {selectedSheet?.id === sheet.id && (
                <div className="min-w-0 border-t border-zinc-700 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="text-lg font-semibold">Car {sheet.car_id} &middot; Read-only submitted sheet</h3>
                    <button type="button" onClick={() => setSelectedSheet(null)} className="rounded-xl border border-zinc-600 px-5 py-3">Close</button>
                  </div>
                  <dl className="mt-4 grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
                    {[
                      { name: "After Event", value: sheet.track_name || "Not recorded" },
                      { name: "Date", value: sheetDate(sheet.post_event_date) },
                      { name: "Submitted by", value: sheet.submission_snapshot?.submitted_by || sheet.created_by || "Unknown mechanic" },
                      { name: "Submission timestamp", value: new Date(sheet.created_at).toLocaleString("en-GB") },
                      ...(sheet.submission_snapshot?.checks ?? Object.entries(CHECK_LABELS).map(([key, name]) => ({ name, value: String(sheet[key as keyof typeof CHECK_LABELS] ?? "") }))),
                    ].map(({ name, value }) => (
                      <div key={name} className="min-w-0 rounded-xl bg-[#0d0f12] p-3">
                        <dt className="break-words text-sm text-zinc-400">{name}</dt>
                        <dd className="mt-1 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{value || "Not recorded"}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

function InputCard({
  label,
  value,
  placeholder,
  type = "text",
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  type?: "text" | "date";
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block min-w-0 rounded-2xl border border-zinc-800 bg-[#0d0f12] p-4">
      <span className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">
        {label}
      </span>

      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="mt-3 min-w-0 w-full max-w-full [color-scheme:dark] border-none bg-transparent text-lg font-semibold text-zinc-100 outline-none placeholder:text-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
      />
    </label>
  );
}