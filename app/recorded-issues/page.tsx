"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
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

type IssueCategory = "Car 1" | "Car 2" | "Car 3" | "Truck" | "General";
type IssueSeverity = "Low" | "Medium" | "High";

type RecordedIssue = {
  id: string;
  report_date: string;
  circuit: string;
  issue_category: IssueCategory | string;
  severity: IssueSeverity | string | null;
  affected_subsystem: string;
  recorded_issue: string;
  recorded_solution: string | null;
  solution_approved: boolean;
  solution_approved_by: string | null;
  solution_approved_at: string | null;
  created_by: string | null;
  created_at: string | null;
  updated_by: string | null;
  updated_at: string | null;
};

const ISSUE_CATEGORIES: IssueCategory[] = [
  "Car 1",
  "Car 2",
  "Car 3",
  "Truck",
  "General",
];

const ISSUE_SEVERITIES: IssueSeverity[] = ["Low", "Medium", "High"];

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

const EXCEL_TEMPLATE_PATH = "/templates/TEAM_Rodin_Faults_List_2026.xlsx";
const EXCEL_SHEET_NAME = "MainSheet";
const EXCEL_FIRST_DATA_ROW = 7;

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

function initialsFromEmail(value: string | null | undefined) {
  if (!value) return "";

  const localPart = value.trim().split("@")[0];

  const nameParts = localPart
    .split(/[.\-_\s]+/)
    .map((part) => part.replace(/[^a-zA-Z]/g, ""))
    .filter(Boolean);

  if (nameParts.length >= 2) {
    return `${nameParts[0][0]}${nameParts[1][0]}`.toUpperCase();
  }

  if (nameParts.length === 1) {
    return nameParts[0].slice(0, 2).toUpperCase();
  }

  return "";
}

function normaliseSeverity(value: string | null | undefined): IssueSeverity {
  if (value === "Low" || value === "Medium" || value === "High") {
    return value;
  }

  return "Medium";
}

