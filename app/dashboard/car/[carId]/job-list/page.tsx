"use client";

import { useState } from "react";
import Link from "next/link";

const STANDARD_TEMPLATE = [
  "Fill out post event sheet",
  "Check chassis for damage",
  "Drain gearbox oil, inspect magnet. Report any issues to DC",
  "Check clutch and release bearing",
  "Check gears for pitting / wear etc",
  "Clean stub axle's and re-grease",
  "Check Engine studs",
  "Check clevis' for cracks",
  "Check floors, v-block and diffuser for damage (get repaired ASAP) — Wood measurement F: R:",
  "Check ackerman arms for cracks (front and rear)",
  "Blow out radiators, discs and corners",
  "Check rad fan gap and bolts",
  "Check wheel bearings for play / freedom of movement",
  "Spanner check drivepegs — 75Nm 270 loctite",
  "Check for airbox for cracks, delamination or any damage",
  "Check ALL power terminals are tight + securely crimped",
  "Check chassis and engine loom for chaffing, plug pulling",
  "Drain Compressor if run in the wet",
  "Check brake discs and bells for cracks",
  "Check / replace brake pads",
  "Check caliper seals arent leaking",
  "Check all brake lines for chafing and kinks",
  "Spanner check all brake unions",
  "Check engine oil header tank for leaks or cracks",
  "Check column loom",
  "Check steering for play in rack and renault joints",
  "Check bodywork brackets for cracks",
  "Check rad fences",
  "Check and clean air filter, wash and oil after race weekends",
  "Check wishbones for damage (use a straight edge). Pay extra attention to welds",
  "Check and clean front wings and check endplate alignment - spanner check",
  "Spanner and crack check rear wing and check DRS — CHECK REAR WING HANGERS",
  "Check wishbone bearings",
  "Spanner check pedal box",
  "Check brake bias cable and that bias is free",
  "Inspect CV boots",
  "Check DRS system for leaks (turn car on and check pressure)",
  "Check DRS compressor mount is secure",
  "Check gear actuator bearings for play",
  "Bleed brakes",
  "Bleed clutch",
  "Check fire extinguisher bracket, test battery and loom",
  "Clean seat & extraction bucket",
  "Check seat belts for damage",
  "Check tape on wishbones isn't peeling off",
  "Spanner check",
  "Check dampers are set on paint marks, if not check with engineer if a setdown is required",
  "Fire up & shift check - wheel speeds, steering, brake pressure and oil dip. Check DRS operation",
  "Fit floors - Check alignment and set floor stays (make sure all clips are secured)",
  "Check toes and setup",
];

type Props = {
  params: Promise<{ carId: string }>;
};

type EditableJob = {
  id: number;
  text: string;
};

function makeJobs() {
  return STANDARD_TEMPLATE.map((text, index) => ({
    id: index + 1,
    text,
  }));
}

export default async function ChiefJobListEditorPage({ params }: Props) {
  const { carId } = await params;

  return <ChiefJobListEditor carId={carId} />;
}

