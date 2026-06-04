"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

type DashboardCar = {
  id: number;
  name: string;
  colour: string | null;
};

type DrainOutRecord = {
  id: string;
  car_id: number;
  car_name: string | null;
  rig: string;
  drain_out_figure: number;
  units: string;
  notes: string | null;
  created_by: string | null;
  created_at: string | null;
};

type EngineerAllocation = {
  carId: number;
  driverName: string;
  engineerName: string;
  engineerEmail: string;
  engineerRole: string;
};

const RIG_OPTIONS = ["Rig 1", "Rig 2"] as const;

/*
  Engineer / car / driver allocation.

  Selecting the engineer now controls:
  - the active car ID
  - the driver name shown on the page
  - the car/driver label saved to Supabase
  - the car/driver label sent to the email API
  - the previous reports shown below
*/
const ENGINEER_ALLOCATIONS: EngineerAllocation[] = [
  {
    carId: 1,
    driverName: "Rehm",
    engineerName: "Engineer Car 1",
    engineerEmail: process.env.NEXT_PUBLIC_DRAIN_OUT_ENGINEER_EMAIL_CAR_1 || "",
    engineerRole: "Car 1 Engineer",
  },
  {
    carId: 2,
    driverName: "Molnar",
    engineerName: "Engineer Car 2",
    engineerEmail: process.env.NEXT_PUBLIC_DRAIN_OUT_ENGINEER_EMAIL_CAR_2 || "",
    engineerRole: "Car 2 Engineer",
  },
  {
    carId: 3,
    driverName: "Pulling",
    engineerName: "Engineer Car 3",
    engineerEmail: process.env.NEXT_PUBLIC_DRAIN_OUT_ENGINEER_EMAIL_CAR_3 || "",
    engineerRole: "Car 3 Engineer",
  },
].filter((allocation) => allocation.engineerEmail.trim().length > 0);

