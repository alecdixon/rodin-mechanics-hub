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
  eveningProgress: number;
  eveningTotal: number;
  eveningCompleted: number;
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

type ClutchMeasurement = {
  id: string | number;
  car_id: number;
  car_name?: string | null;
  created_at: string | null;
  original_stack_height?: number | string | null;
  driven_plates?: unknown;
  intermediate_plates?: unknown;
};

type ClutchWearPoint = {
  id: string;
  car_id: number;
  carName: string;
  colour: string;
  date: string;
  labelDate: string;
  wear: number;
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

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString("en-GB");
}

function shortDate(value: string | null | undefined) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
  });
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

function parsePlateRows(
  value: unknown,
): { a?: unknown; b?: unknown; c?: unknown }[] {
  if (!value) return [];

  if (Array.isArray(value)) {
    return value as { a?: unknown; b?: unknown; c?: unknown }[];
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  return [];
}

function numeric(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function rowMean(row: { a?: unknown; b?: unknown; c?: unknown }) {
  const values = [numeric(row.a), numeric(row.b), numeric(row.c)].filter(
    (value): value is number => value !== null,
  );

  if (values.length === 0) return null;

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function calculateClutchStack(record: ClutchMeasurement) {
  const driven = parsePlateRows(record.driven_plates);
  const intermediate = parsePlateRows(record.intermediate_plates);

  const drivenTotal = driven.reduce((sum, row) => {
    const mean = rowMean(row);
    return mean === null ? sum : sum + mean;
  }, 0);

  const intermediateTotal = intermediate.reduce((sum, row) => {
    const mean = rowMean(row);
    return mean === null ? sum : sum + mean;
  }, 0);

  const total = drivenTotal + intermediateTotal;

  return total > 0 ? total : null;
}

function calculateClutchWear(record: ClutchMeasurement) {
  const originalStack = numeric(record.original_stack_height);
  const measuredStack = calculateClutchStack(record);

  if (originalStack === null || measuredStack === null) return null;

  return Math.max(0, originalStack - measuredStack);
}

function JobStatusPill({
  status,
  colour,
}: {
  status: string;
  colour: string;
}) {
  return (
    <div
      className="mt-3 inline-flex rounded-full border bg-[#0d0f12] px-3 py-1 text-xs text-zinc-300"
      style={{
        borderColor: colour,
      }}
    >
      {status}
    </div>
  );
}

function CardLink({
  href,
  title,
  description,
}: {
  href: string;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-sm font-semibold text-zinc-200 transition hover:border-red-500 hover:bg-[#111418] hover:text-red-300"
    >
      {title}
      <span className="mt-1 block text-xs font-normal leading-5 text-zinc-500">
        {description}
      </span>
    </Link>
  );
}

function ClutchWearChart({ points }: { points: ClutchWearPoint[] }) {
  const width = 1000;
  const height = 360;

  const padding = {
    top: 28,
    right: 36,
    bottom: 58,
    left: 62,
  };

  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;

  const uniqueCars = Array.from(
    new Map(points.map((point) => [point.car_id, point])).values(),
  );

  const dates = points.map((point) => new Date(point.date).getTime());
  const minDate = dates.length ? Math.min(...dates) : Date.now();
  const maxDate = dates.length ? Math.max(...dates) : Date.now();

  const maxWear = points.length
    ? Math.max(...points.map((point) => point.wear), 0.1)
    : 1;

  function xFor(date: string) {
    const time = new Date(date).getTime();

    if (maxDate === minDate) {
      return padding.left + innerWidth / 2;
    }

    return padding.left + ((time - minDate) / (maxDate - minDate)) * innerWidth;
  }

  function yFor(wear: number) {
    return padding.top + innerHeight - (wear / maxWear) * innerHeight;
  }

  const grouped = uniqueCars.map((car) => {
    const carPoints = points.filter((point) => point.car_id === car.car_id);

    const d = carPoints
      .map((point, index) => {
        const command = index === 0 ? "M" : "L";
        return `${command} ${xFor(point.date)} ${yFor(point.wear)}`;
      })
      .join(" ");

    return {
      car,
      points: carPoints,
      d,
    };
  });

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
    const value = maxWear * ratio;
    const y = padding.top + innerHeight - ratio * innerHeight;

    return {
      y,
      value,
    };
  });

  const xLabels = points
    .filter((_, index) => {
      if (points.length <= 6) return true;
      return index % Math.ceil(points.length / 6) === 0;
    })
    .slice(0, 7);

  return (
    <div className="rounded-3xl border border-zinc-800 bg-[#0d0f12] p-5">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-red-400">
            Clutch Analysis
          </p>

          <h3 className="mt-3 text-2xl font-semibold text-zinc-100">
            Clutch Wear Trend
          </h3>

          <p className="mt-1 text-sm text-zinc-500">
            Wear is calculated from original stack height minus measured stack
            height, plotted against upload date.
          </p>
        </div>

        <div className="rounded-2xl border border-zinc-700 bg-black px-4 py-3 text-sm font-semibold text-red-300">
          {points.length} record{points.length === 1 ? "" : "s"}
        </div>
      </div>

      {points.length === 0 ? (
        <div className="grid min-h-[360px] place-items-center rounded-2xl border border-dashed border-zinc-700 bg-[#111418] p-8 text-center text-sm text-zinc-500">
          No clutch wear data available yet. Submit clutch measurement sheets
          with original stack height and plate measurements.
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <svg
              viewBox={`0 0 ${width} ${height}`}
              className="min-w-[860px] rounded-2xl border border-zinc-800 bg-[#111418]"
            >
              {gridLines.map((line) => (
                <g key={line.y}>
                  <line
                    x1={padding.left}
                    y1={line.y}
                    x2={width - padding.right}
                    y2={line.y}
                    stroke="#2a2f36"
                    strokeWidth="1"
                  />

                  <text
                    x={padding.left - 12}
                    y={line.y + 4}
                    textAnchor="end"
                    fontSize="12"
                    fill="#a1a1aa"
                  >
                    {line.value.toFixed(2)}
                  </text>
                </g>
              ))}

              <line
                x1={padding.left}
                y1={padding.top}
                x2={padding.left}
                y2={height - padding.bottom}
                stroke="#52525b"
                strokeWidth="1"
              />

              <line
                x1={padding.left}
                y1={height - padding.bottom}
                x2={width - padding.right}
                y2={height - padding.bottom}
                stroke="#52525b"
                strokeWidth="1"
              />

              <text
                x={20}
                y={height / 2}
                transform={`rotate(-90 20 ${height / 2})`}
                textAnchor="middle"
                fontSize="13"
                fill="#d4d4d8"
              >
                Clutch wear
              </text>

              <text
                x={width / 2}
                y={height - 14}
                textAnchor="middle"
                fontSize="13"
                fill="#d4d4d8"
              >
                Upload date
              </text>

              {xLabels.map((point) => (
                <g key={`${point.id}-x-label`}>
                  <line
                    x1={xFor(point.date)}
                    y1={height - padding.bottom}
                    x2={xFor(point.date)}
                    y2={height - padding.bottom + 6}
                    stroke="#52525b"
                  />

                  <text
                    x={xFor(point.date)}
                    y={height - padding.bottom + 24}
                    textAnchor="middle"
                    fontSize="12"
                    fill="#a1a1aa"
                  >
                    {point.labelDate}
                  </text>
                </g>
              ))}

              {grouped.map((group) => (
                <g key={group.car.car_id}>
                  <path
                    d={group.d}
                    fill="none"
                    stroke={group.car.colour}
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />

                  {group.points.map((point) => (
                    <g key={point.id}>
                      <circle
                        cx={xFor(point.date)}
                        cy={yFor(point.wear)}
                        r="5"
                        fill={point.colour}
                        stroke="#0d0f12"
                        strokeWidth="2"
                      />

                      <title>
                        {point.carName} · {point.labelDate} · {point.wear} wear
                      </title>
                    </g>
                  ))}
                </g>
              ))}
            </svg>
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            {uniqueCars.map((car) => (
              <div
                key={car.car_id}
                className="inline-flex items-center gap-2 rounded-full border border-zinc-700 bg-[#111418] px-3 py-2 text-xs font-semibold text-zinc-300"
              >
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: car.colour }}
                />

                {car.carName}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [cars, setCars] = useState<CarProgress[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [clutchMeasurements, setClutchMeasurements] = useState<
    ClutchMeasurement[]
  >([]);

  const [calendarLoading, setCalendarLoading] = useState(false);
  const [importingCalendar, setImportingCalendar] = useState(false);

  const [carSettingsOpen, setCarSettingsOpen] = useState(false);
  const [expandedCarId, setExpandedCarId] = useState<number | null>(null);

  const [savingCarId, setSavingCarId] = useState<number | null>(null);
  const [addingCar, setAddingCar] = useState(false);

  const [newCarId, setNewCarId] = useState("");
  const [newCarName, setNewCarName] = useState("");
  const [newCarColour, setNewCarColour] = useState(DEFAULT_CAR_COLOUR);

  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const loadCarsAndProgress = useCallback(async () => {
    setErrorMessage("");

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

    const { data: eveningProgressData, error: eveningProgressError } =
      await supabase.from("evening_job_progress").select("car_id,done");

    if (eveningProgressError) {
      setErrorMessage(eveningProgressError.message);
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

    const eveningCarMap: Record<number, { total: number; done: number }> = {};

    (eveningProgressData ?? []).forEach(
      (row: { car_id: number; done: boolean }) => {
        if (!eveningCarMap[row.car_id]) {
          eveningCarMap[row.car_id] = { total: 0, done: 0 };
        }

        eveningCarMap[row.car_id].total += 1;

        if (row.done) {
          eveningCarMap[row.car_id].done += 1;
        }
      },
    );

    const cleanCars = ((carData ?? []) as DashboardCar[]).map((car) => {
      const stats = carMap[car.id] ?? { total: 0, done: 0 };
      const eveningStats = eveningCarMap[car.id] ?? { total: 0, done: 0 };

      const progress = stats.total
        ? Math.round((stats.done / stats.total) * 100)
        : 0;

      const eveningProgress = eveningStats.total
        ? Math.round((eveningStats.done / eveningStats.total) * 100)
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
        eveningProgress,
        eveningTotal: eveningStats.total,
        eveningCompleted: eveningStats.done,
      };
    });

    setCars(cleanCars);
  }, []);

  const loadCalendar = useCallback(async () => {
    setCalendarLoading(true);
    setErrorMessage("");

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

  const loadClutchMeasurements = useCallback(async () => {
    const { data, error } = await supabase
      .from("clutch_measurements")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    setClutchMeasurements((data ?? []) as ClutchMeasurement[]);
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
      await loadClutchMeasurements();

      setLoading(false);
    }

    checkAccess();
  }, [loadCarsAndProgress, loadCalendar, loadClutchMeasurements, router]);

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

  useEffect(() => {
    const channel = supabase
      .channel("dashboard-evening-job-progress")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "evening_job_progress" },
        () => loadCarsAndProgress(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadCarsAndProgress]);

  useEffect(() => {
    const channel = supabase
      .channel("dashboard-clutch-measurements")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "clutch_measurements" },
        () => loadClutchMeasurements(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadClutchMeasurements]);

  const activeCars = useMemo(() => {
    return cars
      .filter((car) => car.active)
      .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
  }, [cars]);

  const clutchWearPoints = useMemo<ClutchWearPoint[]>(() => {
    const carColourMap = new Map<number, { name: string; colour: string }>();

    cars.forEach((car) => {
      carColourMap.set(car.id, {
        name: car.name,
        colour: car.colour || DEFAULT_CAR_COLOUR,
      });
    });

    return clutchMeasurements
      .map((record) => {
        const wear = calculateClutchWear(record);

        if (wear === null || !record.created_at) return null;

        const carDetails = carColourMap.get(record.car_id);

        return {
          id: String(record.id),
          car_id: record.car_id,
          carName: carDetails?.name || record.car_name || `Car ${record.car_id}`,
          colour: carDetails?.colour || DEFAULT_CAR_COLOUR,
          date: record.created_at,
          labelDate: shortDate(record.created_at),
          wear: Number(wear.toFixed(3)),
        };
      })
      .filter((point): point is ClutchWearPoint => point !== null)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [clutchMeasurements, cars]);

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
              Live overview of workshop progress, evening preparation, clutch
              wear, car settings and the season calendar.
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
          activeCars.map((car) => {
            const isExpanded = expandedCarId === car.id;

            return (
              <article
                key={car.id}
                className={`rounded-3xl border bg-[#14181d] p-6 shadow-lg transition ${
                  isExpanded
                    ? "border-red-500/70 shadow-red-950/20"
                    : "border-zinc-800 hover:border-zinc-600"
                }`}
              >
                <button
                  type="button"
                  onClick={() =>
                    setExpandedCarId((current) =>
                      current === car.id ? null : car.id,
                    )
                  }
                  className="w-full rounded-2xl border border-transparent p-2 text-left transition hover:border-zinc-700 hover:bg-[#0d0f12]"
                >
                  <div className="flex flex-col items-center border-b border-zinc-800 pb-6">
                    <ProgressDial progress={car.progress} colour={car.colour} />

                    <div className="mt-5 text-center">
                      <h2 className="text-2xl font-semibold tracking-tight">
                        {car.name}
                      </h2>

                      <JobStatusPill status={car.status} colour={car.colour} />

                      <p className="mt-3 text-sm text-zinc-500">
                        {car.completed} of {car.total || "—"} workshop jobs
                        complete
                      </p>

                      <p className="mt-3 text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                        {isExpanded
                          ? "Close car options ↑"
                          : "Open car options ↓"}
                      </p>
                    </div>
                  </div>
                </button>

                <div className="mt-5 rounded-2xl border border-zinc-800 bg-[#0d0f12] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.25em] text-red-400">
                        Evening Prep
                      </p>

                      <p className="mt-1 text-sm text-zinc-500">
                        {car.eveningCompleted} of {car.eveningTotal || "—"}{" "}
                        evening jobs complete
                      </p>
                    </div>

                    <div className="rounded-xl border border-zinc-700 bg-black px-3 py-2 text-lg font-bold text-zinc-100">
                      {car.eveningProgress}%
                    </div>
                  </div>

                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className="h-full rounded-full bg-red-700"
                      style={{
                        width: `${car.eveningProgress}%`,
                      }}
                    />
                  </div>
                </div>

                {isExpanded && (
                  <div className="mt-6 space-y-5 rounded-3xl border border-zinc-800 bg-[#0d0f12] p-5">
                    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-zinc-800 pb-5">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-red-400">
                          Car Hub
                        </p>

                        <h3 className="mt-2 text-2xl font-semibold text-zinc-100">
                          {car.name}
                        </h3>

                        <p className="mt-1 text-sm text-zinc-500">
                          Select what you want to manage or review for this car.
                        </p>
                      </div>

                      <Link
                        href={`/dashboard/car/${car.id}/viewer`}
                        className="rounded-xl border border-zinc-700 bg-[#14181d] px-4 py-3 text-sm font-semibold text-zinc-200 hover:border-red-500 hover:text-red-300"
                      >
                        Open Full Overview
                      </Link>
                    </div>

                    <div className="grid gap-4">
                      <div className="rounded-2xl border border-zinc-800 bg-[#14181d] p-4">
                        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.25em] text-red-400">
                          Preparation Lists
                        </p>

                        <div className="grid gap-2">
                          <CardLink
                            href={`/dashboard/car/${car.id}/job-list`}
                            title="Workshop Job List"
                            description="Set, check and modify the main workshop jobs"
                          />

                          <CardLink
                            href={`/dashboard/car/${car.id}/evening-job-list`}
                            title="Evening Prep Job List"
                            description="Set, check and modify evening prep jobs"
                          />
                        </div>
                      </div>

                      <div className="rounded-2xl border border-zinc-800 bg-[#14181d] p-4">
                        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.25em] text-red-400">
                          Sheets / Records
                        </p>

                        <div className="grid gap-2">
                          <CardLink
                            href={`/dashboard/car/${car.id}/clutch-measurement`}
                            title="Clutch Measurement"
                            description="Review clutch data submitted for this car"
                          />

                          <CardLink
                            href={`/dashboard/car/${car.id}/post-event`}
                            title="Post Event Sheet"
                            description="Review post-event information and saved PDFs"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </article>
            );
          })
        )}
      </section>

      <section className="mt-8 rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-red-400">
              Season Overview
            </p>

            <h2 className="mt-3 text-3xl font-semibold">
              Clutch Wear & Calendar
            </h2>

            <p className="mt-2 max-w-3xl text-sm text-zinc-400">
              Track clutch wear over time while keeping the full imported season
              calendar visible on the right.
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

        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <ClutchWearChart points={clutchWearPoints} />

          <aside className="rounded-2xl border border-zinc-800 bg-[#0d0f12] p-5">
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-red-400">
                  Calendar
                </p>

                <h3 className="mt-3 text-2xl font-semibold">All Events</h3>

                <p className="mt-1 text-sm text-zinc-500">
                  Full imported season calendar.
                </p>
              </div>

              <div className="rounded-xl border border-zinc-700 bg-black px-3 py-2 text-xs font-semibold text-red-300">
                {calendarEvents.length}
              </div>
            </div>

            {calendarLoading ? (
              <div className="rounded-2xl border border-zinc-800 bg-[#14181d] p-6 text-sm text-zinc-500">
                Loading calendar...
              </div>
            ) : calendarEvents.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-zinc-700 bg-[#14181d] p-6 text-sm text-zinc-500">
                No calendar events imported yet.
              </div>
            ) : (
              <div className="max-h-[520px] space-y-3 overflow-y-auto pr-2">
                {calendarEvents.map((event) => (
                  <div
                    key={event.id}
                    className="rounded-xl border border-zinc-800 bg-[#14181d] p-4"
                  >
                    <div className="flex items-start gap-3">
                      <span
                        className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{
                          backgroundColor: event.colour || DEFAULT_CAR_COLOUR,
                        }}
                      />

                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-zinc-100">
                          {event.event_name}
                        </p>

                        <p className="mt-1 text-xs text-zinc-500">
                          {niceDate(event.start_date)}
                          {event.end_date && event.end_date !== event.start_date
                            ? ` to ${niceDate(event.end_date)}`
                            : ""}
                        </p>

                        <p className="mt-1 truncate text-xs text-zinc-500">
                          {event.track_name || "No track"}
                          {event.location ? ` · ${event.location}` : ""}
                        </p>

                        {event.event_type && (
                          <p className="mt-2 inline-flex rounded-full border border-zinc-700 bg-black px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-400">
                            {event.event_type}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </aside>
        </div>
      </section>
    </main>
  );
}