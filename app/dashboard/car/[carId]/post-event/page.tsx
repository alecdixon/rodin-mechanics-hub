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
  diff_break_off: string | null;
  diff_dynamic: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string | null;
  pdf_path?: string | null;
  pdf_url?: string | null;
};

function niceDate(value: string | null | undefined) {
  if (!value) return "No date";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "No date";
  }

  return date.toLocaleDateString("en-GB");
}

function niceDateTime(value: string | null | undefined) {
  if (!value) return "No timestamp";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "No timestamp";
  }

  return date.toLocaleString("en-GB");
}

function cleanValue(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "—";

  const text = String(value).trim();

  return text || "—";
}

function DetailField({
  label,
  value,
}: {
  label: string;
  value: string | number | null | undefined;
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

export default function ChiefPostEventPage() {
  const params = useParams();
  const router = useRouter();

  const carId = Number(params.carId);

  const [loading, setLoading] = useState(true);
  const [sheets, setSheets] = useState<PostEventSheet[]>([]);
  const [selectedSheet, setSelectedSheet] = useState<PostEventSheet | null>(
    null,
  );

  const [dateFilter, setDateFilter] = useState("");
  const [trackFilter, setTrackFilter] = useState("all");
  const [driverFilter, setDriverFilter] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

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

    if (!hasPermission(email, "post_event:view")) {
      router.replace("/dashboard");
      return null;
    }

    return email;
  }

  async function loadPostEventSheets() {
    setLoading(true);
    setErrorMessage("");

    const email = await checkAccess();

    if (!email) {
      return;
    }

    const { data, error } = await supabase
      .from("post_event_sheets")
      .select("*")
      .eq("car_id", carId)
      .order("created_at", { ascending: false });

    if (error) {
      setErrorMessage(error.message);
      setLoading(false);
      return;
    }

    setSheets((data ?? []) as PostEventSheet[]);
    setLoading(false);
  }

  useEffect(() => {
    if (carId) {
      loadPostEventSheets();
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carId]);

  const trackOptions = useMemo(() => {
    const tracks = sheets
      .map((sheet) => sheet.track_name?.trim())
      .filter((track): track is string => Boolean(track));

    return Array.from(new Set(tracks)).sort((a, b) => a.localeCompare(b));
  }, [sheets]);

  const filteredSheets = useMemo(() => {
    return sheets.filter((sheet) => {
      const sheetDate = sheet.created_at ? sheet.created_at.slice(0, 10) : "";

      const matchesDate = dateFilter ? sheetDate === dateFilter : true;

      const matchesTrack =
        trackFilter === "all"
          ? true
          : (sheet.track_name || "").trim() === trackFilter;

      const matchesDriver = driverFilter.trim()
        ? (sheet.driver || "")
            .toLowerCase()
            .includes(driverFilter.trim().toLowerCase())
        : true;

      return matchesDate && matchesTrack && matchesDriver;
    });
  }, [sheets, dateFilter, trackFilter, driverFilter]);

  const latestSheet = sheets[0] ?? null;

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0d0f12] text-zinc-400">
        Loading post-event sheets...
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0d0f12] p-6 text-zinc-100">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/dashboard"
            className="text-sm text-red-400 hover:text-red-300"
          >
            ← Back to dashboard
          </Link>

          <p className="mt-6 text-xs uppercase tracking-[0.3em] text-red-400">
            Post Event Review
          </p>

          <h1 className="mt-3 text-4xl font-semibold">
            Car {carId} Post Event Sheets
          </h1>

          <p className="mt-3 max-w-3xl text-sm text-zinc-400">
            Review post-event sheets submitted for this car, filter previous
            records, and inspect full saved sheet details.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <Link
            href={`/car/${carId}/post-event`}
            className="rounded-xl border border-zinc-700 bg-[#14181d] px-5 py-3 text-sm font-semibold text-zinc-200 hover:border-red-500 hover:text-red-300"
          >
            Open Mechanic Sheet
          </Link>

          <LogoutButton />
        </div>
      </div>

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

          <h2 className="mt-4 text-6xl font-bold text-zinc-100">
            {sheets.length}
          </h2>

          <p className="mt-3 text-sm text-zinc-500">
            post-event sheet{sheets.length === 1 ? "" : "s"} saved
          </p>
        </div>

        <div className="rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-red-400">
            Latest Sheet
          </p>

          <h2 className="mt-4 text-2xl font-semibold text-zinc-100">
            {latestSheet
              ? niceDateTime(latestSheet.created_at)
              : "No records yet"}
          </h2>

          <p className="mt-3 text-sm text-zinc-500">
            Most recent post-event sheet submitted
          </p>
        </div>

        <div className="rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-red-400">
            Latest Track
          </p>

          <h2 className="mt-4 break-words text-2xl font-semibold text-zinc-100">
            {latestSheet ? cleanValue(latestSheet.track_name) : "—"}
          </h2>

          <p className="mt-3 text-sm text-zinc-500">
            Track from the latest submitted sheet
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
              Search Post Event Records
            </h2>
          </div>

          <button
            type="button"
            onClick={loadPostEventSheets}
            className="rounded-xl border border-zinc-700 px-5 py-3 text-sm font-semibold text-zinc-200 hover:border-red-500 hover:text-red-300"
          >
            Refresh
          </button>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-[220px_1fr_1fr_auto]">
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
              Track
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

          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">
              Driver
            </span>

            <input
              value={driverFilter}
              onChange={(event) => setDriverFilter(event.target.value)}
              placeholder="Search driver..."
              className="mt-2 w-full rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-sm text-zinc-100 outline-none focus:border-red-500"
            />
          </label>

          <div className="flex items-end">
            <button
              type="button"
              onClick={() => {
                setDateFilter("");
                setTrackFilter("all");
                setDriverFilter("");
              }}
              className="w-full rounded-xl border border-zinc-700 px-5 py-3 text-sm font-semibold text-zinc-300 hover:border-red-500 hover:text-red-300"
            >
              Clear
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-red-400">
              Post Event History
            </p>

            <h2 className="mt-3 text-3xl font-semibold">Saved Sheets</h2>

            <p className="mt-2 text-sm text-zinc-400">
              Click a sheet to inspect the full post-event record.
            </p>
          </div>

          <div className="rounded-2xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-sm font-semibold text-red-300">
            {filteredSheets.length} / {sheets.length}
          </div>
        </div>

        {filteredSheets.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-700 bg-[#0d0f12] p-8 text-sm text-zinc-500">
            No post-event sheets found for this filter.
          </div>
        ) : (
          <div className="space-y-3">
            {filteredSheets.map((sheet) => (
              <button
                key={sheet.id}
                type="button"
                onClick={() => setSelectedSheet(sheet)}
                className="w-full rounded-2xl border border-zinc-800 bg-[#0d0f12] p-5 text-left transition hover:border-red-500/70 hover:bg-[#15191f]"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-red-400">
                      {sheet.track_name || "Unknown Track"}
                    </p>

                    <h3 className="mt-2 text-2xl font-semibold text-zinc-100">
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

                  <div className="rounded-xl border border-zinc-700 bg-[#111418] px-4 py-3 text-right text-sm">
                    <p className="text-xs text-zinc-500">Saved</p>

                    <p className="font-semibold text-zinc-100">
                      {niceDate(sheet.created_at)}
                    </p>
                  </div>
                </div>

                <div className="mt-4 grid gap-2 text-sm text-zinc-400 md:grid-cols-4">
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
                    Saved by:{" "}
                    <span className="font-semibold text-zinc-200">
                      {cleanValue(sheet.created_by)}
                    </span>
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      {selectedSheet && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <div className="max-h-[90vh] w-full max-w-6xl overflow-y-auto rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-2xl">
            <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-red-400">
                  Post Event Sheet
                </p>

                <h2 className="mt-3 text-4xl font-semibold text-zinc-100">
                  {selectedSheet.track_name || "Unknown Track"}
                </h2>

                <p className="mt-2 text-sm text-zinc-400">
                  Saved{" "}
                  <span className="font-semibold text-zinc-200">
                    {niceDateTime(selectedSheet.created_at)}
                  </span>{" "}
                  by{" "}
                  <span className="font-semibold text-zinc-200">
                    {selectedSheet.created_by || "unknown"}
                  </span>
                </p>
              </div>

              <button
                type="button"
                onClick={() => setSelectedSheet(null)}
                className="rounded-xl border border-zinc-700 px-5 py-3 text-sm font-semibold text-zinc-200 hover:border-red-500 hover:text-red-300"
              >
                Close
              </button>
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

            <div className="mt-6 grid gap-4 md:grid-cols-3">
              <DetailField
                label="Fuel Drained"
                value={
                  selectedSheet.fuel_drained_kg
                    ? `${selectedSheet.fuel_drained_kg} kg`
                    : null
                }
              />

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

            {(selectedSheet.pdf_url || selectedSheet.pdf_path) && (
              <div className="mt-6 rounded-2xl border border-red-900/50 bg-[#181315] p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-red-400">
                  Saved PDF
                </p>

                <p className="mt-3 break-words text-sm text-zinc-300">
                  {selectedSheet.pdf_url || selectedSheet.pdf_path}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}