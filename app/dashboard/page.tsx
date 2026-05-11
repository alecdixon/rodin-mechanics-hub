"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getAssignedCar, getUserRole } from "@/lib/userAccess";
import LogoutButton from "@/app/components/LogoutButton";

type DashboardCar = {
  id: number;
  name: string;
  colour: string | null;
  active: boolean;
  sort_order: number | null;
  created_at?: string | null;
};

type CarProgress = {
  id: number;
  name: string;
  colour: string;
  progress: number;
  status: string;
  total: number;
  completed: number;
  active: boolean;
  sort_order: number;
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

const DEFAULT_CAR_COLOUR = "#b91c1c";

function ProgressDial({
  progress,
  colour,
}: {
  progress: number;
  colour: string;
}) {
  const angle = progress * 3.6;

  return (
    <div
      className="grid h-36 w-36 place-items-center rounded-full shadow-inner"
      style={{
        background: `conic-gradient(${colour} ${angle}deg, #2a2f36 ${angle}deg)`,
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
      colour: row.colour || DEFAULT_CAR_COLOUR,
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

  const [carSettingsOpen, setCarSettingsOpen] = useState(false);
  const [savingCarId, setSavingCarId] = useState<number | null>(null);
  const [addingCar, setAddingCar] = useState(false);

  const [newCarId, setNewCarId] = useState("");
  const [newCarName, setNewCarName] = useState("");
  const [newCarColour, setNewCarColour] = useState(DEFAULT_CAR_COLOUR);

  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const loadCarsAndProgress = useCallback(async () => {
    const { data: carData, error: carError } = await supabase
      .from("dashboard_cars")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true });

    if (carError) {
      setErrorMessage(carError.message);
      return;
    }

    const { data: progressData, error: progressError } = await supabase
      .from("job_progress")
      .select("car_id,done");

    if (progressError) {
      setErrorMessage(progressError.message);
      return;
    }

    const carMap: Record<number, { total: number; done: number }> = {};

    (progressData ?? []).forEach((row: { car_id: number; done: boolean }) => {
      if (!carMap[row.car_id]) {
        carMap[row.car_id] = { total: 0, done: 0 };
      }

      carMap[row.car_id].total += 1;

      if (row.done) {
        carMap[row.car_id].done += 1;
      }
    });

    const cleanCars = ((carData ?? []) as DashboardCar[]).map((car) => {
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
        colour: car.colour || DEFAULT_CAR_COLOUR,
        active: car.active,
        sort_order: car.sort_order ?? car.id,
        progress,
        status,
        total: stats.total,
        completed: stats.done,
      };
    });

    setCars(cleanCars);
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

      await loadCarsAndProgress();
      await loadCalendar();
      setLoading(false);
    }

    checkAccess();
  }, [loadCarsAndProgress, loadCalendar, router]);

  useEffect(() => {
    const channel = supabase
      .channel("dashboard-job-progress")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "job_progress" },
        () => loadCarsAndProgress(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadCarsAndProgress]);

  const activeCars = useMemo(() => {
    return cars
      .filter((car) => car.active)
      .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
  }, [cars]);

  const upcomingEvents = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return calendarEvents.filter((event) => {
      const endDate = event.end_date || event.start_date;
      return new Date(endDate) >= today;
    });
  }, [calendarEvents]);

  async function updateCar(car: CarProgress, updates: Partial<DashboardCar>) {
    setSavingCarId(car.id);
    setMessage("");
    setErrorMessage("");

    const { error } = await supabase
      .from("dashboard_cars")
      .update(updates)
      .eq("id", car.id);

    if (error) {
      setErrorMessage(error.message);
      setSavingCarId(null);
      return;
    }

    setCars((current) =>
      current.map((item) =>
        item.id === car.id
          ? {
              ...item,
              name: updates.name ?? item.name,
              colour: updates.colour ?? item.colour,
              active:
                typeof updates.active === "boolean"
                  ? updates.active
                  : item.active,
              sort_order:
                typeof updates.sort_order === "number"
                  ? updates.sort_order
                  : item.sort_order,
            }
          : item,
      ),
    );

    setSavingCarId(null);
    setMessage("Car settings saved.");
  }

  async function addCar() {
    const id = Number(newCarId);
    const name = newCarName.trim();

    setMessage("");
    setErrorMessage("");

    if (!id || id < 1) {
      setErrorMessage("Enter a valid car ID number.");
      return;
    }

    if (!name) {
      setErrorMessage("Enter a car name.");
      return;
    }

    const existing = cars.find((car) => car.id === id);
    if (existing) {
      setErrorMessage(`Car ID ${id} already exists.`);
      return;
    }

    setAddingCar(true);

    const { error } = await supabase.from("dashboard_cars").insert({
      id,
      name,
      colour: newCarColour || DEFAULT_CAR_COLOUR,
      active: true,
      sort_order: id,
    });

    if (error) {
      setErrorMessage(error.message);
      setAddingCar(false);
      return;
    }

    setNewCarId("");
    setNewCarName("");
    setNewCarColour(DEFAULT_CAR_COLOUR);
    setMessage(`Added ${name}.`);

    await loadCarsAndProgress();
    setAddingCar(false);
  }

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
              Live overview of car preparation progress, post-event records,
              car settings and the season calendar.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setCarSettingsOpen((current) => !current)}
              className="rounded-xl border border-zinc-700 bg-[#1b2026] px-5 py-3 text-sm font-semibold text-zinc-200 hover:border-red-500 hover:bg-[#222832]"
            >
              {carSettingsOpen ? "Hide Car Settings" : "Manage Cars"}
            </button>

            <LogoutButton />
          </div>
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

      {carSettingsOpen && (
        <section className="mb-8 rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
          <div className="mb-6">
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-red-400">
              Dashboard Settings
            </p>

            <h2 className="mt-3 text-3xl font-semibold">Manage Cars</h2>

            <p className="mt-2 max-w-3xl text-sm text-zinc-400">
              Change car names, dashboard colours, visibility and display order.
              Hiding a car does not delete any historic job data.
            </p>
          </div>

          <div className="space-y-3">
            {cars.map((car) => (
              <div
                key={car.id}
                className="grid gap-3 rounded-2xl border border-zinc-800 bg-[#0d0f12] p-4 lg:grid-cols-[80px_1fr_140px_120px_120px_auto]"
              >
                <div>
                  <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">
                    ID
                  </p>
                  <p className="mt-2 text-lg font-semibold text-zinc-100">
                    {car.id}
                  </p>
                </div>

                <label>
                  <span className="text-xs uppercase tracking-[0.22em] text-zinc-500">
                    Name
                  </span>
                  <input
                    value={car.name}
                    onChange={(event) =>
                      setCars((current) =>
                        current.map((item) =>
                          item.id === car.id
                            ? { ...item, name: event.target.value }
                            : item,
                        ),
                      )
                    }
                    className="mt-2 w-full rounded-xl border border-zinc-700 bg-[#111418] px-4 py-3 text-sm text-zinc-100 outline-none focus:border-red-500"
                  />
                </label>

                <label>
                  <span className="text-xs uppercase tracking-[0.22em] text-zinc-500">
                    Colour
                  </span>
                  <input
                    type="color"
                    value={car.colour}
                    onChange={(event) =>
                      setCars((current) =>
                        current.map((item) =>
                          item.id === car.id
                            ? { ...item, colour: event.target.value }
                            : item,
                        ),
                      )
                    }
                    className="mt-2 h-[46px] w-full rounded-xl border border-zinc-700 bg-[#111418] p-1"
                  />
                </label>

                <label>
                  <span className="text-xs uppercase tracking-[0.22em] text-zinc-500">
                    Order
                  </span>
                  <input
                    type="number"
                    value={car.sort_order}
                    onChange={(event) =>
                      setCars((current) =>
                        current.map((item) =>
                          item.id === car.id
                            ? {
                                ...item,
                                sort_order: Number(event.target.value),
                              }
                            : item,
                        ),
                      )
                    }
                    className="mt-2 w-full rounded-xl border border-zinc-700 bg-[#111418] px-4 py-3 text-sm text-zinc-100 outline-none focus:border-red-500"
                  />
                </label>

                <label>
                  <span className="text-xs uppercase tracking-[0.22em] text-zinc-500">
                    Active
                  </span>
                  <select
                    value={car.active ? "active" : "hidden"}
                    onChange={(event) =>
                      setCars((current) =>
                        current.map((item) =>
                          item.id === car.id
                            ? {
                                ...item,
                                active: event.target.value === "active",
                              }
                            : item,
                        ),
                      )
                    }
                    className="mt-2 w-full rounded-xl border border-zinc-700 bg-[#111418] px-4 py-3 text-sm text-zinc-100 outline-none focus:border-red-500"
                  >
                    <option value="active">Active</option>
                    <option value="hidden">Hidden</option>
                  </select>
                </label>

                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={() =>
                      updateCar(car, {
                        name: car.name.trim() || `Car ${car.id}`,
                        colour: car.colour || DEFAULT_CAR_COLOUR,
                        active: car.active,
                        sort_order: car.sort_order,
                      })
                    }
                    disabled={savingCarId === car.id}
                    className="w-full rounded-xl bg-red-700 px-5 py-3 text-sm font-semibold text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {savingCarId === car.id ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 rounded-2xl border border-red-900/40 bg-[#181315] p-5">
            <h3 className="text-xl font-semibold text-red-100">Add Car</h3>

            <p className="mt-1 text-sm text-zinc-400">
              Use a unique numeric car ID. This ID is what links the car card to
              its job list and mechanic page.
            </p>

            <div className="mt-4 grid gap-3 md:grid-cols-[160px_1fr_160px_auto]">
              <input
                type="number"
                value={newCarId}
                onChange={(event) => setNewCarId(event.target.value)}
                placeholder="Car ID"
                className="rounded-xl border border-red-900/50 bg-[#0d0f12] px-4 py-3 text-sm text-zinc-100 outline-none focus:border-red-500"
              />

              <input
                value={newCarName}
                onChange={(event) => setNewCarName(event.target.value)}
                placeholder="Car name, e.g. GB3-04"
                className="rounded-xl border border-red-900/50 bg-[#0d0f12] px-4 py-3 text-sm text-zinc-100 outline-none focus:border-red-500"
              />

              <input
                type="color"
                value={newCarColour}
                onChange={(event) => setNewCarColour(event.target.value)}
                className="h-[46px] rounded-xl border border-red-900/50 bg-[#0d0f12] p-1"
              />

              <button
                type="button"
                onClick={addCar}
                disabled={addingCar}
                className="rounded-xl bg-red-700 px-5 py-3 text-sm font-semibold text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {addingCar ? "Adding..." : "Add Car"}
              </button>
            </div>
          </div>
        </section>
      )}

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        {activeCars.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-zinc-700 bg-[#14181d] p-7 text-sm text-zinc-500 xl:col-span-3">
            No active cars. Open Manage Cars and set at least one car to Active.
          </div>
        ) : (
          activeCars.map((car) => (
            <article
              key={car.id}
              className="rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-lg transition hover:-translate-y-1 hover:bg-[#181d23]"
              style={{
                borderColor: "#27272a",
              }}
              onMouseEnter={(event) => {
                event.currentTarget.style.borderColor = car.colour;
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.borderColor = "#27272a";
              }}
            >
              <div className="flex flex-col items-center border-b border-zinc-800 pb-6">
                <ProgressDial progress={car.progress} colour={car.colour} />

                <div className="mt-5 text-center">
                  <h2 className="text-2xl font-semibold tracking-tight">
                    {car.name}
                  </h2>

                  <div
                    className="mt-3 inline-flex rounded-full border bg-[#0d0f12] px-3 py-1 text-xs text-zinc-300"
                    style={{
                      borderColor: car.colour,
                    }}
                  >
                    {car.status}
                  </div>

                  <p className="mt-3 text-sm text-zinc-500">
                    {car.completed} of {car.total || "—"} workshop jobs complete
                  </p>
                </div>
              </div>

              <div className="mt-6 space-y-5">
                <div>
                  <p className="mb-3 text-xs font-semibold uppercase tracking-[0.25em] text-red-400">
                    Preparation Lists
                  </p>

                  <div className="grid gap-2">
                    <Link
                      href={`/dashboard/car/${car.id}/job-list`}
                      className="rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-sm font-semibold text-zinc-200 hover:border-red-500 hover:text-red-300"
                    >
                      Workshop Job List
                      <span className="mt-1 block text-xs font-normal text-zinc-500">
                        Set, check and modify the main workshop jobs
                      </span>
                    </Link>

                    <Link
                      href={`/dashboard/car/${car.id}/evening-job-list`}
                      className="rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-sm font-semibold text-zinc-200 hover:border-red-500 hover:text-red-300"
                    >
                      Evening Prep Job List
                      <span className="mt-1 block text-xs font-normal text-zinc-500">
                        Set, check and modify evening prep jobs
                      </span>
                    </Link>
                  </div>
                </div>

                <div>
                  <p className="mb-3 text-xs font-semibold uppercase tracking-[0.25em] text-red-400">
                    Sheets / Records
                  </p>

                  <div className="grid gap-2">
                    <Link
                      href={`/dashboard/car/${car.id}/clutch-measurement`}
                      className="rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-sm font-semibold text-zinc-200 hover:border-red-500 hover:text-red-300"
                    >
                      Clutch Measurement
                      <span className="mt-1 block text-xs font-normal text-zinc-500">
                        Review clutch data submitted for this car
                      </span>
                    </Link>

                    <Link
                      href={`/dashboard/car/${car.id}/post-event`}
                      className="rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-sm font-semibold text-zinc-200 hover:border-red-500 hover:text-red-300"
                    >
                      Post Event Sheet
                      <span className="mt-1 block text-xs font-normal text-zinc-500">
                        Review post-event information and saved PDFs
                      </span>
                    </Link>
                  </div>
                </div>
              </div>
            </article>
          ))
        )}
      </section>

      <section className="mt-8 rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-red-400">
              Season Calendar
            </p>

            <h2 className="mt-3 text-3xl font-semibold">Imported Calendar</h2>

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
                            backgroundColor: event.colour || DEFAULT_CAR_COLOUR,
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

              <h3 className="mt-3 text-2xl font-semibold">Next Events</h3>

              <div className="mt-5 space-y-3">
                {upcomingEvents.length === 0 ? (
                  <p className="text-sm text-zinc-500">No upcoming events.</p>
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