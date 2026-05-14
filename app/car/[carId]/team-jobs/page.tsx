"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getAssignedCar, getUserRole } from "@/lib/userAccess";

type Priority = "low" | "normal" | "high" | "urgent";

type TeamJob = {
  id: string;
  job_text: string;
  notes: string | null;
  priority: Priority;
  published: boolean;
  published_at: string | null;
  completed: boolean;
  completed_by: string | null;
  completed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_by: string | null;
  updated_at: string | null;
};

function niceDateTime(value: string | null | undefined) {
  if (!value) return "No timestamp";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("en-GB");
}

export default function MechanicTeamJobsPage() {
  const params = useParams();
  const router = useRouter();

  const carId = Number(params.carId);

  const [jobs, setJobs] = useState<TeamJob[]>([]);
  const [userEmail, setUserEmail] = useState("");

  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  async function loadJobs() {
    setLoading(true);
    setMessage("");
    setErrorMessage("");

    const { data: userData, error: userError } = await supabase.auth.getUser();

    if (userError || !userData.user?.email) {
      router.replace("/login");
      return;
    }

    const email = userData.user.email.trim().toLowerCase();
    const role = getUserRole(email);
    const assignedCar = getAssignedCar(email);

    setUserEmail(email);

    if (role === "mechanic" && Number(assignedCar) !== carId) {
      router.replace(`/car/${assignedCar}/team-jobs`);
      return;
    }

    if (role !== "mechanic" && role !== "chief") {
      router.replace("/login");
      return;
    }

    const { data, error } = await supabase
      .from("team_jobs")
      .select("*")
      .eq("published", true)
      .order("completed", { ascending: true })
      .order("published_at", { ascending: false });

    if (error) {
      setErrorMessage(error.message);
      setLoading(false);
      return;
    }

    setJobs((data ?? []) as TeamJob[]);
    setLoading(false);
  }

  useEffect(() => {
    if (carId) {
      loadJobs();
    }
  }, [carId]);

  useEffect(() => {
    const channel = supabase
      .channel("mechanic-team-jobs")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "team_jobs",
        },
        () => {
          loadJobs();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const openJobs = useMemo(
    () => jobs.filter((job) => !job.completed),
    [jobs],
  );

  const completedJobs = useMemo(
    () => jobs.filter((job) => job.completed),
    [jobs],
  );

  const progress = jobs.length
    ? Math.round((completedJobs.length / jobs.length) * 100)
    : 0;

  async function toggleJob(job: TeamJob) {
    const nextCompleted = !job.completed;
    const now = new Date().toISOString();

    setSavingId(job.id);
    setMessage("");
    setErrorMessage("");

    setJobs((current) =>
      current.map((item) =>
        item.id === job.id
          ? {
              ...item,
              completed: nextCompleted,
              completed_by: nextCompleted ? userEmail : null,
              completed_at: nextCompleted ? now : null,
              updated_by: userEmail,
              updated_at: now,
            }
          : item,
      ),
    );

    const { error } = await supabase
      .from("team_jobs")
      .update({
        completed: nextCompleted,
        completed_by: nextCompleted ? userEmail : null,
        completed_at: nextCompleted ? now : null,
        updated_by: userEmail,
        updated_at: now,
      })
      .eq("id", job.id);

    if (error) {
      setErrorMessage(error.message);
      await loadJobs();
      setSavingId(null);
      return;
    }

    setMessage(nextCompleted ? "Team job completed." : "Team job reopened.");
    setSavingId(null);
  }

  function priorityClass(priority: Priority) {
    if (priority === "urgent") {
      return "border-red-500 bg-red-950/50 text-red-100";
    }

    if (priority === "high") {
      return "border-orange-500 bg-orange-950/40 text-orange-100";
    }

    if (priority === "low") {
      return "border-zinc-700 bg-zinc-900 text-zinc-300";
    }

    return "border-blue-700 bg-blue-950/40 text-blue-100";
  }

  function renderJob(job: TeamJob) {
    const isSaving = savingId === job.id;

    return (
      <div
        key={job.id}
        className={`rounded-xl border p-4 transition ${
          job.completed
            ? "border-green-800/60 bg-green-950/20"
            : "border-neutral-800 bg-[#0d0f12] hover:border-red-500/70"
        }`}
      >
        <div className="grid grid-cols-[44px_1fr] gap-4">
          <button
            type="button"
            onClick={() => toggleJob(job)}
            disabled={isSaving}
            className={`grid h-9 w-9 place-items-center rounded-lg border text-sm font-bold transition disabled:opacity-50 ${
              job.completed
                ? "border-green-500 bg-green-600 text-white"
                : "border-zinc-600 bg-[#111418] text-transparent hover:border-red-500"
            }`}
          >
            ✓
          </button>

          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex rounded-full border px-3 py-1 text-xs font-bold uppercase ${priorityClass(
                  job.priority,
                )}`}
              >
                {job.priority}
              </span>

              {job.completed && (
                <span className="rounded-full border border-green-800 bg-green-950/40 px-3 py-1 text-xs font-bold uppercase text-green-300">
                  Complete
                </span>
              )}
            </div>

            <p
              className={`mt-3 text-sm leading-6 ${
                job.completed
                  ? "text-neutral-500 line-through"
                  : "text-neutral-100"
              }`}
            >
              {job.job_text}
            </p>

            {job.notes && (
              <div className="mt-4 rounded-xl border border-neutral-800 bg-black p-4 text-sm leading-6 text-neutral-300">
                <span className="font-semibold text-red-300">Notes: </span>
                {job.notes}
              </div>
            )}

            <div className="mt-4 text-xs text-neutral-500">
              <p>Published: {niceDateTime(job.published_at)}</p>

              {job.completed && (
                <p className="mt-1 text-green-300">
                  Completed by {job.completed_by ?? "unknown"} —{" "}
                  {niceDateTime(job.completed_at)}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-black p-6 text-neutral-400">
        Loading team jobs...
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black text-white">
      <div className="mb-6 border-b border-neutral-800 pb-6">
        <p className="text-xs uppercase tracking-[0.35em] text-red-500">
          Rodin Motorsport
        </p>

        <h1 className="mt-2 text-3xl font-bold">Team Jobs</h1>

        <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-400">
          Team-wide jobs published by the chief mechanic. These are shared
          across the whole team, not just Car {carId}.
        </p>
      </div>

      {message && (
        <div className="mb-6 rounded-xl border border-green-800 bg-green-950/30 p-4 text-sm text-green-200">
          {message}
        </div>
      )}

      {errorMessage && (
        <div className="mb-6 rounded-xl border border-red-800 bg-red-950/40 p-4 text-sm text-red-200">
          {errorMessage}
        </div>
      )}

      <section className="mb-6 grid gap-4 md:grid-cols-4">
        <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-4">
          <p className="text-3xl font-bold">{jobs.length}</p>
          <p className="mt-1 text-xs text-neutral-500">Total Published</p>
        </div>

        <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-4">
          <p className="text-3xl font-bold text-red-400">{openJobs.length}</p>
          <p className="mt-1 text-xs text-neutral-500">Open</p>
        </div>

        <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-4">
          <p className="text-3xl font-bold text-green-400">
            {completedJobs.length}
          </p>
          <p className="mt-1 text-xs text-neutral-500">Completed</p>
        </div>

        <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-4">
          <p className="text-3xl font-bold">{progress}%</p>
          <p className="mt-1 text-xs text-neutral-500">Progress</p>
        </div>
      </section>

      {jobs.length === 0 ? (
        <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-6 text-sm text-neutral-500">
          No team jobs have been published yet.
        </div>
      ) : (
        <div className="space-y-8">
          <section>
            <h2 className="text-xl font-bold">Open Team Jobs</h2>

            {openJobs.length === 0 ? (
              <p className="mt-4 rounded-xl border border-green-800 bg-green-950/20 p-4 text-sm text-green-300">
                All team jobs are complete.
              </p>
            ) : (
              <div className="mt-4 space-y-3">{openJobs.map(renderJob)}</div>
            )}
          </section>

          <section>
            <h2 className="text-xl font-bold">Completed Team Jobs</h2>

            {completedJobs.length === 0 ? (
              <p className="mt-4 rounded-xl border border-neutral-800 bg-neutral-950 p-4 text-sm text-neutral-500">
                No team jobs completed yet.
              </p>
            ) : (
              <div className="mt-4 space-y-3">
                {completedJobs.map(renderJob)}
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}