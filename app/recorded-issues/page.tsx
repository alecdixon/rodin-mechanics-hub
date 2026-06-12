"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import LogoutButton from "@/app/components/LogoutButton";
import { supabase } from "@/lib/supabase";
import {
  canDeleteRecordedIssues,
  canEditRecordedIssues,
  getAssignedCar,
  getUserRole,
  hasPermission,
  isReadOnlyUser,
  type UserRole,
} from "@/lib/userAccess";

type RecordedIssue = {
  id: string;
  report_date: string;
  circuit: string;
  affected_subsystem: string;
  recorded_issue: string;
  recorded_solution: string;
  created_by: string | null;
  created_at: string | null;
  updated_by: string | null;
  updated_at: string | null;
};

const DEFAULT_SUBSYSTEMS = [
  "Aero",
  "Brakes",
  "Chassis",
  "Clutch",
  "Cooling",
  "Data / Logger",
  "Electrical",
  "Engine",
  "Fuel System",
  "Gearbox",
  "Hydraulics",
  "Radio / Comms",
  "Steering",
  "Suspension",
  "Tyres",
];

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function niceDate(value: string | null | undefined) {
  if (!value) return "—";

  const date = new Date(`${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function niceDateTime(value: string | null | undefined) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function normaliseSearch(value: string) {
  return value.trim().toLowerCase();
}

function backHref(role: UserRole, assignedCar: number | null) {
  if (role === "chief_mechanic" || role === "engineer" || role === "guest") {
    return "/dashboard";
  }

  if (role === "number1_mechanic" && assignedCar) {
    return `/car/${assignedCar}/job-list`;
  }

  if (role === "number2_mechanic") {
    return "/drain-out";
  }

  return "/login";
}

function backLabel(role: UserRole) {
  if (role === "chief_mechanic" || role === "engineer" || role === "guest") {
    return "Back to Dashboard";
  }

  if (role === "number2_mechanic") {
    return "Back to Drain Out";
  }

  return "Back to Car Page";
}

export default function RecordedIssuesPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [userEmail, setUserEmail] = useState("");
  const [userRole, setUserRole] = useState<UserRole>("unknown");
  const [assignedCar, setAssignedCar] = useState<number | null>(null);
  const [readOnly, setReadOnly] = useState(true);

  const [issues, setIssues] = useState<RecordedIssue[]>([]);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const [reportDate, setReportDate] = useState(todayIsoDate());
  const [circuit, setCircuit] = useState("");
  const [affectedSubsystem, setAffectedSubsystem] = useState("");
  const [recordedIssue, setRecordedIssue] = useState("");
  const [recordedSolution, setRecordedSolution] = useState("");
  const [searchText, setSearchText] = useState("");

  const canEdit = useMemo(() => {
    return !readOnly && canEditRecordedIssues(userEmail);
  }, [readOnly, userEmail]);

  const canDelete = useMemo(() => {
    return !readOnly && canDeleteRecordedIssues(userEmail);
  }, [readOnly, userEmail]);

  const subsystemOptions = useMemo(() => {
    const values = new Set<string>(DEFAULT_SUBSYSTEMS);

    for (const issue of issues) {
      if (issue.affected_subsystem?.trim()) {
        values.add(issue.affected_subsystem.trim());
      }
    }

    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [issues]);

  const filteredIssues = useMemo(() => {
    const query = normaliseSearch(searchText);

    if (!query) return issues;

    return issues.filter((issue) => {
      const combined = [
        issue.report_date,
        issue.circuit,
        issue.affected_subsystem,
        issue.recorded_issue,
        issue.recorded_solution,
        issue.created_by,
        issue.updated_by,
      ]
        .join(" ")
        .toLowerCase();

      return combined.includes(query);
    });
  }, [issues, searchText]);

  const sortedIssues = useMemo(() => {
    return [...filteredIssues].sort((a, b) => {
      const dateCompare = b.report_date.localeCompare(a.report_date);
      if (dateCompare !== 0) return dateCompare;
      return (b.created_at ?? "").localeCompare(a.created_at ?? "");
    });
  }, [filteredIssues]);

  const loadIssues = useCallback(async () => {
    const { data, error } = await supabase
      .from("recorded_issues")
      .select("*")
      .order("report_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    setIssues((data ?? []) as RecordedIssue[]);
  }, []);

  useEffect(() => {
    let mounted = true;

    async function initialise() {
      setLoading(true);
      setErrorMessage("");

      const { data, error } = await supabase.auth.getUser();

      if (error || !data.user?.email) {
        router.replace("/login");
        return;
      }

      const email = data.user.email.trim().toLowerCase();

      if (!hasPermission(email, "recorded_issues:view")) {
        router.replace("/login");
        return;
      }

      if (!mounted) return;

      setUserEmail(email);
      setUserRole(getUserRole(email));
      setAssignedCar(getAssignedCar(email));
      setReadOnly(isReadOnlyUser(email));

      await loadIssues();

      if (!mounted) return;
      setLoading(false);
    }

    initialise();

    return () => {
      mounted = false;
    };
  }, [loadIssues, router]);

  useEffect(() => {
    const channel = supabase
      .channel("recorded-issues-page")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "recorded_issues",
        },
        () => {
          loadIssues();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadIssues]);

  function resetForm() {
    setEditingId(null);
    setReportDate(todayIsoDate());
    setCircuit("");
    setAffectedSubsystem("");
    setRecordedIssue("");
    setRecordedSolution("");
  }

  function blockReadOnlyAction() {
    if (!readOnly) return false;

    setMessage("");
    setErrorMessage("Guest mode is view-only. Recorded issues cannot be edited.");
    return true;
  }

  function startEdit(issue: RecordedIssue) {
    if (blockReadOnlyAction()) return;

    setEditingId(issue.id);
    setReportDate(issue.report_date || todayIsoDate());
    setCircuit(issue.circuit || "");
    setAffectedSubsystem(issue.affected_subsystem || "");
    setRecordedIssue(issue.recorded_issue || "");
    setRecordedSolution(issue.recorded_solution || "");
    setMessage("");
    setErrorMessage("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveIssue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (blockReadOnlyAction()) return;

    if (!canEdit) {
      setErrorMessage("You do not have permission to save recorded issues.");
      return;
    }

    const cleanPayload = {
      report_date: reportDate,
      circuit: circuit.trim(),
      affected_subsystem: affectedSubsystem.trim(),
      recorded_issue: recordedIssue.trim(),
      recorded_solution: recordedSolution.trim(),
      updated_by: userEmail,
      updated_at: new Date().toISOString(),
    };

    if (
      !cleanPayload.report_date ||
      !cleanPayload.circuit ||
      !cleanPayload.affected_subsystem ||
      !cleanPayload.recorded_issue ||
      !cleanPayload.recorded_solution
    ) {
      setErrorMessage("Please fill out date, circuit, subsystem, issue and solution.");
      return;
    }

    setSaving(true);
    setMessage("");
    setErrorMessage("");

    if (editingId) {
      const { error } = await supabase
        .from("recorded_issues")
        .update(cleanPayload)
        .eq("id", editingId);

      setSaving(false);

      if (error) {
        setErrorMessage(error.message);
        return;
      }

      setMessage("Recorded issue updated.");
      resetForm();
      await loadIssues();
      return;
    }

    const { error } = await supabase.from("recorded_issues").insert({
      ...cleanPayload,
      created_by: userEmail,
    });

    setSaving(false);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    setMessage("Recorded issue added.");
    resetForm();
    await loadIssues();
  }

  async function deleteIssue(issueId: string) {
    if (blockReadOnlyAction()) return;

    if (!canDelete) {
      setErrorMessage("Only the chief mechanic can delete recorded issues.");
      return;
    }

    const confirmed = window.confirm("Delete this recorded issue? This cannot be undone.");

    if (!confirmed) return;

    setDeletingId(issueId);
    setMessage("");
    setErrorMessage("");

    const { error } = await supabase
      .from("recorded_issues")
      .delete()
      .eq("id", issueId);

    setDeletingId(null);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    if (editingId === issueId) resetForm();
    setMessage("Recorded issue deleted.");
    await loadIssues();
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0d0f12] text-zinc-400">
        Loading recorded issues...
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0d0f12] px-6 py-8 text-zinc-100">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-col gap-4 rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-red-400">
              Rodin Motorsport
            </p>

            <h1 className="mt-3 text-3xl font-semibold md:text-4xl">
              Recorded Issues
            </h1>

            <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
              Log faults, fixes and repeat issues by date, circuit and subsystem.
              Use this as a searchable reliability and lessons-learned record for
              mechanics and engineers.
            </p>

            {readOnly && (
              <div className="mt-4 rounded-2xl border border-yellow-800 bg-yellow-950/20 p-4 text-sm text-yellow-200">
                Guest mode is view-only. You can search and read recorded issues,
                but adding, editing and deleting are disabled.
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              href={backHref(userRole, assignedCar)}
              className="rounded-xl border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-200 hover:border-red-500 hover:text-red-200"
            >
              {backLabel(userRole)}
            </Link>

            <Link
              href="/team-jobs"
              className="rounded-xl border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-200 hover:border-red-500 hover:text-red-200"
            >
              Team Jobs
            </Link>

            <LogoutButton />
          </div>
        </header>

        {(message || errorMessage) && (
          <section className="mt-6 space-y-3">
            {message && (
              <div className="rounded-2xl border border-emerald-900 bg-emerald-950/40 p-4 text-sm text-emerald-200">
                {message}
              </div>
            )}

            {errorMessage && (
              <div className="rounded-2xl border border-red-900 bg-red-950/40 p-4 text-sm text-red-200">
                {errorMessage}
              </div>
            )}
          </section>
        )}

        <section className="mt-6 grid gap-6 lg:grid-cols-[420px_1fr]">
          {canEdit ? (
            <form
              onSubmit={saveIssue}
              className="rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-semibold">
                    {editingId ? "Edit Recorded Issue" : "Add Recorded Issue"}
                  </h2>

                  <p className="mt-1 text-sm text-zinc-500">
                    Every field is searchable once saved.
                  </p>
                </div>

                {editingId && (
                  <button
                    type="button"
                    onClick={resetForm}
                    className="rounded-xl border border-zinc-700 px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-300 hover:border-red-500 hover:text-red-200"
                  >
                    Cancel Edit
                  </button>
                )}
              </div>

              <div className="mt-6 space-y-4">
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                    Date
                  </label>
                  <input
                    type="date"
                    value={reportDate}
                    onChange={(event) => setReportDate(event.target.value)}
                    className="w-full rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-zinc-100 outline-none focus:border-red-500"
                    required
                  />
                </div>

                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                    Circuit
                  </label>
                  <input
                    type="text"
                    value={circuit}
                    onChange={(event) => setCircuit(event.target.value)}
                    placeholder="Silverstone, Spa, Snetterton..."
                    className="w-full rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-zinc-100 outline-none focus:border-red-500"
                    required
                  />
                </div>

                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                    Affected Subsystem
                  </label>
                  <input
                    list="recorded-issue-subsystems"
                    type="text"
                    value={affectedSubsystem}
                    onChange={(event) => setAffectedSubsystem(event.target.value)}
                    placeholder="Select existing or type a new subsystem"
                    className="w-full rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-zinc-100 outline-none focus:border-red-500"
                    required
                  />
                  <datalist id="recorded-issue-subsystems">
                    {subsystemOptions.map((subsystem) => (
                      <option key={subsystem} value={subsystem} />
                    ))}
                  </datalist>
                  <p className="mt-2 text-xs leading-5 text-zinc-500">
                    Type a new name to add another subsystem automatically.
                  </p>
                </div>

                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                    Recorded Issue
                  </label>
                  <textarea
                    value={recordedIssue}
                    onChange={(event) => setRecordedIssue(event.target.value)}
                    placeholder="What happened? Include symptoms, session context and any useful observations."
                    rows={5}
                    className="w-full rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-zinc-100 outline-none focus:border-red-500"
                    required
                  />
                </div>

                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                    Recorded Solution
                  </label>
                  <textarea
                    value={recordedSolution}
                    onChange={(event) => setRecordedSolution(event.target.value)}
                    placeholder="What fixed it? Include parts changed, setup changes, checks completed or workaround."
                    rows={5}
                    className="w-full rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-zinc-100 outline-none focus:border-red-500"
                    required
                  />
                </div>

                <button
                  type="submit"
                  disabled={saving}
                  className="w-full rounded-xl bg-red-700 px-4 py-3 font-semibold text-white transition hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving
                    ? "Saving..."
                    : editingId
                      ? "Save Updated Issue"
                      : "Add Recorded Issue"}
                </button>
              </div>
            </form>
          ) : (
            <aside className="rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-red-400">
                View Only
              </p>

              <h2 className="mt-3 text-xl font-semibold">
                Recorded issue editing disabled
              </h2>

              <p className="mt-2 text-sm leading-6 text-zinc-400">
                This profile can view and search the recorded issue database,
                but cannot add new issues, edit existing entries, or delete
                records.
              </p>
            </aside>
          )}

          <section className="rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div>
                <h2 className="text-xl font-semibold">Issue Database</h2>
                <p className="mt-1 text-sm text-zinc-500">
                  Showing {sortedIssues.length} of {issues.length} recorded issues.
                </p>
              </div>

              <div className="w-full md:max-w-md">
                <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                  Search
                </label>
                <input
                  type="search"
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                  placeholder="Search subsystem, issue, solution, circuit..."
                  className="w-full rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-zinc-100 outline-none focus:border-red-500"
                />
              </div>
            </div>

            <div className="mt-6 space-y-4">
              {sortedIssues.length === 0 && (
                <div className="rounded-2xl border border-dashed border-zinc-700 bg-[#0d0f12] p-8 text-center text-sm text-zinc-500">
                  No recorded issues match the current search.
                </div>
              )}

              {sortedIssues.map((issue) => (
                <article
                  key={issue.id}
                  className="rounded-2xl border border-zinc-800 bg-[#0d0f12] p-5"
                >
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-red-900 bg-red-950/40 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-red-200">
                          {issue.affected_subsystem}
                        </span>
                        <span className="rounded-full border border-zinc-700 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-300">
                          {niceDate(issue.report_date)}
                        </span>
                        <span className="rounded-full border border-zinc-700 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-300">
                          {issue.circuit}
                        </span>
                      </div>

                      <p className="mt-3 text-xs text-zinc-500">
                        Added by {issue.created_by || "unknown"} · Updated{" "}
                        {niceDateTime(issue.updated_at || issue.created_at)}
                      </p>
                    </div>

                    {(canEdit || canDelete) && (
                      <div className="flex flex-wrap gap-2">
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => startEdit(issue)}
                            className="rounded-xl border border-zinc-700 px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-300 hover:border-red-500 hover:text-red-200"
                          >
                            Edit
                          </button>
                        )}

                        {canDelete && (
                          <button
                            type="button"
                            onClick={() => deleteIssue(issue.id)}
                            disabled={deletingId === issue.id}
                            className="rounded-xl border border-red-900/80 px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-red-200 hover:bg-red-950/40 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {deletingId === issue.id ? "Deleting..." : "Delete"}
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="mt-5 grid gap-4 lg:grid-cols-2">
                    <div className="rounded-2xl border border-zinc-800 bg-[#14181d] p-4">
                      <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                        Recorded Issue
                      </h3>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-zinc-200">
                        {issue.recorded_issue}
                      </p>
                    </div>

                    <div className="rounded-2xl border border-zinc-800 bg-[#14181d] p-4">
                      <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                        Recorded Solution
                      </h3>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-zinc-200">
                        {issue.recorded_solution}
                      </p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}