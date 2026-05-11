"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { supabase } from "@/lib/supabase";

type PlateRow = {
  no: number;
  a: string;
  b: string;
  c: string;
};

type ClutchMeasurementRecord = {
  id?: string;
  car_id: number;
  car_name?: string | null;
  serial_no?: string | null;
  clutch_no?: string | null;
  job_id_no?: string | null;
  measurement_date?: string | null;
  distance_km?: number | null;
  driven_plates?: PlateRow[] | null;
  intermediate_plates?: PlateRow[] | null;
  original_stack_height?: number | null;
  present_stack_height?: number | null;
  wear_mm?: number | null;
  recommended_shim?: string | null;
  clutch_status?: string | null;
  current_shim_installed?: string | null;
  notes?: string | null;
  pdf_path?: string | null;
  created_by?: string | null;
  created_at?: string | null;
};

const PDF_BUCKET = "clutch-measurement-pdfs";

const EMPTY_DRIVEN_PLATES: PlateRow[] = [
  { no: 1, a: "", b: "", c: "" },
  { no: 2, a: "", b: "", c: "" },
];

const EMPTY_INTERMEDIATE_PLATES: PlateRow[] = [
  { no: 1, a: "", b: "", c: "" },
  { no: 2, a: "", b: "", c: "" },
  { no: 3, a: "", b: "", c: "" },
];

function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mean(row: PlateRow): number | null {
  const values = [toNumber(row.a), toNumber(row.b), toNumber(row.c)].filter(
    (v): v is number => v !== null
  );

  if (values.length === 0) return null;

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function backlash(row: PlateRow): number | null {
  const values = [toNumber(row.a), toNumber(row.b), toNumber(row.c)].filter(
    (v): v is number => v !== null
  );

  if (values.length < 2) return null;

  return Math.max(...values) - Math.min(...values);
}

function fmt(value: number | null | undefined, decimals = 3) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  return value.toFixed(decimals);
}

function getRecommendedShim(wear: number | null): string {
  if (wear === null) return "";
  const absWear = Math.abs(wear);

  if (absWear < 0.2) return "0.00 mm";
  if (absWear < 0.4) return "0.25 mm";
  if (absWear < 0.7) return "0.50 mm";
  if (absWear < 0.9) return "0.75 mm";
  if (absWear < 1.2) return "1.00 mm";
  if (absWear < 1.4) return "1.25 mm";
  if (absWear < 1.7) return "1.50 mm";
  if (absWear < 1.9) return "1.75 mm";
  if (absWear < 2.2) return "2.00 mm";
  if (absWear < 2.4) return "2.25 mm";
  if (absWear < 2.7) return "2.50 mm";
  if (absWear < 2.9) return "2.75 mm";
  if (absWear < 3.2) return "3.00 mm";
  if (absWear < 3.4) return "3.25 mm";
  if (absWear < 3.9) return "3.50 mm";

  return "END OF CLUTCH LIFE";
}