function ChiefJobListEditor({ carId }: { carId: string }) {
  const [standardJobs, setStandardJobs] = useState<EditableJob[]>(makeJobs());
  const [specialJobs, setSpecialJobs] = useState<EditableJob[]>([]);
  const [newStandardJob, setNewStandardJob] = useState("");
  const [newSpecialJob, setNewSpecialJob] = useState("");
  const [releasedAt, setReleasedAt] = useState<string | null>(null);

  function updateStandardJob(id: number, text: string) {
    setStandardJobs((current) =>
      current.map((job) => (job.id === id ? { ...job, text } : job)),
    );
  }

  function removeStandardJob(id: number) {
    setStandardJobs((current) => current.filter((job) => job.id !== id));
  }

  function addStandardJob() {
    if (!newStandardJob.trim()) return;

    setStandardJobs((current) => [
      ...current,
      {
        id: Date.now(),
        text: newStandardJob.trim(),
      },
    ]);

    setNewStandardJob("");
  }

  function resetStandardTemplate() {
    setStandardJobs(makeJobs());
  }

  function updateSpecialJob(id: number, text: string) {
    setSpecialJobs((current) =>
      current.map((job) => (job.id === id ? { ...job, text } : job)),
    );
  }

  function removeSpecialJob(id: number) {
    setSpecialJobs((current) => current.filter((job) => job.id !== id));
  }

  function addSpecialJob() {
    if (!newSpecialJob.trim()) return;

    setSpecialJobs((current) => [
      ...current,
      {
        id: Date.now(),
        text: newSpecialJob.trim(),
      },
    ]);

    setNewSpecialJob("");
  }

  function releaseJobList() {
    setReleasedAt(new Date().toLocaleString());
  }

  return (
    <main className="min-h-screen bg-[#0d0f12] p-6 text-zinc-100">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/dashboard"
            className="text-sm text-red-400 hover:text-red-300"
          >
            ← Back to dashboard
          </Link>

          <p className="mt-6 text-xs uppercase tracking-[0.3em] text-red-400">
            Chief Mechanic Control
          </p>

          <h1 className="mt-3 text-4xl font-semibold">
            Car {carId} Job List Editor
          </h1>

          <p className="mt-3 max-w-3xl text-sm text-zinc-400">
            Edit the standard list, add urgent special jobs, then release the
            list to the mechanic device for this car.
          </p>
        </div>

        <button
          onClick={releaseJobList}
          className="rounded-xl bg-red-700 px-6 py-3 text-sm font-semibold hover:bg-red-600"
        >
          Release to Car {carId}
        </button>
      </div>

      {releasedAt && (
        <div className="mb-6 rounded-2xl border border-green-800/60 bg-green-950/20 p-4 text-sm text-green-300">
          Job list released to Car {carId} at {releasedAt}. Database saving will
          be connected in the next backend step.
        </div>
      )}

      <section className="mb-6 rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold">Standard Jobs</h2>
            <p className="mt-1 text-sm text-zinc-500">
              This is the base job list released to the mechanic.
            </p>
          </div>

          <button
            onClick={resetStandardTemplate}
            className="rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-sm hover:border-red-500"
          >
            Reset Template
          </button>
        </div>

        <div className="mb-5 flex gap-3">
          <input
            value={newStandardJob}
            onChange={(event) => setNewStandardJob(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") addStandardJob();
            }}
            placeholder="Add standard job..."
            className="flex-1 rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-sm outline-none focus:border-red-500"
          />

          <button
            onClick={addStandardJob}
            className="rounded-xl bg-[#222832] px-5 py-3 text-sm font-semibold hover:bg-[#2a313b]"
          >
            Add
          </button>
        </div>

        <div className="space-y-2">
          {standardJobs.map((job, index) => (
            <div
              key={job.id}
              className="grid grid-cols-[42px_1fr_auto] items-center gap-3 rounded-xl border border-zinc-800 bg-[#0d0f12] p-3"
            >
              <span className="text-sm text-zinc-500">{index + 1}</span>

              <input
                value={job.text}
                onChange={(event) =>
                  updateStandardJob(job.id, event.target.value)
                }
                className="w-full rounded-lg border border-transparent bg-transparent px-2 py-2 text-sm outline-none focus:border-zinc-700 focus:bg-[#14181d]"
              />

              <button
                onClick={() => removeStandardJob(job.id)}
                className="rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-400 hover:border-red-500 hover:text-red-300"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-3xl border border-red-900/50 bg-[#181315] p-6 shadow-xl">
        <div className="mb-5">
          <h2 className="text-2xl font-semibold text-red-200">Special Jobs</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Add urgent or car-specific jobs. Mechanics can complete them, but
            cannot edit them.
          </p>
        </div>

        <div className="mb-5 flex gap-3">
          <input
            value={newSpecialJob}
            onChange={(event) => setNewSpecialJob(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") addSpecialJob();
            }}
            placeholder="Add urgent special job..."
            className="flex-1 rounded-xl border border-red-900/50 bg-[#0d0f12] px-4 py-3 text-sm outline-none focus:border-red-500"
          />

          <button
            onClick={addSpecialJob}
            className="rounded-xl bg-red-700 px-5 py-3 text-sm font-semibold hover:bg-red-600"
          >
            Add Special
          </button>
        </div>

        {specialJobs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-red-900/50 bg-[#0d0f12] p-6 text-sm text-zinc-500">
            No special jobs added for this car.
          </div>
        ) : (
          <div className="space-y-2">
            {specialJobs.map((job, index) => (
              <div
                key={job.id}
                className="grid grid-cols-[42px_1fr_auto] items-center gap-3 rounded-xl border border-red-900/40 bg-[#0d0f12] p-3"
              >
                <span className="text-sm text-red-300">{index + 1}</span>

                <input
                  value={job.text}
                  onChange={(event) =>
                    updateSpecialJob(job.id, event.target.value)
                  }
                  className="w-full rounded-lg border border-transparent bg-transparent px-2 py-2 text-sm text-red-100 outline-none focus:border-red-900/70 focus:bg-[#14181d]"
                />

                <button
                  onClick={() => removeSpecialJob(job.id)}
                  className="rounded-lg border border-red-900/60 px-3 py-2 text-xs text-zinc-400 hover:border-red-500 hover:text-red-300"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}