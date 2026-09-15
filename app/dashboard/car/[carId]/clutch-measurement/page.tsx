"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { hasPermission, isReadOnlyUser } from "@/lib/userAccess";
import LogoutButton from "@/app/components/LogoutButton";

type ClutchRecord = Record<string, unknown> & {
  id?: string | number;
  car_id?: number;
  created_at?: string | null;
  created_by?: string | null;
  updated_at?: string | null;
  updated_by?: string | null;
  submitted_by?: string | null;
  pdf_path?: string | null;
  pdf_url?: string | null;
  driven_plates?: unknown;
  intermediate_plates?: unknown;
};

type PlateRow = {
  no?: string | number;
  a?: string | number;
  b?: string | number;
  c?: string | number;
};

const CLUTCH_PDF_BUCKET = "clutch-measurement-pdfs";

function compactDate(value: unknown) {
  if (!value || typeof value !== "string") return "No date";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function niceDateTime(value: unknown) {
  if (!value || typeof value !== "string") return "No timestamp";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString("en-GB");
}

function cleanValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (typeof value === "string") {
    return value.trim() || "—";
  }

  return JSON.stringify(value);
}

function formatLabel(key: string) {
  return key
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getFirstValue(record: ClutchRecord, keys: string[]) {
  for (const key of keys) {
    const value = record[key];

    if (value !== null && value !== undefined && value !== "") {
      return value;
    }
  }

  return null;
}

function getRecordId(record: ClutchRecord, fallback: number) {
  const id = record.id;

  if (typeof id === "string" || typeof id === "number") {
    return String(id);
  }

  return `record-${fallback}`;
}

function hasPdf(record: ClutchRecord) {
  return Boolean(record.pdf_url || record.pdf_path);
}

function recordTitle(record: ClutchRecord, fallbackNumber?: number) {
  const outingName = getFirstValue(record, [
    "outing_name",
    "outing",
    "record_name",
    "session_name",
  ]);
  if (outingName) return cleanValue(outingName);

  const serialNumber = getFirstValue(record, ["serial_no", "clutch_no"]);
  if (serialNumber) return `Clutch ${cleanValue(serialNumber)}`;

  return fallbackNumber ? `Saved measurement ${fallbackNumber}` : "Saved clutch measurement";
}

function shouldHideFromGenericData(key: string) {
  return [
    "id",
    "car_id",
    "created_at",
    "created_by",
    "updated_at",
    "updated_by",
    "submitted_by",
    "pdf_path",
    "pdf_url",
    "driven_plates",
    "intermediate_plates",
  ].includes(key);
}

function parsePlateRows(value: unknown): PlateRow[] {
  if (!value) return [];

  if (Array.isArray(value)) {
    return value as PlateRow[];
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);

      if (Array.isArray(parsed)) {
        return parsed as PlateRow[];
      }

      return [];
    } catch {
      return [];
    }
  }

  return [];
}

function plateNumber(value: unknown) {
  const numberValue = Number(value);
  return Number.isNaN(numberValue) ? null : numberValue;
}

function plateMean(row: PlateRow) {
  const values = [plateNumber(row.a), plateNumber(row.b), plateNumber(row.c)]
    .filter((value): value is number => value !== null);

  if (values.length === 0) return "—";

  const total = values.reduce((sum, value) => sum + value, 0);
  return (total / values.length).toFixed(3);
}

function DetailField({
  label,
  value,
}: {
  label: string;
  value: unknown;
}) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-[#0d0f12] p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">
        {label}
      </p>

      <p className="mt-3 break-words text-base font-semibold text-zinc-100">
        {cleanValue(value)}
      </p>
    </div>
  );
}