function getStatus(wear: number | null): string {
  if (wear === null) return "";
  const absWear = Math.abs(wear);

  if (absWear > 4) return "NO-GO";
  if (absWear > 3.25) return "SERVICE SOON";
  return "OK";
}

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function safeFilePart(value: string) {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9-_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

async function buildPdf({
  carId,
  carName,
  serialNo,
  clutchNo,
  jobIdNo,
  measurementDate,
  distanceKm,
  drivenPlates,
  intermediatePlates,
  originalStackHeight,
  presentStackHeight,
  wearMm,
  recommendedShim,
  clutchStatus,
  currentShimInstalled,
  notes,
  createdBy,
}: {
  carId: number;
  carName: string;
  serialNo: string;
  clutchNo: string;
  jobIdNo: string;
  measurementDate: string;
  distanceKm: string;
  drivenPlates: PlateRow[];
  intermediatePlates: PlateRow[];
  originalStackHeight: string;
  presentStackHeight: string;
  wearMm: number | null;
  recommendedShim: string;
  clutchStatus: string;
  currentShimInstalled: string;
  notes: string;
  createdBy: string;
}) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([842, 595]);

  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const black = rgb(0.06, 0.07, 0.08);
  const dark = rgb(0.11, 0.12, 0.14);
  const red = rgb(0.7, 0.05, 0.08);
  const light = rgb(0.96, 0.96, 0.96);
  const mid = rgb(0.78, 0.78, 0.78);
  const white = rgb(1, 1, 1);

  function text(
    value: string,
    x: number,
    y: number,
    size = 9,
    font = regular,
    color = black
  ) {
    page.drawText(value || "", { x, y, size, font, color });
  }

  function box(
    x: number,
    y: number,
    width: number,
    height: number,
    fill = white,
    border = mid
  ) {
    page.drawRectangle({
      x,
      y,
      width,
      height,
      color: fill,
      borderColor: border,
      borderWidth: 0.6,
    });
  }

  function sectionTitle(label: string, x: number, y: number, width: number) {
    box(x, y, width, 18, dark, dark);
    text(label, x + 8, y + 5, 9, bold, white);
  }

  function valueBox(label: string, value: string, x: number, y: number, width: number) {
    text(label, x, y + 5, 8, bold, black);
    box(x + 72, y, width - 72, 18, white, mid);
    text(value || "-", x + 78, y + 5, 8, regular, black);
  }

  page.drawRectangle({ x: 0, y: 0, width: 842, height: 595, color: light });

  box(30, 535, 500, 38, dark, dark);
  text("AP RACING", 44, 557, 13, bold, white);
  text("Carbon Clutch Measurement", 44, 542, 15, bold, white);

  box(545, 535, 265, 38, red, red);
  text(`Car ${carId}${carName ? ` - ${carName}` : ""}`, 560, 553, 13, bold, white);
  text(`Created by: ${createdBy || "-"}`, 560, 540, 8, regular, white);

  valueBox("Serial No:", serialNo, 30, 505, 230);
  valueBox("Job ID No:", jobIdNo, 285, 505, 245);
  valueBox("Clutch No:", clutchNo, 30, 480, 230);
  valueBox("Date:", measurementDate, 285, 480, 245);
  valueBox("Distance km:", distanceKm, 30, 455, 230);
  valueBox("Current shim:", currentShimInstalled, 285, 455, 245);

  sectionTitle("DRIVEN PLATES", 30, 420, 500);

  const tableX = 30;
  let y = 398;
  const widths = [40, 75, 75, 75, 85, 85];
  const headers = ["#", "A", "B", "C", "MEAN", "BACKLASH"];

  let x = tableX;
  headers.forEach((h, i) => {
    box(x, y, widths[i], 20, dark, dark);
    text(h, x + 8, y + 6, 8, bold, white);
    x += widths[i];
  });

  y -= 20;

  drivenPlates.forEach((row) => {
    const rowValues = [
      String(row.no),
      row.a,
      row.b,
      row.c,
      fmt(mean(row)),
      fmt(backlash(row)),
    ];

    x = tableX;
    rowValues.forEach((v, i) => {
      box(x, y, widths[i], 20, white, mid);
      text(v || "-", x + 8, y + 6, 8, regular, black);
      x += widths[i];
    });

    y -= 20;
  });

  sectionTitle("INTERMEDIATE PLATES", 30, 305, 500);

  y = 283;
  x = tableX;

  headers.forEach((h, i) => {
    box(x, y, widths[i], 20, dark, dark);
    text(h, x + 8, y + 6, 8, bold, white);
    x += widths[i];
  });

  y -= 20;

  intermediatePlates.forEach((row) => {
    const rowValues = [
      String(row.no),
      row.a,
      row.b,
      row.c,
      fmt(mean(row)),
      fmt(backlash(row)),
    ];

    x = tableX;
    rowValues.forEach((v, i) => {
      box(x, y, widths[i], 20, white, mid);
      text(v || "-", x + 8, y + 6, 8, regular, black);
      x += widths[i];
    });

    y -= 20;
  });

  sectionTitle("STACK HEIGHTS", 30, 155, 500);
  valueBox("Original:", originalStackHeight, 30, 125, 230);
  valueBox("Present:", presentStackHeight, 285, 125, 245);
  valueBox("Wear:", wearMm !== null ? `${fmt(wearMm, 3)} mm` : "", 30, 100, 230);
  valueBox("Status:", clutchStatus, 285, 100, 245);

  sectionTitle("SHIM WEAR COMPENSATION GUIDE", 545, 480, 265);

  const shimRows = [
    ["Wear mm", "Shim mm"],
    ["0.0", "0.00"],
    ["0.2", "0.25"],
    ["0.4", "0.50"],
    ["0.7", "0.75"],
    ["0.9", "1.00"],
    ["1.2", "1.25"],
    ["1.4", "1.50"],
    ["1.7", "1.75"],
    ["1.9", "2.00"],
    ["2.2", "2.25"],
    ["2.4", "2.50"],
    ["2.7", "2.75"],
    ["2.9", "3.00"],
    ["3.2", "3.25"],
    ["3.4", "3.50"],
  ];

  let shimY = 455;

  shimRows.forEach((row, i) => {
    const fill = i === 0 ? dark : white;
    const color = i === 0 ? white : black;

    box(545, shimY, 130, 18, fill, mid);
    box(675, shimY, 135, 18, fill, mid);

    text(row[0], 555, shimY + 5, 8, i === 0 ? bold : regular, color);
    text(row[1], 685, shimY + 5, 8, i === 0 ? bold : regular, color);

    shimY -= 18;
  });

  sectionTitle("RESULT", 545, 155, 265);
  valueBox("Current wear:", wearMm !== null ? `${fmt(Math.abs(wearMm), 3)} mm` : "", 545, 125, 265);
  valueBox("Recommended:", recommendedShim, 545, 100, 265);
  valueBox("Status:", clutchStatus, 545, 75, 265);

  sectionTitle("NOTES", 30, 65, 780);
  box(30, 25, 780, 35, white, mid);
  text(notes || "-", 40, 45, 8, regular, black);

  const pdfBytes = await pdfDoc.save();
  return pdfBytes;
}

