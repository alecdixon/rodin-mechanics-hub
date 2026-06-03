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

const RIG_OPTIONS = ["Rig 1", "Rig 2"] as const;

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
  const carId = Number(params.carId);

  const [car, setCar] = useState<DashboardCar | null>(null);
  const [rig, setRig] = useState<(typeof RIG_OPTIONS)[number]>("Rig 1");
  const [drainOutFigure, setDrainOutFigure] = useState("");
  const [units, setUnits] = useState("ml");
  const [notes, setNotes] = useState("");
  const [createdBy, setCreatedBy] = useState<string | null>(null);

  const [records, setRecords] = useState<DrainOutRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const carName = car?.name || `Car ${carId}`;

  const numericDrainOut = useMemo(() => {
    const value = Number(drainOutFigure);
    return Number.isFinite(value) ? value : null;
  }, [drainOutFigure]);

  async function loadPageData() {
    if (!Number.isFinite(carId) || carId <= 0) {
      setErrorMessage("Invalid car ID in URL.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setMessage("");
    setErrorMessage("");

    const { data: userData } = await supabase.auth.getUser();
    const email = userData.user?.email ?? null;
    setCreatedBy(email);

    /*
      Important:
      This page should still work even if the car lookup is blocked by RLS
      or if dashboard_cars does not return a matching row. The drain-out report
      is still saved against the numeric carId from the URL.
    */

    const { data: carData, error: carError } = await supabase
      .from("dashboard_cars")
      .select("id,name,colour")
      .eq("id", carId)
      .maybeSingle();

    if (!carError && carData) {
      setCar(carData as DashboardCar);
    } else {
      setCar(null);
    }

    const { data: recordData, error: recordError } = await supabase
      .from("drain_out_reports")
      .select("*")
      .eq("car_id", carId)
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
    loadPageData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carId]);

  async function submitDrainOut() {
    setMessage("");
    setErrorMessage("");

    if (!Number.isFinite(carId) || carId <= 0) {
      setErrorMessage("Invalid car ID in URL.");
      return;
    }

    if (numericDrainOut === null || numericDrainOut < 0) {
      setErrorMessage("Enter a valid drain out figure.");
      return;
    }

    setSaving(true);

    try {
      const payload = {
        car_id: carId,
        car_name: carName,
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
        body: JSON.stringify(inserted),
      });

      if (!notifyResponse.ok) {
        const body = await notifyResponse.json().catch(() => null);
        throw new Error(
          body?.error ||
            "Drain out saved, but the engineer notification failed."
        );
      }

      setMessage("Drain out report submitted and engineer notified.");
      setDrainOutFigure("");
      setNotes("");
      await loadPageData();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Failed to submit drain out report."
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
      <div className="mx-auto max-w-5xl">
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
                {carName} · submit Rig 1 / Rig 2 drain out figures directly to
                the engineer.
              </p>
            </div>

            <Link
              href={`/car/${carId}/job-list`}
              className="rounded-xl border border-zinc-700 bg-[#1b2026] px-5 py-3 text-sm font-semibold text-zinc-200 hover:border-red-500 hover:text-red-300"
            >
              Back to Job List
            </Link>
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

        <section className="rounded-3xl border border-red-900/50 bg-[#181315] p-6 shadow-xl">
          <div className="mb-6">
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-red-400">
              Submit Figure
            </p>

            <h2 className="mt-3 text-2xl font-semibold">Drain Out Report</h2>

            <p className="mt-2 max-w-3xl text-sm text-zinc-400">
              Select the rig, enter the drain out figure, then submit. This saves
              the value and sends the engineer a notification.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-[220px_1fr_160px]">
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
                placeholder="e.g. 475"
                className="w-full rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-sm text-zinc-100 outline-none focus:border-red-500"
              />
            </label>

            <label>
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                Units
              </span>

              <select
                value={units}
                onChange={(event) => setUnits(event.target.value)}
                className="w-full rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-sm text-zinc-100 outline-none focus:border-red-500"
              >
                <option value="ml">ml</option>
                <option value="L">L</option>
                <option value="g">g</option>
                <option value="kg">kg</option>
              </select>
            </label>
          </div>

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
                {carName} · {rig} ·{" "}
                <span className="font-bold text-red-300">
                  {numericDrainOut !== null
                    ? `${numericDrainOut} ${units}`
                    : "No figure entered"}
                </span>
              </p>
            </div>

            <button
              type="button"
              onClick={submitDrainOut}
              disabled={saving}
              className="rounded-xl bg-red-700 px-6 py-3 text-sm font-semibold text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Submitting..." : "Submit & Notify Engineer"}
            </button>
          </div>
        </section>

        <section className="mt-8 rounded-3xl border border-zinc-800 bg-[#14181d] p-6">
          <h2 className="text-2xl font-semibold">Previous Drain Out Reports</h2>

          <div className="mt-4 overflow-hidden rounded-2xl border border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-[#0d0f12] text-zinc-300">
                <tr>
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3 text-left">Rig</th>
                  <th className="px-4 py-3 text-left">Figure</th>
                  <th className="px-4 py-3 text-left">Notes</th>
                  <th className="px-4 py-3 text-left">Submitted By</th>
                </tr>
              </thead>

              <tbody>
                {records.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-zinc-500">
                      No drain out reports saved yet.
                    </td>
                  </tr>
                ) : (
                  records.map((record) => (
                    <tr key={record.id} className="border-t border-zinc-800">
                      <td className="px-4 py-3 text-zinc-300">
                        {formatDate(record.created_at)}
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
