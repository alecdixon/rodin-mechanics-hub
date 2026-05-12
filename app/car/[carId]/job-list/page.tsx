"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import LogoutButton from "@/app/components/LogoutButton";

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
  notes: string | null;
  updated_by: string | null;
  updated_at: string | null;
};

type JobRelease = {
  car_id: number;
  after_event: string | null;
  job_date: string | null;
  completion_date: string | null;
  released_by: string | null;
  released_at: string | null;
  version_number: number | null;
  status: "draft" | "published" | string | null;
  published_at: string | null;
  published_by: string | null;
};

function niceDate(value: string | null | undefined) {
  if (!value) return "No date set";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString("en-GB");
}

function niceDateTime(value: string | null | undefined) {
  if (!value) return "No timestamp";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString("en-GB");
}

function getCompletionUrgency(completionDate: string | null | undefined) {
  if (!completionDate) {
    return {
      label: "No completion date set",
      className: "border-zinc-800 bg-[#111418] text-zinc-300",
    };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const deadline = new Date(completionDate);
  deadline.setHours(0, 0, 0, 0);

  const diffMs = deadline.getTime() - today.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return {
      label: `Overdue by ${Math.abs(diffDays)} day${
        Math.abs(diffDays) === 1 ? "" : "s"
      }`,
      className: "border-red-700 bg-red-950/50 text-red-200",
    };
  }

  if (diffDays === 0) {
    return {
      label: "Due today",
      className: "border-red-700 bg-red-950/50 text-red-200",
    };
  }

  if (diffDays === 1) {
    return {
      label: "Due tomorrow",
      className: "border-yellow-700 bg-yellow-950/30 text-yellow-200",
    };
  }

  return {
    label: `Due in ${diffDays} days`,
    className: "border-green-800 bg-green-950/30 text-green-300",
  };
}

function makeTemplateRows(carId: number): JobRow[] {
  return STANDARD_JOBS.map((text, index) => ({
    car_id: carId,
    job_id: index + 1,
    job_text: text,
    section: "standard",
    done: false,
    notes: null,
    updated_by: null,
    updated_at: new Date().toISOString(),
  }));
}

