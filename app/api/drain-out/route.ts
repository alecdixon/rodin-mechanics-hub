"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
};

type CarDrainOutAllocation = {
  id: string;
  carId: number;
  driverName: string;
  engineerName: string;
  engineerEmail: string;
};

type EditRecordState = {
  rig: string;
  drain_out_figure: string;
  notes: string;
};

const RIG_OPTIONS = ["Rig 1", "Rig 2"] as const;

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

const ALLOWED_ROLES: UserRole[] = [
  "chief_mechanic",
  "number1_mechanic",
  "number2_mechanic",
];

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
  const router = useRouter();

  const [userRole, setUserRole] = useState<UserRole>("unknown");
  const [selectedAllocationId, setSelectedAllocationId] = useState(
    CAR_ALLOCATIONS[0]?.id || "",
  );

  const [rig, setRig] = useState<(typeof RIG_OPTIONS)[number]>("Rig 1");
  const [drainOutFigure, setDrainOutFigure] = useState("");
  const units = "kg";
  const [notes, setNotes] = useState("");
  const [createdBy, setCreatedBy] = useState<string | null>(null);

  const [records, setRecords] = useState<DrainOutRecord[]>([]);
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null);
  const [editRecord, setEditRecord] = useState<EditRecordState>({
    rig: "Rig 1",
    drain_out_figure: "",
    notes: "",
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingEditId, setSavingEditId] = useState<string | null>(null);
  const [deletingRecordId, setDeletingRecordId] = useState<string | null>(null);

  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const canManageRecords = userRole === "chief_mechanic";

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

  const numericDrainOut = useMemo(() => {
    const value = Number(drainOutFigure);
    return Number.isFinite(value) ? value : null;
  }, [drainOutFigure]);

  async function loadRecordsForCar(carId: number) {
    if (!Number.isFinite(carId) || carId <= 0) {
      setRecords([]);
      return;
    }

    const { data: recordData, error: recordError } = await supabase
      .from("drain_out_reports")
      .select("*")
      .eq("car_id", carId)
      .order("created_at", { ascending: false });

    if (recordError) {
      setErrorMessage(recordError.message);
      return;
    }

    setRecords((recordData ?? []) as DrainOutRecord[]);
  }

  useEffect(() => {
    async function checkAccessAndLoad() {
      setLoading(true);
      setMessage("");
      setErrorMessage("");

      const { data, error } = await supabase.auth.getUser();

      if (error || !data.user?.email) {
        router.replace("/login");
        return;
      }

      const email = data.user.email;
      const role = getUserRole(email);

      if (!ALLOWED_ROLES.includes(role)) {
        router.replace("/login");
        return;
      }

      setUserRole(role);
      setCreatedBy(email);

      if (selectedAllocation) {
        await loadRecordsForCar(selectedAllocation.carId);
      }

      setLoading(false);
    }

    checkAccessAndLoad();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAllocation?.carId, router]);

  function startEditing(record: DrainOutRecord) {
    setEditingRecordId(record.id);
    setEditRecord({
      rig: record.rig || "Rig 1",
      drain_out_figure: String(record.drain_out_figure ?? ""),
      notes: record.notes || "",
    });
    setMessage("");
    setErrorMessage("");
  }

  function cancelEditing() {
    setEditingRecordId(null);
    setEditRecord({
      rig: "Rig 1",
      drain_out_figure: "",
      notes: "",
    });
  }

  async function updateDrainOutRecord(record: DrainOutRecord) {
    if (!canManageRecords) {
      setErrorMessage("Only the chief mechanic can modify drain out records.");
      return;
    }

    const nextFigure = Number(editRecord.drain_out_figure);

    if (!Number.isFinite(nextFigure) || nextFigure < 0) {
      setErrorMessage("Enter a valid edited drain out figure.");
      return;
    }

    setSavingEditId(record.id);
    setMessage("");
    setErrorMessage("");

    const { error } = await supabase
      .from("drain_out_reports")
      .update({
        rig: editRecord.rig,
        drain_out_figure: nextFigure,
        notes: editRecord.notes.trim() || null,
      })
      .eq("id", record.id);

    if (error) {
      setErrorMessage(error.message);
      setSavingEditId(null);
      return;
    }

    setSavingEditId(null);
    setEditingRecordId(null);
    setMessage("Drain out record updated.");

    if (selectedAllocation) {
      await loadRecordsForCar(selectedAllocation.carId);
    }
  }

  async function deleteDrainOutRecord(record: DrainOutRecord) {
    if (!canManageRecords) {
      setErrorMessage("Only the chief mechanic can delete drain out records.");
      return;
    }

    const confirmed = window.confirm(
      `Delete this drain out record?\n\n${record.car_name || `Car ${record.car_id}`} · ${record.rig} · ${record.drain_out_figure} ${record.units}`,
    );

    if (!confirmed) return;

    setDeletingRecordId(record.id);
    setMessage("");
    setErrorMessage("");

    const { error } = await supabase
      .from("drain_out_reports")
      .delete()
      .eq("id", record.id);

    if (error) {
      setErrorMessage(error.message);
      setDeletingRecordId(null);
      return;
    }

    setDeletingRecordId(null);
    setMessage("Drain out record deleted.");

    if (selectedAllocation) {
      await loadRecordsForCar(selectedAllocation.carId);
    }
  }

  async function submitDrainOut() {
    setMessage("");
    setErrorMessage("");

    if (!selectedAllocation) {
      setErrorMessage("Select a car before submitting.");
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
        car_id: selectedAllocation.carId,
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
          car_id: selectedAllocation.carId,
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
        `Drain out report submitted for ${carDisplayLabel} and sent to ${selectedAllocation.engineerEmail}.`,
      );

      setDrainOutFigure("");
      setNotes("");
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
                Select the car, enter the drain out figure and submit. The
                driver and engineer email are filled automatically from the car
                selection.
              </p>

              {canManageRecords && (
                <p className="mt-2 text-xs font-semibold uppercase tracking-[0.25em] text-red-300">
                  Chief mechanic mode · edit and delete enabled
                </p>
              )}
            </div>

            <div className="flex flex-wrap gap-3">
              {userRole === "chief_mechanic" && (
                <Link
                  href="/dashboard"
                  className="rounded-xl border border-zinc-700 bg-[#1b2026] px-5 py-3 text-sm font-semibold text-zinc-200 hover:border-red-500 hover:text-red-300"
                >
                  Chief Dashboard
                </Link>
              )}

              <Link
                href="/team-jobs"
                className="rounded-xl border border-zinc-700 bg-[#1b2026] px-5 py-3 text-sm font-semibold text-zinc-200 hover:border-red-500 hover:text-red-300"
              >
                Team Jobs
              </Link>
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

        <section className="rounded-3xl border border-red-900/50 bg-[#181315] p-6 shadow-xl">
          <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-red-400">
                Submit Figure
              </p>

              <h2 className="mt-3 text-2xl font-semibold">
                Drain Out Report
              </h2>

              <p className="mt-2 max-w-3xl text-sm text-zinc-400">
                Choose the car, choose the rig, enter the drain out figure in
                kg, then submit. The preview below shows exactly what will be
                sent.
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
                  cancelEditing();
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
                kg
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-zinc-800 bg-[#101317] p-4">
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
                Car {activeCarId} · {activeDriverName} ·{" "}
                {selectedCarHasEmail
                  ? activeEngineerEmail
                  : "No engineer email"}{" "}
                · {rig} ·{" "}
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
              disabled={saving || !selectedCarHasEmail}
              className="rounded-xl bg-red-700 px-6 py-3 text-sm font-semibold text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Submitting..." : "Submit & Notify Engineer"}
            </button>
          </div>
        </section>

        <section className="mt-8 rounded-3xl border border-zinc-800 bg-[#14181d] p-6">
          <div>
            <h2 className="text-2xl font-semibold">
              Previous Drain Out Reports
            </h2>

            <p className="mt-1 text-sm text-zinc-500">
              Showing saved reports for {carDisplayLabel}.
              {canManageRecords
                ? " Chief mechanic can modify or delete records below."
                : " Modification and deletion are chief mechanic only."}
            </p>
          </div>

          <div className="mt-4 overflow-x-auto rounded-2xl border border-zinc-800">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="bg-[#0d0f12] text-zinc-300">
                <tr>
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3 text-left">Car / Driver</th>
                  <th className="px-4 py-3 text-left">Rig</th>
                  <th className="px-4 py-3 text-left">Figure</th>
                  <th className="px-4 py-3 text-left">Notes</th>
                  <th className="px-4 py-3 text-left">Submitted By</th>
                  {canManageRecords && (
                    <th className="px-4 py-3 text-left">Actions</th>
                  )}
                </tr>
              </thead>

              <tbody>
                {records.length === 0 ? (
                  <tr>
                    <td
                      colSpan={canManageRecords ? 7 : 6}
                      className="px-4 py-6 text-center text-zinc-500"
                    >
                      No drain out reports saved yet for {carDisplayLabel}.
                    </td>
                  </tr>
                ) : (
                  records.map((record) => {
                    const isEditing = editingRecordId === record.id;

                    return (
                      <tr key={record.id} className="border-t border-zinc-800">
                        <td className="px-4 py-3 text-zinc-300">
                          {formatDate(record.created_at)}
                        </td>

                        <td className="px-4 py-3 text-zinc-300">
                          {record.car_name || `Car ${record.car_id}`}
                        </td>

                        <td className="px-4 py-3">
                          {isEditing ? (
                            <select
                              value={editRecord.rig}
                              onChange={(event) =>
                                setEditRecord((current) => ({
                                  ...current,
                                  rig: event.target.value,
                                }))
                              }
                              className="w-full rounded-lg border border-zinc-700 bg-[#0d0f12] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-red-500"
                            >
                              {RIG_OPTIONS.map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ))}
                            </select>
                          ) : (
                            record.rig
                          )}
                        </td>

                        <td className="px-4 py-3 font-semibold text-red-300">
                          {isEditing ? (
                            <input
                              value={editRecord.drain_out_figure}
                              onChange={(event) =>
                                setEditRecord((current) => ({
                                  ...current,
                                  drain_out_figure: event.target.value,
                                }))
                              }
                              inputMode="decimal"
                              className="w-28 rounded-lg border border-zinc-700 bg-[#0d0f12] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-red-500"
                            />
                          ) : (
                            <>
                              {record.drain_out_figure} {record.units}
                            </>
                          )}
                        </td>

                        <td className="px-4 py-3 text-zinc-300">
                          {isEditing ? (
                            <input
                              value={editRecord.notes}
                              onChange={(event) =>
                                setEditRecord((current) => ({
                                  ...current,
                                  notes: event.target.value,
                                }))
                              }
                              className="w-full rounded-lg border border-zinc-700 bg-[#0d0f12] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-red-500"
                              placeholder="Optional notes"
                            />
                          ) : (
                            record.notes || "—"
                          )}
                        </td>

                        <td className="px-4 py-3 text-zinc-400">
                          {record.created_by || "—"}
                        </td>

                        {canManageRecords && (
                          <td className="px-4 py-3">
                            {isEditing ? (
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => updateDrainOutRecord(record)}
                                  disabled={savingEditId === record.id}
                                  className="rounded-lg bg-red-700 px-3 py-2 text-xs font-semibold text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {savingEditId === record.id
                                    ? "Saving..."
                                    : "Save"}
                                </button>

                                <button
                                  type="button"
                                  onClick={cancelEditing}
                                  disabled={savingEditId === record.id}
                                  className="rounded-lg border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-300 hover:border-red-500 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => startEditing(record)}
                                  className="rounded-lg border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-300 hover:border-red-500 hover:text-red-300"
                                >
                                  Edit
                                </button>

                                <button
                                  type="button"
                                  onClick={() => deleteDrainOutRecord(record)}
                                  disabled={deletingRecordId === record.id}
                                  className="rounded-lg border border-red-900/70 px-3 py-2 text-xs font-semibold text-red-300 hover:bg-red-950/40 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {deletingRecordId === record.id
                                    ? "Deleting..."
                                    : "Delete"}
                                </button>
                              </div>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}