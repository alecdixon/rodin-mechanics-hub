"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getUserRole } from "@/lib/userAccess";
import LogoutButton from "@/app/components/LogoutButton";

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

type JobTemplate = {
  id: string;
  name: string;
  jobs: string[];
};

type JobRelease = {
  car_id: number;
  after_event: string | null;
  job_date: string | null;
  released_by: string | null;
  released_at: string | null;
};

export default function ChiefJobListEditorPage() {
  const params = useParams();
  const router = useRouter();
  const carId = Number(params.carId);

  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [templates, setTemplates] = useState<JobTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");

  const [afterEvent, setAfterEvent] = useState("");
  const [jobDate, setJobDate] = useState("");
  const [releaseInfo, setReleaseInfo] = useState<JobRelease | null>(null);

  const [newSpecialJob, setNewSpecialJob] = useState("");
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [savingReleaseInfo, setSavingReleaseInfo] = useState(false);
  const [clearingJobs, setClearingJobs] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  async function loadJobs() {
    const { data, error } = await supabase
      .from("job_progress")
      .select("*")
      .eq("car_id", carId)
      .order("section", { ascending: false })
      .order("job_id", { ascending: true });

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    setJobs((data ?? []) as JobRow[]);
  }

  async function loadTemplates() {
    const { data, error } = await supabase
      .from("job_templates")
      .select("id,name,jobs")
      .order("name", { ascending: true });

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    const cleanTemplates = (data ?? []) as JobTemplate[];
    setTemplates(cleanTemplates);

    if (cleanTemplates.length > 0) {
      setSelectedTemplateId(cleanTemplates[0].id);
    }
  }

  async function loadReleaseInfo() {
    const { data, error } = await supabase
      .from("job_list_releases")
      .select("*")
      .eq("car_id", carId)
      .maybeSingle();

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    if (data) {
      const release = data as JobRelease;
      setReleaseInfo(release);
      setAfterEvent(release.after_event ?? "");
      setJobDate(release.job_date ?? "");
    } else {
      setReleaseInfo(null);
      setAfterEvent("");
      setJobDate("");
    }
  }

  useEffect(() => {
    async function init() {
      const { data } = await supabase.auth.getUser();
      const role = getUserRole(data.user?.email ?? "");

      if (role !== "chief") {
        router.replace("/dashboard");
        return;
      }

      await loadTemplates();
      await loadJobs();
      await loadReleaseInfo();
      setLoading(false);
    }

    if (carId) init();
  }, [carId, router]);

  async function saveReleaseInfo(customMessage?: string) {
    setMessage("");
    setErrorMessage("");
    setSavingReleaseInfo(true);

    const { data: userData } = await supabase.auth.getUser();

    const { error } = await supabase.from("job_list_releases").upsert(
      {
        car_id: carId,
        after_event: afterEvent.trim() || null,
        job_date: jobDate || null,
        released_by: userData.user?.email ?? null,
        released_at: new Date().toISOString(),
      },
      {
        onConflict: "car_id",
      },
    );

    if (error) {
      setErrorMessage(error.message);
      setSavingReleaseInfo(false);
      return false;
    }

    await loadReleaseInfo();
    setSavingReleaseInfo(false);

    if (customMessage) {
      setMessage(customMessage);
    } else {
      setMessage("Release details saved.");
    }

    return true;
  }

  async function importTemplate() {
    setMessage("");
    setErrorMessage("");

    const selectedTemplate = templates.find(
      (template) => template.id === selectedTemplateId,
    );

    if (!selectedTemplate) {
      setErrorMessage("Select a template first.");
      return;
    }

    const confirmed = window.confirm(
      `Import "${selectedTemplate.name}" to Car ${carId}?\n\nThis will replace all existing STANDARD jobs for this car, but it will keep special jobs.`,
    );

    if (!confirmed) return;

    setImporting(true);

    const { error: deleteError } = await supabase
      .from("job_progress")
      .delete()
      .eq("car_id", carId)
      .eq("section", "standard");

    if (deleteError) {
      setErrorMessage(deleteError.message);
      setImporting(false);
      return;
    }

    const rows: JobRow[] = selectedTemplate.jobs.map((text, index) => ({
      car_id: carId,
      job_id: index + 1,
      job_text: text,
      section: "standard",
      done: false,
      updated_by: null,
      updated_at: new Date().toISOString(),
    }));

    const { error: insertError } = await supabase
      .from("job_progress")
      .insert(rows);

    if (insertError) {
      setErrorMessage(insertError.message);
      setImporting(false);
      return;
    }

    await saveReleaseInfo(`Imported "${selectedTemplate.name}" to Car ${carId}.`);
    await loadJobs();
    setImporting(false);
  }

  async function updateJobText(job: JobRow, text: string) {
    setJobs((current) =>
      current.map((item) =>
        item.car_id === job.car_id &&
        item.job_id === job.job_id &&
        item.section === job.section
          ? { ...item, job_text: text }
          : item,
      ),
    );

    const { error } = await supabase
      .from("job_progress")
      .update({
        job_text: text,
        updated_at: new Date().toISOString(),
      })
      .eq("car_id", job.car_id)
      .eq("job_id", job.job_id)
      .eq("section", job.section);

    if (error) setErrorMessage(error.message);
  }

  async function addSpecialJob() {
    const text = newSpecialJob.trim();
    if (!text) return;

    setMessage("");
    setErrorMessage("");

    const existingSpecialIds = jobs
      .filter((job) => job.section === "special")
      .map((job) => job.job_id);

    const nextId = existingSpecialIds.length
      ? Math.max(...existingSpecialIds) + 1
      : 1;

    const newRow: JobRow = {
      car_id: carId,
      job_id: nextId,
      job_text: text,
      section: "special",
      done: false,
      updated_by: null,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase.from("job_progress").insert(newRow);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    await saveReleaseInfo("Special job added and released.");
    setNewSpecialJob("");
    await loadJobs();
  }

  async function removeJob(job: JobRow) {
    const confirmed = window.confirm(`Remove this job?\n\n${job.job_text}`);
    if (!confirmed) return;

    setMessage("");
    setErrorMessage("");

    const { error } = await supabase
      .from("job_progress")
      .delete()
      .eq("car_id", job.car_id)
      .eq("job_id", job.job_id)
      .eq("section", job.section);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    setMessage("Job removed.");
    await loadJobs();
  }

  async function clearAllJobs() {
    const confirmed = window.confirm(
      `Clear ALL jobs for Car ${carId}?\n\nThis will remove all standard jobs, all special jobs, and the released event/date from the mechanic page.`,
    );

    if (!confirmed) return;

    setMessage("");
    setErrorMessage("");
    setClearingJobs(true);

    const { error: jobsError } = await supabase
      .from("job_progress")
      .delete()
      .eq("car_id", carId);

    if (jobsError) {
      setErrorMessage(jobsError.message);
      setClearingJobs(false);
      return;
    }

    const { error: releaseError } = await supabase
      .from("job_list_releases")
      .delete()
      .eq("car_id", carId);

    if (releaseError) {
      setErrorMessage(releaseError.message);
      setClearingJobs(false);
      return;
    }

    setJobs([]);
    setAfterEvent("");
    setJobDate("");
    setReleaseInfo(null);
    setMessage(`All jobs cleared for Car ${carId}.`);
    setClearingJobs(false);
  }

  const standardJobs = jobs.filter((job) => job.section === "standard");
  const specialJobs = jobs.filter((job) => job.section === "special");

  if (loading) {
    return (
      <main className="min-h-screen bg-[#0d0f12] p-6 text-zinc-400">
        Loading editor...
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0d0f12] p-6 text-zinc-100">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <Link
            href={`/dashboard/car/${carId}/viewer`}
            className="text-sm text-red-400 hover:text-red-300"
          >
            ← Back to Car {carId} viewer
          </Link>

          <p className="mt-6 text-xs uppercase tracking-[0.3em] text-red-400">
            Chief Mechanic Control
          </p>

          <h1 className="mt-3 text-4xl font-semibold">
            Car {carId} Job List Editor
          </h1>

          <p className="mt-3 max-w-3xl text-sm text-zinc-400">
            Import a saved standard template, add urgent special jobs, set the
            event/date, and edit the released list for this car.
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

      <section className="mb-6 rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
        <h2 className="text-2xl font-semibold">Release Details</h2>

        <p className="mt-1 text-sm text-zinc-500">
          These details appear at the top of the mechanic&apos;s job list.
        </p>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="text-sm font-semibold text-zinc-300">
              After Event Name
            </span>

            <input
              value={afterEvent}
              onChange={(event) => setAfterEvent(event.target.value)}
              placeholder="Example: After Silverstone"
              className="mt-2 w-full rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-sm text-zinc-100 outline-none focus:border-red-500"
            />
          </label>

          <label className="block">
            <span className="text-sm font-semibold text-zinc-300">Date</span>

            <input
              type="date"
              value={jobDate}
              onChange={(event) => setJobDate(event.target.value)}
              className="mt-2 w-full rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-sm text-zinc-100 outline-none focus:border-red-500"
            />
          </label>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            onClick={() => saveReleaseInfo()}
            disabled={savingReleaseInfo}
            className="rounded-xl bg-red-700 px-5 py-3 text-sm font-semibold text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {savingReleaseInfo ? "Saving..." : "Save Release Details"}
          </button>

          <button
            onClick={clearAllJobs}
            disabled={clearingJobs}
            className="rounded-xl border border-red-900/70 px-5 py-3 text-sm font-semibold text-red-300 hover:bg-red-950/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {clearingJobs ? "Clearing..." : "Clear All Jobs"}
          </button>
        </div>

        <div className="mt-5 rounded-2xl border border-zinc-800 bg-[#0d0f12] p-4 text-sm text-zinc-400">
          <p>
            Current release:{" "}
            <span className="font-semibold text-zinc-100">
              {releaseInfo?.after_event || "No event name set"}
            </span>
          </p>

          <p className="mt-1">
            Date:{" "}
            <span className="font-semibold text-zinc-100">
              {releaseInfo?.job_date
                ? new Date(releaseInfo.job_date).toLocaleDateString("en-GB")
                : "No date set"}
            </span>
          </p>

          {releaseInfo?.released_at && (
            <p className="mt-1">
              Last released:{" "}
              <span className="font-semibold text-zinc-100">
                {new Date(releaseInfo.released_at).toLocaleString("en-GB")}
              </span>
            </p>
          )}
        </div>
      </section>

      <section className="mb-6 rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
        <h2 className="text-2xl font-semibold">Import Standard Template</h2>

        <p className="mt-1 text-sm text-zinc-500">
          Use this to quickly load the standard post-event job list for this car.
          It will keep any special jobs already released.
        </p>

        <div className="mt-5 flex flex-wrap gap-3">
          <select
            value={selectedTemplateId}
            onChange={(event) => setSelectedTemplateId(event.target.value)}
            className="min-w-[280px] flex-1 rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-sm outline-none focus:border-red-500"
          >
            {templates.length === 0 ? (
              <option value="">No templates found</option>
            ) : (
              templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))
            )}
          </select>

          <button
            onClick={importTemplate}
            disabled={importing || templates.length === 0}
            className="rounded-xl bg-red-700 px-5 py-3 text-sm font-semibold hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {importing ? "Importing..." : "Import Template"}
          </button>
        </div>
      </section>

      <section className="mb-6 rounded-3xl border border-red-900/50 bg-[#181315] p-6 shadow-xl">
        <h2 className="text-2xl font-semibold text-red-200">
          Add Special Job
        </h2>

        <p className="mt-1 text-sm text-zinc-400">
          Special jobs are added directly to this car and appear on the
          mechanic&apos;s job list.
        </p>

        <div className="mt-4 flex gap-3">
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
            Release Special Job
          </button>
        </div>
      </section>

      <section className="mb-6 rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
        <h2 className="text-2xl font-semibold">
          Standard Jobs ({standardJobs.length})
        </h2>

        <div className="mt-5 space-y-2">
          {standardJobs.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-zinc-700 bg-[#0d0f12] p-6 text-sm text-zinc-500">
              No standard jobs released yet. Import a template above.
            </div>
          ) : (
            standardJobs.map((job, index) => (
              <div
                key={`${job.section}-${job.job_id}`}
                className="grid grid-cols-[42px_1fr_auto] items-center gap-3 rounded-xl border border-zinc-800 bg-[#0d0f12] p-3"
              >
                <span className="text-sm text-zinc-500">{index + 1}</span>

                <input
                  value={job.job_text}
                  onChange={(event) => updateJobText(job, event.target.value)}
                  className="w-full rounded-lg border border-transparent bg-transparent px-2 py-2 text-sm outline-none focus:border-zinc-700 focus:bg-[#14181d]"
                />

                <button
                  onClick={() => removeJob(job)}
                  className="rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-400 hover:border-red-500 hover:text-red-300"
                >
                  Remove
                </button>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="rounded-3xl border border-red-900/50 bg-[#181315] p-6 shadow-xl">
        <h2 className="text-2xl font-semibold text-red-200">
          Special Jobs ({specialJobs.length})
        </h2>

        <div className="mt-5 space-y-2">
          {specialJobs.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-red-900/50 bg-[#0d0f12] p-6 text-sm text-zinc-500">
              No special jobs released for this car.
            </div>
          ) : (
            specialJobs.map((job, index) => (
              <div
                key={`${job.section}-${job.job_id}`}
                className="grid grid-cols-[42px_1fr_auto] items-center gap-3 rounded-xl border border-red-900/40 bg-[#0d0f12] p-3"
              >
                <span className="text-sm text-red-300">{index + 1}</span>

                <input
                  value={job.job_text}
                  onChange={(event) => updateJobText(job, event.target.value)}
                  className="w-full rounded-lg border border-transparent bg-transparent px-2 py-2 text-sm text-red-100 outline-none focus:border-red-900/70 focus:bg-[#14181d]"
                />

                <button
                  onClick={() => removeJob(job)}
                  className="rounded-lg border border-red-900/60 px-3 py-2 text-xs text-zinc-400 hover:border-red-500 hover:text-red-300"
                >
                  Remove
                </button>
              </div>
            ))
          )}
        </div>
      </section>
    </main>
  );
}