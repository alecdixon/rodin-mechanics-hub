"use client";

import { useState } from "react";

export default function PostEventPage() {
  const [form, setForm] = useState({
    chassis: "#022",
    driver: "M. Rehm",
    engineNo: "",
    hoursRemaining: "",
    gearboxNo: "",
    fuelDrained: "",
    diffBreakOff: "",
    diffDynamic: "",
    notes: "",
  });

  function updateField(field: keyof typeof form, value: string) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  return (
    <div>
      <div className="mb-8">
        <p className="text-xs uppercase tracking-[0.3em] text-red-400">
          Post Event Sheet
        </p>

        <h1 className="mt-3 text-4xl font-semibold">Post Event</h1>

        <p className="mt-3 max-w-2xl text-sm text-zinc-400">
          Final car condition, consumables, fuel, differential checks and event
          close-out information.
        </p>
      </div>

      <section className="rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-zinc-800 pb-5">
          <div>
            <h2 className="text-2xl font-semibold">Car Information</h2>
            <p className="mt-1 text-sm text-zinc-500">
              Core identifiers for this post-event record.
            </p>
          </div>

          <span className="rounded-full border border-zinc-700 bg-[#0d0f12] px-4 py-2 text-xs uppercase tracking-widest text-zinc-400">
            Draft
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          <Field
            label="Chassis"
            value={form.chassis}
            onChange={(value) => updateField("chassis", value)}
          />

          <Field
            label="Driver"
            value={form.driver}
            onChange={(value) => updateField("driver", value)}
          />

          <Field
            label="Engine No."
            value={form.engineNo}
            onChange={(value) => updateField("engineNo", value)}
          />

          <Field
            label="Hours Remaining"
            value={form.hoursRemaining}
            onChange={(value) => updateField("hoursRemaining", value)}
          />

          <Field
            label="Gbox No."
            value={form.gearboxNo}
            onChange={(value) => updateField("gearboxNo", value)}
          />
        </div>
      </section>

      <section className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
          <div className="mb-5">
            <h2 className="text-xl font-semibold">Fuel Drained</h2>
            <p className="mt-1 text-sm text-zinc-500">
              Record total drained fuel mass.
            </p>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-[#0d0f12] p-5">
            <label className="mb-2 block text-xs uppercase tracking-widest text-zinc-500">
              Fuel Drained
            </label>

            <div className="flex items-center gap-3">
              <input
                value={form.fuelDrained}
                onChange={(event) =>
                  updateField("fuelDrained", event.target.value)
                }
                placeholder="0.0"
                type="number"
                className="w-full rounded-xl border border-zinc-700 bg-[#111418] px-4 py-4 text-3xl font-semibold outline-none focus:border-red-500"
              />

              <span className="rounded-xl border border-zinc-700 bg-[#171b21] px-4 py-4 text-sm text-zinc-400">
                kg
              </span>
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl xl:col-span-2">
          <div className="mb-5">
            <h2 className="text-xl font-semibold">Differential Checks</h2>
            <p className="mt-1 text-sm text-zinc-500">
              Record diff break-off and dynamic readings.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field
              label="Diff Break-Off"
              value={form.diffBreakOff}
              onChange={(value) => updateField("diffBreakOff", value)}
              placeholder="Enter reading"
            />

            <Field
              label="Diff Dynamic"
              value={form.diffDynamic}
              onChange={(value) => updateField("diffDynamic", value)}
              placeholder="Enter reading"
            />
          </div>
        </div>
      </section>

      <section className="mt-6 rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
        <div className="mb-5">
          <h2 className="text-xl font-semibold">Post Event Notes</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Add any issues, follow-up work or comments from strip down.
          </p>
        </div>

        <textarea
          value={form.notes}
          onChange={(event) => updateField("notes", event.target.value)}
          placeholder="Example: gearbox magnet clean, rear floor needs repair, inspect DRS hanger before next run..."
          className="min-h-36 w-full resize-y rounded-2xl border border-zinc-700 bg-[#0d0f12] px-4 py-4 text-sm outline-none focus:border-red-500"
        />
      </section>

      <div className="mt-6 flex justify-end gap-3">
        <button className="rounded-xl border border-zinc-700 bg-[#171b21] px-5 py-3 text-sm font-medium hover:border-red-500">
          Save Draft
        </button>

        <button className="rounded-xl bg-red-700 px-5 py-3 text-sm font-semibold hover:bg-red-600">
          Submit Post Event Sheet
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="mb-2 block text-xs uppercase tracking-widest text-zinc-500">
        {label}
      </label>

      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-sm outline-none focus:border-red-500"
      />
    </div>
  );
}