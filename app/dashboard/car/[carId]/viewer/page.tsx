"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { hasPermission } from "@/lib/userAccess";
import LogoutButton from "@/app/components/LogoutButton";

type JobRow = {
  id?: string;
  car_id: number;
  job_id: number;
  job_text: string;
  section: "standard" | "special";
  done: boolean;
  notes: string | null;
  updated_by: string | null;
  updated_at: string | null;
};

type JobRelease = {
  car_id: number;
  after_event: string | null;
  job_date: string | null;
  released_by: string | null;
  released_at: string | null;
};

type PostEventSheet = {
  id: string;
  car_id: number;
  track_name: string | null;
  chassis: string | null;
  driver: string | null;
  engine_no: string | null;
  hours_remaining: string | null;
  gearbox_no: string | null;
  fuel_drained_kg: string | null;
  front_ride_height: string | null;
  rear_ride_height: string | null;
  diff_break_off: string | null;
  diff_dynamic: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string | null;
  pdf_path: string | null;
  pdf_filename: string | null;
};

type GenericRecord = Record<string, unknown>;

type ClutchRecord = GenericRecord & {
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
const POST_EVENT_PDF_BUCKET = "post-event-sheets";

function niceDate(value: string | null | undefined) {
  if (!value) return "No date";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString("en-GB");
}

function niceDateTime(value: string | null | undefined) {
  if (!value) return "No timestamp";

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

function getRecordValue(record: GenericRecord, keys: string[]) {
  for (const key of keys) {
    const value = record[key];

    if (value !== null && value !== undefined && value !== "") {
      return value;
    }
  }

  return null;
}

function dateFromUnknown(value: unknown) {
  if (!value || typeof value !== "string") return "No date";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString("en-GB");
}

function dateTimeFromUnknown(value: unknown) {
  if (!value || typeof value !== "string") return "No timestamp";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString("en-GB");
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

function shouldHideFromClutchSummary(key: string) {
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

      <p className="mt-3 break-words text-lg font-semibold text-zinc-100">
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
        <div className="overflow-hidden rounded-2xl border border-zinc-800">
          <table className="w-full border-collapse text-sm">
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

export default function ChiefCarViewerPage() {
  const params = useParams();
  const router = useRouter();

  const carId = Number(params.carId);

  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [releaseInfo, setReleaseInfo] = useState<JobRelease | null>(null);
  const [clutchRows, setClutchRows] = useState<ClutchRecord[]>([]);
  const [postEventRows, setPostEventRows] = useState<PostEventSheet[]>([]);

  const [selectedSheet, setSelectedSheet] = useState<PostEventSheet | null>(
    null,
  );

  const [selectedClutchRecord, setSelectedClutchRecord] =
    useState<ClutchRecord | null>(null);

  const [dateFilter, setDateFilter] = useState("");
  const [trackFilter, setTrackFilter] = useState("all");

  const [clutchDateFilter, setClutchDateFilter] = useState("");
  const [clutchSearchFilter, setClutchSearchFilter] = useState("");
  const [openingPdfKey, setOpeningPdfKey] = useState<string | null>(null);
  const [openingPostEventPdfId, setOpeningPostEventPdfId] = useState<
    string | null
  >(null);

  const [errorMessage, setErrorMessage] = useState("");
  const [message, setMessage] = useState("");
  const [clearingNoteKey, setClearingNoteKey] = useState<string | null>(null);
  const [canEditJobNotes, setCanEditJobNotes] = useState(false);

  async function checkAccess() {
    if (!Number.isFinite(carId)) {
      router.replace("/dashboard");
      return null;
    }

    const { data: userData, error: userError } = await supabase.auth.getUser();

    if (userError || !userData.user?.email) {
      router.replace("/login");
      return null;
    }

    const email = userData.user.email.trim().toLowerCase();

    const allowed =
      hasPermission(email, "dashboard:view") && hasPermission(email, "cars:view");

    if (!allowed) {
      router.replace("/dashboard");
      return null;
    }

    setCanEditJobNotes(hasPermission(email, "job_lists:edit"));

    return email;
  }

  useEffect(() => {
    async function loadViewer() {
      const email = await checkAccess();

      if (!email) {
        return;
      }

      setLoading(true);
      setMessage("");
      setErrorMessage("");

      const { data: releaseData, error: releaseError } = await supabase
        .from("job_list_releases")
        .select("*")
        .eq("car_id", carId)
        .maybeSingle();

      if (releaseError) {
        setErrorMessage(`Release details failed: ${releaseError.message}`);
      } else {
        setReleaseInfo((releaseData as JobRelease) ?? null);
      }

      const { data: jobData, error: jobError } = await supabase
        .from("job_progress")
        .select("*")
        .eq("car_id", carId)
        .order("section", { ascending: false })
        .order("job_id", { ascending: true });

      if (jobError) {
        setErrorMessage(`Jobs failed: ${jobError.message}`);
      } else {
        setJobs((jobData ?? []) as JobRow[]);
      }

      const clutch = await supabase
        .from("clutch_measurements")
        .select("*")
        .eq("car_id", carId)
        .order("created_at", { ascending: false });

      if (clutch.error) {
        setErrorMessage(`Clutch measurements failed: ${clutch.error.message}`);
      } else {
        setClutchRows((clutch.data ?? []) as ClutchRecord[]);
      }

      const postEvent = await supabase
        .from("post_event_sheets")
        .select("*")
        .eq("car_id", carId)
        .order("created_at", { ascending: false });

      if (postEvent.error) {
        setErrorMessage(
          `Post-event sheets failed: ${postEvent.error.message}`,
        );
      } else {
        setPostEventRows((postEvent.data ?? []) as PostEventSheet[]);
      }

      setLoading(false);
    }

    if (carId) {
      loadViewer();
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carId, router]);

  async function openClutchPdf(record: ClutchRecord, key: string) {
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

    setErrorMessage("No PDF is linked to this clutch measurement record yet.");
    setOpeningPdfKey(null);
  }

  async function openPostEventPdf(sheet: PostEventSheet) {
    setMessage("");
    setErrorMessage("");
    setOpeningPostEventPdfId(sheet.id);

    if (!sheet.pdf_path) {
      setErrorMessage(
        "No PDF is linked to this post-event sheet. The database record exists, but pdf_path is empty.",
      );
      setOpeningPostEventPdfId(null);
      return;
    }

    const { data, error } = await supabase.storage
      .from(POST_EVENT_PDF_BUCKET)
      .createSignedUrl(sheet.pdf_path, 60 * 10);

    if (error || !data?.signedUrl) {
      setErrorMessage(
        error?.message ||
          "Could not open the post-event PDF. Check the storage bucket and saved PDF path.",
      );

      setOpeningPostEventPdfId(null);
      return;
    }

    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    setOpeningPostEventPdfId(null);
  }

  async function clearJobNote(job: JobRow) {
    if (!canEditJobNotes) {
      setErrorMessage("You do not have permission to clear mechanic notes.");
      return;
    }

    const confirmed = window.confirm(
      `Clear this mechanic note?\n\nTask:\n${job.job_text}`,
    );

    if (!confirmed) return;

    const key = `${job.section}-${job.job_id}`;
    const now = new Date().toISOString();

    setClearingNoteKey(key);
    setMessage("");
    setErrorMessage("");

    const email = await checkAccess();

    if (!email) {
      setClearingNoteKey(null);
      return;
    }

    const { error } = await supabase
      .from("job_progress")
      .update({
        notes: null,
        updated_by: email,
        updated_at: now,
      })
      .eq("car_id", job.car_id)
      .eq("job_id", job.job_id)
      .eq("section", job.section);

    if (error) {
      setErrorMessage(`Failed to clear note: ${error.message}`);
      setClearingNoteKey(null);
      return;
    }

    setJobs((current) =>
      current.map((item) =>
        item.car_id === job.car_id &&
        item.job_id === job.job_id &&
        item.section === job.section
          ? {
              ...item,
              notes: null,
              updated_by: email,
              updated_at: now,
            }
          : item,
      ),
    );

    setMessage("Mechanic note cleared.");
    setClearingNoteKey(null);
  }

  const completedJobs = jobs.filter((job) => job.done).length;
  const totalJobs = jobs.length;
  const progress = totalJobs ? Math.round((completedJobs / totalJobs) * 100) : 0;

  const outstandingJobs = useMemo(
    () => jobs.filter((job) => !job.done),
    [jobs],
  );

  const completedJobRows = useMemo(
    () => jobs.filter((job) => job.done),
    [jobs],
  );

  const mechanicJobNotes = useMemo(() => {
    return jobs
      .filter((job) => job.notes && job.notes.trim().length > 0)
      .sort((a, b) => {
        const aTime = a.updated_at ? new Date(a.updated_at).getTime() : 0;
        const bTime = b.updated_at ? new Date(b.updated_at).getTime() : 0;
        return bTime - aTime;
      });
  }, [jobs]);

  const trackOptions = useMemo(() => {
    const tracks = postEventRows
      .map((sheet) => sheet.track_name?.trim())
      .filter((track): track is string => Boolean(track));

    return Array.from(new Set(tracks)).sort((a, b) => a.localeCompare(b));
  }, [postEventRows]);

  const filteredPostEventRows = useMemo(() => {
    return postEventRows.filter((sheet) => {
      const sheetDate = sheet.created_at ? sheet.created_at.slice(0, 10) : "";

      const matchesDate = dateFilter ? sheetDate === dateFilter : true;

      const matchesTrack =
        trackFilter === "all"
          ? true
          : (sheet.track_name || "").trim() === trackFilter;

      return matchesDate && matchesTrack;
    });
  }, [postEventRows, dateFilter, trackFilter]);

  const filteredClutchRows = useMemo(() => {
    return clutchRows.filter((record) => {
      const createdAt = getRecordValue(record, ["created_at"]);
      const recordDate =
        typeof createdAt === "string" ? createdAt.slice(0, 10) : "";

      const matchesDate = clutchDateFilter
        ? recordDate === clutchDateFilter
        : true;

      const searchableText = Object.values(record)
        .map((value) => cleanValue(value))
        .join(" ")
        .toLowerCase();

      const matchesSearch = clutchSearchFilter.trim()
        ? searchableText.includes(clutchSearchFilter.trim().toLowerCase())
        : true;

      return matchesDate && matchesSearch;
    });
  }, [clutchRows, clutchDateFilter, clutchSearchFilter]);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0d0f12] text-zinc-400">
        Loading Car {carId} viewer...
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0d0f12] p-6 text-zinc-100">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-red-400">
            Car Viewer
          </p>

          <h1 className="mt-3 text-4xl font-semibold">
            Car {carId} Profile
          </h1>

          <p className="mt-3 max-w-3xl text-sm text-zinc-400">
            Read-only overview of current job progress, clutch measurements,
            mechanic notes and post-event records.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          {canEditJobNotes && (
            <Link
              href={`/dashboard/car/${carId}/job-list`}
              className="rounded-xl bg-red-700 px-5 py-3 text-sm font-semibold hover:bg-red-600"
            >
              Edit Job List
            </Link>
          )}

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

      <section className="mb-6 rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-red-400">
              Released Job List
            </p>

            <h2 className="mt-3 text-3xl font-semibold text-zinc-100">
              {releaseInfo?.after_event || "No event name set"}
            </h2>

            <div className="mt-3 flex flex-wrap gap-4 text-sm text-zinc-400">
              <span>
                Date:{" "}
                <span className="font-semibold text-zinc-100">
                  {releaseInfo?.job_date
                    ? new Date(releaseInfo.job_date).toLocaleDateString("en-GB")
                    : "No date set"}
                </span>
              </span>

              {releaseInfo?.released_at && (
                <span>
                  Released:{" "}
                  <span className="font-semibold text-zinc-100">
                    {new Date(releaseInfo.released_at).toLocaleString("en-GB")}
                  </span>
                </span>
              )}

              {releaseInfo?.released_by && (
                <span>
                  By:{" "}
                  <span className="font-semibold text-zinc-100">
                    {releaseInfo.released_by}
                  </span>
                </span>
              )}
            </div>
          </div>

          {canEditJobNotes && (
            <Link
              href={`/dashboard/car/${carId}/job-list`}
              className="rounded-xl border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-200 hover:border-red-500 hover:text-red-300"
            >
              Change Details
            </Link>
          )}
        </div>
      </section>

      <section className="mb-6 grid gap-6 lg:grid-cols-3">
        <div className="rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
          <h2 className="text-2xl font-semibold">Job Progress</h2>

          <p className="mt-2 text-sm text-zinc-500">
            {completedJobs} of {totalJobs} jobs complete.
          </p>

          <div className="mt-6 text-6xl font-bold text-red-400">
            {progress}%
          </div>

          <div className="mt-5 h-3 overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full rounded-full bg-red-700"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        <div className="rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl lg:col-span-2">
          <h2 className="text-2xl font-semibold">Outstanding Jobs</h2>

          <div className="mt-4 max-h-[420px] space-y-2 overflow-y-auto pr-2">
            {outstandingJobs.length === 0 ? (
              <p className="rounded-xl border border-green-800 bg-green-950/20 p-4 text-sm text-green-300">
                No outstanding jobs.
              </p>
            ) : (
              outstandingJobs.map((job) => (
                <div
                  key={`${job.section}-${job.job_id}`}
                  className="rounded-xl border border-zinc-800 bg-[#0d0f12] p-4 text-sm"
                >
                  <div className="text-zinc-100">{job.job_text}</div>

                  <div className="mt-1 flex flex-wrap gap-3 text-xs uppercase tracking-widest text-zinc-500">
                    <span>{job.section}</span>

                    {job.notes?.trim() && (
                      <span className="text-red-300">Has Note</span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="mb-6 rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
        <h2 className="text-2xl font-semibold">Completed Jobs</h2>

        <div className="mt-4 max-h-[320px] space-y-2 overflow-y-auto pr-2">
          {completedJobRows.length === 0 ? (
            <p className="text-sm text-zinc-500">No jobs completed yet.</p>
          ) : (
            completedJobRows.map((job) => (
              <div
                key={`${job.section}-${job.job_id}`}
                className="rounded-xl border border-green-900/50 bg-green-950/10 p-4 text-sm"
              >
                <div className="text-zinc-300 line-through">
                  {job.job_text}
                </div>

                <div className="mt-1 flex flex-wrap gap-3 text-xs text-zinc-500">
                  <span>Updated by {job.updated_by ?? "unknown"}</span>

                  <span>
                    {job.updated_at
                      ? new Date(job.updated_at).toLocaleString("en-GB")
                      : ""}
                  </span>

                  {job.notes?.trim() && (
                    <span className="font-semibold text-red-300">
                      Has Note
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold">
                Previous Clutch Measurements
              </h2>

              <p className="mt-1 text-sm text-zinc-500">
                Click a clutch record to open the full measurement data.
              </p>
            </div>

            <div className="rounded-2xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-sm font-semibold text-red-300">
              {filteredClutchRows.length} / {clutchRows.length}
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">
                Filter Date
              </span>

              <input
                type="date"
                value={clutchDateFilter}
                onChange={(event) => setClutchDateFilter(event.target.value)}
                className="mt-2 w-full rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-sm text-zinc-100 outline-none focus:border-red-500"
              />
            </label>

            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">
                Search
              </span>

              <input
                value={clutchSearchFilter}
                onChange={(event) => setClutchSearchFilter(event.target.value)}
                placeholder="Search clutch no, serial no, user..."
                className="mt-2 w-full rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-sm text-zinc-100 outline-none focus:border-red-500"
              />
            </label>
          </div>

          {(clutchDateFilter || clutchSearchFilter) && (
            <button
              type="button"
              onClick={() => {
                setClutchDateFilter("");
                setClutchSearchFilter("");
              }}
              className="mt-3 rounded-xl border border-zinc-700 px-4 py-2 text-xs font-semibold text-zinc-300 hover:border-red-500 hover:text-red-300"
            >
              Clear Filters
            </button>
          )}

          <div className="mt-5 max-h-[520px] space-y-3 overflow-y-auto pr-2">
            {filteredClutchRows.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-zinc-700 bg-[#0d0f12] p-6 text-sm text-zinc-500">
                No clutch measurement records found.
              </div>
            ) : (
              filteredClutchRows.map((record, index) => {
                const createdAt = getRecordValue(record, ["created_at"]);
                const createdBy = getRecordValue(record, [
                  "created_by",
                  "updated_by",
                  "submitted_by",
                ]);

                const carName = getRecordValue(record, ["car_name"]);
                const serialNo = getRecordValue(record, ["serial_no"]);
                const clutchNo = getRecordValue(record, ["clutch_no"]);
                const measurementDate = getRecordValue(record, [
                  "measurement_date",
                ]);
                const distanceKm = getRecordValue(record, ["distance_km"]);
                const pdfKey = `viewer-clutch-${String(record.id ?? index)}`;

                return (
                  <div
                    key={String(record.id ?? index)}
                    className="rounded-2xl border border-zinc-800 bg-[#0d0f12] p-4 transition hover:border-red-500/70 hover:bg-[#15191f]"
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedClutchRecord(record)}
                      className="w-full text-left"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-red-400">
                            Clutch Measurement
                          </p>

                          <h3 className="mt-2 text-xl font-semibold text-zinc-100">
                            {cleanValue(carName) !== "—"
                              ? `Car ${cleanValue(carName)}`
                              : `Record ${index + 1}`}
                          </h3>

                          <p className="mt-1 text-sm text-zinc-400">
                            Submitted by:{" "}
                            <span className="font-semibold text-zinc-200">
                              {cleanValue(createdBy)}
                            </span>
                          </p>
                        </div>

                        <div className="rounded-xl border border-zinc-700 bg-[#111418] px-3 py-2 text-right">
                          <p className="text-xs text-zinc-500">Saved</p>

                          <p className="text-sm font-semibold text-zinc-200">
                            {dateFromUnknown(createdAt)}
                          </p>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-2 text-sm text-zinc-400 sm:grid-cols-3">
                        <p>
                          Serial:{" "}
                          <span className="font-semibold text-zinc-200">
                            {cleanValue(serialNo)}
                          </span>
                        </p>

                        <p>
                          Clutch:{" "}
                          <span className="font-semibold text-zinc-200">
                            {cleanValue(clutchNo)}
                          </span>
                        </p>

                        <p>
                          Distance:{" "}
                          <span className="font-semibold text-zinc-200">
                            {cleanValue(distanceKm)} km
                          </span>
                        </p>

                        <p>
                          Measured:{" "}
                          <span className="font-semibold text-zinc-200">
                            {cleanValue(measurementDate)}
                          </span>
                        </p>

                        <p>
                          PDF:{" "}
                          <span
                            className={`font-semibold ${
                              record.pdf_path || record.pdf_url
                                ? "text-green-300"
                                : "text-zinc-500"
                            }`}
                          >
                            {record.pdf_path || record.pdf_url
                              ? "Linked"
                              : "Not linked"}
                          </span>
                        </p>
                      </div>
                    </button>

                    <div className="mt-4 flex flex-wrap justify-end gap-3 border-t border-zinc-800 pt-4">
                      <button
                        type="button"
                        onClick={() => setSelectedClutchRecord(record)}
                        className="rounded-xl border border-zinc-700 px-4 py-2 text-xs font-semibold text-zinc-300 hover:border-red-500 hover:text-red-300"
                      >
                        View Data
                      </button>

                      <button
                        type="button"
                        onClick={() => openClutchPdf(record, pdfKey)}
                        disabled={openingPdfKey === pdfKey}
                        className="rounded-xl border border-red-900/60 bg-red-950/30 px-4 py-2 text-xs font-semibold text-red-200 hover:border-red-500 hover:bg-red-950/50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {openingPdfKey === pdfKey ? "Opening..." : "Open PDF"}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold">
                Previous Post Event Sheets
              </h2>

              <p className="mt-1 text-sm text-zinc-500">
                Click a sheet to open the full record.
              </p>
            </div>

            <div className="rounded-2xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-sm font-semibold text-red-300">
              {filteredPostEventRows.length} / {postEventRows.length}
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">
                Filter Date
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
                Filter Track
              </span>

              <select
                value={trackFilter}
                onChange={(event) => setTrackFilter(event.target.value)}
                className="mt-2 w-full rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-sm text-zinc-100 outline-none focus:border-red-500"
              >
                <option value="all">All tracks</option>

                {trackOptions.map((track) => (
                  <option key={track} value={track}>
                    {track}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {(dateFilter || trackFilter !== "all") && (
            <button
              type="button"
              onClick={() => {
                setDateFilter("");
                setTrackFilter("all");
              }}
              className="mt-3 rounded-xl border border-zinc-700 px-4 py-2 text-xs font-semibold text-zinc-300 hover:border-red-500 hover:text-red-300"
            >
              Clear Filters
            </button>
          )}

          <div className="mt-5 max-h-[520px] space-y-3 overflow-y-auto pr-2">
            {filteredPostEventRows.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-zinc-700 bg-[#0d0f12] p-6 text-sm text-zinc-500">
                No post-event sheets found for this filter.
              </div>
            ) : (
              filteredPostEventRows.map((sheet) => {
                const isOpening = openingPostEventPdfId === sheet.id;

                return (
                  <div
                    key={sheet.id}
                    className="rounded-2xl border border-zinc-800 bg-[#0d0f12] p-4 transition hover:border-red-500/70 hover:bg-[#15191f]"
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedSheet(sheet)}
                      className="w-full text-left"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-red-400">
                            {sheet.track_name || "Unknown Track"}
                          </p>

                          <h3 className="mt-2 text-xl font-semibold text-zinc-100">
                            {sheet.chassis
                              ? `Chassis ${sheet.chassis}`
                              : `Car ${sheet.car_id}`}
                          </h3>

                          <p className="mt-1 text-sm text-zinc-400">
                            Driver:{" "}
                            <span className="font-semibold text-zinc-200">
                              {cleanValue(sheet.driver)}
                            </span>
                          </p>
                        </div>

                        <div className="rounded-xl border border-zinc-700 bg-[#111418] px-3 py-2 text-right">
                          <p className="text-xs text-zinc-500">Saved</p>

                          <p className="text-sm font-semibold text-zinc-200">
                            {niceDate(sheet.created_at)}
                          </p>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-2 text-sm text-zinc-400 sm:grid-cols-4">
                        <p>
                          Engine:{" "}
                          <span className="font-semibold text-zinc-200">
                            {cleanValue(sheet.engine_no)}
                          </span>
                        </p>

                        <p>
                          Gbox:{" "}
                          <span className="font-semibold text-zinc-200">
                            {cleanValue(sheet.gearbox_no)}
                          </span>
                        </p>

                        <p>
                          Fuel:{" "}
                          <span className="font-semibold text-zinc-200">
                            {cleanValue(sheet.fuel_drained_kg)} kg
                          </span>
                        </p>

                        <p>
                          PDF:{" "}
                          <span
                            className={`font-semibold ${
                              sheet.pdf_path ? "text-green-300" : "text-zinc-500"
                            }`}
                          >
                            {sheet.pdf_path ? "Linked" : "Not linked"}
                          </span>
                        </p>
                      </div>
                    </button>

                    <div className="mt-4 flex flex-wrap justify-end gap-3 border-t border-zinc-800 pt-4">
                      <button
                        type="button"
                        onClick={() => setSelectedSheet(sheet)}
                        className="rounded-xl border border-zinc-700 px-4 py-2 text-xs font-semibold text-zinc-300 hover:border-red-500 hover:text-red-300"
                      >
                        View Details
                      </button>

                      <button
                        type="button"
                        onClick={() => openPostEventPdf(sheet)}
                        disabled={isOpening || !sheet.pdf_path}
                        className="rounded-xl border border-red-900/60 bg-red-950/30 px-4 py-2 text-xs font-semibold text-red-200 hover:border-red-500 hover:bg-red-950/50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isOpening ? "Opening..." : "Open PDF"}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </section>

      <section className="mt-6 rounded-3xl border border-red-900/50 bg-[#181315] p-6 shadow-xl">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-red-400">
              Mechanic Feedback
            </p>

            <h2 className="mt-2 text-2xl font-semibold text-red-100">
              Job Notes
            </h2>

            <p className="mt-1 text-sm text-zinc-400">
              Notes added by mechanics against specific tasks.
            </p>
          </div>

          <div className="rounded-2xl border border-red-900/50 bg-[#0d0f12] px-4 py-3 text-sm font-semibold text-red-300">
            {mechanicJobNotes.length} notes
          </div>
        </div>

        {mechanicJobNotes.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-red-900/50 bg-[#0d0f12] p-6 text-sm text-zinc-500">
            No mechanic notes added yet.
          </div>
        ) : (
          <div className="max-h-[520px] space-y-3 overflow-y-auto pr-2">
            {mechanicJobNotes.map((job) => {
              const noteKey = `${job.section}-${job.job_id}`;
              const isClearing = clearingNoteKey === noteKey;

              return (
                <div
                  key={noteKey}
                  className="rounded-2xl border border-red-900/40 bg-[#0d0f12] p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-red-400">
                        {job.section} job #{job.job_id}
                      </p>

                      <h3 className="mt-2 text-base font-semibold text-zinc-100">
                        {job.job_text}
                      </h3>
                    </div>

                    <div className="rounded-xl border border-zinc-800 bg-[#111418] px-3 py-2 text-xs text-zinc-400">
                      {job.updated_at
                        ? new Date(job.updated_at).toLocaleString("en-GB")
                        : "No timestamp"}
                    </div>
                  </div>

                  <div className="mt-4 rounded-xl border border-zinc-800 bg-[#14181d] p-4 text-sm leading-6 text-zinc-200">
                    {job.notes}
                  </div>

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs text-zinc-500">
                      Added by {job.updated_by || "unknown"}
                    </p>

                    <button
                      type="button"
                      onClick={() => clearJobNote(job)}
                      disabled={isClearing || !canEditJobNotes}
                      className="rounded-lg border border-red-900/70 px-4 py-2 text-xs font-semibold text-red-300 transition hover:border-red-500 hover:bg-red-950/40 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isClearing ? "Clearing..." : "Clear Note"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {selectedClutchRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <div className="max-h-[90vh] w-full max-w-6xl overflow-y-auto rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-2xl">
            <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-red-400">
                  Clutch Measurement
                </p>

                <h2 className="mt-3 text-4xl font-semibold text-zinc-100">
                  Car {carId}
                </h2>

                <p className="mt-2 text-sm text-zinc-400">
                  Saved{" "}
                  <span className="font-semibold text-zinc-200">
                    {dateTimeFromUnknown(
                      getRecordValue(selectedClutchRecord, ["created_at"]),
                    )}
                  </span>{" "}
                  by{" "}
                  <span className="font-semibold text-zinc-200">
                    {cleanValue(
                      getRecordValue(selectedClutchRecord, [
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
                  onClick={() =>
                    openClutchPdf(selectedClutchRecord, "clutch-modal")
                  }
                  disabled={openingPdfKey === "clutch-modal"}
                  className="rounded-xl border border-red-900/60 bg-red-950/30 px-5 py-3 text-sm font-semibold text-red-200 transition hover:border-red-500 hover:bg-red-950/50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {openingPdfKey === "clutch-modal" ? "Opening..." : "Open PDF"}
                </button>

                <button
                  type="button"
                  onClick={() => setSelectedClutchRecord(null)}
                  className="rounded-xl border border-zinc-700 px-5 py-3 text-sm font-semibold text-zinc-200 hover:border-red-500 hover:text-red-300"
                >
                  Close
                </button>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              <DetailField
                label="Car Name"
                value={getRecordValue(selectedClutchRecord, ["car_name"])}
              />

              <DetailField
                label="Serial No"
                value={getRecordValue(selectedClutchRecord, ["serial_no"])}
              />

              <DetailField
                label="Clutch No"
                value={getRecordValue(selectedClutchRecord, ["clutch_no"])}
              />

              <DetailField
                label="Measurement Date"
                value={getRecordValue(selectedClutchRecord, [
                  "measurement_date",
                ])}
              />

              <DetailField
                label="Distance KM"
                value={getRecordValue(selectedClutchRecord, ["distance_km"])}
              />
            </div>

            <div className="mt-6 grid gap-6 xl:grid-cols-2">
              <PlateTable
                title="Driven Plates"
                value={selectedClutchRecord.driven_plates}
              />

              <PlateTable
                title="Intermediate Plates"
                value={selectedClutchRecord.intermediate_plates}
              />
            </div>

            <div className="mt-6 rounded-3xl border border-zinc-800 bg-[#0d0f12] p-5">
              <p className="mb-4 text-xs font-semibold uppercase tracking-[0.3em] text-red-400">
                Measurement Summary
              </p>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {Object.entries(selectedClutchRecord)
                  .filter(([key]) => !shouldHideFromClutchSummary(key))
                  .map(([key, value]) => (
                    <DetailField
                      key={key}
                      label={formatLabel(key)}
                      value={value}
                    />
                  ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {selectedSheet && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <div className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-2xl">
            <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-red-400">
                  Post Event Sheet
                </p>

                <h2 className="mt-3 text-4xl font-semibold text-zinc-100">
                  {selectedSheet.track_name || "Unknown Track"}
                </h2>

                <p className="mt-2 text-sm text-zinc-400">
                  Saved {niceDateTime(selectedSheet.created_at)} by{" "}
                  <span className="font-semibold text-zinc-200">
                    {selectedSheet.created_by || "unknown"}
                  </span>
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => openPostEventPdf(selectedSheet)}
                  disabled={
                    openingPostEventPdfId === selectedSheet.id ||
                    !selectedSheet.pdf_path
                  }
                  className="rounded-xl border border-red-900/60 bg-red-950/30 px-5 py-3 text-sm font-semibold text-red-200 transition hover:border-red-500 hover:bg-red-950/50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {openingPostEventPdfId === selectedSheet.id
                    ? "Opening..."
                    : "Open PDF"}
                </button>

                <button
                  type="button"
                  onClick={() => setSelectedSheet(null)}
                  className="rounded-xl border border-zinc-700 px-5 py-3 text-sm font-semibold text-zinc-200 hover:border-red-500 hover:text-red-300"
                >
                  Close
                </button>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              <DetailField label="Chassis" value={selectedSheet.chassis} />

              <DetailField label="Driver" value={selectedSheet.driver} />

              <DetailField
                label="Engine No."
                value={selectedSheet.engine_no}
              />

              <DetailField
                label="Hours Remaining"
                value={selectedSheet.hours_remaining}
              />

              <DetailField
                label="Gearbox No."
                value={selectedSheet.gearbox_no}
              />
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <DetailField
                label="Fuel Drained"
                value={
                  selectedSheet.fuel_drained_kg
                    ? `${selectedSheet.fuel_drained_kg} kg`
                    : null
                }
              />

              <DetailField
                label="Front Ride Height"
                value={selectedSheet.front_ride_height}
              />

              <DetailField
                label="Rear Ride Height"
                value={selectedSheet.rear_ride_height}
              />

              <DetailField
                label="PDF"
                value={selectedSheet.pdf_path ? "Linked" : "Not linked"}
              />
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <DetailField
                label="Diff Break-Off"
                value={selectedSheet.diff_break_off}
              />

              <DetailField
                label="Diff Dynamic"
                value={selectedSheet.diff_dynamic}
              />
            </div>

            <div className="mt-6 rounded-2xl border border-zinc-800 bg-[#0d0f12] p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">
                Notes
              </p>

              <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-zinc-200">
                {selectedSheet.notes?.trim() || "No notes added."}
              </p>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}