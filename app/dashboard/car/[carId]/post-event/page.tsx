"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { hasPermission } from "@/lib/userAccess";
import LogoutButton from "@/app/components/LogoutButton";

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

export default function ChiefPostEventRecordsPage() {
  const params = useParams();
  const router = useRouter();

  const carId = Number(params.carId);

  const [loading, setLoading] = useState(true);
  const [postEventRows, setPostEventRows] = useState<PostEventSheet[]>([]);
  const [selectedSheet, setSelectedSheet] = useState<PostEventSheet | null>(
    null,
  );

  const [dateFilter, setDateFilter] = useState("");
  const [trackFilter, setTrackFilter] = useState("all");

  const [openingPostEventPdfId, setOpeningPostEventPdfId] = useState<
    string | null
  >(null);

  const [deletingPostEventId, setDeletingPostEventId] = useState<string | null>(
    null,
  );

  const [errorMessage, setErrorMessage] = useState("");
  const [message, setMessage] = useState("");
  const [canDeletePostEvent, setCanDeletePostEvent] = useState(false);

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
      hasPermission(email, "dashboard:view") &&
      hasPermission(email, "cars:view") &&
      hasPermission(email, "post_event:view");

    if (!allowed) {
      router.replace("/dashboard");
      return null;
    }

    setCanDeletePostEvent(hasPermission(email, "post_event:edit"));

    return email;
  }

  async function loadPostEventSheets() {
    const email = await checkAccess();

    if (!email) {
      return;
    }

    setLoading(true);
    setMessage("");
    setErrorMessage("");

    const { data, error } = await supabase
      .from("post_event_sheets")
      .select("*")
      .eq("car_id", carId)
      .order("created_at", { ascending: false });

    if (error) {
      setErrorMessage(`Post-event sheets failed: ${error.message}`);
      setPostEventRows([]);
      setLoading(false);
      return;
    }

    setPostEventRows((data ?? []) as PostEventSheet[]);
    setLoading(false);
  }

  useEffect(() => {
    if (carId) {
      loadPostEventSheets();
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carId, router]);

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

  async function deletePostEventSheet(sheet: PostEventSheet) {
    if (!canDeletePostEvent) {
      setErrorMessage("You do not have permission to delete post-event sheets.");
      return;
    }

    const confirmed = window.confirm(
      `Delete this post-event sheet?\n\nCar ${sheet.car_id}\nSaved: ${niceDateTime(
        sheet.created_at,
      )}\n\nThis will delete the database record and its linked PDF if one exists.`,
    );

    if (!confirmed) return;

    setMessage("");
    setErrorMessage("");
    setDeletingPostEventId(sheet.id);

    if (sheet.pdf_path) {
      const { error: storageError } = await supabase.storage
        .from(POST_EVENT_PDF_BUCKET)
        .remove([sheet.pdf_path]);

      if (storageError) {
        setErrorMessage(`PDF delete failed: ${storageError.message}`);
        setDeletingPostEventId(null);
        return;
      }
    }

    const { error } = await supabase
      .from("post_event_sheets")
      .delete()
      .eq("id", sheet.id);

    if (error) {
      setErrorMessage(`Post-event sheet delete failed: ${error.message}`);
      setDeletingPostEventId(null);
      return;
    }

    setPostEventRows((current) =>
      current.filter((item) => item.id !== sheet.id),
    );

    if (selectedSheet?.id === sheet.id) {
      setSelectedSheet(null);
    }

    setMessage("Post-event sheet deleted.");
    setDeletingPostEventId(null);
  }

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

  const linkedPdfCount = useMemo(() => {
    return postEventRows.filter((sheet) => Boolean(sheet.pdf_path)).length;
  }, [postEventRows]);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0d0f12] text-zinc-400">
        Loading Car {carId} post-event records...
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0d0f12] p-6 text-zinc-100">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-red-400">
            Chief Mechanic
          </p>

          <h1 className="mt-3 text-4xl font-semibold">
            Car {carId} Post-Event Sheets
          </h1>

          <p className="mt-3 max-w-3xl text-sm text-zinc-400">
            View, open and delete saved post-event sheet records for this car.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <Link
            href={`/dashboard/car/${carId}/viewer`}
            className="rounded-xl border border-zinc-700 px-5 py-3 text-sm font-semibold text-zinc-200 hover:border-red-500 hover:text-red-300"
          >
            Back to Car Overview
          </Link>

          <Link
            href={`/car/${carId}/post-event`}
            className="rounded-xl bg-red-700 px-5 py-3 text-sm font-semibold text-white hover:bg-red-600"
          >
            New Sheet
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

      <section className="mb-6 grid gap-6 lg:grid-cols-3">
        <div className="rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-red-400">
            Records
          </p>

          <div className="mt-5 text-6xl font-bold text-red-400">
            {postEventRows.length}
          </div>

          <p className="mt-3 text-sm text-zinc-500">
            Total post-event sheets saved for Car {carId}.
          </p>
        </div>

        <div className="rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-red-400">
            PDFs
          </p>

          <div className="mt-5 text-6xl font-bold text-red-400">
            {linkedPdfCount}
          </div>

          <p className="mt-3 text-sm text-zinc-500">
            Records with linked PDF files in storage.
          </p>
        </div>

        <div className="rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-red-400">
            Filtered
          </p>

          <div className="mt-5 text-6xl font-bold text-red-400">
            {filteredPostEventRows.length}
          </div>

          <p className="mt-3 text-sm text-zinc-500">
            Records currently visible after filters.
          </p>
        </div>
      </section>

      <section className="rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold">
              Previous Post-Event Sheets
            </h2>

            <p className="mt-1 text-sm text-zinc-500">
              Open each saved post-event sheet as a PDF, view details, or delete
              the record.
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

        <div className="mt-5 max-h-[680px] space-y-3 overflow-y-auto pr-2">
          {filteredPostEventRows.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-zinc-700 bg-[#0d0f12] p-6 text-sm text-zinc-500">
              No post-event sheets found for this filter.
            </div>
          ) : (
            filteredPostEventRows.map((sheet) => {
              const isOpening = openingPostEventPdfId === sheet.id;
              const isDeleting = deletingPostEventId === sheet.id;

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

                    {canDeletePostEvent && (
                      <button
                        type="button"
                        onClick={() => deletePostEventSheet(sheet)}
                        disabled={isDeleting}
                        className="rounded-xl border border-red-800 bg-red-950/40 px-4 py-2 text-xs font-semibold text-red-300 hover:border-red-500 hover:bg-red-950/60 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isDeleting ? "Deleting..." : "Delete"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

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

                {canDeletePostEvent && (
                  <button
                    type="button"
                    onClick={() => deletePostEventSheet(selectedSheet)}
                    disabled={deletingPostEventId === selectedSheet.id}
                    className="rounded-xl border border-red-800 bg-red-950/40 px-5 py-3 text-sm font-semibold text-red-300 transition hover:border-red-500 hover:bg-red-950/60 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {deletingPostEventId === selectedSheet.id
                      ? "Deleting..."
                      : "Delete"}
                  </button>
                )}

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