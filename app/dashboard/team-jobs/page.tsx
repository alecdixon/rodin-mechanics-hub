"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { hasPermission } from "@/lib/userAccess";
import LogoutButton from "@/app/components/LogoutButton";

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
  if (!value) return "Not published";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("en-GB");
}

export default function ChiefTeamJobsPage() {
  const [jobs, setJobs] = useState<TeamJob[]>([]);
  const [jobText, setJobText] = useState("");
  const [notes, setNotes] = useState("");
  const [priority, setPriority] = useState<Priority>("normal");
  const [userEmail, setUserEmail] = useState("");

  const [canCreateJobs, setCanCreateJobs] = useState(false);
  const [canPublishJobs, setCanPublishJobs] = useState(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  async function loadJobs() {
    setLoading(true);
    setMessage("");
    setErrorMessage("");

    const { data: userData, error: userError } = await supabase.auth.getUser();

    if (userError || !userData.user?.email) {
      setErrorMessage("You are not logged in.");
      setLoading(false);
      return;
    }

    const email = userData.user.email.trim().toLowerCase();

    const userCanCreateJobs = hasPermission(email, "team_jobs:create");
    const userCanPublishJobs = hasPermission(email, "team_jobs:publish");

    setUserEmail(email);
    setCanCreateJobs(userCanCreateJobs);
    setCanPublishJobs(userCanPublishJobs);

    if (!userCanCreateJobs && !userCanPublishJobs) {
      setErrorMessage("You do not have permission to manage team jobs.");
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("team_jobs")
      .select("*")
      .order("published", { ascending: true })
      .order("created_at", { ascending: false });

    if (error) {
      setErrorMessage(error.message);
      setLoading(false);
      return;
    }

    setJobs((data ?? []) as TeamJob[]);
    setLoading(false);
  }

  useEffect(() => {
    loadJobs();
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel("chief-team-jobs")
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

  const draftJobs = useMemo(
    () => jobs.filter((job) => !job.published),
    [jobs],
  );

  const publishedJobs = useMemo(
    () => jobs.filter((job) => job.published),
    [jobs],
  );

  const completedJobs = publishedJobs.filter((job) => job.completed).length;

  async function addJob() {
    if (!canCreateJobs) {
      setErrorMessage("You do not have permission to create team jobs.");
      return;
    }

    const cleanText = jobText.trim();
    const cleanNotes = notes.trim();

    if (!cleanText) {
      setErrorMessage("Enter a team job first.");
      return;
    }

    setSaving(true);
    setMessage("");
    setErrorMessage("");

    const now = new Date().toISOString();

    const { error } = await supabase.from("team_jobs").insert({
      job_text: cleanText,
      notes: cleanNotes || null,
      priority,
      published: false,
      completed: false,
      created_by: userEmail,
      created_at: now,
      updated_by: userEmail,
      updated_at: now,
    });

    if (error) {
      setErrorMessage(error.message);
      setSaving(false);
      return;
    }

    setJobText("");
    setNotes("");
    setPriority("normal");
    setMessage("Draft team job added.");
    setSaving(false);
    await loadJobs();
  }

  async function publishDraftJobs() {
    if (!canPublishJobs) {
      setErrorMessage("You do not have permission to publish team jobs.");
      return;
    }

    if (draftJobs.length === 0) {
      setErrorMessage("There are no draft team jobs to publish.");
      return;
    }

    const confirmed = window.confirm(
      `Publish ${draftJobs.length} team job${
        draftJobs.length === 1 ? "" : "s"
      } to all mechanics?`,
    );

    if (!confirmed) return;

    setPublishing(true);
    setMessage("");
    setErrorMessage("");

    const now = new Date().toISOString();
    const draftIds = draftJobs.map((job) => job.id);

    const { error: publishError } = await supabase
      .from("team_jobs")
      .update({
        published: true,
        published_at: now,
        updated_by: userEmail,
        updated_at: now,
      })
      .in("id", draftIds);

    if (publishError) {
      setErrorMessage(publishError.message);
      setPublishing(false);
      return;
    }

    const { error: notificationError } = await supabase
      .from("team_job_notifications")
      .insert({
        title: "New Team Jobs Published",
        message: `${draftJobs.length} new team job${
          draftJobs.length === 1 ? "" : "s"
        } published by the chief mechanic.`,
        created_by: userEmail,
        created_at: now,
      });

    if (notificationError) {
      setErrorMessage(
        `Jobs were published, but notification failed: ${notificationError.message}`,
      );
      setPublishing(false);
      await loadJobs();
      return;
    }

    setMessage("Team jobs published and mechanics notified.");
    setPublishing(false);
    await loadJobs();
  }

  async function deleteJob(job: TeamJob) {
    if (!canCreateJobs) {
      setErrorMessage("You do not have permission to delete team jobs.");
      return;
    }

    const confirmed = window.confirm(
      `Delete this team job?\n\n${job.job_text}`,
    );

    if (!confirmed) return;

    setDeletingId(job.id);
    setMessage("");
    setErrorMessage("");

    const { error } = await supabase
      .from("team_jobs")
      .delete()
      .eq("id", job.id);

    if (error) {
      setErrorMessage(error.message);
      setDeletingId(null);
      return;
    }

    setMessage("Team job deleted.");
    setDeletingId(null);
    await loadJobs();
  }

  async function resetCompleted(job: TeamJob) {
    if (!canCreateJobs) {
      setErrorMessage("You do not have permission to reset team jobs.");
      return;
    }

    const confirmed = window.confirm("Mark this team job as not completed?");
    if (!confirmed) return;

    const now = new Date().toISOString();

    const { error } = await supabase
      .from("team_jobs")
      .update({
        completed: false,
        completed_by: null,
        completed_at: null,
        updated_by: userEmail,
        updated_at: now,
      })
      .eq("id", job.id);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    setMessage("Team job reset.");
    await loadJobs();
  }

  function priorityClass(jobPriority: Priority) {
    if (jobPriority === "urgent") {
      return "border-red-500 bg-red-950/50 text-red-100";
    }

    if (jobPriority === "high") {
      return "border-orange-500 bg-orange-950/40 text-orange-100";
    }

    if (jobPriority === "low") {
      return "border-zinc-700 bg-zinc-900 text-zinc-300";
    }

    return "border-blue-700 bg-blue-950/40 text-blue-100";
  }

  return (
    <main className="min-h-screen bg-black p-6 text-white">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-4 border-b border-neutral-800 pb-6 md:flex-row md:items-start md:justify-between">
          <div>
            <Link
              href="/dashboard"
              className="text-sm text-red-400 hover:text-red-300"
            >
              ← Back to Dashboard
            </Link>

            <p className="mt-5 text-xs uppercase tracking-[0.35em] text-red-500">
              Rodin Motorsport
            </p>

            <h1 className="mt-2 text-3xl font-bold">Team Jobs</h1>

            <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-400">
              Add team-wide jobs, keep them as drafts, then publish them to all
              mechanics. When published, mechanic tablets receive an in-app
              notification.
            </p>
          </div>

          <LogoutButton />
        </div>

        {message && (
          <div className="mt-6 rounded-xl border border-green-800 bg-green-950/30 p-4 text-sm text-green-200">
            {message}
          </div>
        )}

        {errorMessage && (
          <div className="mt-6 rounded-xl border border-red-800 bg-red-950/40 p-4 text-sm text-red-200">
            {errorMessage}
          </div>
        )}

        <section className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
          <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-5">
            <h2 className="text-xl font-bold">Add Team Job</h2>

            <label className="mt-5 block text-xs font-semibold uppercase tracking-[0.22em] text-neutral-500">
              Job
            </label>

            <textarea
              value={jobText}
              onChange={(event) => setJobText(event.target.value)}
              rows={3}
              placeholder="Example: Clean pit wall kit and check all radio chargers"
              disabled={!canCreateJobs}
              className="mt-2 w-full rounded-xl border border-neutral-800 bg-black p-3 text-sm text-white outline-none focus:border-red-500 disabled:cursor-not-allowed disabled:opacity-50"
            />

            <label className="mt-5 block text-xs font-semibold uppercase tracking-[0.22em] text-neutral-500">
              Notes
            </label>

            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={3}
              placeholder="Optional extra detail..."
              disabled={!canCreateJobs}
              className="mt-2 w-full rounded-xl border border-neutral-800 bg-black p-3 text-sm text-white outline-none focus:border-red-500 disabled:cursor-not-allowed disabled:opacity-50"
            />

            <label className="mt-5 block text-xs font-semibold uppercase tracking-[0.22em] text-neutral-500">
              Priority
            </label>

            <select
              value={priority}
              onChange={(event) => setPriority(event.target.value as Priority)}
              disabled={!canCreateJobs}
              className="mt-2 w-full rounded-xl border border-neutral-800 bg-black p-3 text-sm text-white outline-none focus:border-red-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>

            <button
              type="button"
              onClick={addJob}
              disabled={saving || !canCreateJobs}
              className="mt-6 rounded-xl bg-red-600 px-5 py-3 text-sm font-bold text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Adding..." : "Add Draft Job"}
            </button>
          </div>

          <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-5">
            <p className="text-xs uppercase tracking-[0.25em] text-neutral-500">
              Team Status
            </p>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-neutral-800 bg-black p-4">
                <p className="text-3xl font-bold text-white">
                  {draftJobs.length}
                </p>
                <p className="mt-1 text-xs text-neutral-500">Draft</p>
              </div>

              <div className="rounded-xl border border-neutral-800 bg-black p-4">
                <p className="text-3xl font-bold text-white">
                  {publishedJobs.length}
                </p>
                <p className="mt-1 text-xs text-neutral-500">Published</p>
              </div>

              <div className="rounded-xl border border-neutral-800 bg-black p-4">
                <p className="text-3xl font-bold text-green-400">
                  {completedJobs}
                </p>
                <p className="mt-1 text-xs text-neutral-500">Completed</p>
              </div>

              <div className="rounded-xl border border-neutral-800 bg-black p-4">
                <p className="text-3xl font-bold text-red-400">
                  {publishedJobs.length - completedJobs}
                </p>
                <p className="mt-1 text-xs text-neutral-500">Open</p>
              </div>
            </div>

            <button
              type="button"
              onClick={publishDraftJobs}
              disabled={publishing || draftJobs.length === 0 || !canPublishJobs}
              className="mt-6 w-full rounded-xl bg-red-600 px-5 py-3 text-sm font-bold text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {publishing
                ? "Publishing..."
                : `Publish New Jobs (${draftJobs.length})`}
            </button>

            <p className="mt-3 text-xs leading-5 text-neutral-500">
              Publishing creates a notification record that all permitted users
              listen for in real time.
            </p>
          </div>
        </section>

        <section className="mt-8">
          <h2 className="text-xl font-bold">Draft Jobs</h2>

          {loading ? (
            <p className="mt-4 text-sm text-neutral-500">Loading...</p>
          ) : draftJobs.length === 0 ? (
            <p className="mt-4 rounded-xl border border-neutral-800 bg-neutral-950 p-4 text-sm text-neutral-500">
              No draft team jobs.
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              {draftJobs.map((job) => (
                <div
                  key={job.id}
                  className="rounded-xl border border-neutral-800 bg-neutral-950 p-4"
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <span
                        className={`inline-flex rounded-full border px-3 py-1 text-xs font-bold uppercase ${priorityClass(
                          job.priority,
                        )}`}
                      >
                        {job.priority}
                      </span>

                      <p className="mt-3 text-sm leading-6 text-white">
                        {job.job_text}
                      </p>

                      {job.notes && (
                        <p className="mt-3 rounded-lg border border-neutral-800 bg-black p-3 text-sm leading-6 text-neutral-400">
                          {job.notes}
                        </p>
                      )}

                      <p className="mt-3 text-xs text-neutral-500">
                        Created by {job.created_by ?? "unknown"} —{" "}
                        {niceDateTime(job.created_at)}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => deleteJob(job)}
                      disabled={deletingId === job.id || !canCreateJobs}
                      className="rounded-lg border border-red-800 px-4 py-2 text-sm font-semibold text-red-300 hover:border-red-500 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {deletingId === job.id ? "Deleting..." : "Delete"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="mt-8">
          <h2 className="text-xl font-bold">Published Jobs</h2>

          {publishedJobs.length === 0 ? (
            <p className="mt-4 rounded-xl border border-neutral-800 bg-neutral-950 p-4 text-sm text-neutral-500">
              No published team jobs yet.
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              {publishedJobs.map((job) => (
                <div
                  key={job.id}
                  className={`rounded-xl border p-4 ${
                    job.completed
                      ? "border-green-800 bg-green-950/20"
                      : "border-neutral-800 bg-neutral-950"
                  }`}
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <span
                        className={`inline-flex rounded-full border px-3 py-1 text-xs font-bold uppercase ${priorityClass(
                          job.priority,
                        )}`}
                      >
                        {job.priority}
                      </span>

                      <p
                        className={`mt-3 text-sm leading-6 ${
                          job.completed
                            ? "text-neutral-500 line-through"
                            : "text-white"
                        }`}
                      >
                        {job.job_text}
                      </p>

                      {job.notes && (
                        <p className="mt-3 rounded-lg border border-neutral-800 bg-black p-3 text-sm leading-6 text-neutral-400">
                          {job.notes}
                        </p>
                      )}

                      <p className="mt-3 text-xs text-neutral-500">
                        Published {niceDateTime(job.published_at)}
                      </p>

                      {job.completed && (
                        <p className="mt-1 text-xs text-green-300">
                          Completed by {job.completed_by ?? "unknown"} —{" "}
                          {niceDateTime(job.completed_at)}
                        </p>
                      )}
                    </div>

                    <div className="flex gap-2">
                      {job.completed && (
                        <button
                          type="button"
                          onClick={() => resetCompleted(job)}
                          disabled={!canCreateJobs}
                          className="rounded-lg border border-neutral-700 px-4 py-2 text-sm font-semibold text-neutral-300 hover:border-red-500 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Reset
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => deleteJob(job)}
                        disabled={deletingId === job.id || !canCreateJobs}
                        className="rounded-lg border border-red-800 px-4 py-2 text-sm font-semibold text-red-300 hover:border-red-500 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {deletingId === job.id ? "Deleting..." : "Delete"}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}