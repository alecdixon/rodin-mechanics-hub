"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import LogoutButton from "@/app/components/LogoutButton";

type PostEventForm = {
  chassis: string;
  driver: string;
  engine_no: string;
  hours_remaining: string;
  gearbox_no: string;
  fuel_drained_kg: string;
  diff_break_off: string;
  diff_dynamic: string;
  notes: string;
};

const EMPTY_FORM: PostEventForm = {
  chassis: "",
  driver: "",
  engine_no: "",
  hours_remaining: "",
  gearbox_no: "",
  fuel_drained_kg: "",
  diff_break_off: "",
  diff_dynamic: "",
  notes: "",
};

export default function PostEventSheetPage() {
  const params = useParams();
  const carId = Number(params.carId);

  const [form, setForm] = useState<PostEventForm>(EMPTY_FORM);
  const [userEmail, setUserEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadingLatest, setLoadingLatest] = useState(true);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const completionPercent = useMemo(() => {
    const requiredFields = [
      form.chassis,
      form.driver,
      form.engine_no,
      form.hours_remaining,
      form.gearbox_no,
      form.fuel_drained_kg,
      form.diff_break_off,
      form.diff_dynamic,
    ];

    const filled = requiredFields.filter((value) => value.trim()).length;
    return Math.round((filled / requiredFields.length) * 100);
  }, [form]);

  useEffect(() => {
    async function init() {
      if (!carId) return;

      setLoadingLatest(true);
      setErrorMessage("");

      const { data: userData } = await supabase.auth.getUser();
      setUserEmail(userData.user?.email?.trim().toLowerCase() ?? "");

      const { data, error } = await supabase
        .from("post_event_sheets")
        .select("*")
        .eq("car_id", carId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        setErrorMessage(error.message);
        setLoadingLatest(false);
        return;
      }

      if (data) {
        setForm({
          chassis: String(data.chassis ?? ""),
          driver: String(data.driver ?? ""),
          engine_no: String(data.engine_no ?? ""),
          hours_remaining: String(data.hours_remaining ?? ""),
          gearbox_no: String(data.gearbox_no ?? ""),
          fuel_drained_kg: String(data.fuel_drained_kg ?? ""),
          diff_break_off: String(data.diff_break_off ?? ""),
          diff_dynamic: String(data.diff_dynamic ?? ""),
          notes: String(data.notes ?? ""),
        });
      }

      setLoadingLatest(false);
    }

    init();
  }, [carId]);

  function updateField(field: keyof PostEventForm, value: string) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function saveSheet() {
    setSaving(true);
    setMessage("");
    setErrorMessage("");

    const { error } = await supabase.from("post_event_sheets").insert({
      car_id: carId,
      chassis: form.chassis.trim(),
      driver: form.driver.trim(),
      engine_no: form.engine_no.trim(),
      hours_remaining: form.hours_remaining.trim(),
      gearbox_no: form.gearbox_no.trim(),
      fuel_drained_kg: form.fuel_drained_kg.trim(),
      diff_break_off: form.diff_break_off.trim(),
      diff_dynamic: form.diff_dynamic.trim(),
      notes: form.notes.trim(),
      created_by: userEmail || null,
      created_at: new Date().toISOString(),
    });

    if (error) {
      setErrorMessage(error.message);
      setSaving(false);
      return;
    }

    setMessage("Post-event sheet saved successfully.");
    setSaving(false);
  }

  function clearForm() {
    const confirmed = window.confirm(
      "Clear the current post-event sheet on screen? This will not delete saved records.",
    );

    if (!confirmed) return;

    setForm(EMPTY_FORM);
    setMessage("");
    setErrorMessage("");
  }

  if (loadingLatest) {
    return (
      <main className="min-h-screen bg-[#0d0f12] p-6 text-zinc-100">
        <div className="rounded-3xl border border-zinc-800 bg-[#14181d] p-6">
          Loading post-event sheet...
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0d0f12] p-6 text-zinc-100">
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4 rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-red-400">
            Rodin Motorsport
          </p>

          <h1 className="mt-3 text-4xl font-semibold tracking-tight">
            Car {carId} Post-Event Sheet
          </h1>

          <p className="mt-3 max-w-3xl text-sm text-zinc-400">
            Record the key post-event details for chassis, engine, gearbox, fuel
            drained and diff checks.
          </p>
        </div>

        <LogoutButton />
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

      <section className="mb-6 grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold">Event Details</h2>
              <p className="mt-1 text-sm text-zinc-500">
                Main post-event identity and running details.
              </p>
            </div>

            <div className="rounded-2xl border border-zinc-700 bg-[#0d0f12] px-5 py-3 text-right">
              <p className="text-xs uppercase tracking-[0.25em] text-zinc-500">
                Complete
              </p>
              <p className="text-2xl font-semibold text-red-400">
                {completionPercent}%
              </p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <InputCard
              label="Chassis"
              value={form.chassis}
              placeholder="#022"
              onChange={(value) => updateField("chassis", value)}
            />

            <InputCard
              label="Driver"
              value={form.driver}
              placeholder="M. Rehm"
              onChange={(value) => updateField("driver", value)}
            />

            <InputCard
              label="Engine No."
              value={form.engine_no}
              placeholder="Engine number"
              onChange={(value) => updateField("engine_no", value)}
            />

            <InputCard
              label="Hours Remaining"
              value={form.hours_remaining}
              placeholder="0.0"
              onChange={(value) => updateField("hours_remaining", value)}
            />

            <InputCard
              label="Gearbox No."
              value={form.gearbox_no}
              placeholder="Gearbox number"
              onChange={(value) => updateField("gearbox_no", value)}
            />
          </div>
        </div>

        <div className="rounded-3xl border border-red-900/40 bg-[#181315] p-6 shadow-xl">
          <p className="text-xs uppercase tracking-[0.3em] text-red-300">
            Sheet Status
          </p>

          <div className="mt-6 h-3 overflow-hidden rounded-full bg-red-950/50">
            <div
              className="h-full rounded-full bg-red-600 transition-all"
              style={{ width: `${completionPercent}%` }}
            />
          </div>

          <p className="mt-4 text-sm text-zinc-400">
            Fill in the fields, then save the sheet. Each save creates a new
            timestamped post-event record.
          </p>

          <div className="mt-6 rounded-2xl border border-red-900/50 bg-[#0d0f12] p-4 text-sm text-zinc-400">
            <p>
              Car:{" "}
              <span className="font-semibold text-zinc-100">Car {carId}</span>
            </p>
            <p className="mt-1">
              User:{" "}
              <span className="font-semibold text-zinc-100">
                {userEmail || "Unknown"}
              </span>
            </p>
          </div>
        </div>
      </section>

      <section className="mb-6 grid gap-6 lg:grid-cols-3">
        <div className="rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
          <div className="mb-5">
            <p className="text-xs uppercase tracking-[0.3em] text-red-400">
              Fuel
            </p>

            <h2 className="mt-2 text-2xl font-semibold">Fuel Drained</h2>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-[#0d0f12] p-5">
            <label className="block text-sm font-semibold text-zinc-300">
              Fuel Drained
            </label>

            <div className="mt-3 flex items-end gap-3">
              <input
                value={form.fuel_drained_kg}
                onChange={(event) =>
                  updateField("fuel_drained_kg", event.target.value)
                }
                placeholder="0.00"
                inputMode="decimal"
                className="w-full rounded-xl border border-zinc-700 bg-[#111418] px-4 py-4 text-3xl font-semibold text-zinc-100 outline-none transition focus:border-red-500"
              />

              <span className="pb-4 text-sm font-semibold uppercase tracking-widest text-zinc-500">
                KG
              </span>
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl lg:col-span-2">
          <div className="mb-5">
            <p className="text-xs uppercase tracking-[0.3em] text-red-400">
              Differential
            </p>

            <h2 className="mt-2 text-2xl font-semibold">Diff Checks</h2>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <InputCard
              label="Diff Break-Off"
              value={form.diff_break_off}
              placeholder="Value / comment"
              onChange={(value) => updateField("diff_break_off", value)}
            />

            <InputCard
              label="Diff Dynamic"
              value={form.diff_dynamic}
              placeholder="Value / comment"
              onChange={(value) => updateField("diff_dynamic", value)}
            />
          </div>
        </div>
      </section>

      <section className="mb-6 rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
        <h2 className="text-2xl font-semibold">Notes</h2>

        <p className="mt-1 text-sm text-zinc-500">
          Add any extra comments, damage notes, mechanic observations or follow-up
          actions.
        </p>

        <textarea
          value={form.notes}
          onChange={(event) => updateField("notes", event.target.value)}
          placeholder="Type post-event notes here..."
          rows={6}
          className="mt-5 w-full resize-none rounded-2xl border border-zinc-700 bg-[#0d0f12] px-4 py-4 text-sm text-zinc-100 outline-none transition focus:border-red-500"
        />
      </section>

      <section className="rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold">Save Sheet</h2>
            <p className="mt-1 text-sm text-zinc-500">
              Saves this as a new post-event sheet record for Car {carId}.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              onClick={clearForm}
              className="rounded-xl border border-zinc-700 px-5 py-3 text-sm font-semibold text-zinc-300 hover:border-red-500 hover:text-red-300"
            >
              Clear Form
            </button>

            <button
              onClick={saveSheet}
              disabled={saving}
              className="rounded-xl bg-red-700 px-6 py-3 text-sm font-semibold text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Post-Event Sheet"}
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}

function InputCard({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block rounded-2xl border border-zinc-800 bg-[#0d0f12] p-4">
      <span className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">
        {label}
      </span>

      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-3 w-full border-none bg-transparent text-lg font-semibold text-zinc-100 outline-none placeholder:text-zinc-700"
      />
    </label>
  );
}