function formatDate(value: string | null) {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function DrainOutPage() {
  const params = useParams();
  const routeCarId = Number(params.carId);

  const [selectedCarId, setSelectedCarId] = useState<number>(() => {
    if (Number.isFinite(routeCarId) && routeCarId > 0) {
      return routeCarId;
    }

    return ENGINEER_ALLOCATIONS[0]?.carId || 1;
  });

  const [car, setCar] = useState<DashboardCar | null>(null);
  const [rig, setRig] = useState<(typeof RIG_OPTIONS)[number]>("Rig 1");
  const [drainOutFigure, setDrainOutFigure] = useState("");
  const units = "kg";
  const [notes, setNotes] = useState("");
  const [createdBy, setCreatedBy] = useState<string | null>(null);

  const [records, setRecords] = useState<DrainOutRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const selectedAllocation = useMemo(() => {
    return (
      ENGINEER_ALLOCATIONS.find(
        (allocation) => allocation.carId === selectedCarId,
      ) || ENGINEER_ALLOCATIONS[0] || null
    );
  }, [selectedCarId]);

  const activeCarId = selectedAllocation?.carId || selectedCarId || routeCarId;
  const driverName = selectedAllocation?.driverName || `Car ${activeCarId}`;
  const carDisplayLabel = `Car ${activeCarId} - ${driverName}`;
  const dashboardCarLabel = car?.name || `Car ${activeCarId}`;

  const numericDrainOut = useMemo(() => {
    const value = Number(drainOutFigure);
    return Number.isFinite(value) ? value : null;
  }, [drainOutFigure]);

  async function loadPageData(carIdToLoad: number) {
    if (!Number.isFinite(carIdToLoad) || carIdToLoad <= 0) {
      setErrorMessage("Invalid car ID selected.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setMessage("");
    setErrorMessage("");

    const { data: userData } = await supabase.auth.getUser();
    const email = userData.user?.email ?? null;
    setCreatedBy(email);

    const { data: carData, error: carError } = await supabase
      .from("dashboard_cars")
      .select("id,name,colour")
      .eq("id", carIdToLoad)
      .maybeSingle();

    if (!carError && carData) {
      setCar(carData as DashboardCar);
    } else {
      setCar(null);
    }

    const { data: recordData, error: recordError } = await supabase
      .from("drain_out_reports")
      .select("*")
      .eq("car_id", carIdToLoad)
      .order("created_at", { ascending: false });

    if (recordError) {
      setErrorMessage(recordError.message);
      setLoading(false);
      return;
    }

    setRecords((recordData ?? []) as DrainOutRecord[]);
    setLoading(false);
  }

  useEffect(() => {
    if (ENGINEER_ALLOCATIONS.length === 0) {
      setLoading(false);
      setErrorMessage(
        "No engineers are configured. Add NEXT_PUBLIC_DRAIN_OUT_ENGINEER_EMAIL_CAR_1, _CAR_2 and _CAR_3 in Vercel.",
      );
      return;
    }

    const allocationForRoute =
      ENGINEER_ALLOCATIONS.find(
        (allocation) => allocation.carId === routeCarId,
      ) || ENGINEER_ALLOCATIONS[0];

    setSelectedCarId(allocationForRoute.carId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeCarId]);

  useEffect(() => {
    if (!selectedAllocation) return;

    loadPageData(selectedAllocation.carId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAllocation?.carId]);

  async function submitDrainOut() {
    setMessage("");
    setErrorMessage("");

    if (!selectedAllocation) {
      setErrorMessage("Select an engineer to notify.");
      return;
    }

    if (!Number.isFinite(activeCarId) || activeCarId <= 0) {
      setErrorMessage("Invalid car selected.");
      return;
    }

    if (numericDrainOut === null || numericDrainOut < 0) {
      setErrorMessage("Enter a valid drain out figure in kg.");
      return;
    }

    setSaving(true);

    try {
      const payload = {
        car_id: activeCarId,
        car_name: carDisplayLabel,
        rig,
        drain_out_figure: numericDrainOut,
        units: "kg",
        notes: notes.trim() || null,
        created_by: createdBy,
      };

      const { data: inserted, error: insertError } = await supabase
        .from("drain_out_reports")
        .insert(payload)
        .select("*")
        .single();

      if (insertError) {
        throw new Error(insertError.message);
      }

      const notifyResponse = await fetch("/api/drain-out", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...inserted,
          car_id: activeCarId,
          car_name: carDisplayLabel,
          engineer_name: selectedAllocation.engineerName,
          engineer_email: selectedAllocation.engineerEmail,
        }),
      });

      if (!notifyResponse.ok) {
        const body = await notifyResponse.json().catch(() => null);

        const readableError = [
          body?.error,
          body?.likely_cause ? `Cause: ${body.likely_cause}` : null,
          body?.fix ? `Fix: ${body.fix}` : null,
          body?.technical_error ? `Technical: ${body.technical_error}` : null,
        ]
          .filter(Boolean)
          .join("\n\n");

        throw new Error(
          readableError ||
            "Drain out saved, but the engineer notification failed.",
        );
      }

      setMessage(
        `Drain out report submitted for ${carDisplayLabel} and sent to ${selectedAllocation.engineerName}.`,
      );

      setDrainOutFigure("");
      setNotes("");
      await loadPageData(activeCarId);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Failed to submit drain out report.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0d0f12] text-zinc-400">
        Loading drain out page...
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0d0f12] p-6 text-zinc-100">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8 rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-red-400">
                Mechanic Report
              </p>

              <h1 className="mt-3 text-4xl font-semibold tracking-tight">
                Drain Out
              </h1>

              <p className="mt-2 text-sm text-zinc-400">
                Select the engineer allocation first. The page will then use the
                matching car and driver for the drain out report.
              </p>

              {dashboardCarLabel !== carDisplayLabel && (
                <p className="mt-2 text-xs text-zinc-500">
                  Dashboard car label: {dashboardCarLabel}
                </p>
              )}
            </div>

            <Link
              href={`/car/${activeCarId}/job-list`}
              className="rounded-xl border border-zinc-700 bg-[#1b2026] px-5 py-3 text-sm font-semibold text-zinc-200 hover:border-red-500 hover:text-red-300"
            >
              Back to Job List
            </Link>
          </div>
        </header>

        {message && (
          <div className="mb-6 whitespace-pre-line rounded-2xl border border-green-800 bg-green-950/20 p-4 text-sm text-green-300">
            {message}
          </div>
        )}

        {errorMessage && (
          <div className="mb-6 whitespace-pre-line rounded-2xl border border-red-900 bg-red-950/40 p-4 text-sm text-red-200">
            {errorMessage}
          </div>
        )}

        <section className="rounded-3xl border border-red-900/50 bg-[#181315] p-6 shadow-xl">
          <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-red-400">
                Submit Figure
              </p>

              <h2 className="mt-3 text-2xl font-semibold">Drain Out Report</h2>

              <p className="mt-2 max-w-3xl text-sm text-zinc-400">
                Choose the engineer, choose the rig, enter the drain out figure
                in kg, then submit. The selected engineer determines the car and
                driver used for the report.
              </p>
            </div>

            <div className="rounded-2xl border border-zinc-800 bg-[#0d0f12] px-4 py-3">
              <p className="text-xs uppercase tracking-[0.25em] text-zinc-500">
                Car / Driver
              </p>
              <p className="mt-1 text-lg font-semibold text-zinc-100">
                {carDisplayLabel}
              </p>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.3fr_220px_1fr_160px]">
            <label>
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                Engineer To Notify
              </span>

              <select
                value={selectedAllocation?.carId || ""}
                onChange={(event) => {
                  setSelectedCarId(Number(event.target.value));
                  setDrainOutFigure("");
                  setNotes("");
                  setMessage("");
                  setErrorMessage("");
                }}
                className="w-full rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-sm text-zinc-100 outline-none focus:border-red-500"
              >
                {ENGINEER_ALLOCATIONS.length === 0 ? (
                  <option value="">No engineers configured</option>
                ) : (
                  ENGINEER_ALLOCATIONS.map((allocation) => (
                    <option key={allocation.carId} value={allocation.carId}>
                      {allocation.engineerName} — Car {allocation.carId} —{" "}
                      {allocation.driverName}
                    </option>
                  ))
                )}
              </select>
            </label>

            <label>
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                Rig
              </span>

              <select
                value={rig}
                onChange={(event) =>
                  setRig(event.target.value as (typeof RIG_OPTIONS)[number])
                }
                className="w-full rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-sm text-zinc-100 outline-none focus:border-red-500"
              >
                {RIG_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                Drain Out Figure
              </span>

              <input
                value={drainOutFigure}
                onChange={(event) => setDrainOutFigure(event.target.value)}
                inputMode="decimal"
                placeholder="e.g. 2.35"
                className="w-full rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-sm text-zinc-100 outline-none focus:border-red-500"
              />
            </label>

            <div>
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                Units
              </span>

              <div className="rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-sm font-bold text-red-300">
                kg
              </div>
            </div>
          </div>

          {selectedAllocation && (
            <div className="mt-4 rounded-2xl border border-zinc-800 bg-[#101317] p-4">
              <p className="text-xs uppercase tracking-[0.25em] text-zinc-500">
                Selected Allocation
              </p>

              <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-zinc-100">
                    {selectedAllocation.engineerName}
                  </p>
                  <p className="text-sm text-zinc-400">
                    {selectedAllocation.engineerRole} · Car{" "}
                    {selectedAllocation.carId} · {selectedAllocation.driverName}
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">
                    {selectedAllocation.engineerEmail}
                  </p>
                </div>

                <div className="rounded-full border border-red-900/60 bg-red-950/30 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-red-300">
                  Notification Target
                </div>
              </div>
            </div>
          )}

          <label className="mt-4 block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
              Notes
            </span>

            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Optional: oil condition, contamination, abnormal smell, leak notes..."
              className="min-h-28 w-full rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-sm text-zinc-100 outline-none focus:border-red-500"
            />
          </label>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-zinc-800 bg-[#0d0f12] p-4">
            <div>
              <p className="text-xs uppercase tracking-[0.25em] text-zinc-500">
                Notification Preview
              </p>

              <p className="mt-2 text-sm text-zinc-300">
                {selectedAllocation?.engineerName || "No engineer"} ·{" "}
                {carDisplayLabel} · {rig} ·{" "}
                <span className="font-bold text-red-300">
                  {numericDrainOut !== null
                    ? `${numericDrainOut} ${units}`
                    : `0 ${units}`}
                </span>
              </p>
            </div>

            <button
              type="button"
              onClick={submitDrainOut}
              disabled={saving || ENGINEER_ALLOCATIONS.length === 0}
              className="rounded-xl bg-red-700 px-6 py-3 text-sm font-semibold text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Submitting..." : "Submit & Notify Engineer"}
            </button>
          </div>
        </section>

        <section className="mt-8 rounded-3xl border border-zinc-800 bg-[#14181d] p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-2xl font-semibold">
                Previous Drain Out Reports
              </h2>
              <p className="mt-1 text-sm text-zinc-500">
                Showing saved reports for {carDisplayLabel}.
              </p>
            </div>
          </div>

          <div className="mt-4 overflow-x-auto rounded-2xl border border-zinc-800">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="bg-[#0d0f12] text-zinc-300">
                <tr>
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3 text-left">Car / Driver</th>
                  <th className="px-4 py-3 text-left">Rig</th>
                  <th className="px-4 py-3 text-left">Figure</th>
                  <th className="px-4 py-3 text-left">Notes</th>
                  <th className="px-4 py-3 text-left">Submitted By</th>
                </tr>
              </thead>

              <tbody>
                {records.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-6 text-center text-zinc-500"
                    >
                      No drain out reports saved yet for {carDisplayLabel}.
                    </td>
                  </tr>
                ) : (
                  records.map((record) => (
                    <tr key={record.id} className="border-t border-zinc-800">
                      <td className="px-4 py-3 text-zinc-300">
                        {formatDate(record.created_at)}
                      </td>
                      <td className="px-4 py-3 text-zinc-300">
                        {record.car_name || `Car ${record.car_id}`}
                      </td>
                      <td className="px-4 py-3">{record.rig}</td>
                      <td className="px-4 py-3 font-semibold text-red-300">
                        {record.drain_out_figure} {record.units}
                      </td>
                      <td className="px-4 py-3 text-zinc-300">
                        {record.notes || "—"}
                      </td>
                      <td className="px-4 py-3 text-zinc-400">
                        {record.created_by || "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}