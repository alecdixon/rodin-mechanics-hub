"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getAssignedCar, getUserRole } from "@/lib/userAccess";
import LogoutButton from "@/app/components/LogoutButton";

type CarProgress = {
  id: number;
  name: string;
  progress: number;
  status: string;
  total: number;
  completed: number;
};

type CalendarEvent = {
  id: string;
  event_name: string;
  track_name: string | null;
  start_date: string;
  end_date: string | null;
  event_type: string | null;
  location: string | null;
  notes: string | null;
  colour: string | null;
  created_at: string | null;
};

type CsvCalendarRow = {
  event_name: string;
  track_name: string | null;
  start_date: string;
  end_date: string | null;
  event_type: string | null;
  location: string | null;
  notes: string | null;
  colour: string | null;
};

const CAR_META = [
  { id: 1, name: "GB3-01" },
  { id: 2, name: "GB3-02" },
  { id: 3, name: "GB3-03" },
];

function ProgressDial({ progress }: { progress: number }) {
  const angle = progress * 3.6;

  return (
    <div
      className="grid h-36 w-36 place-items-center rounded-full shadow-inner"
      style={{
        background: `conic-gradient(#b91c1c ${angle}deg, #2a2f36 ${angle}deg)`,
      }}
    >
      <div className="grid h-28 w-28 place-items-center rounded-full bg-[#111418]">
        <div className="text-center">
          <div className="text-3xl font-semibold">{progress}%</div>
          <div className="text-xs uppercase tracking-widest text-zinc-500">
            Jobs
          </div>
        </div>
      </div>
    </div>
  );
}

function niceDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-GB");
}

function splitCsvLine(line: string) {
  const result: string[] = [];
  let current = "";
  let insideQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];

    if (char === '"' && insideQuotes && nextChar === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      insideQuotes = !insideQuotes;
    } else if (char === "," && !insideQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}

function parseCalendarCsv(csvText: string): CsvCalendarRow[] {
  const lines = csvText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0]).map((header) =>
    header.trim().toLowerCase(),
  );

  const requiredHeaders = ["event_name", "start_date"];

  for (const required of requiredHeaders) {
    if (!headers.includes(required)) {
      throw new Error(`CSV is missing required column: ${required}`);
    }
  }

  return lines.slice(1).map((line, index) => {
    const values = splitCsvLine(line);
    const row: Record<string, string> = {};

    headers.forEach((header, headerIndex) => {
      row[header] = values[headerIndex]?.trim() ?? "";
    });

    if (!row.event_name) {
      throw new Error(`Row ${index + 2} is missing event_name.`);
    }

    if (!row.start_date) {
      throw new Error(`Row ${index + 2} is missing start_date.`);
    }

    return {
      event_name: row.event_name,
      track_name: row.track_name || null,
      start_date: row.start_date,
      end_date: row.end_date || null,
      event_type: row.event_type || null,
      location: row.location || null,
      notes: row.notes || null,
      colour: row.colour || "#b91c1c",
    };
  });
}