export default function MechanicJobListPage() {
  const params = useParams();
  const carId = Number(params.carId);

  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [releaseInfo, setReleaseInfo] = useState<JobRelease | null>(null);
  const [userEmail, setUserEmail] = useState("");
  const [loading, setLoading] = useState(true);

  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [openNoteKey, setOpenNoteKey] = useState<string | null>(null);
  const [draftNotes, setDraftNotes] = useState<Record<string, string>>({});
  const [savingNoteKey, setSavingNoteKey] = useState<string | null>(null);

  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    async function loadPage() {
      if (!carId) return;

      setLoading(true);
      setMessage("");
      setErrorMessage("");

      const { data: userData } = await supabase.auth.getUser();
      const email = userData.user?.email?.trim().toLowerCase() ?? "";
      setUserEmail(email);

      const { error: upsertError } = await supabase.from("job_progress").upsert(
        makeTemplateRows(carId),
        {
          onConflict: "car_id,job_id,section",
          ignoreDuplicates: true,
        },
      );

      if (upsertError) {
        setErrorMessage(`Failed to create job rows: ${upsertError.message}`);
        setLoading(false);
        return;
      }

      const { data: releaseData, error: releaseError } = await supabase
        .from("job_list_releases")
        .select("*")
        .eq("car_id", carId)
        .maybeSingle();

      if (releaseError) {
        setErrorMessage(
          `Failed to load release details: ${releaseError.message}`,
        );
      } else {
        setReleaseInfo((releaseData as JobRelease) ?? null);
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

      const cleanJobs = (data ?? []) as JobRow[];
      setJobs(cleanJobs);

      const initialNotes: Record<string, string> = {};
      cleanJobs.forEach((job) => {
        const key = `${job.section}-${job.job_id}`;
        initialNotes[key] = job.notes ?? "";
      });

      setDraftNotes(initialNotes);
      setLoading(false);
    }

    loadPage();
  }, [carId]);

  const standardJobs = useMemo(
    () => jobs.filter((job) => job.section === "standard"),
    [jobs],
  );

  const specialJobs = useMemo(
    () => jobs.filter((job) => job.section === "special"),
    [jobs],
  );

  const totalJobs = jobs.length;
  const completedJobs = jobs.filter((job) => job.done).length;
  const progress = totalJobs ? Math.round((completedJobs / totalJobs) * 100) : 0;

  const completionUrgency = getCompletionUrgency(releaseInfo?.completion_date);

  async function toggleJob(job: JobRow) {
    const newDone = !job.done;
    const saveKey = `${job.section}-${job.job_id}`;
    const now = new Date().toISOString();

    setSavingKey(saveKey);
    setMessage("");
    setErrorMessage("");

    setJobs((current) =>
      current.map((item) =>
        item.car_id === job.car_id &&
        item.job_id === job.job_id &&
        item.section === job.section
          ? {
              ...item,
              done: newDone,
              updated_by: userEmail,
              updated_at: now,
            }
          : item,
      ),
    );

    const { error } = await supabase
      .from("job_progress")
      .update({
        done: newDone,
        updated_by: userEmail,
        updated_at: now,
      })
      .eq("car_id", job.car_id)
      .eq("job_id", job.job_id)
      .eq("section", job.section);

    if (error) {
      setErrorMessage(`Autosave failed: ${error.message}`);

      setJobs((current) =>
        current.map((item) =>
          item.car_id === job.car_id &&
          item.job_id === job.job_id &&
          item.section === job.section
            ? { ...item, done: job.done }
            : item,
        ),
      );
    }

    setSavingKey(null);
  }

  function openNote(job: JobRow) {
    const key = `${job.section}-${job.job_id}`;

    setDraftNotes((current) => ({
      ...current,
      [key]: current[key] ?? job.notes ?? "",
    }));

    setOpenNoteKey(openNoteKey === key ? null : key);
    setMessage("");
    setErrorMessage("");
  }

  async function saveNote(job: JobRow) {
    const key = `${job.section}-${job.job_id}`;
    const note = (draftNotes[key] ?? "").trim();
    const now = new Date().toISOString();

    setSavingNoteKey(key);
    setMessage("");
    setErrorMessage("");

    const { error } = await supabase
      .from("job_progress")
      .update({
        notes: note || null,
        updated_by: userEmail,
        updated_at: now,
      })
      .eq("car_id", job.car_id)
      .eq("job_id", job.job_id)
      .eq("section", job.section);

    if (error) {
      setErrorMessage(`Note save failed: ${error.message}`);
      setSavingNoteKey(null);
      return;
    }

    setJobs((current) =>
      current.map((item) =>
        item.car_id === job.car_id &&
        item.job_id === job.job_id &&
        item.section === job.section
          ? {
              ...item,
              notes: note || null,
              updated_by: userEmail,
              updated_at: now,
            }
          : item,
      ),
    );

    setOpenNoteKey(null);
    setSavingNoteKey(null);
    setMessage("Note saved.");
  }

  async function clearNote(job: JobRow) {
    const key = `${job.section}-${job.job_id}`;
    const confirmed = window.confirm("Clear this note?");
    if (!confirmed) return;

    setSavingNoteKey(key);
    setMessage("");
    setErrorMessage("");

    const now = new Date().toISOString();

    const { error } = await supabase
      .from("job_progress")
      .update({
        notes: null,
        updated_by: userEmail,
        updated_at: now,
      })
      .eq("car_id", job.car_id)
      .eq("job_id", job.job_id)
      .eq("section", job.section);

    if (error) {
      setErrorMessage(`Note clear failed: ${error.message}`);
      setSavingNoteKey(null);
      return;
    }

    setDraftNotes((current) => ({
      ...current,
      [key]: "",
    }));

    setJobs((current) =>
      current.map((item) =>
        item.car_id === job.car_id &&
        item.job_id === job.job_id &&
        item.section === job.section
          ? {
              ...item,
              notes: null,
              updated_by: userEmail,
              updated_at: now,
            }
          : item,
      ),
    );

    setOpenNoteKey(null);
    setSavingNoteKey(null);
    setMessage("Note cleared.");
  }

  function renderJobCard(
    job: JobRow,
    index: number,
    variant: "standard" | "special",
  ) {
    const key = `${job.section}-${job.job_id}`;
    const isSaving = savingKey === key;
    const isNoteOpen = openNoteKey === key;
    const isSavingNote = savingNoteKey === key;
    const hasNote = Boolean(job.notes?.trim());

    const cardClass =
      variant === "special"
        ? job.done
          ? "border-green-800/60 bg-green-950/20"
          : "border-red-900/40 bg-[#0d0f12] hover:border-red-500/70"
        : job.done
          ? "border-green-800/60 bg-green-950/20"
          : "border-zinc-800 bg-[#0d0f12] hover:border-red-500/70";

    const checkBorder =
      variant === "special" ? "border-red-900/60" : "border-zinc-600";

    const numberClass =
      variant === "special" ? "text-red-300" : "text-zinc-500";

    const textClass = job.done
      ? "text-zinc-500 line-through"
      : variant === "special"
        ? "text-red-100"
        : "text-zinc-100";

    return (
      <div
        key={key}
        className={`rounded-xl border p-4 transition ${cardClass}`}
      >
        <div className="grid grid-cols-[42px_44px_1fr_auto] items-center gap-3">
          <span className={`text-sm ${numberClass}`}>{index + 1}</span>

          <button
            type="button"
            onClick={() => toggleJob(job)}
            disabled={isSaving}
            className={`grid h-8 w-8 place-items-center rounded-lg border transition disabled:opacity-60 ${
              job.done
                ? "border-green-500 bg-green-600 text-white"
                : `${checkBorder} bg-[#111418] text-transparent hover:border-red-500`
            }`}
          >
            ✓
          </button>

          <span className={`text-sm leading-6 ${textClass}`}>
            {job.job_text}
          </span>

          <button
            type="button"
            onClick={() => openNote(job)}
            className={`rounded-lg border px-3 py-2 text-xs font-semibold transition ${
              hasNote
                ? "border-red-700 bg-red-950/30 text-red-200 hover:border-red-500"
                : "border-zinc-700 text-zinc-300 hover:border-red-500 hover:text-red-300"
            }`}
          >
            {hasNote ? "Edit Note" : "Add Note"}
          </button>
        </div>

        {hasNote && !isNoteOpen && (
          <div className="mt-4 rounded-xl border border-zinc-800 bg-[#111418] p-4 text-sm leading-6 text-zinc-300">
            <span className="font-semibold text-red-300">Note: </span>
            {job.notes}
          </div>
        )}

        {isNoteOpen && (
          <div className="mt-4 rounded-xl border border-zinc-800 bg-[#111418] p-4">
            <label className="block text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">
              Mechanic Note For This Task
            </label>

            <textarea
              value={draftNotes[key] ?? ""}
              onChange={(event) =>
                setDraftNotes((current) => ({
                  ...current,
                  [key]: event.target.value,
                }))
              }
              placeholder="Add a note for the chief mechanic..."
              rows={4}
              className="mt-3 w-full resize-none rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-sm text-zinc-100 outline-none focus:border-red-500"
            />

            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-zinc-500">
                This note will appear on the chief mechanic viewer against this
                exact task.
              </p>

              <div className="flex flex-wrap gap-2">
                {hasNote && (
                  <button
                    type="button"
                    onClick={() => clearNote(job)}
                    disabled={isSavingNote}
                    className="rounded-lg border border-zinc-700 px-4 py-2 text-xs font-semibold text-zinc-300 hover:border-red-500 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Clear
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setOpenNoteKey(null)}
                  disabled={isSavingNote}
                  className="rounded-lg border border-zinc-700 px-4 py-2 text-xs font-semibold text-zinc-300 hover:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Cancel
                </button>

                <button
                  type="button"
                  onClick={() => saveNote(job)}
                  disabled={isSavingNote}
                  className="rounded-lg bg-red-700 px-4 py-2 text-xs font-semibold text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isSavingNote ? "Saving..." : "Save Note"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-[#0d0f12] p-6 text-zinc-100">
        <div className="rounded-3xl border border-zinc-800 bg-[#14181d] p-6">
          Loading Car {carId} job list...
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0d0f12] p-6 text-zinc-100">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-red-400">
            Mechanic Job List
          </p>

          <h1 className="mt-3 text-4xl font-semibold">
            Car {carId} Job List
          </h1>

          <p className="mt-3 max-w-2xl text-sm text-zinc-400">
            Tick jobs off as they are completed. Add notes where the chief
            mechanic needs extra information.
          </p>
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

      {releaseInfo?.completion_date && (
        <section
          className={`mb-6 rounded-3xl border p-6 shadow-xl ${completionUrgency.className}`}
        >
          <p className="text-xs font-semibold uppercase tracking-[0.3em]">
            Required Completion Date
          </p>

          <h2 className="mt-3 text-4xl font-bold">
            Complete by {niceDate(releaseInfo.completion_date)}
          </h2>

          <p className="mt-3 text-sm font-semibold">
            {completionUrgency.label}
          </p>
        </section>
      )}

      <section className="mb-6 rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-red-400">
          Current Released Job List
        </p>

        <h2 className="mt-3 text-3xl font-semibold text-zinc-100">
          {releaseInfo?.after_event || "No event name set"}
        </h2>

        <div className="mt-3 flex flex-wrap gap-4 text-sm text-zinc-400">
          <span>
            Job list date:{" "}
            <span className="font-semibold text-zinc-100">
              {niceDate(releaseInfo?.job_date)}
            </span>
          </span>

          <span>
            Complete by:{" "}
            <span className="font-semibold text-red-300">
              {niceDate(releaseInfo?.completion_date)}
            </span>
          </span>

          {releaseInfo?.version_number !== null &&
            releaseInfo?.version_number !== undefined && (
              <span>
                Version:{" "}
                <span className="font-semibold text-zinc-100">
                  {releaseInfo.version_number || "Not published"}
                </span>
              </span>
            )}

          {releaseInfo?.status && (
            <span>
              Status:{" "}
              <span
                className={`font-semibold ${
                  releaseInfo.status === "published"
                    ? "text-green-300"
                    : "text-yellow-300"
                }`}
              >
                {releaseInfo.status}
              </span>
            </span>
          )}

          {releaseInfo?.released_at && (
            <span>
              Released:{" "}
              <span className="font-semibold text-zinc-100">
                {niceDateTime(releaseInfo.released_at)}
              </span>
            </span>
          )}
        </div>
      </section>

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
            Released preparation list for this car.
          </p>
        </div>

        <div className="space-y-2">
          {standardJobs.map((job, index) =>
            renderJobCard(job, index, "standard"),
          )}
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
            {specialJobs.map((job, index) =>
              renderJobCard(job, index, "special"),
            )}
          </div>
        )}
      </section>
    </main>
  );
}