function severityRank(value: string | null | undefined) {
  const severity = normaliseSeverity(value);

  if (severity === "High") return 0;
  if (severity === "Medium") return 1;
  return 2;
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

function categoryClass(category: string) {
  if (category === "Car 1") {
    return "border-blue-800 bg-blue-950/40 text-blue-200";
  }

  if (category === "Car 2") {
    return "border-purple-800 bg-purple-950/40 text-purple-200";
  }

  if (category === "Car 3") {
    return "border-orange-800 bg-orange-950/40 text-orange-200";
  }

  if (category === "Truck") {
    return "border-yellow-800 bg-yellow-950/40 text-yellow-200";
  }

  return "border-zinc-700 bg-zinc-900 text-zinc-300";
}

function severityClass(severityValue: string | null | undefined) {
  const severity = normaliseSeverity(severityValue);

  if (severity === "High") {
    return "border-red-700 bg-red-950/50 text-red-200";
  }

  if (severity === "Medium") {
    return "border-yellow-700 bg-yellow-950/40 text-yellow-200";
  }

  return "border-green-700 bg-green-950/30 text-green-200";
}

function hasSolution(issue: RecordedIssue) {
  return Boolean(issue.recorded_solution?.trim());
}

function solutionStatus(issue: RecordedIssue) {
  if (issue.solution_approved) return "Approved";
  if (hasSolution(issue)) return "Solution Added";
  return "Solution Pending";
}

async function loadExcelTemplateWorkbook() {
  try {
    const response = await fetch(EXCEL_TEMPLATE_PATH, { cache: "no-store" });

    if (!response.ok) {
      throw new Error(`Template fetch failed: ${response.status}`);
    }

    const buffer = await response.arrayBuffer();
    return XLSX.read(buffer, {
      type: "array",
      cellStyles: true,
      cellDates: true,
    });
  } catch {
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet([
      [null, null, "Severity", "Description", "F2 Issues List", null, null, null, null],
      [null, null, "Low", "Low priority / non-critical", null, null, null, null, null],
      [null, null, "Medium", "Needs action but not car-stopping", null, null, null, null, null],
      [null, null, "High", "Safety / car-stopping / urgent", null, null, null, null, null],
      [null, null, null, null, null, null, null, null, null],
      ["Event", "Day", "Severity", "Topic", "Raised by", "Description", "Action / Solution", "Action leader", "Status"],
    ]);

    XLSX.utils.book_append_sheet(workbook, worksheet, EXCEL_SHEET_NAME);
    return workbook;
  }
}

function fileSafeDateTime() {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
}

export default function RecordedIssuesPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);

  const [userEmail, setUserEmail] = useState("");
  const [userRole, setUserRole] = useState<UserRole>("unknown");
  const [assignedCar, setAssignedCar] = useState<number | null>(null);
  const [readOnly, setReadOnly] = useState(true);

  const [issues, setIssues] = useState<RecordedIssue[]>([]);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const [reportDate, setReportDate] = useState(todayIsoDate());
  const [circuit, setCircuit] = useState("");
  const [issueCategory, setIssueCategory] = useState<IssueCategory>("General");
  const [severity, setSeverity] = useState<IssueSeverity>("Medium");
  const [affectedSubsystem, setAffectedSubsystem] = useState("");
  const [recordedIssue, setRecordedIssue] = useState("");
  const [recordedSolution, setRecordedSolution] = useState("");
  const [searchText, setSearchText] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<"All" | IssueCategory>(
    "All",
  );
  const [severityFilter, setSeverityFilter] = useState<"All" | IssueSeverity>(
    "All",
  );

  const isChiefMechanic = userRole === "chief_mechanic";

  const canEdit = useMemo(() => {
    return !readOnly && canEditRecordedIssues(userEmail);
  }, [readOnly, userEmail]);

  const canDelete = useMemo(() => {
    return !readOnly && canDeleteRecordedIssues(userEmail);
  }, [readOnly, userEmail]);

  const canApproveSolution = !readOnly && isChiefMechanic;

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

    return issues.filter((issue) => {
      if (categoryFilter !== "All" && issue.issue_category !== categoryFilter) {
        return false;
      }

      if (
        severityFilter !== "All" &&
        normaliseSeverity(issue.severity) !== severityFilter
      ) {
        return false;
      }

      if (!query) return true;

      const combined = [
        issue.report_date,
        issue.circuit,
        issue.issue_category,
        normaliseSeverity(issue.severity),
        issue.affected_subsystem,
        issue.recorded_issue,
        issue.recorded_solution,
        issue.solution_approved ? "solution approved approved green" : "",
        !hasSolution(issue) ? "solution pending pending" : "",
        issue.created_by,
        issue.updated_by,
        issue.solution_approved_by,
      ]
        .join(" ")
        .toLowerCase();

      return combined.includes(query);
    });
  }, [categoryFilter, issues, searchText, severityFilter]);

  const sortedIssues = useMemo(() => {
    return [...filteredIssues].sort((a, b) => {
      if (a.solution_approved !== b.solution_approved) {
        return a.solution_approved ? 1 : -1;
      }

      const severityCompare = severityRank(a.severity) - severityRank(b.severity);
      if (severityCompare !== 0) return severityCompare;

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
    setIssueCategory("General");
    setSeverity("Medium");
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
    setIssueCategory(
      ISSUE_CATEGORIES.includes(issue.issue_category as IssueCategory)
        ? (issue.issue_category as IssueCategory)
        : "General",
    );
    setSeverity(normaliseSeverity(issue.severity));
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

    const cleanSolution = recordedSolution.trim();

    const cleanPayload = {
      report_date: reportDate,
      circuit: circuit.trim(),
      issue_category: issueCategory,
      severity,
      affected_subsystem: affectedSubsystem.trim(),
      recorded_issue: recordedIssue.trim(),
      recorded_solution: cleanSolution || null,
      updated_by: userEmail,
      updated_at: new Date().toISOString(),
    };

    if (
      !cleanPayload.report_date ||
      !cleanPayload.circuit ||
      !cleanPayload.issue_category ||
      !cleanPayload.severity ||
      !cleanPayload.affected_subsystem ||
      !cleanPayload.recorded_issue
    ) {
      setErrorMessage(
        "Please fill out date, circuit, issue category, severity, subsystem and recorded issue. The solution can be left blank if it is still pending.",
      );
      return;
    }

    setSaving(true);
    setMessage("");
    setErrorMessage("");

    if (editingId) {
      const currentIssue = issues.find((issue) => issue.id === editingId);
      const solutionWasChanged =
        (currentIssue?.recorded_solution ?? "").trim() !== cleanSolution;

      const { error } = await supabase
        .from("recorded_issues")
        .update({
          ...cleanPayload,
          solution_approved:
            solutionWasChanged || !cleanSolution
              ? false
              : currentIssue?.solution_approved ?? false,
          solution_approved_by:
            solutionWasChanged || !cleanSolution
              ? null
              : currentIssue?.solution_approved_by ?? null,
          solution_approved_at:
            solutionWasChanged || !cleanSolution
              ? null
              : currentIssue?.solution_approved_at ?? null,
        })
        .eq("id", editingId);

      setSaving(false);

      if (error) {
        setErrorMessage(error.message);
        return;
      }

      setMessage(
        cleanSolution
          ? "Recorded issue updated."
          : "Recorded issue updated. Solution is still pending.",
      );
      resetForm();
      await loadIssues();
      return;
    }

    const { error } = await supabase.from("recorded_issues").insert({
      ...cleanPayload,
      solution_approved: false,
      solution_approved_by: null,
      solution_approved_at: null,
      created_by: userEmail,
    });

    setSaving(false);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    setMessage(
      cleanSolution
        ? "Recorded issue added."
        : "Recorded issue added with solution pending.",
    );
    resetForm();
    await loadIssues();
  }

  async function toggleSolutionApproved(issue: RecordedIssue) {
    if (blockReadOnlyAction()) return;

    if (!canApproveSolution) {
      setErrorMessage("Only the chief mechanic can approve recorded solutions.");
      return;
    }

    if (!hasSolution(issue)) {
      setErrorMessage("A solution cannot be approved until the solution box has been filled in.");
      return;
    }

    const nextApproved = !issue.solution_approved;
    const now = new Date().toISOString();

    setApprovingId(issue.id);
    setMessage("");
    setErrorMessage("");

    const { error } = await supabase
      .from("recorded_issues")
      .update({
        solution_approved: nextApproved,
        solution_approved_by: nextApproved ? userEmail : null,
        solution_approved_at: nextApproved ? now : null,
        updated_by: userEmail,
        updated_at: now,
      })
      .eq("id", issue.id);

    setApprovingId(null);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    setMessage(
      nextApproved
        ? "Solution approved."
        : "Solution approval removed.",
    );
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

  async function exportIssuesToExcel() {
    if (sortedIssues.length === 0) {
      setMessage("");
      setErrorMessage("There are no recorded issues to export with the current filters.");
      return;
    }

    setExportingExcel(true);
    setMessage("");
    setErrorMessage("");

    try {
      const workbook = await loadExcelTemplateWorkbook();
      const worksheet = workbook.Sheets[EXCEL_SHEET_NAME] ?? workbook.Sheets[workbook.SheetNames[0]];

      const exportRows = sortedIssues.map((issue) => [
        issue.circuit || "",
        niceDate(issue.report_date),
        normaliseSeverity(issue.severity),
        issue.affected_subsystem || "",
        initialsFromEmail(issue.created_by || issue.updated_by),
        issue.recorded_issue || "",
        issue.recorded_solution?.trim() || "Solution Pending",
        initialsFromEmail(issue.updated_by || issue.solution_approved_by || issue.created_by),
        solutionStatus(issue),
      ]);

      XLSX.utils.sheet_add_aoa(worksheet, exportRows, {
        origin: `A${EXCEL_FIRST_DATA_ROW}`,
      });

      const endRow = Math.max(EXCEL_FIRST_DATA_ROW + exportRows.length - 1, 6);
      worksheet["!ref"] = XLSX.utils.encode_range({
        s: { r: 0, c: 0 },
        e: { r: endRow - 1, c: 8 },
      });

      worksheet["!cols"] = [
        { wch: 18 },
        { wch: 14 },
        { wch: 12 },
        { wch: 24 },
        { wch: 28 },
        { wch: 55 },
        { wch: 55 },
        { wch: 28 },
        { wch: 18 },
      ];

      const fileName = `Rodin_Recorded_Issues_${fileSafeDateTime()}.xlsx`;
      XLSX.writeFile(workbook, fileName, { bookType: "xlsx" });
      setMessage(`Excel export generated: ${fileName}`);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Failed to generate Excel export.",
      );
    }

    setExportingExcel(false);
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
              Log faults, fixes and repeat issues by date, circuit, category,
              severity and subsystem. Solutions can be added later, and the chief
              mechanic can approve a solution once it is confirmed.
            </p>

            {readOnly && (
              <div className="mt-4 rounded-2xl border border-yellow-800 bg-yellow-950/20 p-4 text-sm text-yellow-200">
                Guest mode is view-only. You can search and read recorded issues,
                but adding, editing, approving and deleting are disabled.
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={exportIssuesToExcel}
              disabled={exportingExcel || sortedIssues.length === 0}
              className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {exportingExcel ? "Generating..." : "Export Excel"}
            </button>

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
                    The solution can be left blank and filled in later.
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
                    Issue Category
                  </label>
                  <select
                    value={issueCategory}
                    onChange={(event) =>
                      setIssueCategory(event.target.value as IssueCategory)
                    }
                    className="w-full rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-zinc-100 outline-none focus:border-red-500"
                    required
                  >
                    {ISSUE_CATEGORIES.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                    Severity
                  </label>
                  <select
                    value={severity}
                    onChange={(event) =>
                      setSeverity(event.target.value as IssueSeverity)
                    }
                    className="w-full rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-zinc-100 outline-none focus:border-red-500"
                    required
                  >
                    {ISSUE_SEVERITIES.map((severityOption) => (
                      <option key={severityOption} value={severityOption}>
                        {severityOption}
                      </option>
                    ))}
                  </select>
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
                </div>

                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                    Recorded Issue
                  </label>
                  <textarea
                    value={recordedIssue}
                    onChange={(event) => setRecordedIssue(event.target.value)}
                    placeholder="What happened? Include symptoms, session context and useful observations."
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
                    placeholder="Optional. Leave blank if solution is still pending."
                    rows={5}
                    className="w-full rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-zinc-100 outline-none focus:border-red-500"
                  />
                  <p className="mt-2 text-xs text-zinc-500">
                    Blank solution boxes will show as Solution Pending and can be
                    filled out later.
                  </p>
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
                but cannot add new issues, edit existing entries, approve
                solutions, or delete records.
              </p>

              <button
                type="button"
                onClick={exportIssuesToExcel}
                disabled={exportingExcel || sortedIssues.length === 0}
                className="mt-5 w-full rounded-xl bg-emerald-700 px-4 py-3 font-semibold text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {exportingExcel ? "Generating Excel..." : "Export Excel"}
              </button>
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

              <div className="grid w-full gap-3 md:max-w-3xl md:grid-cols-[160px_160px_1fr]">
                <label>
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                    Category
                  </span>
                  <select
                    value={categoryFilter}
                    onChange={(event) =>
                      setCategoryFilter(event.target.value as "All" | IssueCategory)
                    }
                    className="w-full rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-zinc-100 outline-none focus:border-red-500"
                  >
                    <option value="All">All</option>
                    {ISSUE_CATEGORIES.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                    Severity
                  </span>
                  <select
                    value={severityFilter}
                    onChange={(event) =>
                      setSeverityFilter(event.target.value as "All" | IssueSeverity)
                    }
                    className="w-full rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-zinc-100 outline-none focus:border-red-500"
                  >
                    <option value="All">All</option>
                    {ISSUE_SEVERITIES.map((severityOption) => (
                      <option key={severityOption} value={severityOption}>
                        {severityOption}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                    Search
                  </span>
                  <input
                    type="search"
                    value={searchText}
                    onChange={(event) => setSearchText(event.target.value)}
                    placeholder="Search category, severity, subsystem, issue, solution, circuit..."
                    className="w-full rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-zinc-100 outline-none focus:border-red-500"
                  />
                </label>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={exportIssuesToExcel}
                disabled={exportingExcel || sortedIssues.length === 0}
                className="rounded-xl border border-emerald-800 bg-emerald-950/40 px-4 py-2 text-sm font-semibold text-emerald-200 hover:border-emerald-500 hover:bg-emerald-950/60 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {exportingExcel ? "Generating Excel..." : "Export Filtered Excel"}
              </button>

              {(categoryFilter !== "All" || severityFilter !== "All" || searchText) && (
                <button
                  type="button"
                  onClick={() => {
                    setCategoryFilter("All");
                    setSeverityFilter("All");
                    setSearchText("");
                  }}
                  className="rounded-xl border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-300 hover:border-red-500 hover:text-red-200"
                >
                  Clear Filters
                </button>
              )}
            </div>

            <div className="mt-6 space-y-4">
              {sortedIssues.length === 0 && (
                <div className="rounded-2xl border border-dashed border-zinc-700 bg-[#0d0f12] p-8 text-center text-sm text-zinc-500">
                  No recorded issues match the current filters.
                </div>
              )}

              {sortedIssues.map((issue) => {
                const solutionExists = hasSolution(issue);
                const issueSeverity = normaliseSeverity(issue.severity);

                return (
                  <article
                    key={issue.id}
                    className={`rounded-2xl border p-5 transition ${
                      issue.solution_approved
                        ? "border-green-700 bg-green-950/20"
                        : issueSeverity === "High"
                          ? "border-red-900 bg-red-950/20"
                          : "border-zinc-800 bg-[#0d0f12]"
                    }`}
                  >
                    <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${categoryClass(
                              issue.issue_category || "General",
                            )}`}
                          >
                            {issue.issue_category || "General"}
                          </span>

                          <span
                            className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${severityClass(
                              issue.severity,
                            )}`}
                          >
                            {issueSeverity} Severity
                          </span>

                          <span className="rounded-full border border-red-900 bg-red-950/40 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-red-200">
                            {issue.affected_subsystem}
                          </span>

                          <span className="rounded-full border border-zinc-700 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-300">
                            {niceDate(issue.report_date)}
                          </span>

                          <span className="rounded-full border border-zinc-700 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-300">
                            {issue.circuit}
                          </span>

                          {issue.solution_approved ? (
                            <span className="rounded-full border border-green-700 bg-green-900/50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-green-200">
                              ✓ Solution Approved
                            </span>
                          ) : solutionExists ? (
                            <span className="rounded-full border border-blue-800 bg-blue-950/40 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-blue-200">
                              Solution Added
                            </span>
                          ) : (
                            <span className="rounded-full border border-yellow-800 bg-yellow-950/40 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-yellow-200">
                              Solution Pending
                            </span>
                          )}
                        </div>

                        <p className="mt-3 text-xs text-zinc-500">
                          Added by {issue.created_by || "unknown"} · Updated{" "}
                          {niceDateTime(issue.updated_at || issue.created_at)}
                        </p>

                        {issue.solution_approved && (
                          <p className="mt-1 text-xs text-green-300">
                            Solution approved by{" "}
                            {issue.solution_approved_by || "unknown"} ·{" "}
                            {niceDateTime(issue.solution_approved_at)}
                          </p>
                        )}
                      </div>

                      {(canEdit || canDelete || canApproveSolution) && (
                        <div className="flex flex-wrap gap-2">
                          {canApproveSolution && (
                            <button
                              type="button"
                              onClick={() => toggleSolutionApproved(issue)}
                              disabled={approvingId === issue.id || !solutionExists}
                              className={`rounded-xl border px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] disabled:cursor-not-allowed disabled:opacity-50 ${
                                issue.solution_approved
                                  ? "border-green-700 bg-green-900/40 text-green-200 hover:bg-green-900/60"
                                  : "border-zinc-700 text-zinc-300 hover:border-green-600 hover:text-green-200"
                              }`}
                            >
                              {approvingId === issue.id
                                ? "Saving..."
                                : issue.solution_approved
                                  ? "Approved ✓"
                                  : "Approve Solution"}
                            </button>
                          )}

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

                      <div
                        className={`rounded-2xl border p-4 ${
                          issue.solution_approved
                            ? "border-green-800 bg-green-950/30"
                            : solutionExists
                              ? "border-zinc-800 bg-[#14181d]"
                              : "border-yellow-800 bg-yellow-950/20"
                        }`}
                      >
                        <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                          Recorded Solution
                        </h3>
                        {solutionExists ? (
                          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-zinc-200">
                            {issue.recorded_solution}
                          </p>
                        ) : (
                          <p className="mt-2 text-sm font-semibold leading-6 text-yellow-200">
                            Solution Pending
                          </p>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}
