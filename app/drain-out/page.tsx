"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { getUserRole, type UserRole } from "@/lib/userAccess";

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

  report_date: string | null;
  session: string | null;
  circuit: string | null;
};

type CarDrainOutAllocation = {
  id: string;
  carId: number;
  driverName: string;
  engineerName: string;
  engineerEmail: string;
};

const RIG_OPTIONS = ["Rig 1", "Rig 2"] as const;

const SESSION_OPTIONS = [
  "FP1",
  "FP2",
  "FP3",
  "Qualifying",
  "Race 1",
  "Race 2",
  "Race 3",
  "Test",
  "Other",
] as const;

const CIRCUIT_OPTIONS = [
  "Oulton Park",
  "Silverstone",
  "Spa-Francorchamps",
  "Monza",
  "Hungaroring",
  "Zandvoort",
  "Brands Hatch",
  "Snetterton",
  "Donington Park",
  "Other",
] as const;

const CAR_ALLOCATIONS: CarDrainOutAllocation[] = [
  {
    id: "car-1",
    carId: 1,
    driverName: "Rehm",
    engineerName: "Engineer Car 1",
    engineerEmail: process.env.NEXT_PUBLIC_DRAIN_OUT_ENGINEER_EMAIL_CAR_1 || "",
  },
  {
    id: "car-2",
    carId: 2,
    driverName: "Molnar",
    engineerName: "Engineer Car 2",
    engineerEmail: process.env.NEXT_PUBLIC_DRAIN_OUT_ENGINEER_EMAIL_CAR_2 || "",
  },
  {
    id: "car-3",
    carId: 3,
    driverName: "Pulling",
    engineerName: "Engineer Car 3",
    engineerEmail: process.env.NEXT_PUBLIC_DRAIN_OUT_ENGINEER_EMAIL_CAR_3 || "",
  },
];

function getTodayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function formatDateTime(value: string | null) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatReportDate(value: string | null) {
  if (!value) return "—";

  const date = new Date(`${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export default function DrainOutPage() {
  const [userRole, setUserRole] = useState<UserRole>("unknown");

  const [selectedAllocationId, setSelectedAllocationId] = useState(
    CAR_ALLOCATIONS[0]?.id || "",
  );

  const [reportDate, setReportDate] = useState(getTodayIsoDate());
  const [session, setSession] =
    useState<(typeof SESSION_OPTIONS)[number]>("FP1");
  const [customSession, setCustomSession] = useState("");

  const [circuit, setCircuit] =
    useState<(typeof CIRCUIT_OPTIONS)[number]>("Oulton Park");
  const [customCircuit, setCustomCircuit] = useState("");

  const [rig, setRig] = useState<(typeof RIG_OPTIONS)[number]>("Rig 1");
  const [drainOutFigure, setDrainOutFigure] = useState("");
  const [notes, setNotes] = useState("");
  const [createdBy, setCreatedBy] = useState<string | null>(null);

  const units = "kg";

  const [records, setRecords] = useState<DrainOutRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const selectedAllocation = useMemo(() => {
    return (
      CAR_ALLOCATIONS.find(
        (allocation) => allocation.id === selectedAllocationId,
      ) ||
      CAR_ALLOCATIONS[0] ||
      null
    );
  }, [selectedAllocationId]);

  const activeCarId = selectedAllocation?.carId ?? 0;
  const activeDriverName = selectedAllocation?.driverName ?? "Unknown Driver";
  const activeEngineerName =
    selectedAllocation?.engineerName ?? "No engineer configured";
  const activeEngineerEmail = selectedAllocation?.engineerEmail ?? "";

  const carDisplayLabel = activeCarId
    ? `Car ${activeCarId} - ${activeDriverName}`
    : "No car selected";

  const selectedCarHasEmail = activeEngineerEmail.trim().length > 0;

  const finalSession = useMemo(() => {
    if (session === "Other") return customSession.trim();
    return session;
  }, [session, customSession]);

  const finalCircuit = useMemo(() => {
    if (circuit === "Other") return customCircuit.trim();
    return circuit;
  }, [circuit, customCircuit]);

  const numericDrainOut = useMemo(() => {
    const value = Number(drainOutFigure);
    return Number.isFinite(value) ? value : null;
  }, [drainOutFigure]);

  const showChiefDashboardButton =
    userRole === "chief_mechanic" || userRole === "engineer";

  const canDeleteDrainOuts = userRole === "chief_mechanic";

  async function loadRecordsForCar(carId: number) {
    if (!Number.isFinite(carId) || carId <= 0) {
      setRecords([]);
      return;
    }

    const { data, error } = await supabase
      .from("drain_out_reports")
      .select("*")
      .eq("car_id", carId)
      .order("report_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    setRecords((data ?? []) as DrainOutRecord[]);
  }

  useEffect(() => {
    async function loadPageData() {
      setLoading(true);
      setMessage("");
      setErrorMessage("");

      const { data: userData } = await supabase.auth.getUser();
      const email = userData.user?.email ?? null;

      setCreatedBy(email);
      setUserRole(getUserRole(email));

      if (selectedAllocation) {
        await loadRecordsForCar(selectedAllocation.carId);
      }

      setLoading(false);
    }

    loadPageData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAllocation?.carId]);

  function resetFormAfterSubmit() {
    setDrainOutFigure("");
    setNotes("");
  }

  async function submitDrainOut() {
    setMessage("");
    setErrorMessage("");

    if (!selectedAllocation) {
      setErrorMessage("Select a car before submitting.");
      return;
    }

    if (!reportDate) {
      setErrorMessage("Select a report date.");
      return;
    }

    if (!finalSession) {
      setErrorMessage("Enter a session.");
      return;
    }

    if (!finalCircuit) {
      setErrorMessage("Enter a circuit.");
      return;
    }

    if (!selectedCarHasEmail) {
      setErrorMessage(
        `No engineer email is configured for Car ${selectedAllocation.carId}. Add NEXT_PUBLIC_DRAIN_OUT_ENGINEER_EMAIL_CAR_${selectedAllocation.carId} in Vercel.`,
      );
      return;
    }

    if (numericDrainOut === null || numericDrainOut < 0) {
      setErrorMessage("Enter a valid drain out figure in kg.");
      return;
    }

    setSaving(true);

    try {
      const payload = {
        report_date: reportDate,
        session: finalSession,
        circuit: finalCircuit,
        car_id: selectedAllocation.carId,
        car_name: carDisplayLabel,
        rig,
        drain_out_figure: numericDrainOut,
        units,
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
        `Drain out report submitted for ${carDisplayLabel} — ${finalCircuit}, ${finalSession}. Notification sent to ${selectedAllocation.engineerEmail}.`,
      );

      resetFormAfterSubmit();
      await loadRecordsForCar(selectedAllocation.carId);
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

  async function deleteDrainOutRecord(record: DrainOutRecord) {
    setMessage("");
    setErrorMessage("");

    if (!canDeleteDrainOuts) {
      setErrorMessage("Only the chief mechanic can delete drain out records.");
      return;
    }

    const confirmed = window.confirm(
      `Delete this drain out record?\n\n${record.car_name || `Car ${record.car_id}`}\n${record.circuit || "No circuit"} · ${record.session || "No session"} · ${record.rig} · ${record.drain_out_figure} ${record.units}`,
    );

    if (!confirmed) return;

    setDeletingId(record.id);

    const { error } = await supabase
      .from("drain_out_reports")
      .delete()
      .eq("id", record.id);

    if (error) {
      setErrorMessage(error.message);
      setDeletingId(null);
      return;
    }

    setMessage("Drain out record deleted.");
    setDeletingId(null);

    if (selectedAllocation) {
      await loadRecordsForCar(selectedAllocation.carId);
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

              <p className="mt-2 max-w-3xl text-sm text-zinc-400">
                Enter the event details, select the car and rig, then submit the
                drain out figure. The engineer notification is handled from the
                selected car allocation.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <Link
                href="/team-jobs"
                className="rounded-xl border border-red-600 bg-red-700 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-red-950/30 transition hover:border-red-400 hover:bg-red-600"
              >
                Team Jobs
              </Link>

              <Link
                href="/recorded-issues"
                className="rounded-xl border border-zinc-700 bg-[#1b2026] px-5 py-3 text-sm font-semibold text-zinc-200 transition hover:border-red-500 hover:text-red-300"
              >
                Recorded Issues
              </Link>

              {showChiefDashboardButton && (
                <Link
                  href="/dashboard"
                  className="rounded-xl border border-zinc-700 bg-[#1b2026] px-5 py-3 text-sm font-semibold text-zinc-200 transition hover:border-red-500 hover:text-red-300"
                >
                  Chief Dashboard
                </Link>
              )}
            </div>
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

        <section className="rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
          <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-red-400">
                New Report
              </p>

              <h2 className="mt-3 text-2xl font-semibold">
                Submit Drain Out Figure
              </h2>

              <p className="mt-2 max-w-3xl text-sm text-zinc-400">
                Complete the event details first, then add the car, rig and
                drain out value. The preview at the bottom shows exactly what
                will be submitted.
              </p>
            </div>

            <div className="rounded-2xl border border-zinc-800 bg-[#0d0f12] px-4 py-3">
              <p className="text-xs uppercase tracking-[0.25em] text-zinc-500">
                Selected Car
              </p>

              <p className="mt-1 text-lg font-semibold text-zinc-100">
                {carDisplayLabel}
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-[#101317] p-5">
            <p className="mb-4 text-xs font-semibold uppercase tracking-[0.3em] text-zinc-500">
              Event Details
            </p>

            <div className="grid gap-4 md:grid-cols-3">
              <label>
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                  Date
                </span>

                <input
                  type="date"
                  value={reportDate}
                  onChange={(event) => setReportDate(event.target.value)}
                  className="w-full rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-sm text-zinc-100 outline-none focus:border-red-500"
                />
              </label>

              <label>
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                  Session
                </span>

                <select
                  value={session}
                  onChange={(event) => {
                    setSession(
                      event.target.value as (typeof SESSION_OPTIONS)[number],
                    );
                    setCustomSession("");
                  }}
                  className="w-full rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-sm text-zinc-100 outline-none focus:border-red-500"
                >
                  {SESSION_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                  Circuit
                </span>

                <select
                  value={circuit}
                  onChange={(event) => {
                    setCircuit(
                      event.target.value as (typeof CIRCUIT_OPTIONS)[number],
                    );
                    setCustomCircuit("");
                  }}
                  className="w-full rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-sm text-zinc-100 outline-none focus:border-red-500"
                >
                  {CIRCUIT_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {(session === "Other" || circuit === "Other") && (
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                {session === "Other" && (
                  <label>
                    <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                      Custom Session
                    </span>

                    <input
                      value={customSession}
                      onChange={(event) => setCustomSession(event.target.value)}
                      placeholder="e.g. Warm-up"
                      className="w-full rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-sm text-zinc-100 outline-none focus:border-red-500"
                    />
                  </label>
                )}

                {circuit === "Other" && (
                  <label>
                    <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                      Custom Circuit
                    </span>

                    <input
                      value={customCircuit}
                      onChange={(event) => setCustomCircuit(event.target.value)}
                      placeholder="e.g. Red Bull Ring"
                      className="w-full rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-sm text-zinc-100 outline-none focus:border-red-500"
                    />
                  </label>
                )}
              </div>
            )}
          </div>

          <div className="mt-5 rounded-2xl border border-zinc-800 bg-[#101317] p-5">
            <p className="mb-4 text-xs font-semibold uppercase tracking-[0.3em] text-zinc-500">
              Car And Measurement
            </p>

            <div className="grid gap-4 lg:grid-cols-[1.3fr_180px_1fr_120px]">
              <label>
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                  Car
                </span>

                <select
                  value={selectedAllocationId}
                  onChange={(event) => {
                    setSelectedAllocationId(event.target.value);
                    setDrainOutFigure("");
                    setNotes("");
                    setMessage("");
                    setErrorMessage("");
                  }}
                  className="w-full rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-sm text-zinc-100 outline-none focus:border-red-500"
                >
                  {CAR_ALLOCATIONS.map((allocation) => (
                    <option key={allocation.id} value={allocation.id}>
                      Car {allocation.carId} — {allocation.driverName}
                    </option>
                  ))}
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
                  {units}
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-zinc-800 bg-[#0d0f12] p-4">
              <p className="text-xs uppercase tracking-[0.25em] text-zinc-500">
                Auto-Filled Engineer
              </p>

              <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-zinc-100">
                    {activeEngineerName}
                  </p>

                  <p className="text-sm text-zinc-400">
                    {selectedCarHasEmail
                      ? activeEngineerEmail
                      : `No email configured for Car ${activeCarId}`}
                  </p>
                </div>

                <div
                  className={`rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] ${
                    selectedCarHasEmail
                      ? "border-green-900/60 bg-green-950/20 text-green-300"
                      : "border-red-900/60 bg-red-950/30 text-red-300"
                  }`}
                >
                  {selectedCarHasEmail ? "Ready To Notify" : "Missing Email"}
                </div>
              </div>
            </div>
          </div>

          <label className="mt-5 block">
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

          <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-red-900/40 bg-[#181315] p-5">
            <div>
              <p className="text-xs uppercase tracking-[0.25em] text-zinc-500">
                Submission Preview
              </p>

              <p className="mt-2 text-sm text-zinc-300">
                {formatReportDate(reportDate)} · {finalCircuit || "No circuit"}{" "}
                · {finalSession || "No session"} · Car {activeCarId} ·{" "}
                {activeDriverName} · {rig} ·{" "}
                <span className="font-bold text-red-300">
                  {numericDrainOut !== null
                    ? `${numericDrainOut} ${units}`
                    : `0 ${units}`}
                </span>
              </p>

              <p className="mt-1 text-xs text-zinc-500">
                Notification recipient:{" "}
                {selectedCarHasEmail ? activeEngineerEmail : "No engineer email"}
              </p>
            </div>

            <button
              type="button"
              onClick={submitDrainOut}
              disabled={saving || !selectedCarHasEmail}
              className="rounded-xl bg-red-700 px-6 py-3 text-sm font-semibold text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Submitting..." : "Submit & Notify Engineer"}
            </button>
          </div>
        </section>

        <section className="mt-8 rounded-3xl border border-zinc-800 bg-[#14181d] p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
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
            <table className="w-full min-w-[1100px] text-sm">
              <thead className="bg-[#0d0f12] text-zinc-300">
                <tr>
                  <th className="px-4 py-3 text-left">Report Date</th>
                  <th className="px-4 py-3 text-left">Session</th>
                  <th className="px-4 py-3 text-left">Circuit</th>
                  <th className="px-4 py-3 text-left">Car / Driver</th>
                  <th className="px-4 py-3 text-left">Rig</th>
                  <th className="px-4 py-3 text-left">Figure</th>
                  <th className="px-4 py-3 text-left">Notes</th>
                  <th className="px-4 py-3 text-left">Submitted By</th>
                  <th className="px-4 py-3 text-left">Submitted At</th>
                  {canDeleteDrainOuts && (
                    <th className="px-4 py-3 text-left">Actions</th>
                  )}
                </tr>
              </thead>

              <tbody>
                {records.length === 0 ? (
                  <tr>
                    <td
                      colSpan={canDeleteDrainOuts ? 10 : 9}
                      className="px-4 py-6 text-center text-zinc-500"
                    >
                      No drain out reports saved yet for {carDisplayLabel}.
                    </td>
                  </tr>
                ) : (
                  records.map((record) => (
                    <tr key={record.id} className="border-t border-zinc-800">
                      <td className="px-4 py-3 text-zinc-300">
                        {formatReportDate(record.report_date)}
                      </td>

                      <td className="px-4 py-3 text-zinc-300">
                        {record.session || "—"}
                      </td>

                      <td className="px-4 py-3 text-zinc-300">
                        {record.circuit || "—"}
                      </td>

                      <td className="px-4 py-3 text-zinc-300">
                        {record.car_name || `Car ${record.car_id}`}
                      </td>

                      <td className="px-4 py-3 text-zinc-300">
                        {record.rig}
                      </td>

                      <td className="px-4 py-3 font-semibold text-red-300">
                        {record.drain_out_figure} {record.units}
                      </td>

                      <td className="px-4 py-3 text-zinc-300">
                        {record.notes || "—"}
                      </td>

                      <td className="px-4 py-3 text-zinc-400">
                        {record.created_by || "—"}
                      </td>

                      <td className="px-4 py-3 text-zinc-400">
                        {formatDateTime(record.created_at)}
                      </td>

                      {canDeleteDrainOuts && (
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => deleteDrainOutRecord(record)}
                            disabled={deletingId === record.id}
                            className="rounded-lg border border-red-900/70 px-3 py-2 text-xs font-semibold text-red-300 transition hover:bg-red-950/40 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {deletingId === record.id
                              ? "Deleting..."
                              : "Delete"}
                          </button>
                        </td>
                      )}
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