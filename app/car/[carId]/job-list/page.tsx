"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

const STANDARD_JOBS = [
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

const SPECIAL_JOBS: string[] = [];

type Job = {
  id: number;
  text: string;
  done: boolean;
};

function makeJobs(items: string[]): Job[] {
  return items.map((text, index) => ({
    id: index + 1,
    text,
    done: false,
  }));
}

export default function JobListPage() {
  const router = useRouter();
  const params = useParams();

  const carId = params.carId as string;

  const [standardJobs, setStandardJobs] = useState<Job[]>(
    makeJobs(STANDARD_JOBS),
  );

  const [specialJobs, setSpecialJobs] = useState<Job[]>(
    makeJobs(SPECIAL_JOBS),
  );

  async function handleLogout() {
    await supabase.auth.signOut();
    document.cookie = "user-email=; path=/; max-age=0";
    router.push("/login");
  }

  const totalJobs = standardJobs.length + specialJobs.length;

  const completedJobs =
    standardJobs.filter((job) => job.done).length +
    specialJobs.filter((job) => job.done).length;

  const progress = totalJobs
    ? Math.round((completedJobs / totalJobs) * 100)
    : 0;

  function toggleStandardJob(id: number) {
    setStandardJobs((current) =>
      current.map((job) =>
        job.id === id ? { ...job, done: !job.done } : job,
      ),
    );
  }

  function toggleSpecialJob(id: number) {
    setSpecialJobs((current) =>
      current.map((job) =>
        job.id === id ? { ...job, done: !job.done } : job,
      ),
    );
  }

  return (
    <main className="min-h-screen bg-[#0d0f12] px-6 py-8 text-zinc-100">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-red-400">
              Mechanic Job List
            </p>

            <h1 className="mt-3 text-4xl font-semibold">Car {carId} Job List</h1>

            <p className="mt-3 max-w-2xl text-sm text-zinc-400">
              Complete the released job list for this car. The chief mechanic can
              view progress across all cars.
            </p>
          </div>

          <button
            onClick={handleLogout}
            className="rounded-xl border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:border-red-500 hover:text-white"
          >
            Logout
          </button>
        </div>

        <section className="mb-6 rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold">Progress</h2>
              <p className="mt-1 text-sm text-zinc-500">
                {completedJobs} of {totalJobs} jobs complete.
              </p>
            </div>

            <div className="rounded-2xl border border-zinc-700 bg-[#0d0f12] px-5 py-3 text-2xl font-semibold">
              {progress}%
            </div>
          </div>

          <div className="h-3 overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full rounded-full bg-red-700 transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </section>

        <section className="mb-6 rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
          <div className="mb-5">
            <h2 className="text-2xl font-semibold">Standard Jobs</h2>
            <p className="mt-1 text-sm text-zinc-500">
              Released standard preparation list.
            </p>
          </div>

          <div className="space-y-2">
            {standardJobs.map((job, index) => (
              <button
                key={job.id}
                onClick={() => toggleStandardJob(job.id)}
                className={`grid w-full grid-cols-[42px_44px_1fr] items-center gap-3 rounded-xl border p-4 text-left transition ${
                  job.done
                    ? "border-green-800/60 bg-green-950/20"
                    : "border-zinc-800 bg-[#0d0f12] hover:border-red-500/70"
                }`}
              >
                <span className="text-sm text-zinc-500">{index + 1}</span>

                <span
                  className={`grid h-8 w-8 place-items-center rounded-lg border ${
                    job.done
                      ? "border-green-500 bg-green-600 text-white"
                      : "border-zinc-600 bg-[#111418] text-transparent"
                  }`}
                >
                  ✓
                </span>

                <span
                  className={`text-sm leading-6 ${
                    job.done ? "text-zinc-500 line-through" : "text-zinc-100"
                  }`}
                >
                  {job.text}
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-3xl border border-red-900/50 bg-[#181315] p-6 shadow-xl">
          <div className="mb-5">
            <h2 className="text-2xl font-semibold text-red-200">
              Special Jobs
            </h2>
            <p className="mt-1 text-sm text-zinc-400">
              Urgent or car-specific jobs released by the chief mechanic.
            </p>
          </div>

          {specialJobs.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-red-900/50 bg-[#0d0f12] p-6 text-sm text-zinc-500">
              No special jobs currently released for this car.
            </div>
          ) : (
            <div className="space-y-2">
              {specialJobs.map((job, index) => (
                <button
                  key={job.id}
                  onClick={() => toggleSpecialJob(job.id)}
                  className={`grid w-full grid-cols-[42px_44px_1fr] items-center gap-3 rounded-xl border p-4 text-left transition ${
                    job.done
                      ? "border-green-800/60 bg-green-950/20"
                      : "border-red-900/40 bg-[#0d0f12] hover:border-red-500/70"
                  }`}
                >
                  <span className="text-sm text-red-300">{index + 1}</span>

                  <span
                    className={`grid h-8 w-8 place-items-center rounded-lg border ${
                      job.done
                        ? "border-green-500 bg-green-600 text-white"
                        : "border-red-900/60 bg-[#111418] text-transparent"
                    }`}
                  >
                    ✓
                  </span>

                  <span
                    className={`text-sm leading-6 ${
                      job.done ? "text-zinc-500 line-through" : "text-red-100"
                    }`}
                  >
                    {job.text}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}