"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import LogoutButton from "@/app/components/LogoutButton";
import { supabase } from "@/lib/supabase";
import { getAssignedCar, getUserRole, hasPermission } from "@/lib/userAccess";

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

type ClutchInventoryItem = {
  id: string;
  serial_no: string;
  label: string | null;
  current_car_id: number | null;
  notes: string | null;
  created_at?: string | null;
};

const DEFAULT_CAR_COLOUR = "#b91c1c";

function clutchDisplayName(clutch: ClutchInventoryItem) {
  const label = clutch.label?.trim();

  if (label) {
    return `${clutch.serial_no} · ${label}`;
  }

  return clutch.serial_no;
}

function carDisplayName(car: Pick<CarProgress, "id" | "name">) {
  return `${car.name} / Car ${car.id}`;
}

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
      className="grid h-32 w-32 shrink-0 place-items-center rounded-full shadow-inner"
      style={{
        background: `conic-gradient(${colour} ${angle}deg, #2a2f36 ${angle}deg)`,
      }}
    >
      <div className="grid h-24 w-24 place-items-center rounded-full bg-[#111418]">
        <div className="text-center">
          <div className="text-2xl font-semibold">{progress}%</div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">
            Jobs
          </div>
        </div>
      </div>
    </div>
  );
}

function JobStatusPill({ status, colour }: { status: string; colour: string }) {
  return (
    <div
      className="inline-flex rounded-full border bg-[#0d0f12] px-3 py-1 text-xs font-semibold text-zinc-300"
      style={{
        borderColor: colour,
      }}
    >
      {status}
    </div>
  );
}

function QuickLink({
  href,
  title,
  description,
  variant = "dark",
}: {
  href: string;
  title: string;
  description: string;
  variant?: "dark" | "red";
}) {
  const className =
    variant === "red"
      ? "rounded-2xl border border-red-600 bg-red-700 px-5 py-4 text-sm font-semibold text-white shadow-lg shadow-red-950/25 transition hover:border-red-400 hover:bg-red-600"
      : "rounded-2xl border border-zinc-700 bg-[#1b2026] px-5 py-4 text-sm font-semibold text-zinc-100 transition hover:border-red-500 hover:bg-[#222832] hover:text-red-200";

  return (
    <Link href={href} className={className}>
      <span>{title}</span>
      <span className="mt-1 block text-xs font-normal leading-5 opacity-70">
        {description}
      </span>
    </Link>
  );
}

function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.35em] text-red-400">
        {eyebrow}
      </p>

      <h2 className="mt-3 text-2xl font-semibold text-zinc-100 md:text-3xl">
        {title}
      </h2>

      <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
        {description}
      </p>
    </div>
  );
}

