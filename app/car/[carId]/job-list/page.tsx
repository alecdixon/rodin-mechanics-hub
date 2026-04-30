"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
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

type JobSection = "standard" | "special";

type JobRow = {
  id?: string;
  car_id: number;
  job_id: number;
  job_text: string;
  section: JobSection;
  done: boolean;
  updated_by: string | null;
  updated_at: string | null;
};

function makeTemplateRows(carId: number): JobRow[] {
  return STANDARD_JOBS.map((text, index) => ({
    car_id: carId,
    job_id: index + 1,
    job_text: text,
    section: "standard",
    done: false,
    updated_by: null,
    updated_at: new Date().toISOString(),
  }));
}

export default function MechanicJobListPage() {
  const params = useParams();
  const carId = Number(params.carId);

  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [userEmail, setUserEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    async function loadJobs() {
      if (!carId) return;
      setLoading(true);
      setErrorMessage("");

      const { data: userData } = await supabase.auth.getUser();
      const email = userData.user?.email?.trim().toLowerCase() ?? "";
      setUserEmail(email);

      const { error: upsertError } = await supabase.from("job_progress").upsert(makeTemplateRows(carId), {
        onConflict: "car_id,job_id,section",
        ignoreDuplicates: true,
      });

      if (upsertError) {
        setErrorMessage(`Failed to create job rows: ${upsertError.message}`);
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from("job_progress")
        .select("*")
        .eq("car_id", carId)
        .order("section", { ascending: false })
        .order("job_id", { ascending: true });

      if (error) {
        setErrorMessage(`Failed to load job list: ${error.message}`);
        setLoading(false);
        return;
      }

      setJobs((data ?? []) as JobRow[]);
      setLoading(false);
    }

    loadJobs();
  }, [carId]);

  const standardJobs = useMemo(() => jobs.filter((job) => job.section === "standard"), [jobs]);
  const specialJobs = useMemo(() => jobs.filter((job) => job.section === "special"), [jobs]);

  const totalJobs = jobs.length;
  const completedJobs = jobs.filter((job) => job.done).length;
  const progress = totalJobs ? Math.round((completedJobs / totalJobs) * 100) : 0;

  async function toggleJob(job: JobRow) {
    const newDone = !job.done;
    const saveKey = `${job.section}-${job.job_id}`;

    setSavingKey(saveKey);
    setErrorMessage("");

    setJobs((current) =>
      current.map((item) =>
        item.car_id === job.car_id && item.job_id === job.job_id && item.section === job.section
          ? { ...item, done: newDone, updated_by: userEmail, updated_at: new Date().toISOString() }
          : item,
      ),
    );

    const { error } = await supabase
      .from("job_progress")
      .update({ done: newDone, updated_by: userEmail, updated_at: new Date().toISOString() })
      .eq("car_id", job.car_id)
      .eq("job_id", job.job_id)
      .eq("section", job.section);

    if (error) {
      setErrorMessage(`Autosave failed: ${error.message}`);
      setJobs((current) =>
        current.map((item) =>
          item.car_id === job.car_id && item.job_id === job.job_id && item.section === job.section ? { ...item, done: job.done } : item,
        ),
      );
    }

    setSavingKey(null);
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-[#0d0f12] p-6 text-zinc-100">
        <div className="rounded-3xl border border-zinc-800 bg-[#14181d] p-6">Loading Car {carId} job list...</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0d0f12] p-6 text-zinc-100">
      <div className="mb-8">
        <p className="text-xs uppercase tracking-[0.3em] text-red-400">Mechanic Job List</p>
        <h1 className="mt-3 text-4xl font-semibold">Car {carId} Job List</h1>
        <p className="mt-3 max-w-2xl text-sm text-zinc-400">Tick jobs off as they are completed. Progress autosaves to Supabase and feeds the chief mechanic dashboard.</p>
      </div>

      {errorMessage && <div className="mb-6 rounded-2xl border border-red-900 bg-red-950/40 p-4 text-sm text-red-200">{errorMessage}</div>}

      <section className="mb-6 rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold">Progress</h2>
            <p className="mt-1 text-sm text-zinc-500">{completedJobs} of {totalJobs} jobs complete.</p>
          </div>
          <div className="rounded-2xl border border-zinc-700 bg-[#0d0f12] px-5 py-3 text-2xl font-semibold">{progress}%</div>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-zinc-800">
          <div className="h-full rounded-full bg-red-700 transition-all" style={{ width: `${progress}%` }} />
        </div>
      </section>

      <section className="mb-6 rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
        <div className="mb-5">
          <h2 className="text-2xl font-semibold">Standard Jobs</h2>
          <p className="mt-1 text-sm text-zinc-500">Released preparation list for this car.</p>
        </div>
        <div className="space-y-2">
          {standardJobs.map((job, index) => {
            const key = `${job.section}-${job.job_id}`;
            const isSaving = savingKey === key;
            return (
              <button key={key} onClick={() => toggleJob(job)} disabled={isSaving} className={`grid w-full grid-cols-[42px_44px_1fr] items-center gap-3 rounded-xl border p-4 text-left transition disabled:opacity-60 ${job.done ? "border-green-800/60 bg-green-950/20" : "border-zinc-800 bg-[#0d0f12] hover:border-red-500/70"}`}>
                <span className="text-sm text-zinc-500">{index + 1}</span>
                <span className={`grid h-8 w-8 place-items-center rounded-lg border ${job.done ? "border-green-500 bg-green-600 text-white" : "border-zinc-600 bg-[#111418] text-transparent"}`}>✓</span>
                <span className={`text-sm leading-6 ${job.done ? "text-zinc-500 line-through" : "text-zinc-100"}`}>{job.job_text}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="rounded-3xl border border-red-900/50 bg-[#181315] p-6 shadow-xl">
        <div className="mb-5">
          <h2 className="text-2xl font-semibold text-red-200">Special Jobs</h2>
          <p className="mt-1 text-sm text-zinc-400">Urgent or car-specific jobs released by the chief mechanic.</p>
        </div>
        {specialJobs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-red-900/50 bg-[#0d0f12] p-6 text-sm text-zinc-500">No special jobs currently released for this car.</div>
        ) : (
          <div className="space-y-2">
            {specialJobs.map((job, index) => {
              const key = `${job.section}-${job.job_id}`;
              const isSaving = savingKey === key;
              return (
                <button key={key} onClick={() => toggleJob(job)} disabled={isSaving} className={`grid w-full grid-cols-[42px_44px_1fr] items-center gap-3 rounded-xl border p-4 text-left transition disabled:opacity-60 ${job.done ? "border-green-800/60 bg-green-950/20" : "border-red-900/40 bg-[#0d0f12] hover:border-red-500/70"}`}>
                  <span className="text-sm text-red-300">{index + 1}</span>
                  <span className={`grid h-8 w-8 place-items-center rounded-lg border ${job.done ? "border-green-500 bg-green-600 text-white" : "border-red-900/60 bg-[#111418] text-transparent"}`}>✓</span>
                  <span className={`text-sm leading-6 ${job.done ? "text-zinc-500 line-through" : "text-red-100"}`}>{job.job_text}</span>
                </button>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