function PlateTable({
  title,
  value,
}: {
  title: string;
  value: unknown;
}) {
  const rows = parsePlateRows(value);

  return (
    <div className="rounded-3xl border border-zinc-800 bg-[#0d0f12] p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-red-400">
          {title}
        </p>

        <div className="rounded-xl border border-zinc-700 bg-black px-3 py-2 text-xs font-semibold text-zinc-300">
          {rows.length} plate{rows.length === 1 ? "" : "s"}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-700 bg-[#111418] p-5 text-sm text-zinc-500">
          No plate data saved.
        </div>
      ) : (
        <div className="max-w-full overflow-x-auto rounded-2xl border border-zinc-800">
          <table className="w-full min-w-[430px] border-collapse text-sm">
            <thead className="bg-[#14181d] text-xs uppercase tracking-[0.18em] text-zinc-500">
              <tr>
                <th className="border-b border-zinc-800 px-4 py-3 text-left">
                  Plate
                </th>

                <th className="border-b border-zinc-800 px-4 py-3 text-left">
                  A
                </th>

                <th className="border-b border-zinc-800 px-4 py-3 text-left">
                  B
                </th>

                <th className="border-b border-zinc-800 px-4 py-3 text-left">
                  C
                </th>

                <th className="border-b border-zinc-800 px-4 py-3 text-left">
                  Mean
                </th>
              </tr>
            </thead>

            <tbody>
              {rows.map((row, index) => (
                <tr
                  key={index}
                  className="border-b border-zinc-800 last:border-b-0"
                >
                  <td className="px-4 py-3 font-semibold text-zinc-100">
                    {cleanValue(row.no ?? index + 1)}
                  </td>

                  <td className="px-4 py-3 text-zinc-300">
                    {cleanValue(row.a)}
                  </td>

                  <td className="px-4 py-3 text-zinc-300">
                    {cleanValue(row.b)}
                  </td>

                  <td className="px-4 py-3 text-zinc-300">
                    {cleanValue(row.c)}
                  </td>

                  <td className="px-4 py-3 font-semibold text-red-200">
                    {plateMean(row)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function ChiefClutchMeasurementPage() {
  const params = useParams();
  const router = useRouter();
  const carId = Number(params.carId);

  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<ClutchRecord[]>([]);
  const [selectedRecord, setSelectedRecord] = useState<ClutchRecord | null>(
    null,
  );

  const [dateFilter, setDateFilter] = useState("");
  const [searchText, setSearchText] = useState("");
  const [openingPdfKey, setOpeningPdfKey] = useState<string | null>(null);

  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [readOnly, setReadOnly] = useState(false);

  async function loadClutchMeasurements() {
    setLoading(true);
    setMessage("");
    setErrorMessage("");

    const { data: userData, error: userError } = await supabase.auth.getUser();

    if (userError || !userData.user?.email) {
      router.replace("/login");
      return;
    }

    const email = userData.user.email.trim().toLowerCase();

    setReadOnly(isReadOnlyUser(email));

    if (!hasPermission(email, "clutch:view")) {
      router.replace("/dashboard");
      return;
    }

    const { data, error } = await supabase
      .from("clutch_measurements")
      .select("*")
      .eq("car_id", carId)
      .order("created_at", { ascending: false });

    if (error) {
      setErrorMessage(error.message);
      setLoading(false);
      return;
    }

    setRecords((data ?? []) as ClutchRecord[]);
    setLoading(false);
  }

  useEffect(() => {
    if (carId) {
      loadClutchMeasurements();
    }
  }, [carId]);

  async function openPdf(record: ClutchRecord, key: string) {
    setMessage("");
    setErrorMessage("");
    setOpeningPdfKey(key);

    if (record.pdf_url && typeof record.pdf_url === "string") {
      window.open(record.pdf_url, "_blank", "noopener,noreferrer");
      setOpeningPdfKey(null);
      return;
    }

    if (record.pdf_path && typeof record.pdf_path === "string") {
      const { data, error } = await supabase.storage
        .from(CLUTCH_PDF_BUCKET)
        .createSignedUrl(record.pdf_path, 60 * 10);

      if (error || !data?.signedUrl) {
        setErrorMessage(
          error?.message ||
            "Could not open the clutch measurement PDF. Check the storage bucket and saved PDF path.",
        );
        setOpeningPdfKey(null);
        return;
      }

      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
      setOpeningPdfKey(null);
      return;
    }

    setErrorMessage(
      "No PDF is linked to this clutch measurement record yet. The clutch submit page needs to save pdf_path into clutch_measurements.",
    );

    setOpeningPdfKey(null);
  }

  const filteredRecords = useMemo(() => {
    return records.filter((record) => {
      const createdAt = getFirstValue(record, ["created_at"]);
      const recordDate =
        typeof createdAt === "string" ? createdAt.slice(0, 10) : "";

      const matchesDate = dateFilter ? recordDate === dateFilter : true;

      const searchableText = Object.values(record)
        .map((value) => cleanValue(value))
        .join(" ")
        .toLowerCase();

      const matchesSearch = searchText.trim()
        ? searchableText.includes(searchText.trim().toLowerCase())
        : true;

      return matchesDate && matchesSearch;
    });
  }, [records, dateFilter, searchText]);

  function toggleSelectedRecord(record: ClutchRecord) {
    setSelectedRecord((previous) => {
      if (!previous) return record;

      const previousId = previous.id;
      const clickedId = record.id;
      const isSameRecord =
        previous === record ||
        (previousId !== null &&
          previousId !== undefined &&
          clickedId !== null &&
          clickedId !== undefined &&
          String(previousId) === String(clickedId));

      return isSameRecord ? null : record;
    });
  }

  const latestRecord = records[0] ?? null;

  const latestCreatedAt = latestRecord
    ? getFirstValue(latestRecord, ["created_at"])
    : null;

  const latestCreatedBy = latestRecord
    ? getFirstValue(latestRecord, ["created_by", "updated_by", "submitted_by"])
    : null;

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0d0f12] text-zinc-400">
        Loading clutch measurements...
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0d0f12] p-6 text-zinc-100">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-red-400">
            Chief Review
          </p>

          <h1 className="mt-3 text-4xl font-semibold">
            Car {carId} Clutch Measurements
          </h1>

          <p className="mt-3 max-w-3xl text-sm text-zinc-400">
            Review clutch measurement records submitted for this car and open
            the saved PDF sheet.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <Link
            href={`/car/${carId}/clutch-measurement`}
            className="rounded-xl border border-zinc-700 bg-[#14181d] px-5 py-3 text-sm font-semibold text-zinc-200 hover:border-red-500 hover:text-red-300"
          >
            Open Mechanic Sheet
          </Link>

          <LogoutButton />
        </div>
      </div>

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

      {readOnly && (
        <div className="mb-6 rounded-2xl border border-amber-800 bg-amber-950/25 p-4 text-sm text-amber-200">
          Guest mode is view-only. Clutch records and PDFs can be reviewed, but no clutch data can be changed.
        </div>
      )}

      <section className="mb-6 grid gap-6 lg:grid-cols-3">
        <div className="rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-red-400">
            Records
          </p>

          <h2 className="mt-3 text-5xl font-bold text-zinc-100">
            {records.length}
          </h2>

          <p className="mt-2 text-sm text-zinc-500">
            clutch measurement record{records.length === 1 ? "" : "s"} saved
          </p>
        </div>

        <div className="rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-red-400">
            Latest Record
          </p>

          <h2 className="mt-3 text-2xl font-semibold text-zinc-100">
            {niceDateTime(latestCreatedAt)}
          </h2>

          <p className="mt-2 text-sm text-zinc-500">
            Most recent clutch sheet submitted
          </p>
        </div>

        <div className="rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-red-400">
            Latest Submitted By
          </p>

          <h2 className="mt-3 break-words text-2xl font-semibold text-zinc-100">
            {cleanValue(latestCreatedBy)}
          </h2>

          <p className="mt-2 text-sm text-zinc-500">
            User linked to the latest record
          </p>
        </div>
      </section>

      <section className="mb-6 rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-red-400">
              Filters
            </p>

            <h2 className="mt-3 text-2xl font-semibold">
              Search Clutch Records
            </h2>
          </div>

          <button
            type="button"
            onClick={loadClutchMeasurements}
            className="rounded-xl border border-zinc-700 px-5 py-3 text-sm font-semibold text-zinc-200 hover:border-red-500 hover:text-red-300"
          >
            Refresh
          </button>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-[220px_1fr_auto]">
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">
              Date
            </span>

            <input
              type="date"
              value={dateFilter}
              onChange={(event) => setDateFilter(event.target.value)}
              className="mt-2 w-full rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-sm text-zinc-100 outline-none focus:border-red-500"
            />
          </label>

          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">
              Search
            </span>

            <input
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Search driver, track, notes, values..."
              className="mt-2 w-full rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-sm text-zinc-100 outline-none focus:border-red-500"
            />
          </label>

          <div className="flex items-end">
            <button
              type="button"
              onClick={() => {
                setDateFilter("");
                setSearchText("");
              }}
              className="w-full rounded-xl border border-zinc-700 px-5 py-3 text-sm font-semibold text-zinc-300 hover:border-red-500 hover:text-red-300"
            >
              Clear
            </button>
          </div>
        </div>
      </section>

      <section className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,38fr)_minmax(0,62fr)] lg:items-start">
        <div className="min-w-0 rounded-3xl border border-zinc-800 bg-[#14181d] p-4 shadow-xl sm:p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-red-400">
                Clutch Measurement History
              </p>

              <h2 className="mt-2 text-xl font-semibold">
                Saved Measurements
              </h2>

              <p className="mt-1 text-xs leading-5 text-zinc-500">
                Select an outing to view its saved sheet.
              </p>
            </div>

            <div className="shrink-0 rounded-lg border border-zinc-700 bg-[#0d0f12] px-2.5 py-1.5 text-xs font-semibold text-zinc-400">
              {filteredRecords.length} / {records.length}
            </div>
          </div>

          {filteredRecords.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-700 bg-[#0d0f12] p-5 text-sm text-zinc-500">
              No clutch measurement records found.
            </div>
          ) : (
            <div className="max-h-[420px] space-y-2 overflow-y-auto overscroll-contain pr-1 sm:max-h-[520px] lg:max-h-[680px]">
              {filteredRecords.map((record, index) => {
              const id = getRecordId(record, index);
              const recordDate = getFirstValue(record, [
                "measurement_date",
                "created_at",
              ]);
              const createdBy = getFirstValue(record, [
                "created_by",
                "updated_by",
                "submitted_by",
              ]);
              const driver = getFirstValue(record, ["driver", "driver_name"]);
              const isSelected =
                selectedRecord === record ||
                (selectedRecord?.id !== null &&
                  selectedRecord?.id !== undefined &&
                  record.id !== null &&
                  record.id !== undefined &&
                  String(selectedRecord.id) === String(record.id));

              return (
                <button
                  key={`${id}-${index}`}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => toggleSelectedRecord(record)}
                  className={`block w-full rounded-xl border px-4 py-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/70 ${
                    isSelected
                      ? "border-red-700/70 bg-red-950/20"
                      : "border-zinc-800 bg-[#0d0f12] hover:border-zinc-600 hover:bg-[#171b20]"
                  }`}
                >
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold text-zinc-100">
                        {recordTitle(record, filteredRecords.length - index)}
                      </h3>
                      <p className="mt-1 truncate text-xs text-zinc-400">
                        {cleanValue(createdBy)}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      {hasPdf(record) && (
                        <span
                          aria-label="PDF available"
                          title="PDF available"
                          className="rounded-md border border-emerald-900/70 bg-emerald-950/30 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-emerald-300"
                        >
                          PDF
                        </span>
                      )}
                      <span className="text-xs font-medium text-zinc-400">
                        {compactDate(recordDate)}
                      </span>
                    </div>
                  </div>

                  <p className="mt-2 truncate text-xs text-zinc-500">
                    Driver: <span className="text-zinc-300">{cleanValue(driver)}</span>
                  </p>
                </button>
              );
              })}
            </div>
          )}
        </div>

        {selectedRecord ? (
          <div className="min-w-0 lg:sticky lg:top-6">
            <div className="max-h-none min-w-0 overflow-hidden rounded-3xl border border-zinc-800 bg-[#14181d] p-4 shadow-xl sm:p-5 lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto">
            <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-red-400">
                  Clutch Measurement Record
                </p>

                <h2 className="mt-2 break-words text-2xl font-semibold text-zinc-100">
                  {recordTitle(selectedRecord)}
                </h2>

                <p className="mt-2 text-sm text-zinc-400">
                  Saved{" "}
                  <span className="font-semibold text-zinc-200">
                    {niceDateTime(getFirstValue(selectedRecord, ["created_at"]))}
                  </span>{" "}
                  by{" "}
                  <span className="font-semibold text-zinc-200">
                    {cleanValue(
                      getFirstValue(selectedRecord, [
                        "created_by",
                        "updated_by",
                        "submitted_by",
                      ]),
                    )}
                  </span>
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => openPdf(selectedRecord, "modal")}
                  disabled={openingPdfKey === "modal"}
                  className="rounded-xl border border-red-900/60 bg-red-950/30 px-4 py-2.5 text-sm font-semibold text-red-200 transition hover:border-red-500 hover:bg-red-950/50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {openingPdfKey === "modal" ? "Opening..." : "Open PDF"}
                </button>

                <button
                  type="button"
                  onClick={() => setSelectedRecord(null)}
                  className="rounded-xl border border-zinc-700 px-4 py-2.5 text-sm font-semibold text-zinc-200 hover:border-red-500 hover:text-red-300"
                >
                  Close
                </button>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <DetailField
                label="Track"
                value={getFirstValue(selectedRecord, [
                  "track_name",
                  "track",
                  "circuit",
                ])}
              />

              <DetailField
                label="Driver"
                value={getFirstValue(selectedRecord, [
                  "driver",
                  "driver_name",
                ])}
              />

              <DetailField
                label="Chassis"
                value={getFirstValue(selectedRecord, [
                  "chassis",
                  "chassis_no",
                ])}
              />

              <DetailField
                label="Created"
                value={niceDateTime(
                  getFirstValue(selectedRecord, ["created_at"]),
                )}
              />
            </div>

            <div className="mt-6 rounded-3xl border border-zinc-800 bg-[#0d0f12] p-5">
              <p className="mb-4 text-xs font-semibold uppercase tracking-[0.3em] text-red-400">
                PDF Link
              </p>

              <div className="grid gap-3 md:grid-cols-2">
                <DetailField label="PDF Path" value={selectedRecord.pdf_path} />
                <DetailField label="PDF URL" value={selectedRecord.pdf_url} />
              </div>
            </div>

            <div className="mt-5 grid min-w-0 gap-5 xl:grid-cols-2">
              <PlateTable
                title="Driven Plates"
                value={selectedRecord.driven_plates}
              />

              <PlateTable
                title="Intermediate Plates"
                value={selectedRecord.intermediate_plates}
              />
            </div>

            <div className="mt-5 rounded-3xl border border-zinc-800 bg-[#0d0f12] p-5">
              <p className="mb-4 text-xs font-semibold uppercase tracking-[0.3em] text-red-400">
                Measurement Summary
              </p>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {Object.entries(selectedRecord)
                  .filter(([key]) => !shouldHideFromGenericData(key))
                  .map(([key, value]) => (
                    <DetailField
                      key={key}
                      label={formatLabel(key)}
                      value={value}
                    />
                  ))}
              </div>
            </div>

            <details className="mt-6 rounded-3xl border border-zinc-800 bg-[#0d0f12] p-5">
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.3em] text-red-400">
                Raw Record
              </summary>

              <pre className="mt-4 max-h-[320px] max-w-full overflow-auto whitespace-pre-wrap break-all rounded-2xl border border-zinc-800 bg-black p-4 text-xs leading-5 text-zinc-300">
                {JSON.stringify(selectedRecord, null, 2)}
              </pre>
            </details>
            </div>
          </div>
        ) : (
          <p className="px-1 py-3 text-sm text-zinc-600 lg:px-3 lg:py-5">
            Select a saved outing to view its measurements.
          </p>
        )}
      </section>
    </main>
  );
}