export default function DashboardPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [cars, setCars] = useState<CarProgress[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [importingCalendar, setImportingCalendar] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const loadProgress = useCallback(async () => {
    const { data, error } = await supabase
      .from("job_progress")
      .select("car_id,done");

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    const carMap: Record<number, { total: number; done: number }> = {};

    (data ?? []).forEach((row: { car_id: number; done: boolean }) => {
      if (!carMap[row.car_id]) {
        carMap[row.car_id] = { total: 0, done: 0 };
      }

      carMap[row.car_id].total += 1;

      if (row.done) {
        carMap[row.car_id].done += 1;
      }
    });

    setCars(
      CAR_META.map((car) => {
        const stats = carMap[car.id] ?? { total: 0, done: 0 };
        const progress = stats.total
          ? Math.round((stats.done / stats.total) * 100)
          : 0;

        const status =
          progress === 100 && stats.total > 0
            ? "Complete"
            : progress > 0
              ? "In Progress"
              : "Open Jobs";

        return {
          id: car.id,
          name: car.name,
          progress,
          status,
          total: stats.total,
          completed: stats.done,
        };
      }),
    );
  }, []);

  const loadCalendar = useCallback(async () => {
    setCalendarLoading(true);

    const { data, error } = await supabase
      .from("season_calendar")
      .select("*")
      .order("start_date", { ascending: true });

    if (error) {
      setErrorMessage(error.message);
      setCalendarLoading(false);
      return;
    }

    setCalendarEvents((data ?? []) as CalendarEvent[]);
    setCalendarLoading(false);
  }, []);

  useEffect(() => {
    async function checkAccess() {
      const { data } = await supabase.auth.getUser();
      const email = data.user?.email ?? "";
      const role = getUserRole(email);

      if (role === "mechanic") {
        const carId = getAssignedCar(email);
        router.replace(`/car/${carId}/job-list`);
        return;
      }

      if (role !== "chief") {
        router.replace("/login");
        return;
      }

      await loadProgress();
      await loadCalendar();
      setLoading(false);
    }

    checkAccess();
  }, [loadProgress, loadCalendar, router]);

  useEffect(() => {
    const channel = supabase
      .channel("dashboard-job-progress")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "job_progress" },
        () => loadProgress(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadProgress]);

  const upcomingEvents = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return calendarEvents.filter((event) => {
      const endDate = event.end_date || event.start_date;
      return new Date(endDate) >= today;
    });
  }, [calendarEvents]);

  async function handleCalendarCsvUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setMessage("");
    setErrorMessage("");
    setImportingCalendar(true);

    try {
      const csvText = await file.text();
      const rows = parseCalendarCsv(csvText);

      if (rows.length === 0) {
        throw new Error("CSV contains no calendar rows.");
      }

      const { error } = await supabase.from("season_calendar").insert(rows);

      if (error) {
        throw new Error(error.message);
      }

      setMessage(`Imported ${rows.length} calendar event(s).`);
      await loadCalendar();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Calendar import failed.",
      );
    }

    event.target.value = "";
    setImportingCalendar(false);
  }

  async function clearCalendar() {
    const confirmed = window.confirm(
      "Clear the whole season calendar? This will remove all imported calendar events.",
    );

    if (!confirmed) return;

    setMessage("");
    setErrorMessage("");

    const { error } = await supabase
      .from("season_calendar")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    setMessage("Season calendar cleared.");
    await loadCalendar();
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0d0f12] text-zinc-400">
        Loading chief dashboard...
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0d0f12] p-6 text-zinc-100">
      <header className="mb-8 rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-5">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-red-400">
              Rodin Motorsport
            </p>

            <h1 className="mt-3 text-4xl font-semibold tracking-tight">
              Chief Mechanic Dashboard
            </h1>

            <p className="mt-2 max-w-2xl text-sm text-zinc-400">
              Live overview of car preparation progress, clutch measurements,
              post-event records and the season calendar.
            </p>
          </div>

          <LogoutButton />
        </div>
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

      <section className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {cars.map((car) => (
          <Link
            key={car.id}
            href={`/dashboard/car/${car.id}/viewer`}
            className="group rounded-3xl border border-zinc-800 bg-[#14181d] p-7 shadow-lg transition hover:-translate-y-1 hover:border-red-500/70 hover:bg-[#181d23]"
          >
            <div className="flex flex-col items-center">
              <ProgressDial progress={car.progress} />

              <div className="mt-6 text-center">
                <h2 className="text-2xl font-semibold tracking-tight">
                  {car.name}
                </h2>

                <div className="mt-3 inline-flex rounded-full border border-zinc-700 bg-[#0d0f12] px-3 py-1 text-xs text-zinc-300">
                  {car.status}
                </div>

                <p className="mt-3 text-sm text-zinc-500">
                  {car.completed} of {car.total || "—"} jobs complete
                </p>

                <p className="mt-4 text-sm text-zinc-500 group-hover:text-zinc-300">
                  Open car viewer →
                </p>
              </div>
            </div>
          </Link>
        ))}
      </section>

      <section className="mt-8 rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-red-400">
              Season Calendar
            </p>

            <h2 className="mt-3 text-3xl font-semibold">
              Imported Calendar
            </h2>

            <p className="mt-2 max-w-3xl text-sm text-zinc-400">
              Upload a CSV calendar to show race weekends, tests and important
              team events below the car overview.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <label className="cursor-pointer rounded-xl bg-red-700 px-5 py-3 text-sm font-semibold text-white hover:bg-red-600">
              {importingCalendar ? "Importing..." : "Import CSV"}
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={handleCalendarCsvUpload}
                disabled={importingCalendar}
                className="hidden"
              />
            </label>

            <button
              type="button"
              onClick={clearCalendar}
              className="rounded-xl border border-red-900/70 px-5 py-3 text-sm font-semibold text-red-300 hover:bg-red-950/40"
            >
              Clear Calendar
            </button>
          </div>
        </div>

        <div className="mb-5 rounded-2xl border border-zinc-800 bg-[#0d0f12] p-4 text-sm text-zinc-400">
          CSV format:{" "}
          <span className="font-mono text-zinc-200">
            event_name, track_name, start_date, end_date, event_type, location,
            notes, colour
          </span>
        </div>

        {calendarLoading ? (
          <div className="rounded-2xl border border-zinc-800 bg-[#0d0f12] p-6 text-sm text-zinc-500">
            Loading calendar...
          </div>
        ) : calendarEvents.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-700 bg-[#0d0f12] p-6 text-sm text-zinc-500">
            No calendar events imported yet.
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
            <div className="max-h-[620px] space-y-3 overflow-y-auto pr-2">
              {calendarEvents.map((event) => (
                <div
                  key={event.id}
                  className="rounded-2xl border border-zinc-800 bg-[#0d0f12] p-5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="flex flex-wrap items-center gap-3">
                        <span
                          className="h-3 w-3 rounded-full"
                          style={{
                            backgroundColor: event.colour || "#b91c1c",
                          }}
                        />

                        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-red-400">
                          {event.event_type || "Event"}
                        </p>
                      </div>

                      <h3 className="mt-3 text-2xl font-semibold text-zinc-100">
                        {event.event_name}
                      </h3>

                      <p className="mt-1 text-sm text-zinc-400">
                        {event.track_name || "No track"}{" "}
                        {event.location ? `· ${event.location}` : ""}
                      </p>
                    </div>

                    <div className="rounded-xl border border-zinc-700 bg-[#111418] px-4 py-3 text-right text-sm">
                      <p className="font-semibold text-zinc-100">
                        {niceDate(event.start_date)}
                      </p>

                      {event.end_date && event.end_date !== event.start_date && (
                        <p className="text-zinc-500">
                          to {niceDate(event.end_date)}
                        </p>
                      )}
                    </div>
                  </div>

                  {event.notes && (
                    <p className="mt-4 rounded-xl border border-zinc-800 bg-[#14181d] p-4 text-sm leading-6 text-zinc-300">
                      {event.notes}
                    </p>
                  )}
                </div>
              ))}
            </div>

            <aside className="rounded-2xl border border-zinc-800 bg-[#0d0f12] p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-red-400">
                Upcoming
              </p>

              <h3 className="mt-3 text-2xl font-semibold">
                Next Events
              </h3>

              <div className="mt-5 space-y-3">
                {upcomingEvents.length === 0 ? (
                  <p className="text-sm text-zinc-500">
                    No upcoming events.
                  </p>
                ) : (
                  upcomingEvents.slice(0, 5).map((event) => (
                    <div
                      key={event.id}
                      className="rounded-xl border border-zinc-800 bg-[#14181d] p-4"
                    >
                      <p className="text-sm font-semibold text-zinc-100">
                        {event.event_name}
                      </p>

                      <p className="mt-1 text-xs text-zinc-500">
                        {niceDate(event.start_date)}
                        {event.track_name ? ` · ${event.track_name}` : ""}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </aside>
          </div>
        )}
      </section>
    </main>
  );
}