function StatBox({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  tone?: "neutral" | "red" | "green";
}) {
  const valueClass =
    tone === "red"
      ? "text-red-300"
      : tone === "green"
        ? "text-green-300"
        : "text-zinc-100";

  return (
    <div className="rounded-2xl border border-zinc-800 bg-[#0d0f12] p-4">
      <p className={`text-3xl font-semibold ${valueClass}`}>{value}</p>
      <p className="mt-1 text-xs uppercase tracking-[0.2em] text-zinc-500">
        {label}
      </p>
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [cars, setCars] = useState<CarProgress[]>([]);
  const [clutches, setClutches] = useState<ClutchInventoryItem[]>([]);

  const [carSettingsOpen, setCarSettingsOpen] = useState(false);
  const [expandedCarId, setExpandedCarId] = useState<number | null>(null);

  const [savingCarId, setSavingCarId] = useState<number | null>(null);
  const [addingCar, setAddingCar] = useState(false);

  const [savingClutchId, setSavingClutchId] = useState<string | null>(null);
  const [addingClutch, setAddingClutch] = useState(false);

  const [newCarId, setNewCarId] = useState("");
  const [newCarName, setNewCarName] = useState("");
  const [newCarColour, setNewCarColour] = useState(DEFAULT_CAR_COLOUR);

  const [newClutchSerial, setNewClutchSerial] = useState("");
  const [newClutchLabel, setNewClutchLabel] = useState("");
  const [newClutchCarId, setNewClutchCarId] = useState<string>("spare");
  const [newClutchNotes, setNewClutchNotes] = useState("");

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
    const eveningCarMap: Record<number, { total: number; done: number }> = {};

    (progressData ?? []).forEach((row: { car_id: number; done: boolean }) => {
      if (!carMap[row.car_id]) {
        carMap[row.car_id] = { total: 0, done: 0 };
      }

      carMap[row.car_id].total += 1;

      if (row.done) {
        carMap[row.car_id].done += 1;
      }
    });

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

  const loadClutches = useCallback(async () => {
    const { data, error } = await supabase
      .from("clutch_inventory")
      .select("*")
      .order("current_car_id", { ascending: true, nullsFirst: false })
      .order("serial_no", { ascending: true });

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    setClutches((data ?? []) as ClutchInventoryItem[]);
  }, []);

  useEffect(() => {
    async function checkAccess() {
      const { data } = await supabase.auth.getUser();
      const email = data.user?.email ?? "";
      const role = getUserRole(email);

      if (role === "number1_mechanic") {
        const carId = getAssignedCar(email);

        if (carId) {
          router.replace(`/car/${carId}/job-list`);
          return;
        }

        router.replace("/login");
        return;
      }

      if (role === "number2_mechanic") {
        router.replace("/team-jobs");
        return;
      }

      if (!hasPermission(email, "dashboard:view")) {
        router.replace("/login");
        return;
      }

      await loadCarsAndProgress();
      await loadClutches();

      setLoading(false);
    }

    checkAccess();
  }, [loadCarsAndProgress, loadClutches, router]);

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
      .channel("dashboard-clutch-inventory")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "clutch_inventory" },
        () => loadClutches(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadClutches]);

  const activeCars = useMemo(() => {
    return cars
      .filter((car) => car.active)
      .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
  }, [cars]);

  const activeClutches = useMemo(() => {
    return [...clutches].sort((a, b) => a.serial_no.localeCompare(b.serial_no));
  }, [clutches]);

  const spareActiveClutches = useMemo(() => {
    return activeClutches.filter((clutch) => clutch.current_car_id === null);
  }, [activeClutches]);

  const currentClutchByCarId = useMemo(() => {
    const map = new Map<number, ClutchInventoryItem>();

    activeClutches.forEach((clutch) => {
      if (clutch.current_car_id !== null) {
        map.set(clutch.current_car_id, clutch);
      }
    });

    return map;
  }, [activeClutches]);

  const totalJobs = useMemo(() => {
    return activeCars.reduce((sum, car) => sum + car.total, 0);
  }, [activeCars]);

  const completedJobs = useMemo(() => {
    return activeCars.reduce((sum, car) => sum + car.completed, 0);
  }, [activeCars]);

  const openJobs = Math.max(0, totalJobs - completedJobs);

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

  async function addClutch() {
    const serial = newClutchSerial.trim();
    const label = newClutchLabel.trim();
    const notes = newClutchNotes.trim();
    const currentCarId =
      newClutchCarId === "spare" ? null : Number(newClutchCarId);

    setMessage("");
    setErrorMessage("");

    if (!serial) {
      setErrorMessage("Enter a clutch serial number.");
      return;
    }

    const duplicate = clutches.find(
      (clutch) =>
        clutch.serial_no.trim().toLowerCase() === serial.toLowerCase(),
    );

    if (duplicate) {
      setErrorMessage(`Clutch ${serial} already exists.`);
      return;
    }

    if (currentCarId !== null && !cars.some((car) => car.id === currentCarId)) {
      setErrorMessage("Select a valid car or leave the clutch as spare.");
      return;
    }

    setAddingClutch(true);

    if (currentCarId !== null) {
      const { error: clearError } = await supabase
        .from("clutch_inventory")
        .update({ current_car_id: null })
        .eq("current_car_id", currentCarId);

      if (clearError) {
        setErrorMessage(clearError.message);
        setAddingClutch(false);
        return;
      }
    }

    const { error } = await supabase.from("clutch_inventory").insert({
      serial_no: serial,
      label: label || null,
      current_car_id: currentCarId,
      notes: notes || null,
    });

    if (error) {
      setErrorMessage(error.message);
      setAddingClutch(false);
      return;
    }

    setNewClutchSerial("");
    setNewClutchLabel("");
    setNewClutchCarId("spare");
    setNewClutchNotes("");
    setMessage(
      currentCarId === null
        ? `Added spare clutch ${serial}.`
        : `Added clutch ${serial} and allocated it to car ID ${currentCarId}.`,
    );

    await loadClutches();
    setAddingClutch(false);
  }

  async function allocateClutch(clutchId: string, carId: number | null) {
    const clutch = clutches.find((item) => item.id === clutchId);

    setMessage("");
    setErrorMessage("");

    if (!clutch) {
      setErrorMessage("Could not find that clutch in the current inventory.");
      return;
    }

    if (carId !== null && !cars.some((car) => car.id === carId)) {
      setErrorMessage("That car does not exist in dashboard_cars.");
      return;
    }

    setSavingClutchId(clutchId);

    if (carId !== null) {
      const { error: clearError } = await supabase
        .from("clutch_inventory")
        .update({ current_car_id: null })
        .eq("current_car_id", carId)
        .neq("id", clutchId);

      if (clearError) {
        setErrorMessage(clearError.message);
        setSavingClutchId(null);
        return;
      }
    }

    const { error } = await supabase
      .from("clutch_inventory")
      .update({ current_car_id: carId })
      .eq("id", clutchId);

    if (error) {
      setErrorMessage(error.message);
      setSavingClutchId(null);
      return;
    }

    setSavingClutchId(null);
    setMessage(
      carId === null
        ? `Moved clutch ${clutch.serial_no} to spare.`
        : `Allocated clutch ${clutch.serial_no} to car ID ${carId}.`,
    );
    await loadClutches();
  }

  async function updateClutch(clutch: ClutchInventoryItem) {
    const serial = clutch.serial_no.trim();
    const label = clutch.label?.trim() || null;
    const notes = clutch.notes?.trim() || null;

    setSavingClutchId(clutch.id);
    setMessage("");
    setErrorMessage("");

    if (!serial) {
      setErrorMessage("Clutch serial number cannot be empty.");
      setSavingClutchId(null);
      return;
    }

    const duplicate = clutches.find(
      (item) =>
        item.id !== clutch.id &&
        item.serial_no.trim().toLowerCase() === serial.toLowerCase(),
    );

    if (duplicate) {
      setErrorMessage(`Another clutch already uses serial ${serial}.`);
      setSavingClutchId(null);
      return;
    }

    if (clutch.current_car_id !== null) {
      const { error: clearError } = await supabase
        .from("clutch_inventory")
        .update({ current_car_id: null })
        .eq("current_car_id", clutch.current_car_id)
        .neq("id", clutch.id);

      if (clearError) {
        setErrorMessage(clearError.message);
        setSavingClutchId(null);
        return;
      }
    }

    const { error } = await supabase
      .from("clutch_inventory")
      .update({
        serial_no: serial,
        label,
        current_car_id: clutch.current_car_id,
        notes,
      })
      .eq("id", clutch.id);

    if (error) {
      setErrorMessage(error.message);
      setSavingClutchId(null);
      return;
    }

    setSavingClutchId(null);
    setMessage(`Clutch ${serial} saved.`);
    await loadClutches();
  }

  async function removeClutch(clutch: ClutchInventoryItem) {
    const confirmed = window.confirm(
      `Move clutch ${clutch.serial_no} to spare? Existing measurement records will not be deleted.`,
    );

    if (!confirmed) return;

    setSavingClutchId(clutch.id);
    setMessage("");
    setErrorMessage("");

    const { error } = await supabase
      .from("clutch_inventory")
      .update({ current_car_id: null })
      .eq("id", clutch.id);

    if (error) {
      setErrorMessage(error.message);
      setSavingClutchId(null);
      return;
    }

    setSavingClutchId(null);
    setMessage(`Clutch ${clutch.serial_no} moved to spare.`);
    await loadClutches();
  }

  async function deleteClutch(clutch: ClutchInventoryItem) {
    const confirmed = window.confirm(
      `Delete clutch ${clutch.serial_no} from the inventory? Only do this if it was added by mistake.`,
    );

    if (!confirmed) return;

    setSavingClutchId(clutch.id);
    setMessage("");
    setErrorMessage("");

    const { error } = await supabase
      .from("clutch_inventory")
      .delete()
      .eq("id", clutch.id);

    if (error) {
      setErrorMessage(error.message);
      setSavingClutchId(null);
      return;
    }

    setSavingClutchId(null);
    setMessage(`Deleted clutch ${clutch.serial_no}.`);
    await loadClutches();
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0d0f12] text-zinc-400">
        Loading dashboard...
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0d0f12] p-6 text-zinc-100">
      <header className="mb-8 overflow-hidden rounded-[2rem] border border-zinc-800 bg-[#111418] shadow-2xl shadow-black/30">
        <div className="relative isolate overflow-hidden border-b border-zinc-800 bg-gradient-to-br from-black via-[#101317] to-[#171114]">
          <div className="pointer-events-none absolute inset-y-0 left-0 hidden w-1/2 items-center justify-start overflow-hidden md:flex">
            <img
              src="/rodin-logo.png"
              alt=""
              className="ml-8 h-56 w-auto object-contain opacity-[0.26]"
            />
          </div>

          <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-1/2 items-center justify-end overflow-hidden md:flex">
            <img
              src="/gb3-logo.png"
              alt=""
              className="mr-8 h-60 w-auto object-contain opacity-[0.28]"
            />
          </div>

          <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[#0d0f12]/58 via-[#111418]/76 to-[#0d0f12]/58" />

          <div className="relative grid min-h-[230px] gap-8 p-8 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.42em] text-red-400">
                Rodin Motorsport
              </p>

              <h1 className="mt-4 text-4xl font-semibold tracking-tight text-white md:text-5xl">
                Chief Mechanic Dashboard
              </h1>

              <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-400">
                Live workshop control for car preparation, evening prep, clutch
                allocation and team operations.
              </p>
            </div>

            <div className="flex justify-start lg:justify-end">
              <LogoutButton />
            </div>
          </div>
        </div>

        <div className="bg-[#0d0f12]/80 p-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <QuickLink
              href="/drain-out"
              title="Drain Out"
              description="Submit and review drain-out reports"
              variant="red"
            />

            <QuickLink
              href="/sticker-list"
              title="Sticker List"
              description="Sticker requests and printable sheet"
            />

            <QuickLink
              href="/recorded-issues"
              title="Recorded Issues"
              description="Faults, fixes and approved solutions"
            />

            <QuickLink
              href="/dashboard/team-jobs"
              title="Team Jobs"
              description="Create and publish team-wide jobs"
            />

            <button
              type="button"
              onClick={() => setCarSettingsOpen((current) => !current)}
              className="rounded-2xl border border-zinc-700 bg-[#1b2026] px-5 py-4 text-left text-sm font-semibold text-zinc-100 transition hover:border-red-500 hover:bg-[#222832] hover:text-red-200"
            >
              {carSettingsOpen ? "Hide Settings" : "Manage Cars"}
              <span className="mt-1 block text-xs font-normal leading-5 text-zinc-500">
                Cars, colours and clutch allocation
              </span>
            </button>
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

      <section className="mb-8 grid gap-4 md:grid-cols-3">
        <StatBox label="Active cars" value={activeCars.length} />
        <StatBox label="Open jobs" value={openJobs} tone="red" />
        <StatBox label="Completed jobs" value={completedJobs} tone="green" />
      </section>

      {carSettingsOpen && (
        <section className="mb-8 rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
          <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
            <SectionHeading
              eyebrow="Dashboard Settings"
              title="Cars and clutch allocation"
              description="Manage car names, colours, display order and current clutch allocation from one consistent control area."
            />

            <div className="rounded-2xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-sm font-semibold text-red-300">
              {activeClutches.length} clutch
              {activeClutches.length === 1 ? "" : "es"} ·{" "}
              {spareActiveClutches.length} spare
            </div>
          </div>

          <div className="rounded-2xl border border-red-900/40 bg-[#181315] p-5">
            <div className="mb-5">
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-red-400">
                Quick Clutch Control
              </p>

              <h3 className="mt-3 text-2xl font-semibold text-red-100">
                Allocate clutches to cars
              </h3>

              <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
                Select the fitted clutch for each active car. Only one clutch is
                kept allocated to each car; changing the dropdown moves the old
                clutch back to spare automatically.
              </p>
            </div>

            <div className="grid gap-3">
              {activeCars.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-zinc-700 bg-[#0d0f12] p-5 text-sm text-zinc-500">
                  No active cars available for clutch allocation.
                </div>
              ) : (
                activeCars.map((car) => {
                  const fittedClutch = currentClutchByCarId.get(car.id);
                  const options = activeClutches.filter(
                    (clutch) =>
                      clutch.current_car_id === null ||
                      clutch.current_car_id === car.id,
                  );

                  return (
                    <div
                      key={`clutch-allocation-${car.id}`}
                      className="grid gap-3 rounded-2xl border border-zinc-800 bg-[#0d0f12] p-4 lg:grid-cols-[260px_1fr_auto]"
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className="h-12 w-2 rounded-full"
                          style={{ backgroundColor: car.colour }}
                        />

                        <div>
                          <p className="text-lg font-semibold text-zinc-100">
                            {car.name}
                          </p>

                          <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">
                            Car ID {car.id}
                          </p>
                        </div>
                      </div>

                      <label>
                        <span className="text-xs uppercase tracking-[0.22em] text-zinc-500">
                          Current clutch
                        </span>

                        <select
                          value={fittedClutch?.id ?? "spare"}
                          onChange={(event) => {
                            if (event.target.value === "spare") {
                              if (fittedClutch) {
                                allocateClutch(fittedClutch.id, null);
                              }
                              return;
                            }

                            allocateClutch(event.target.value, car.id);
                          }}
                          className="mt-2 w-full rounded-xl border border-zinc-700 bg-[#111418] px-4 py-3 text-sm text-zinc-100 outline-none focus:border-red-500"
                        >
                          <option value="spare">
                            No clutch fitted / spare
                          </option>
                          {options.map((clutch) => (
                            <option key={clutch.id} value={clutch.id}>
                              {clutchDisplayName(clutch)}
                              {clutch.current_car_id === car.id
                                ? " — fitted"
                                : ""}
                            </option>
                          ))}
                        </select>
                      </label>

                      <div className="flex items-end">
                        <button
                          type="button"
                          onClick={() =>
                            fittedClutch &&
                            allocateClutch(fittedClutch.id, null)
                          }
                          disabled={
                            !fittedClutch || savingClutchId === fittedClutch.id
                          }
                          className="w-full rounded-xl border border-zinc-700 px-4 py-3 text-sm font-semibold text-zinc-300 hover:border-red-500 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-50 lg:w-auto"
                        >
                          Move to Spare
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-zinc-800 bg-[#0d0f12] p-5">
            <h3 className="text-2xl font-semibold text-zinc-100">
              Manage Cars
            </h3>

            <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
              Change car names, dashboard colours, visibility and display order.
              Hiding a car does not delete historic job data.
            </p>

            <div className="mt-5 space-y-3">
              {cars.map((car) => (
                <div
                  key={car.id}
                  className="grid gap-3 rounded-2xl border border-zinc-800 bg-[#111418] p-4 lg:grid-cols-[80px_1fr_140px_120px_120px_auto]"
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
                      className="mt-2 w-full rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-sm text-zinc-100 outline-none focus:border-red-500"
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
                      className="mt-2 h-[46px] w-full rounded-xl border border-zinc-700 bg-[#0d0f12] p-1"
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
                      className="mt-2 w-full rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-sm text-zinc-100 outline-none focus:border-red-500"
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
                      className="mt-2 w-full rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-sm text-zinc-100 outline-none focus:border-red-500"
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
              <h4 className="text-xl font-semibold text-red-100">Add Car</h4>

              <p className="mt-1 text-sm leading-6 text-zinc-400">
                Use a unique numeric car ID. This ID links the car card to the
                job list and mechanic page.
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
          </div>

          <div className="mt-6 rounded-2xl border border-zinc-800 bg-[#0d0f12] p-5">
            <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.35em] text-red-400">
                  Clutch Inventory
                </p>

                <h3 className="mt-3 text-2xl font-semibold text-zinc-100">
                  Manage Clutches
                </h3>

                <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
                  Add clutch serial numbers, allocate them to cars, move them
                  back to spare, or delete an inventory row if it was added by
                  mistake.
                </p>
              </div>

              <div className="rounded-xl border border-zinc-700 bg-black px-4 py-3 text-sm font-semibold text-red-300">
                {clutches.length} total
              </div>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-zinc-800">
              <table className="w-full min-w-[900px] text-sm">
                <thead className="bg-zinc-900 text-zinc-300">
                  <tr>
                    <th className="px-4 py-3 text-left">Serial No.</th>
                    <th className="px-4 py-3 text-left">Label</th>
                    <th className="px-4 py-3 text-left">Allocated To</th>
                    <th className="px-4 py-3 text-left">Notes</th>
                    <th className="px-4 py-3 text-left">Actions</th>
                  </tr>
                </thead>

                <tbody>
                  {clutches.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-4 py-6 text-center text-zinc-500"
                      >
                        No clutches added yet.
                      </td>
                    </tr>
                  ) : (
                    clutches.map((clutch) => (
                      <tr key={clutch.id} className="border-t border-zinc-800">
                        <td className="px-4 py-3">
                          <input
                            value={clutch.serial_no}
                            onChange={(event) =>
                              setClutches((current) =>
                                current.map((item) =>
                                  item.id === clutch.id
                                    ? { ...item, serial_no: event.target.value }
                                    : item,
                                ),
                              )
                            }
                            className="w-full rounded-xl border border-zinc-700 bg-[#111418] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-red-500"
                            placeholder="e.g. 28819"
                          />
                        </td>

                        <td className="px-4 py-3">
                          <input
                            value={clutch.label ?? ""}
                            onChange={(event) =>
                              setClutches((current) =>
                                current.map((item) =>
                                  item.id === clutch.id
                                    ? { ...item, label: event.target.value }
                                    : item,
                                ),
                              )
                            }
                            className="w-full rounded-xl border border-zinc-700 bg-[#111418] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-red-500"
                            placeholder="Optional label"
                          />
                        </td>

                        <td className="px-4 py-3">
                          <select
                            value={clutch.current_car_id ?? "spare"}
                            onChange={(event) =>
                              setClutches((current) =>
                                current.map((item) =>
                                  item.id === clutch.id
                                    ? {
                                        ...item,
                                        current_car_id:
                                          event.target.value === "spare"
                                            ? null
                                            : Number(event.target.value),
                                      }
                                    : item,
                                ),
                              )
                            }
                            className="w-full rounded-xl border border-zinc-700 bg-[#111418] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-red-500"
                          >
                            <option value="spare">Spare clutch</option>
                            {activeCars.map((car) => (
                              <option key={car.id} value={car.id}>
                                {carDisplayName(car)}
                              </option>
                            ))}
                          </select>
                        </td>

                        <td className="px-4 py-3">
                          <input
                            value={clutch.notes ?? ""}
                            onChange={(event) =>
                              setClutches((current) =>
                                current.map((item) =>
                                  item.id === clutch.id
                                    ? { ...item, notes: event.target.value }
                                    : item,
                                ),
                              )
                            }
                            className="w-full rounded-xl border border-zinc-700 bg-[#111418] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-red-500"
                            placeholder="Optional notes"
                          />
                        </td>

                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => updateClutch(clutch)}
                              disabled={savingClutchId === clutch.id}
                              className="rounded-lg bg-red-700 px-3 py-2 text-xs font-semibold text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {savingClutchId === clutch.id
                                ? "Saving..."
                                : "Save"}
                            </button>

                            <button
                              type="button"
                              onClick={() => removeClutch(clutch)}
                              disabled={savingClutchId === clutch.id}
                              className="rounded-lg border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-300 hover:border-red-500 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Move Spare
                            </button>

                            <button
                              type="button"
                              onClick={() => deleteClutch(clutch)}
                              disabled={savingClutchId === clutch.id}
                              className="rounded-lg border border-red-900/70 px-3 py-2 text-xs font-semibold text-red-300 hover:bg-red-950/40 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-6 rounded-2xl border border-red-900/40 bg-[#181315] p-5">
              <h4 className="text-xl font-semibold text-red-100">Add Clutch</h4>

              <div className="mt-4 grid gap-3 lg:grid-cols-[180px_1fr_220px_1fr_auto]">
                <input
                  value={newClutchSerial}
                  onChange={(event) => setNewClutchSerial(event.target.value)}
                  placeholder="Serial No. e.g. 28819"
                  className="rounded-xl border border-red-900/50 bg-[#0d0f12] px-4 py-3 text-sm text-zinc-100 outline-none focus:border-red-500"
                />

                <input
                  value={newClutchLabel}
                  onChange={(event) => setNewClutchLabel(event.target.value)}
                  placeholder="Label optional"
                  className="rounded-xl border border-red-900/50 bg-[#0d0f12] px-4 py-3 text-sm text-zinc-100 outline-none focus:border-red-500"
                />

                <select
                  value={newClutchCarId}
                  onChange={(event) => setNewClutchCarId(event.target.value)}
                  className="rounded-xl border border-red-900/50 bg-[#0d0f12] px-4 py-3 text-sm text-zinc-100 outline-none focus:border-red-500"
                >
                  <option value="spare">Spare clutch</option>
                  {activeCars.map((car) => (
                    <option key={car.id} value={car.id}>
                      {carDisplayName(car)}
                    </option>
                  ))}
                </select>

                <input
                  value={newClutchNotes}
                  onChange={(event) => setNewClutchNotes(event.target.value)}
                  placeholder="Notes"
                  className="rounded-xl border border-red-900/50 bg-[#0d0f12] px-4 py-3 text-sm text-zinc-100 outline-none focus:border-red-500"
                />

                <button
                  type="button"
                  onClick={addClutch}
                  disabled={addingClutch}
                  className="rounded-xl bg-red-700 px-5 py-3 text-sm font-semibold text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {addingClutch ? "Adding..." : "Add Clutch"}
                </button>
              </div>
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
            const fittedClutch = currentClutchByCarId.get(car.id);

            return (
              <article
                key={car.id}
                className={`rounded-3xl border bg-[#14181d] p-6 shadow-lg transition ${
                  isExpanded
                    ? "border-red-500/70 shadow-red-950/20"
                    : "border-zinc-800"
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <span
                      className="h-14 w-2 rounded-full"
                      style={{ backgroundColor: car.colour }}
                    />

                    <div>
                      <p className="text-xs uppercase tracking-[0.25em] text-zinc-500">
                        Car {car.id}
                      </p>

                      <h2 className="mt-1 text-2xl font-semibold">
                        {car.name}
                      </h2>

                      <JobStatusPill status={car.status} colour={car.colour} />
                    </div>
                  </div>

                  <ProgressDial progress={car.progress} colour={car.colour} />
                </div>

                <div className="mt-6 grid gap-3 md:grid-cols-3">
                  <div className="rounded-2xl border border-zinc-800 bg-[#0d0f12] p-4">
                    <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">
                      Workshop
                    </p>

                    <p className="mt-2 text-2xl font-semibold text-zinc-100">
                      {car.completed}/{car.total}
                    </p>

                    <p className="mt-1 text-sm text-zinc-500">
                      {car.progress}% complete
                    </p>
                  </div>

                  <div className="rounded-2xl border border-zinc-800 bg-[#0d0f12] p-4">
                    <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">
                      Evening Prep
                    </p>

                    <p className="mt-2 text-2xl font-semibold text-zinc-100">
                      {car.eveningCompleted}/{car.eveningTotal}
                    </p>

                    <p className="mt-1 text-sm text-zinc-500">
                      {car.eveningProgress}% complete
                    </p>
                  </div>

                  <div className="rounded-2xl border border-zinc-800 bg-[#0d0f12] p-4">
                    <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">
                      Clutch
                    </p>

                    <p className="mt-2 text-sm font-semibold leading-6 text-zinc-100">
                      {fittedClutch ? clutchDisplayName(fittedClutch) : "No clutch fitted"}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    setExpandedCarId((current) =>
                      current === car.id ? null : car.id,
                    )
                  }
                  className="mt-5 w-full rounded-xl border border-zinc-700 bg-[#1b2026] px-4 py-3 text-sm font-semibold text-zinc-200 transition hover:border-red-500 hover:bg-[#222832] hover:text-red-200"
                >
                  {isExpanded ? "Hide Car Links" : "Open Car Links"}
                </button>

                {isExpanded && (
                  <div className="mt-5 grid gap-3">
                    <QuickLink
                      href={`/dashboard/car/${car.id}/job-list`}
                      title="Workshop Job List"
                      description="Main workshop jobs for this car"
                    />

                    <QuickLink
                      href={`/dashboard/car/${car.id}/evening-job-list`}
                      title="Evening Prep Job List"
                      description="Evening preparation jobs for this car"
                    />

                    <QuickLink
                      href={`/dashboard/car/${car.id}/post-event`}
                      title="Post Event Sheet"
                      description="Post-event notes and saved PDFs"
                    />
                  </div>
                )}
              </article>
            );
          })
        )}
      </section>
    </main>
  );
}