export default function ClutchMeasurementPage() {
  const params = useParams();
  const carId = Number(params.carId);

  const [serialNo, setSerialNo] = useState("");
  const [clutchNo, setClutchNo] = useState("");
  const [jobIdNo, setJobIdNo] = useState("");
  const [carName, setCarName] = useState("");
  const [measurementDate, setMeasurementDate] = useState(todayString());
  const [distanceKm, setDistanceKm] = useState("");

  const [drivenPlates, setDrivenPlates] = useState<PlateRow[]>(EMPTY_DRIVEN_PLATES);
  const [intermediatePlates, setIntermediatePlates] = useState<PlateRow[]>(
    EMPTY_INTERMEDIATE_PLATES
  );

  const [originalStackHeight, setOriginalStackHeight] = useState("");
  const [presentStackHeight, setPresentStackHeight] = useState("");
  const [currentShimInstalled, setCurrentShimInstalled] = useState("");
  const [notes, setNotes] = useState("");

  const [rows, setRows] = useState<ClutchMeasurementRecord[]>([]);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const wearMm = useMemo(() => {
    const original = toNumber(originalStackHeight);
    const present = toNumber(presentStackHeight);

    if (original === null || present === null) return null;

    return present - original;
  }, [originalStackHeight, presentStackHeight]);

  const recommendedShim = useMemo(() => getRecommendedShim(wearMm), [wearMm]);
  const clutchStatus = useMemo(() => getStatus(wearMm), [wearMm]);

  async function loadRows() {
    if (!carId) return;

    const { data, error } = await supabase
      .from("clutch_measurements")
      .select("*")
      .eq("car_id", carId)
      .order("created_at", { ascending: false });

    if (error) {
      setMessage(error.message);
      return;
    }

    setRows((data ?? []) as ClutchMeasurementRecord[]);
  }

  useEffect(() => {
    if (carId) loadRows();
  }, [carId]);

  function updateDrivenPlate(index: number, key: keyof PlateRow, value: string) {
    setDrivenPlates((current) =>
      current.map((row, i) => (i === index ? { ...row, [key]: value } : row))
    );
  }

  function updateIntermediatePlate(index: number, key: keyof PlateRow, value: string) {
    setIntermediatePlates((current) =>
      current.map((row, i) => (i === index ? { ...row, [key]: value } : row))
    );
  }

  function resetForm() {
    setSerialNo("");
    setClutchNo("");
    setJobIdNo("");
    setCarName("");
    setMeasurementDate(todayString());
    setDistanceKm("");
    setDrivenPlates(EMPTY_DRIVEN_PLATES);
    setIntermediatePlates(EMPTY_INTERMEDIATE_PLATES);
    setOriginalStackHeight("");
    setPresentStackHeight("");
    setCurrentShimInstalled("");
    setNotes("");
  }

  async function saveMeasurementAndPdf() {
    setMessage("");

    if (!carId) {
      setMessage("Invalid car ID.");
      return;
    }

    if (!measurementDate) {
      setMessage("Please enter a measurement date.");
      return;
    }

    if (toNumber(distanceKm) === null) {
      setMessage("Please enter distance in km. This is needed for wear plotting.");
      return;
    }

    if (toNumber(originalStackHeight) === null || toNumber(presentStackHeight) === null) {
      setMessage("Please enter original and present stack heights.");
      return;
    }

    setSaving(true);

    try {
      const { data: userData } = await supabase.auth.getUser();
      const createdBy = userData.user?.email ?? null;

      const pdfBytes = await buildPdf({
        carId,
        carName,
        serialNo,
        clutchNo,
        jobIdNo,
        measurementDate,
        distanceKm,
        drivenPlates,
        intermediatePlates,
        originalStackHeight,
        presentStackHeight,
        wearMm,
        recommendedShim,
        clutchStatus,
        currentShimInstalled,
        notes,
        createdBy: createdBy ?? "",
      });

      const fileName = `${safeFilePart(
        carName || `car_${carId}`
      )}_${safeFilePart(clutchNo || "clutch")}_${Date.now()}.pdf`;

      const pdfPath = `car-${carId}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from(PDF_BUCKET)
        .upload(pdfPath, new Blob([pdfBytes], { type: "application/pdf" }), {
          contentType: "application/pdf",
          upsert: false,
        });

      if (uploadError) {
        setMessage(`PDF upload failed: ${uploadError.message}`);
        setSaving(false);
        return;
      }

      const { error: insertError } = await supabase.from("clutch_measurements").insert({
        car_id: carId,
        car_name: carName || null,
        serial_no: serialNo || null,
        clutch_no: clutchNo || null,
        job_id_no: jobIdNo || null,
        measurement_date: measurementDate,
        distance_km: toNumber(distanceKm),

        driven_plates: drivenPlates,
        intermediate_plates: intermediatePlates,

        original_stack_height: toNumber(originalStackHeight),
        present_stack_height: toNumber(presentStackHeight),
        wear_mm: wearMm,
        recommended_shim: recommendedShim || null,
        clutch_status: clutchStatus || null,
        current_shim_installed: currentShimInstalled || null,

        notes: notes || null,
        pdf_path: pdfPath,
        created_by: createdBy,
      });

      if (insertError) {
        setMessage(`Database save failed: ${insertError.message}`);
        setSaving(false);
        return;
      }

      const url = URL.createObjectURL(new Blob([pdfBytes], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);

      setMessage("Clutch measurement saved and PDF generated.");
      resetForm();
      await loadRows();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  async function openPdf(path: string | null | undefined) {
    if (!path) {
      setMessage("No PDF stored for this record.");
      return;
    }

    const { data, error } = await supabase.storage
      .from(PDF_BUCKET)
      .createSignedUrl(path, 60 * 5);

    if (error) {
      setMessage(error.message);
      return;
    }

    window.open(data.signedUrl, "_blank");
  }

  const plotPoints = useMemo(() => {
    const validRows = rows
      .filter((row) => row.distance_km !== null && row.distance_km !== undefined)
      .filter((row) => row.wear_mm !== null && row.wear_mm !== undefined)
      .map((row) => ({
        distance: Number(row.distance_km),
        wear: Math.abs(Number(row.wear_mm)),
      }))
      .sort((a, b) => a.distance - b.distance);

    if (validRows.length === 0) return [];

    const minDistance = Math.min(...validRows.map((p) => p.distance));
    const maxDistance = Math.max(...validRows.map((p) => p.distance));
    const maxWear = Math.max(...validRows.map((p) => p.wear), 0.1);

    return validRows.map((point) => {
      const x =
        maxDistance === minDistance
          ? 40
          : 40 + ((point.distance - minDistance) / (maxDistance - minDistance)) * 300;

      const y = 150 - (point.wear / maxWear) * 110;

      return { ...point, x, y };
    });
  }, [rows]);

  return (
    <main className="min-h-screen bg-[#0d0f12] p-6 text-zinc-100">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col gap-3 border-b border-zinc-800 pb-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-red-500">
              AP Racing
            </p>
            <h1 className="mt-2 text-4xl font-semibold">
              Car {carId} Carbon Clutch Measurement
            </h1>
            <p className="mt-3 max-w-3xl text-sm text-zinc-400">
              Fill out the clutch sheet, generate the PDF, and store the measured
              wear against distance so clutch degradation can be plotted over time.
            </p>
          </div>

          <div
            className={[
              "rounded-2xl border px-5 py-4 text-right",
              clutchStatus === "NO-GO"
                ? "border-red-500 bg-red-950/40"
                : clutchStatus === "SERVICE SOON"
                ? "border-yellow-500 bg-yellow-950/30"
                : "border-emerald-500/40 bg-emerald-950/20",
            ].join(" ")}
          >
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-400">
              Current Status
            </p>
            <p className="mt-1 text-2xl font-bold">{clutchStatus || "Incomplete"}</p>
            <p className="mt-1 text-sm text-zinc-400">
              Wear: {wearMm !== null ? `${fmt(Math.abs(wearMm), 3)} mm` : "-"}
            </p>
          </div>
        </div>

        <section className="mt-8 rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-2xl">
          <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
            <div>
              <div className="rounded-2xl border border-zinc-800 bg-[#0d0f12] p-5">
                <h2 className="text-2xl font-semibold">
                  AP RACING Carbon Clutch Measurement
                </h2>

                <div className="mt-5 grid gap-4 md:grid-cols-3">
                  <Field label="Serial No.">
                    <input
                      value={serialNo}
                      onChange={(e) => setSerialNo(e.target.value)}
                      className="input"
                      placeholder="e.g. 28819"
                    />
                  </Field>

                  <Field label="Job ID No.">
                    <input
                      value={jobIdNo}
                      onChange={(e) => setJobIdNo(e.target.value)}
                      className="input"
                      placeholder="Job ID"
                    />
                  </Field>

                  <Field label="Date">
                    <input
                      type="date"
                      value={measurementDate}
                      onChange={(e) => setMeasurementDate(e.target.value)}
                      className="input"
                    />
                  </Field>

                  <Field label="Clutch No.">
                    <input
                      value={clutchNo}
                      onChange={(e) => setClutchNo(e.target.value)}
                      className="input"
                      placeholder="e.g. 1"
                    />
                  </Field>

                  <Field label="Car">
                    <input
                      value={carName}
                      onChange={(e) => setCarName(e.target.value)}
                      className="input"
                      placeholder={`Car ${carId}`}
                    />
                  </Field>

                  <Field label="Distance km">
                    <input
                      value={distanceKm}
                      onChange={(e) => setDistanceKm(e.target.value)}
                      className="input"
                      placeholder="Required for wear plot"
                      inputMode="decimal"
                    />
                  </Field>
                </div>
              </div>

              <PlateTable
                title="Driven Plates"
                rows={drivenPlates}
                onChange={updateDrivenPlate}
              />

              <PlateTable
                title="Intermediate Plates"
                rows={intermediatePlates}
                onChange={updateIntermediatePlate}
              />

              <div className="mt-6 rounded-2xl border border-zinc-800 bg-[#0d0f12] p-5">
                <h3 className="text-lg font-semibold uppercase tracking-[0.15em]">
                  Stack Heights
                </h3>

                <div className="mt-4 grid gap-4 md:grid-cols-4">
                  <Field label="Original">
                    <input
                      value={originalStackHeight}
                      onChange={(e) => setOriginalStackHeight(e.target.value)}
                      className="input"
                      placeholder="mm"
                      inputMode="decimal"
                    />
                  </Field>

                  <Field label="Present">
                    <input
                      value={presentStackHeight}
                      onChange={(e) => setPresentStackHeight(e.target.value)}
                      className="input"
                      placeholder="mm"
                      inputMode="decimal"
                    />
                  </Field>

                  <Field label="Wear">
                    <div className="readonly-box">
                      {wearMm !== null ? `${fmt(wearMm, 3)} mm` : "-"}
                    </div>
                  </Field>

                  <Field label="Current Shim Installed">
                    <input
                      value={currentShimInstalled}
                      onChange={(e) => setCurrentShimInstalled(e.target.value)}
                      className="input"
                      placeholder="e.g. 0.25 mm"
                    />
                  </Field>
                </div>
              </div>

              <div className="mt-6 rounded-2xl border border-zinc-800 bg-[#0d0f12] p-5">
                <h3 className="text-lg font-semibold uppercase tracking-[0.15em]">
                  Notes
                </h3>

                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="mt-4 min-h-28 w-full rounded-xl border border-zinc-700 bg-[#101419] px-4 py-3 text-sm outline-none focus:border-red-500"
                  placeholder="Mechanic notes, abnormal wear, surface condition, action required..."
                />
              </div>
            </div>

            <aside className="space-y-6">
              <div className="rounded-2xl border border-zinc-800 bg-[#0d0f12] p-5">
                <h3 className="text-lg font-semibold">Shim Wear Compensation Guide</h3>

                <div className="mt-4 overflow-hidden rounded-xl border border-zinc-800">
                  <table className="w-full text-sm">
                    <thead className="bg-zinc-900 text-zinc-300">
                      <tr>
                        <th className="px-3 py-2 text-left">Wear mm</th>
                        <th className="px-3 py-2 text-left">Shim Compensation</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        ["0.0", "0.00 mm"],
                        ["0.2", "0.25 mm"],
                        ["0.4", "0.50 mm"],
                        ["0.7", "0.75 mm"],
                        ["0.9", "1.00 mm"],
                        ["1.2", "1.25 mm"],
                        ["1.4", "1.50 mm"],
                        ["1.7", "1.75 mm"],
                        ["1.9", "2.00 mm"],
                        ["2.2", "2.25 mm"],
                        ["2.4", "2.50 mm"],
                        ["2.7", "2.75 mm"],
                        ["2.9", "3.00 mm"],
                        ["3.2", "3.25 mm"],
                        ["3.4", "3.50 mm"],
                      ].map(([wear, shim]) => (
                        <tr key={wear} className="border-t border-zinc-800">
                          <td className="px-3 py-2 text-zinc-300">{wear}</td>
                          <td className="px-3 py-2 font-semibold">{shim}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="rounded-2xl border border-zinc-800 bg-[#0d0f12] p-5">
                <h3 className="text-lg font-semibold">Calculated Result</h3>

                <div className="mt-4 space-y-3 text-sm">
                  <ResultLine
                    label="Current Wear"
                    value={wearMm !== null ? `${fmt(Math.abs(wearMm), 3)} mm` : "-"}
                  />
                  <ResultLine label="Recommended Shim" value={recommendedShim || "-"} />
                  <ResultLine label="Status" value={clutchStatus || "-"} />
                </div>

                <button
                  onClick={saveMeasurementAndPdf}
                  disabled={saving}
                  className="mt-6 w-full rounded-xl bg-red-700 px-5 py-3 text-sm font-semibold text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? "Saving..." : "Save Measurement & Generate PDF"}
                </button>

                {message && <p className="mt-4 text-sm text-zinc-400">{message}</p>}
              </div>

              <div className="rounded-2xl border border-zinc-800 bg-[#0d0f12] p-5">
                <h3 className="text-lg font-semibold">Wear vs Distance</h3>

                {plotPoints.length < 2 ? (
                  <p className="mt-4 text-sm text-zinc-500">
                    Add at least two saved measurements with distance to plot wear.
                  </p>
                ) : (
                  <svg viewBox="0 0 380 180" className="mt-4 h-48 w-full">
                    <line x1="40" y1="150" x2="360" y2="150" stroke="#52525b" />
                    <line x1="40" y1="20" x2="40" y2="150" stroke="#52525b" />

                    <polyline
                      fill="none"
                      stroke="#dc2626"
                      strokeWidth="3"
                      points={plotPoints.map((p) => `${p.x},${p.y}`).join(" ")}
                    />

                    {plotPoints.map((p, index) => (
                      <circle key={index} cx={p.x} cy={p.y} r="4" fill="#ef4444" />
                    ))}

                    <text x="40" y="172" fill="#a1a1aa" fontSize="10">
                      Distance
                    </text>
                    <text x="5" y="18" fill="#a1a1aa" fontSize="10">
                      Wear
                    </text>
                  </svg>
                )}
              </div>
            </aside>
          </div>
        </section>

        <section className="mt-8 rounded-3xl border border-zinc-800 bg-[#14181d] p-6">
          <h2 className="text-2xl font-semibold">Previous Measurements</h2>

          <div className="mt-4 overflow-hidden rounded-2xl border border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-[#0d0f12] text-zinc-300">
                <tr>
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3 text-left">Distance</th>
                  <th className="px-4 py-3 text-left">Serial</th>
                  <th className="px-4 py-3 text-left">Clutch</th>
                  <th className="px-4 py-3 text-left">Wear</th>
                  <th className="px-4 py-3 text-left">Shim</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">PDF</th>
                </tr>
              </thead>

              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-6 text-center text-zinc-500">
                      No saved clutch measurements.
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={row.id} className="border-t border-zinc-800">
                      <td className="px-4 py-3 text-zinc-300">
                        {row.measurement_date || "-"}
                      </td>
                      <td className="px-4 py-3 text-zinc-300">
                        {row.distance_km !== null && row.distance_km !== undefined
                          ? `${row.distance_km} km`
                          : "-"}
                      </td>
                      <td className="px-4 py-3">{row.serial_no || "-"}</td>
                      <td className="px-4 py-3">{row.clutch_no || "-"}</td>
                      <td className="px-4 py-3">
                        {row.wear_mm !== null && row.wear_mm !== undefined
                          ? `${Math.abs(Number(row.wear_mm)).toFixed(3)} mm`
                          : "-"}
                      </td>
                      <td className="px-4 py-3">{row.recommended_shim || "-"}</td>
                      <td className="px-4 py-3">
                        <span
                          className={[
                            "rounded-full px-3 py-1 text-xs font-semibold",
                            row.clutch_status === "NO-GO"
                              ? "bg-red-900 text-red-100"
                              : row.clutch_status === "SERVICE SOON"
                              ? "bg-yellow-900 text-yellow-100"
                              : "bg-emerald-900 text-emerald-100",
                          ].join(" ")}
                        >
                          {row.clutch_status || "-"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => openPdf(row.pdf_path)}
                          className="rounded-lg border border-zinc-700 px-3 py-1 text-xs hover:border-red-500 hover:text-red-400"
                        >
                          Open PDF
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <style jsx>{`
        .input {
          width: 100%;
          border-radius: 0.75rem;
          border: 1px solid #3f3f46;
          background: #101419;
          padding: 0.75rem 1rem;
          font-size: 0.875rem;
          color: #f4f4f5;
          outline: none;
        }

        .input:focus {
          border-color: #ef4444;
        }

        .readonly-box {
          min-height: 44px;
          width: 100%;
          border-radius: 0.75rem;
          border: 1px solid #3f3f46;
          background: #18181b;
          padding: 0.75rem 1rem;
          font-size: 0.875rem;
          color: #f4f4f5;
        }
      `}</style>
    </main>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.15em] text-zinc-500">
        {label}
      </span>
      {children}
    </label>
  );
}

function PlateTable({
  title,
  rows,
  onChange,
}: {
  title: string;
  rows: PlateRow[];
  onChange: (index: number, key: keyof PlateRow, value: string) => void;
}) {
  return (
    <div className="mt-6 rounded-2xl border border-zinc-800 bg-[#0d0f12] p-5">
      <h3 className="text-lg font-semibold uppercase tracking-[0.15em]">{title}</h3>

      <div className="mt-4 overflow-hidden rounded-xl border border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900 text-zinc-300">
            <tr>
              <th className="w-16 px-3 py-2 text-left">#</th>
              <th className="px-3 py-2 text-left">A</th>
              <th className="px-3 py-2 text-left">B</th>
              <th className="px-3 py-2 text-left">C</th>
              <th className="px-3 py-2 text-left">Mean</th>
              <th className="px-3 py-2 text-left">Backlash</th>
            </tr>
          </thead>

          <tbody>
            {rows.map((row, index) => (
              <tr key={row.no} className="border-t border-zinc-800">
                <td className="px-3 py-2 font-semibold">{row.no}</td>

                {(["a", "b", "c"] as const).map((key) => (
                  <td key={key} className="px-3 py-2">
                    <input
                      value={row[key]}
                      onChange={(e) => onChange(index, key, e.target.value)}
                      className="w-full rounded-lg border border-zinc-700 bg-[#101419] px-3 py-2 text-sm outline-none focus:border-red-500"
                      inputMode="decimal"
                      placeholder="mm"
                    />
                  </td>
                ))}

                <td className="px-3 py-2 text-zinc-300">{fmt(mean(row)) || "-"}</td>
                <td className="px-3 py-2 text-zinc-300">
                  {fmt(backlash(row)) || "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ResultLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-zinc-800 bg-[#14181d] px-4 py-3">
      <span className="text-zinc-400">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}