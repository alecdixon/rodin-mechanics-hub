"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getUserRole } from "@/lib/userAccess";
import LogoutButton from "@/app/components/LogoutButton";

type JobRow = {
  id?: string;
  car_id: number;
  job_id: number;
  job_text: string;
  section: "standard" | "special";
  done: boolean;
  updated_by: string | null;
  updated_at: string | null;
};

type JobRelease = {
  car_id: number;
  after_event: string | null;
  job_date: string | null;
  released_by: string | null;
  released_at: string | null;
};

type GenericRecord = Record<string, unknown>;

export default function ChiefCarViewerPage() {
  const params = useParams();
  const router = useRouter();
  const carId = Number(params.carId);

  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [releaseInfo, setReleaseInfo] = useState<JobRelease | null>(null);
  const [clutchRows, setClutchRows] = useState<GenericRecord[]>([]);
  const [postEventRows, setPostEventRows] = useState<GenericRecord[]>([]);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    async function loadViewer() {
      const { data: userData } = await supabase.auth.getUser();
      const role = getUserRole(userData.user?.email ?? "");

      if (role !== "chief") {
        router.replace("/dashboard");
        return;
      }

      setLoading(true);
      setErrorMessage("");

      const { data: releaseData, error: releaseError } = await supabase
        .from("job_list_releases")
        .select("*")
        .eq("car_id", carId)
        .maybeSingle();

      if (releaseError) {
        setErrorMessage(releaseError.message);
      } else {
        setReleaseInfo((releaseData as JobRelease) ?? null);
      }

      const { data: jobData, error: jobError } = await supabase
        .from("job_progress")
        .select("*")
        .eq("car_id", carId)
        .order("section", { ascending: false })
        .order("job_id", { ascending: true });

      if (jobError) {
        setErrorMessage(jobError.message);
      } else {
        setJobs((jobData ?? []) as JobRow[]);
      }

      const clutch = await supabase
        .from("clutch_measurements")
        .select("*")
        .eq("car_id", carId)
        .order("created_at", { ascending: false })
        .limit(10);

      if (!clutch.error) {
        setClutchRows((clutch.data ?? []) as GenericRecord[]);
      }

      const postEvent = await supabase
        .from("post_event_sheets")
        .select("*")
        .eq("car_id", carId)
        .order("created_at", { ascending: false })
        .limit(10);

      if (!postEvent.error) {
        setPostEventRows((postEvent.data ?? []) as GenericRecord[]);
      }

      setLoading(false);
    }

    if (carId) loadViewer();
  }, [carId, router]);

  const completedJobs = jobs.filter((job) => job.done).length;
  const totalJobs = jobs.length;
  const progress = totalJobs ? Math.round((completedJobs / totalJobs) * 100) : 0;

  const outstandingJobs = useMemo(
    () => jobs.filter((job) => !job.done),
    [jobs],
  );

  const completedJobRows = useMemo(
    () => jobs.filter((job) => job.done),
    [jobs],
  );

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0d0f12] text-zinc-400">
        Loading Car {carId} viewer...
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0d0f12] p-6 text-zinc-100">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/dashboard"
            className="text-sm text-red-400 hover:text-red-300"
          >
            ← Back to chief dashboard
          </Link>

          <p className="mt-6 text-xs uppercase tracking-[0.3em] text-red-400">
            Chief Viewer
          </p>

          <h1 className="mt-3 text-4xl font-semibold">
            Car {carId} Profile
          </h1>

          <p className="mt-3 max-w-3xl text-sm text-zinc-400">
            Read-only overview of current job progress, clutch measurements and
            post-event records.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <Link
            href={`/dashboard/car/${carId}/job-list`}
            className="rounded-xl bg-red-700 px-5 py-3 text-sm font-semibold hover:bg-red-600"
          >
            Edit Job List
          </Link>

          <LogoutButton />
        </div>
      </div>

      {errorMessage && (
        <div className="mb-6 rounded-2xl border border-red-900 bg-red-950/40 p-4 text-sm text-red-200">
          {errorMessage}
        </div>
      )}

      <section className="mb-6 rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-red-400">
              Released Job List
            </p>

            <h2 className="mt-3 text-3xl font-semibold text-zinc-100">
              {releaseInfo?.after_event || "No event name set"}
            </h2>

            <div className="mt-3 flex flex-wrap gap-4 text-sm text-zinc-400">
              <span>
                Date:{" "}
                <span className="font-semibold text-zinc-100">
                  {releaseInfo?.job_date
                    ? new Date(releaseInfo.job_date).toLocaleDateString("en-GB")
                    : "No date set"}
                </span>
              </span>

              {releaseInfo?.released_at && (
                <span>
                  Released:{" "}
                  <span className="font-semibold text-zinc-100">
                    {new Date(releaseInfo.released_at).toLocaleString("en-GB")}
                  </span>
                </span>
              )}

              {releaseInfo?.released_by && (
                <span>
                  By:{" "}
                  <span className="font-semibold text-zinc-100">
                    {releaseInfo.released_by}
                  </span>
                </span>
              )}
            </div>
          </div>

          <Link
            href={`/dashboard/car/${carId}/job-list`}
            className="rounded-xl border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-200 hover:border-red-500 hover:text-red-300"
          >
            Change Details
          </Link>
        </div>
      </section>

      <section className="mb-6 grid gap-6 lg:grid-cols-3">
        <div className="rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
          <h2 className="text-2xl font-semibold">Job Progress</h2>

          <p className="mt-2 text-sm text-zinc-500">
            {completedJobs} of {totalJobs} jobs complete.
          </p>

          <div className="mt-6 text-6xl font-bold text-red-400">
            {progress}%
          </div>

          <div className="mt-5 h-3 overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full rounded-full bg-red-700"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        <div className="rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl lg:col-span-2">
          <h2 className="text-2xl font-semibold">Outstanding Jobs</h2>

          <div className="mt-4 max-h-[420px] space-y-2 overflow-y-auto pr-2">
            {outstandingJobs.length === 0 ? (
              <p className="rounded-xl border border-green-800 bg-green-950/20 p-4 text-sm text-green-300">
                No outstanding jobs.
              </p>
            ) : (
              outstandingJobs.map((job) => (
                <div
                  key={`${job.section}-${job.job_id}`}
                  className="rounded-xl border border-zinc-800 bg-[#0d0f12] p-4 text-sm"
                >
                  <div className="text-zinc-100">{job.job_text}</div>

                  <div className="mt-1 text-xs uppercase tracking-widest text-zinc-500">
                    {job.section}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="mb-6 rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
        <h2 className="text-2xl font-semibold">Completed Jobs</h2>

        <div className="mt-4 max-h-[320px] space-y-2 overflow-y-auto pr-2">
          {completedJobRows.length === 0 ? (
            <p className="text-sm text-zinc-500">No jobs completed yet.</p>
          ) : (
            completedJobRows.map((job) => (
              <div
                key={`${job.section}-${job.job_id}`}
                className="rounded-xl border border-green-900/50 bg-green-950/10 p-4 text-sm"
              >
                <div className="text-zinc-300 line-through">
                  {job.job_text}
                </div>

                <div className="mt-1 text-xs text-zinc-500">
                  Updated by {job.updated_by ?? "unknown"}{" "}
                  {job.updated_at
                    ? `at ${new Date(job.updated_at).toLocaleString("en-GB")}`
                    : ""}
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
          <h2 className="text-2xl font-semibold">
            Previous Clutch Measurements
          </h2>

          <div className="mt-4 space-y-2">
            {clutchRows.length === 0 ? (
              <p className="text-sm text-zinc-500">
                No clutch measurement records found.
              </p>
            ) : (
              clutchRows.map((row, index) => (
                <pre
                  key={index}
                  className="overflow-auto rounded-xl border border-zinc-800 bg-[#0d0f12] p-3 text-xs text-zinc-300"
                >
                  {JSON.stringify(row, null, 2)}
                </pre>
              ))
            )}
          </div>
        </div>

        <div className="rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
          <h2 className="text-2xl font-semibold">
            Previous Post Event Sheets
          </h2>

          <div className="mt-4 space-y-2">
            {postEventRows.length === 0 ? (
              <p className="text-sm text-zinc-500">
                No post-event sheets found.
              </p>
            ) : (
              postEventRows.map((row, index) => (
                <pre
                  key={index}
                  className="overflow-auto rounded-xl border border-zinc-800 bg-[#0d0f12] p-3 text-xs text-zinc-300"
                >
                  {JSON.stringify(row, null, 2)}
                </pre>
              ))
            )}
          </div>
        </div>
      </section>
    </main>
  );
}