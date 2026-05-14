"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import {
  getAssignedCar,
  getUserRole,
  hasPermission,
} from "@/lib/userAccess";
import LogoutButton from "@/app/components/LogoutButton";

type JobSection = "standard" | "special";

type EveningJobRow = {
  id?: string;
  car_id: number;
  job_id: number;
  job_text: string;
  section: JobSection;
  done: boolean;
  notes: string | null;
  updated_by: string | null;
  updated_at: string | null;
};

type EveningJobRelease = {
  car_id: number;
  after_event: string | null;
  job_date: string | null;
  released_by: string | null;
  released_at: string | null;
};

function niceDate(value: string | null | undefined) {
  if (!value) return "No date set";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "No date set";
  }

  return date.toLocaleDateString("en-GB");
}

function niceDateTime(value: string | null | undefined) {
  if (!value) return "No timestamp";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "No timestamp";
  }

  return date.toLocaleString("en-GB");
}

export default function MechanicEveningJobListPage() {
  const params = useParams();
  const router = useRouter();

  const carId = Number(params.carId);

  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState<EveningJobRow[]>([]);
  const [releaseInfo, setReleaseInfo] = useState<EveningJobRelease | null>(
    null,
  );

  const [noteJob, setNoteJob] = useState<EveningJobRow | null>(null);
  const [noteText, setNoteText] = useState("");

  const [savingJobKey, setSavingJobKey] = useState<string | null>(null);
  const [savingNote, setSavingNote] = useState(false);

  const [canEditEveningJobs, setCanEditEveningJobs] = useState(false);

  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  async function loadEveningJobs() {
    setLoading(true);
    setMessage("");
    setErrorMessage("");

    if (!Number.isFinite(carId)) {
      router.replace("/login");
      return;
    }

    const { data: userData, error: userError } = await supabase.auth.getUser();

    if (userError || !userData.user?.email) {
      router.replace("/login");
      return;
    }

    const email = userData.user.email.trim().toLowerCase();
    const role = getUserRole(email);
    const assignedCar = getAssignedCar(email);

    if (role === "number2_mechanic") {
      router.replace("/team-jobs");
      return;
    }

    if (!hasPermission(email, "evening_jobs:view")) {
      router.replace("/login");
      return;
    }

    if (role === "number1_mechanic") {
      if (!assignedCar) {
        router.replace("/login");
        return;
      }

      if (Number(assignedCar) !== carId) {
        router.replace(`/car/${assignedCar}/evening-job-list`);
        return;
      }
    }

    setCanEditEveningJobs(hasPermission(email, "evening_jobs:edit"));

    const { data: releaseData, error: releaseError } = await supabase
      .from("evening_job_list_releases")
      .select("*")
      .eq("car_id", carId)
      .maybeSingle();

    if (releaseError) {
      setErrorMessage(`Release details failed: ${releaseError.message}`);
    } else {
      setReleaseInfo((releaseData as EveningJobRelease) ?? null);
    }

    const { data: jobData, error: jobError } = await supabase
      .from("evening_job_progress")
      .select("*")
      .eq("car_id", carId)
      .order("section", { ascending: false })
      .order("job_id", { ascending: true });

    if (jobError) {
      setErrorMessage(`Evening jobs failed: ${jobError.message}`);
      setLoading(false);
      return;
    }

    setJobs((jobData ?? []) as EveningJobRow[]);
    setLoading(false);
  }

  useEffect(() => {
    if (carId) {
      loadEveningJobs();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carId]);

  async function toggleJob(job: EveningJobRow) {
    if (!canEditEveningJobs) {
      setErrorMessage("You do not have permission to update evening jobs.");
      return;
    }

    const jobKey = `${job.section}-${job.job_id}`;
    const nextDone = !job.done;
    const now = new Date().toISOString();

    setSavingJobKey(jobKey);
    setMessage("");
    setErrorMessage("");

    const { data: userData } = await supabase.auth.getUser();
    const email = userData.user?.email?.trim().toLowerCase() ?? "unknown";

    setJobs((current) =>
      current.map((item) =>
        item.car_id === job.car_id &&
        item.job_id === job.job_id &&
        item.section === job.section
          ? {
              ...item,
              done: nextDone,
              updated_by: email,
              updated_at: now,
            }
          : item,
      ),
    );

    const { error } = await supabase
      .from("evening_job_progress")
      .update({
        done: nextDone,
        updated_by: email,
        updated_at: now,
      })
      .eq("car_id", job.car_id)
      .eq("job_id", job.job_id)
      .eq("section", job.section);

    if (error) {
      setErrorMessage(error.message);
      await loadEveningJobs();
    }

    setSavingJobKey(null);
  }

  function openNote(job: EveningJobRow) {
    if (!canEditEveningJobs) {
      setErrorMessage("You do not have permission to edit evening job notes.");
      return;
    }

    setNoteJob(job);
    setNoteText(job.notes ?? "");
  }

  async function saveNote() {
    if (!noteJob) return;

    if (!canEditEveningJobs) {
      setErrorMessage("You do not have permission to edit evening job notes.");
      return;
    }

    setSavingNote(true);
    setMessage("");
    setErrorMessage("");

    const now = new Date().toISOString();
    const { data: userData } = await supabase.auth.getUser();
    const email = userData.user?.email?.trim().toLowerCase() ?? "unknown";

    const cleanNote = noteText.trim() || null;

    const { error } = await supabase
      .from("evening_job_progress")
      .update({
        notes: cleanNote,
        updated_by: email,
        updated_at: now,
      })
      .eq("car_id", noteJob.car_id)
      .eq("job_id", noteJob.job_id)
      .eq("section", noteJob.section);

    if (error) {
      setErrorMessage(error.message);
      setSavingNote(false);
      return;
    }

    setJobs((current) =>
      current.map((item) =>
        item.car_id === noteJob.car_id &&
        item.job_id === noteJob.job_id &&
        item.section === noteJob.section
          ? {
              ...item,
              notes: cleanNote,
              updated_by: email,
              updated_at: now,
            }
          : item,
      ),
    );

    setNoteJob(null);
    setNoteText("");
    setSavingNote(false);
    setMessage("Evening job note saved.");
  }

  const standardJobs = jobs.filter((job) => job.section === "standard");
  const specialJobs = jobs.filter((job) => job.section === "special");

  const completedJobs = jobs.filter((job) => job.done).length;
  const totalJobs = jobs.length;
  const progress = totalJobs ? Math.round((completedJobs / totalJobs) * 100) : 0;

  const mechanicNotes = useMemo(() => {
    return jobs.filter((job) => job.notes && job.notes.trim().length > 0);
  }, [jobs]);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0d0f12] text-zinc-400">
        Loading evening prep job list...
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0d0f12] p-6 text-zinc-100">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-red-400">
            Mechanic Evening Prep
          </p>

          <h1 className="mt-3 text-4xl font-semibold">
            Car {carId} Evening Prep Job List
          </h1>

          <p className="mt-3 max-w-3xl text-sm text-zinc-400">
            Tick off evening preparation jobs as they are completed. Add notes
            where the chief mechanic needs extra information.
          </p>

          {!canEditEveningJobs && (
            <p className="mt-4 rounded-xl border border-yellow-800 bg-yellow-950/30 px-4 py-3 text-sm text-yellow-200">
              Your login can view this list, but cannot mark jobs complete or
              edit notes.
            </p>
          )}
        </div>

        <LogoutButton />
      </div>

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

      <section className="mb-6 rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-red-400">
          Current Evening Prep List
        </p>

        <h2 className="mt-3 text-3xl font-semibold text-zinc-100">
          {releaseInfo?.after_event || "No evening prep list released yet"}
        </h2>

        <div className="mt-4 flex flex-wrap gap-4 text-sm text-zinc-400">
          <span>
            Date:{" "}
            <span className="font-semibold text-zinc-100">
              {niceDate(releaseInfo?.job_date)}
            </span>
          </span>

          <span>
            Released:{" "}
            <span className="font-semibold text-zinc-100">
              {niceDateTime(releaseInfo?.released_at)}
            </span>
          </span>
        </div>
      </section>

      <section className="mb-6 rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold">Evening Progress</h2>

            <p className="mt-2 text-sm text-zinc-500">
              {completedJobs} of {totalJobs} evening jobs complete.
            </p>
          </div>

          <div className="rounded-2xl border border-zinc-700 bg-[#0d0f12] px-5 py-4 text-2xl font-bold text-zinc-100">
            {progress}%
          </div>
        </div>

        <div className="mt-5 h-3 overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full rounded-full bg-red-700"
            style={{ width: `${progress}%` }}
          />
        </div>
      </section>

      <section className="mb-6 rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold">Standard Evening Jobs</h2>

            <p className="mt-1 text-sm text-zinc-500">
              Released evening preparation list for this car.
            </p>
          </div>

          <div className="rounded-2xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-sm font-semibold text-zinc-300">
            {standardJobs.filter((job) => job.done).length} /{" "}
            {standardJobs.length}
          </div>
        </div>

        <div className="space-y-2">
          {standardJobs.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-zinc-700 bg-[#0d0f12] p-6 text-sm text-zinc-500">
              No standard evening prep jobs released yet.
            </div>
          ) : (
            standardJobs.map((job, index) => {
              const jobKey = `${job.section}-${job.job_id}`;
              const isSaving = savingJobKey === jobKey;

              return (
                <div
                  key={jobKey}
                  className={`rounded-xl border p-4 transition ${
                    job.done
                      ? "border-green-900/70 bg-green-950/10"
                      : "border-zinc-800 bg-[#0d0f12]"
                  }`}
                >
                  <div className="grid grid-cols-[38px_44px_1fr_auto] items-center gap-3">
                    <span className="text-sm text-zinc-500">{index + 1}</span>

                    <button
                      type="button"
                      disabled={isSaving || !canEditEveningJobs}
                      onClick={() => toggleJob(job)}
                      className={`grid h-8 w-8 place-items-center rounded-lg border text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                        job.done
                          ? "border-green-500 bg-green-600 text-white"
                          : "border-zinc-700 bg-black text-zinc-400 hover:border-red-500"
                      }`}
                    >
                      {job.done ? "✓" : ""}
                    </button>

                    <div>
                      <p
                        className={`text-sm ${
                          job.done
                            ? "text-zinc-500 line-through"
                            : "text-zinc-100"
                        }`}
                      >
                        {job.job_text}
                      </p>

                      <div className="mt-1 flex flex-wrap gap-3 text-xs text-zinc-500">
                        <span>{job.done ? "Complete" : "Open"}</span>
                        {job.updated_by && <span>By {job.updated_by}</span>}
                        {job.updated_at && (
                          <span>{niceDateTime(job.updated_at)}</span>
                        )}
                        {job.notes?.trim() && (
                          <span className="font-semibold text-red-300">
                            Has note
                          </span>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => openNote(job)}
                      disabled={!canEditEveningJobs}
                      className="rounded-lg border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-300 hover:border-red-500 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {job.notes?.trim() ? "Edit Note" : "Add Note"}
                    </button>
                  </div>

                  {job.notes?.trim() && (
                    <div className="mt-3 rounded-xl border border-red-900/40 bg-[#181315] p-3 text-sm text-red-100">
                      {job.notes}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </section>

      <section className="rounded-3xl border border-red-900/50 bg-[#181315] p-6 shadow-xl">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold text-red-100">
              Special Evening Jobs
            </h2>

            <p className="mt-1 text-sm text-zinc-400">
              Extra car-specific jobs released by the chief mechanic.
            </p>
          </div>

          <div className="rounded-2xl border border-red-900/50 bg-[#0d0f12] px-4 py-3 text-sm font-semibold text-red-300">
            {specialJobs.filter((job) => job.done).length} /{" "}
            {specialJobs.length}
          </div>
        </div>

        <div className="space-y-2">
          {specialJobs.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-red-900/50 bg-[#0d0f12] p-6 text-sm text-zinc-500">
              No special evening jobs released for this car.
            </div>
          ) : (
            specialJobs.map((job, index) => {
              const jobKey = `${job.section}-${job.job_id}`;
              const isSaving = savingJobKey === jobKey;

              return (
                <div
                  key={jobKey}
                  className={`rounded-xl border p-4 transition ${
                    job.done
                      ? "border-green-900/70 bg-green-950/10"
                      : "border-red-900/40 bg-[#0d0f12]"
                  }`}
                >
                  <div className="grid grid-cols-[38px_44px_1fr_auto] items-center gap-3">
                    <span className="text-sm text-red-300">{index + 1}</span>

                    <button
                      type="button"
                      disabled={isSaving || !canEditEveningJobs}
                      onClick={() => toggleJob(job)}
                      className={`grid h-8 w-8 place-items-center rounded-lg border text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                        job.done
                          ? "border-green-500 bg-green-600 text-white"
                          : "border-zinc-700 bg-black text-zinc-400 hover:border-red-500"
                      }`}
                    >
                      {job.done ? "✓" : ""}
                    </button>

                    <div>
                      <p
                        className={`text-sm ${
                          job.done
                            ? "text-zinc-500 line-through"
                            : "text-red-100"
                        }`}
                      >
                        {job.job_text}
                      </p>

                      <div className="mt-1 flex flex-wrap gap-3 text-xs text-zinc-500">
                        <span>{job.done ? "Complete" : "Open"}</span>
                        {job.updated_by && <span>By {job.updated_by}</span>}
                        {job.updated_at && (
                          <span>{niceDateTime(job.updated_at)}</span>
                        )}
                        {job.notes?.trim() && (
                          <span className="font-semibold text-red-300">
                            Has note
                          </span>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => openNote(job)}
                      disabled={!canEditEveningJobs}
                      className="rounded-lg border border-red-900/60 px-3 py-2 text-xs font-semibold text-zinc-300 hover:border-red-500 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {job.notes?.trim() ? "Edit Note" : "Add Note"}
                    </button>
                  </div>

                  {job.notes?.trim() && (
                    <div className="mt-3 rounded-xl border border-red-900/40 bg-[#181315] p-3 text-sm text-red-100">
                      {job.notes}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </section>

      {mechanicNotes.length > 0 && (
        <section className="mt-6 rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
          <h2 className="text-2xl font-semibold">Notes Summary</h2>

          <div className="mt-4 space-y-3">
            {mechanicNotes.map((job) => (
              <div
                key={`${job.section}-${job.job_id}-note-summary`}
                className="rounded-xl border border-zinc-800 bg-[#0d0f12] p-4"
              >
                <p className="text-sm font-semibold text-zinc-100">
                  {job.job_text}
                </p>

                <p className="mt-2 text-sm text-zinc-400">{job.notes}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {noteJob && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <div className="w-full max-w-2xl rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-2xl">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-red-400">
                  Evening Job Note
                </p>

                <h2 className="mt-3 text-2xl font-semibold text-zinc-100">
                  {noteJob.job_text}
                </h2>
              </div>

              <button
                type="button"
                onClick={() => {
                  setNoteJob(null);
                  setNoteText("");
                }}
                className="rounded-xl border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-200 hover:border-red-500 hover:text-red-300"
              >
                Close
              </button>
            </div>

            <textarea
              value={noteText}
              onChange={(event) => setNoteText(event.target.value)}
              placeholder="Add note for the chief mechanic..."
              rows={6}
              className="w-full rounded-2xl border border-zinc-700 bg-[#0d0f12] p-4 text-sm text-zinc-100 outline-none focus:border-red-500"
            />

            <div className="mt-5 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setNoteText("");
                }}
                className="rounded-xl border border-zinc-700 px-5 py-3 text-sm font-semibold text-zinc-300 hover:border-red-500 hover:text-red-300"
              >
                Clear Text
              </button>

              <button
                type="button"
                onClick={saveNote}
                disabled={savingNote}
                className="rounded-xl bg-red-700 px-5 py-3 text-sm font-semibold text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {savingNote ? "Saving..." : "Save Note"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}