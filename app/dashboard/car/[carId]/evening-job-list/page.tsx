"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getUserRole } from "@/lib/userAccess";
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

type EveningJobTemplate = {
  id: string;
  name: string;
  jobs: string[];
};

type EveningJobRelease = {
  car_id: number;
  after_event: string | null;
  job_date: string | null;
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

function StatusPill({
  done,
  notes,
}: {
  done: boolean;
  notes?: string | null;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <span
        className={`rounded-full border px-3 py-1 text-xs font-semibold ${
          done
            ? "border-green-800 bg-green-950/30 text-green-300"
            : "border-zinc-700 bg-[#111418] text-zinc-400"
        }`}
      >
        {done ? "Complete" : "Open"}
      </span>

      {notes?.trim() && (
        <span className="rounded-full border border-red-900/60 bg-red-950/30 px-3 py-1 text-xs font-semibold text-red-300">
          Has Note
        </span>
      )}
    </div>
  );
}

function PublishStatusPill({
  status,
}: {
  status: string | null | undefined;
}) {
  const isPublished = status === "published";

  return (
    <span
      className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] ${
        isPublished
          ? "border-green-800 bg-green-950/30 text-green-300"
          : "border-yellow-800 bg-yellow-950/20 text-yellow-300"
      }`}
    >
      {isPublished ? "Published" : "Draft"}
    </span>
  );
}

export default function ChiefEveningJobListPage() {
  const params = useParams();
  const router = useRouter();
  const carId = Number(params.carId);

  const [jobs, setJobs] = useState<EveningJobRow[]>([]);
  const [templates, setTemplates] = useState<EveningJobTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");

  const [afterEvent, setAfterEvent] = useState("");
  const [jobDate, setJobDate] = useState("");
  const [releaseInfo, setReleaseInfo] = useState<EveningJobRelease | null>(
    null,
  );

  const [newSpecialJob, setNewSpecialJob] = useState("");

  const [loading, setLoading] = useState(true);
  const [updatingTemplate, setUpdatingTemplate] = useState(false);
  const [savingReleaseInfo, setSavingReleaseInfo] = useState(false);
  const [publishingJobList, setPublishingJobList] = useState(false);
  const [addingSpecialJob, setAddingSpecialJob] = useState(false);
  const [clearingStandardJobs, setClearingStandardJobs] = useState(false);
  const [clearingAllJobs, setClearingAllJobs] = useState(false);
  const [removingJobKey, setRemovingJobKey] = useState<string | null>(null);
  const [clearingNoteKey, setClearingNoteKey] = useState<string | null>(null);

  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const [pendingChanges, setPendingChanges] = useState<string[]>([]);

  function jobKey(job: EveningJobRow) {
    return job.id || `${job.car_id}-${job.section}-${job.job_id}`;
  }

  function addPendingChange(change: string) {
    setPendingChanges((current) => {
      if (current.includes(change)) return current;
      return [...current, change];
    });
  }

  function buildChangesMadeSummary(nextVersion: number) {
    const baseDetails = [
      `Car: ${carId}`,
      `Evening job list version: ${nextVersion}`,
      `Event/session: ${afterEvent.trim()}`,
      `Date: ${jobDate}`,
      "",
      "Changes Made:",
    ];

    if (pendingChanges.length === 0) {
      return [
        ...baseDetails,
        "Evening job list published. No individual added or removed jobs were recorded during this editing session.",
        "",
        "Please review the latest evening job list before continuing work.",
      ].join("\n");
    }

    return [
      ...baseDetails,
      ...pendingChanges.map((change) => `• ${change}`),
      "",
      "Please review the latest evening job list before continuing work.",
    ].join("\n");
  }

  async function createEveningJobListNotification({
    title,
    message,
    changeSummary,
  }: {
    title: string;
    message: string;
    changeSummary: string;
  }) {
    const { data: userData, error: userError } = await supabase.auth.getUser();

    if (userError) {
      throw new Error(`User check failed: ${userError.message}`);
    }

    const email = userData.user?.email?.trim().toLowerCase() ?? "unknown";

    const { error } = await supabase.from("job_list_notifications").insert({
      car_id: carId,
      notice_type: "evening_job_list_update",
      title,
      message,
      change_summary: changeSummary,
      created_by: email,
    });

    if (error) {
      throw new Error(error.message);
    }
  }

  async function loadJobs() {
    const { data, error } = await supabase
      .from("evening_job_progress")
      .select("*")
      .eq("car_id", carId)
      .order("section", { ascending: false })
      .order("job_id", { ascending: true });

    if (error) {
      setErrorMessage(`Evening jobs failed to load: ${error.message}`);
      return;
    }

    setJobs((data ?? []) as EveningJobRow[]);
  }

  async function loadTemplates() {
    const { data, error } = await supabase
      .from("evening_job_templates")
      .select("id,name,jobs")
      .order("name", { ascending: true });

    if (error) {
      setErrorMessage(`Evening templates failed to load: ${error.message}`);
      return;
    }

    const cleanTemplates = (data ?? []) as EveningJobTemplate[];
    setTemplates(cleanTemplates);

    if (cleanTemplates.length > 0) {
      setSelectedTemplateId((current) => current || cleanTemplates[0].id);
    }
  }

  async function loadReleaseInfo() {
    const { data, error } = await supabase
      .from("evening_job_list_releases")
      .select("*")
      .eq("car_id", carId)
      .maybeSingle();

    if (error) {
      setErrorMessage(
        `Evening release details failed to load: ${error.message}`,
      );
      return;
    }

    if (data) {
      const release = data as EveningJobRelease;
      setReleaseInfo(release);
      setAfterEvent(release.after_event ?? "");
      setJobDate(release.job_date ?? "");
    } else {
      setReleaseInfo(null);
      setAfterEvent("");
      setJobDate("");
    }
  }

  async function loadEverything() {
    setLoading(true);
    setMessage("");
    setErrorMessage("");

    const { data, error } = await supabase.auth.getUser();

    if (error) {
      setErrorMessage(`User check failed: ${error.message}`);
      setLoading(false);
      return;
    }

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

  useEffect(() => {
    if (carId) {
      loadEverything();
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carId]);

  async function saveReleaseInfo(customMessage?: string) {
    setMessage("");
    setErrorMessage("");
    setSavingReleaseInfo(true);

    const { data: userData, error: userError } = await supabase.auth.getUser();

    if (userError) {
      setErrorMessage(`User check failed: ${userError.message}`);
      setSavingReleaseInfo(false);
      return false;
    }

    const { error } = await supabase.from("evening_job_list_releases").upsert(
      {
        car_id: carId,
        after_event: afterEvent.trim() || null,
        job_date: jobDate || null,
        released_by: userData.user?.email ?? null,
        released_at: new Date().toISOString(),
        status: releaseInfo?.status === "published" ? "published" : "draft",
        version_number: releaseInfo?.version_number ?? 0,
        published_at: releaseInfo?.published_at ?? null,
        published_by: releaseInfo?.published_by ?? null,
      },
      {
        onConflict: "car_id",
      },
    );

    if (error) {
      setErrorMessage(
        `Evening release details failed to save: ${error.message}`,
      );
      setSavingReleaseInfo(false);
      return false;
    }

    await loadReleaseInfo();

    setSavingReleaseInfo(false);
    setMessage(customMessage || "Evening prep release details saved.");
    return true;
  }

  async function markDraft(customMessage?: string) {
    const { data: userData, error: userError } = await supabase.auth.getUser();

    if (userError) {
      setErrorMessage(`User check failed: ${userError.message}`);
      return false;
    }

    const { error } = await supabase.from("evening_job_list_releases").upsert(
      {
        car_id: carId,
        after_event: afterEvent.trim() || null,
        job_date: jobDate || null,
        released_by: userData.user?.email ?? null,
        released_at: new Date().toISOString(),
        status: "draft",
        version_number: releaseInfo?.version_number ?? 0,
        published_at: releaseInfo?.published_at ?? null,
        published_by: releaseInfo?.published_by ?? null,
      },
      {
        onConflict: "car_id",
      },
    );

    if (error) {
      setErrorMessage(
        `Could not mark evening job list as draft: ${error.message}`,
      );
      return false;
    }

    await loadReleaseInfo();

    if (customMessage) {
      setMessage(customMessage);
    }

    return true;
  }

  async function publishJobList() {
    setMessage("");
    setErrorMessage("");

    if (jobs.length === 0) {
      setErrorMessage("Add or update evening jobs before publishing the list.");
      return;
    }

    if (!afterEvent.trim()) {
      setErrorMessage("Enter an event/session name before publishing.");
      return;
    }

    if (!jobDate) {
      setErrorMessage("Enter an evening job list date before publishing.");
      return;
    }

    const confirmed = window.confirm(
      `Publish evening prep job list for Car ${carId}?\n\nMechanics assigned to this car will receive a popup notification and must acknowledge it.`,
    );

    if (!confirmed) return;

    setPublishingJobList(true);

    const { data: userData, error: userError } = await supabase.auth.getUser();

    if (userError) {
      setErrorMessage(`User check failed: ${userError.message}`);
      setPublishingJobList(false);
      return;
    }

    const currentVersion = releaseInfo?.version_number ?? 0;
    const nextVersion = currentVersion + 1;
    const now = new Date().toISOString();
    const email = userData.user?.email ?? null;

    const { error } = await supabase.from("evening_job_list_releases").upsert(
      {
        car_id: carId,
        after_event: afterEvent.trim() || null,
        job_date: jobDate || null,
        released_by: email,
        released_at: now,
        version_number: nextVersion,
        status: "published",
        published_at: now,
        published_by: email,
      },
      {
        onConflict: "car_id",
      },
    );

    if (error) {
      setErrorMessage(`Could not publish evening job list: ${error.message}`);
      setPublishingJobList(false);
      return;
    }

    try {
      await createEveningJobListNotification({
        title: "Evening job list published",
        message:
          "The chief mechanic has published a new evening prep job list for this car. Please review the changes before continuing.",
        changeSummary: buildChangesMadeSummary(nextVersion),
      });
    } catch (notificationError) {
      const warning =
        notificationError instanceof Error
          ? notificationError.message
          : "Unknown notification error";

      setErrorMessage(
        `Evening job list was published, but the mechanic notification failed: ${warning}`,
      );

      await loadReleaseInfo();
      await loadJobs();

      setPublishingJobList(false);
      return;
    }

    await loadReleaseInfo();
    await loadJobs();

    setPendingChanges([]);

    setMessage(
      `Evening prep job list published as version ${nextVersion}. Mechanics will receive an acknowledgement popup.`,
    );
    setPublishingJobList(false);
  }

  async function updateFromTemplate() {
    setMessage("");
    setErrorMessage("");

    const selectedTemplate = templates.find(
      (template) => template.id === selectedTemplateId,
    );

    if (!selectedTemplate) {
      setErrorMessage("Select an evening prep template first.");
      return;
    }

    const confirmed = window.confirm(
      `Update Car ${carId} from "${selectedTemplate.name}"?\n\nThis will create or update the STANDARD evening prep jobs for this car. Special jobs will be kept.\n\nAfter checking it, click Publish Evening Job List so mechanics know they are on the official version.`,
    );

    if (!confirmed) return;

    const currentStandardJobs = jobs.filter((job) => job.section === "standard");

    const currentStandardTexts = new Set(
      currentStandardJobs.map((job) => job.job_text.trim()).filter(Boolean),
    );

    const newTemplateTexts = new Set(
      selectedTemplate.jobs.map((job) => job.trim()).filter(Boolean),
    );

    const addedStandardJobs = selectedTemplate.jobs.filter(
      (job) => !currentStandardTexts.has(job.trim()),
    );

    const removedStandardJobs = currentStandardJobs.filter(
      (job) => !newTemplateTexts.has(job.job_text.trim()),
    );

    setUpdatingTemplate(true);

    const now = new Date().toISOString();

    const rows = selectedTemplate.jobs.map((text, index) => ({
      car_id: carId,
      job_id: index + 1,
      job_text: text,
      section: "standard" as const,
      done: false,
      notes: null,
      updated_by: null,
      updated_at: now,
    }));

    const { error: upsertError } = await supabase
      .from("evening_job_progress")
      .upsert(rows, {
        onConflict: "car_id,job_id,section",
      });

    if (upsertError) {
      setErrorMessage(
        `Could not update evening list from template: ${upsertError.message}`,
      );
      setUpdatingTemplate(false);
      return;
    }

    const { error: cleanupError } = await supabase
      .from("evening_job_progress")
      .delete()
      .eq("car_id", carId)
      .eq("section", "standard")
      .gt("job_id", selectedTemplate.jobs.length);

    if (cleanupError) {
      setErrorMessage(
        `Template updated, but old extra evening jobs could not be removed: ${cleanupError.message}`,
      );
      await loadJobs();
      setUpdatingTemplate(false);
      return;
    }

    addedStandardJobs.forEach((jobText) => {
      addPendingChange(`Added to evening standard job list: ${jobText}`);
    });

    removedStandardJobs.forEach((job) => {
      addPendingChange(`Removed from evening standard job list: ${job.job_text}`);
    });

    await markDraft(
      `Updated Car ${carId} evening prep list from "${selectedTemplate.name}". Publish it when ready.`,
    );

    await loadJobs();
    setUpdatingTemplate(false);
  }

  async function clearStandardJobs() {
    const confirmed = window.confirm(
      `Clear STANDARD evening prep jobs for Car ${carId}?\n\nThis removes only the template evening prep jobs. Special jobs and release details will be kept.\n\nThe list will be marked as draft until published again.`,
    );

    if (!confirmed) return;

    setMessage("");
    setErrorMessage("");
    setClearingStandardJobs(true);

    const jobsBeingRemoved = jobs.filter((job) => job.section === "standard");

    const { error } = await supabase
      .from("evening_job_progress")
      .delete()
      .eq("car_id", carId)
      .eq("section", "standard");

    if (error) {
      setErrorMessage(`Standard evening jobs failed to clear: ${error.message}`);
      setClearingStandardJobs(false);
      return;
    }

    jobsBeingRemoved.forEach((job) => {
      addPendingChange(`Removed from evening standard job list: ${job.job_text}`);
    });

    await markDraft(`Standard evening prep jobs cleared for Car ${carId}.`);
    await loadJobs();

    setClearingStandardJobs(false);
  }

  async function updateJobText(job: EveningJobRow, text: string) {
    const previousText = job.job_text;
    const cleanPreviousText = previousText.trim();
    const cleanNewText = text.trim();

    setJobs((current) =>
      current.map((item) =>
        item.car_id === job.car_id &&
        item.job_id === job.job_id &&
        item.section === job.section
          ? { ...item, job_text: text }
          : item,
      ),
    );

    let updateQuery = supabase
      .from("evening_job_progress")
      .update({
        job_text: text,
        updated_at: new Date().toISOString(),
      });

    if (job.id) {
      updateQuery = updateQuery.eq("id", job.id);
    } else {
      updateQuery = updateQuery
        .eq("car_id", job.car_id)
        .eq("job_id", job.job_id)
        .eq("section", job.section);
    }

    const { error } = await updateQuery;

    if (error) {
      setErrorMessage(`Could not update evening job: ${error.message}`);
      return;
    }

    if (
      cleanPreviousText &&
      cleanNewText &&
      cleanPreviousText !== cleanNewText
    ) {
      addPendingChange(
        job.section === "special"
          ? `Updated evening special job: ${cleanPreviousText} → ${cleanNewText}`
          : `Updated evening standard job: ${cleanPreviousText} → ${cleanNewText}`,
      );
    }

    await markDraft();
  }

  async function addSpecialJob() {
    const text = newSpecialJob.trim();

    setMessage("");
    setErrorMessage("");

    if (!text) {
      setErrorMessage("Enter a special evening job before adding it.");
      return;
    }

    setAddingSpecialJob(true);

    const { data: userData, error: userError } = await supabase.auth.getUser();

    if (userError) {
      setErrorMessage(`User check failed: ${userError.message}`);
      setAddingSpecialJob(false);
      return;
    }

    const userEmail = userData.user?.email ?? null;

    const existingSpecialIds = jobs
      .filter((job) => job.section === "special")
      .map((job) => job.job_id);

    const nextId = existingSpecialIds.length
      ? Math.max(...existingSpecialIds) + 1
      : 1;

    const now = new Date().toISOString();

    const newRow = {
      car_id: carId,
      job_id: nextId,
      job_text: text,
      section: "special" as const,
      done: false,
      notes: null,
      updated_by: userEmail,
      updated_at: now,
    };

    const { error: insertError } = await supabase
      .from("evening_job_progress")
      .insert(newRow);

    if (insertError) {
      setErrorMessage(
        `Failed to add special evening job: ${insertError.message}`,
      );
      setAddingSpecialJob(false);
      return;
    }

    addPendingChange(`Added to evening special jobs: ${text}`);

    await markDraft("Special evening job added. Publish the list when ready.");
    setNewSpecialJob("");
    await loadJobs();

    setAddingSpecialJob(false);
  }

  async function removeJob(job: EveningJobRow) {
    const confirmed = window.confirm(
      `Remove this evening prep job?\n\n${job.job_text}`,
    );

    if (!confirmed) return;

    const key = jobKey(job);

    setMessage("");
    setErrorMessage("");
    setRemovingJobKey(key);

    let deleteQuery = supabase.from("evening_job_progress").delete();

    if (job.id) {
      deleteQuery = deleteQuery.eq("id", job.id);
    } else {
      deleteQuery = deleteQuery
        .eq("car_id", job.car_id)
        .eq("job_id", job.job_id)
        .eq("section", job.section);
    }

    const { error } = await deleteQuery;

    if (error) {
      setErrorMessage(`Could not remove evening job: ${error.message}`);
      setRemovingJobKey(null);
      return;
    }

    addPendingChange(
      job.section === "special"
        ? `Removed from evening special jobs: ${job.job_text}`
        : `Removed from evening standard job list: ${job.job_text}`,
    );

    setJobs((current) =>
      current.filter((item) => {
        if (job.id && item.id) {
          return item.id !== job.id;
        }

        return !(
          item.car_id === job.car_id &&
          item.job_id === job.job_id &&
          item.section === job.section
        );
      }),
    );

    await markDraft("Evening job removed. Publish the list when ready.");
    await loadJobs();
    setRemovingJobKey(null);
  }

  async function clearJobNote(job: EveningJobRow) {
    const confirmed = window.confirm(
      `Clear this mechanic note?\n\nTask:\n${job.job_text}`,
    );

    if (!confirmed) return;

    const key = `${job.section}-${job.job_id}`;
    const now = new Date().toISOString();

    setClearingNoteKey(key);
    setMessage("");
    setErrorMessage("");

    const { data: userData, error: userError } = await supabase.auth.getUser();

    if (userError) {
      setErrorMessage(`User check failed: ${userError.message}`);
      setClearingNoteKey(null);
      return;
    }

    const email = userData.user?.email ?? "chief";

    const { error } = await supabase
      .from("evening_job_progress")
      .update({
        notes: null,
        updated_by: email,
        updated_at: now,
      })
      .eq("car_id", job.car_id)
      .eq("job_id", job.job_id)
      .eq("section", job.section);

    if (error) {
      setErrorMessage(`Failed to clear note: ${error.message}`);
      setClearingNoteKey(null);
      return;
    }

    setJobs((current) =>
      current.map((item) =>
        item.car_id === job.car_id &&
        item.job_id === job.job_id &&
        item.section === job.section
          ? {
              ...item,
              notes: null,
              updated_by: email,
              updated_at: now,
            }
          : item,
      ),
    );

    await markDraft("Mechanic note cleared. Publish the list when ready.");
    setClearingNoteKey(null);
  }

  async function clearAllJobs() {
    const confirmed = window.confirm(
      `Clear ALL evening prep jobs for Car ${carId}?\n\nThis will remove standard evening prep jobs, special evening prep jobs, notes and the published/release details from the mechanic page.\n\nMechanics will receive a popup notification.`,
    );

    if (!confirmed) return;

    setMessage("");
    setErrorMessage("");
    setClearingAllJobs(true);

    const jobsBeingRemoved = [...jobs];

    const { error: jobsError } = await supabase
      .from("evening_job_progress")
      .delete()
      .eq("car_id", carId);

    if (jobsError) {
      setErrorMessage(`Could not clear evening jobs: ${jobsError.message}`);
      setClearingAllJobs(false);
      return;
    }

    const { error: releaseError } = await supabase
      .from("evening_job_list_releases")
      .delete()
      .eq("car_id", carId);

    if (releaseError) {
      setErrorMessage(
        `Could not clear evening release details: ${releaseError.message}`,
      );
      setClearingAllJobs(false);
      return;
    }

    const removedStandardJobs = jobsBeingRemoved.filter(
      (job) => job.section === "standard",
    );

    const removedSpecialJobs = jobsBeingRemoved.filter(
      (job) => job.section === "special",
    );

    const clearSummary = [
      `Car: ${carId}`,
      "",
      "Changes Made:",
      ...removedStandardJobs.map(
        (job) => `• Removed from evening standard job list: ${job.job_text}`,
      ),
      ...removedSpecialJobs.map(
        (job) => `• Removed from evening special jobs: ${job.job_text}`,
      ),
      "",
      "Evening release details were cleared.",
      "Previous evening job-list instructions should no longer be treated as current.",
    ].join("\n");

    try {
      await createEveningJobListNotification({
        title: "Evening job list cleared",
        message:
          "The chief mechanic has cleared the evening prep job list for this car. Please check with the chief mechanic before continuing with previous evening job-list work.",
        changeSummary: clearSummary,
      });
    } catch (notificationError) {
      const warning =
        notificationError instanceof Error
          ? notificationError.message
          : "Unknown notification error";

      setErrorMessage(
        `Evening jobs were cleared, but the mechanic notification failed: ${warning}`,
      );
      setClearingAllJobs(false);
      return;
    }

    setJobs([]);
    setAfterEvent("");
    setJobDate("");
    setReleaseInfo(null);
    setPendingChanges([]);

    setMessage(
      `All evening prep jobs cleared for Car ${carId}. Mechanics will receive an acknowledgement popup.`,
    );
    setClearingAllJobs(false);
  }

  const standardJobs = jobs.filter((job) => job.section === "standard");
  const specialJobs = jobs.filter((job) => job.section === "special");

  const completedJobs = jobs.filter((job) => job.done).length;
  const totalJobs = jobs.length;
  const progress = totalJobs ? Math.round((completedJobs / totalJobs) * 100) : 0;
  const outstandingJobs = jobs.filter((job) => !job.done);

  const mechanicNotes = useMemo(() => {
    return jobs
      .filter((job) => job.notes && job.notes.trim().length > 0)
      .sort((a, b) => {
        const aTime = a.updated_at ? new Date(a.updated_at).getTime() : 0;
        const bTime = b.updated_at ? new Date(b.updated_at).getTime() : 0;
        return bTime - aTime;
      });
  }, [jobs]);

  const selectedTemplate = useMemo(() => {
    return templates.find((template) => template.id === selectedTemplateId);
  }, [templates, selectedTemplateId]);

  const isPublished = releaseInfo?.status === "published";
  const versionNumber = releaseInfo?.version_number ?? 0;

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
            Chief Mechanic Control
          </p>

          <h1 className="mt-3 text-4xl font-semibold">
            Car {carId} Evening Prep Job List
          </h1>

          <p className="mt-3 max-w-3xl text-sm text-zinc-400">
            Create, update, clear and publish the evening preparation list.
            Mechanics receive a blocking acknowledgement popup when the evening
            list is published or cleared.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <Link
            href={`/car/${carId}/evening-job-list`}
            className="rounded-xl border border-zinc-700 bg-[#14181d] px-5 py-3 text-sm font-semibold text-zinc-200 hover:border-red-500 hover:text-red-300"
          >
            Open Mechanic View
          </Link>

          <LogoutButton />
        </div>
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

      {pendingChanges.length > 0 && (
        <div className="mb-6 rounded-2xl border border-blue-900/70 bg-blue-950/20 p-4 text-sm text-blue-200">
          <p className="font-semibold">Pending evening notification changes:</p>

          <ul className="mt-2 list-disc space-y-1 pl-5">
            {pendingChanges.map((change) => (
              <li key={change}>{change}</li>
            ))}
          </ul>

          <p className="mt-3 text-xs text-blue-300/80">
            These will be shown to mechanics when you publish the evening job
            list.
          </p>
        </div>
      )}

      <section className="mb-6 grid gap-6 lg:grid-cols-3">
        <div className="rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-red-400">
            Evening Progress
          </p>

          <h2 className="mt-4 text-6xl font-bold text-red-400">{progress}%</h2>

          <p className="mt-3 text-sm text-zinc-500">
            {completedJobs} of {totalJobs} jobs complete
          </p>

          <div className="mt-5 h-3 overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full rounded-full bg-red-700"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        <div className="rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-red-400">
            Outstanding
          </p>

          <h2 className="mt-4 text-6xl font-bold text-zinc-100">
            {outstandingJobs.length}
          </h2>

          <p className="mt-3 text-sm text-zinc-500">
            evening prep jobs still open
          </p>
        </div>

        <div className="rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-red-400">
            Mechanic Notes
          </p>

          <h2 className="mt-4 text-6xl font-bold text-zinc-100">
            {mechanicNotes.length}
          </h2>

          <p className="mt-3 text-sm text-zinc-500">
            notes added against evening jobs
          </p>
        </div>
      </section>

      <section className="mb-6 rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-red-400">
                Publication
              </p>

              <PublishStatusPill status={releaseInfo?.status} />
            </div>

            <h2 className="mt-3 text-3xl font-semibold">
              {releaseInfo?.after_event || "No evening event name set"}
            </h2>

            <div className="mt-3 flex flex-wrap gap-4 text-sm text-zinc-400">
              <span>
                Date:{" "}
                <span className="font-semibold text-zinc-100">
                  {niceDate(releaseInfo?.job_date)}
                </span>
              </span>

              <span>
                Version:{" "}
                <span className="font-semibold text-zinc-100">
                  {versionNumber || "Not published"}
                </span>
              </span>

              <span>
                Published:{" "}
                <span className="font-semibold text-zinc-100">
                  {niceDateTime(releaseInfo?.published_at)}
                </span>
              </span>

              {releaseInfo?.published_by && (
                <span>
                  By:{" "}
                  <span className="font-semibold text-zinc-100">
                    {releaseInfo.published_by}
                  </span>
                </span>
              )}
            </div>

            {!isPublished && (
              <div className="mt-4 rounded-2xl border border-yellow-800/60 bg-yellow-950/20 p-4 text-sm text-yellow-200">
                This evening prep list is currently a draft. Mechanics should
                not treat it as the official list until you publish it.
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={loadEverything}
            className="rounded-xl border border-zinc-700 px-5 py-3 text-sm font-semibold text-zinc-200 hover:border-red-500 hover:text-red-300"
          >
            Refresh
          </button>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="text-sm font-semibold text-zinc-300">
              Event / Session Name
            </span>

            <input
              value={afterEvent}
              onChange={(event) => setAfterEvent(event.target.value)}
              placeholder="Example: Silverstone Friday Evening"
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
            type="button"
            onClick={() => saveReleaseInfo()}
            disabled={savingReleaseInfo}
            className="rounded-xl border border-zinc-700 bg-[#0d0f12] px-5 py-3 text-sm font-semibold text-zinc-200 hover:border-red-500 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {savingReleaseInfo ? "Saving..." : "Save Draft Details"}
          </button>

          <button
            type="button"
            onClick={publishJobList}
            disabled={publishingJobList || jobs.length === 0}
            className="rounded-xl bg-green-700 px-5 py-3 text-sm font-semibold text-white hover:bg-green-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {publishingJobList
              ? "Publishing..."
              : "Publish Evening Job List + Notify"}
          </button>

          <button
            type="button"
            onClick={clearAllJobs}
            disabled={clearingAllJobs}
            className="rounded-xl border border-red-900/70 px-5 py-3 text-sm font-semibold text-red-300 hover:bg-red-950/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {clearingAllJobs ? "Clearing..." : "Clear All Evening Jobs + Notify"}
          </button>
        </div>
      </section>

      <section className="mb-6 grid gap-6 xl:grid-cols-[1fr_420px]">
        <div className="rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-red-400">
            Job List Creation
          </p>

          <h2 className="mt-3 text-2xl font-semibold">
            Create / Update Standard Evening List
          </h2>

          <p className="mt-2 text-sm leading-6 text-zinc-500">
            Choose a template, then update the standard evening prep jobs for
            this car. Special jobs are kept separate. Publishing is a separate
            final step.
          </p>

          <div className="mt-5 flex flex-wrap gap-3">
            <select
              value={selectedTemplateId}
              onChange={(event) => setSelectedTemplateId(event.target.value)}
              className="min-w-[280px] flex-1 rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-sm outline-none focus:border-red-500"
            >
              {templates.length === 0 ? (
                <option value="">No evening templates found</option>
              ) : (
                templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))
              )}
            </select>

            <button
              type="button"
              onClick={updateFromTemplate}
              disabled={updatingTemplate || templates.length === 0}
              className="rounded-xl bg-red-700 px-5 py-3 text-sm font-semibold text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {updatingTemplate ? "Updating..." : "Update From Template"}
            </button>

            <button
              type="button"
              onClick={clearStandardJobs}
              disabled={clearingStandardJobs || standardJobs.length === 0}
              className="rounded-xl border border-zinc-700 px-5 py-3 text-sm font-semibold text-zinc-300 hover:border-red-500 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {clearingStandardJobs
                ? "Clearing..."
                : "Clear Standard Evening Jobs"}
            </button>
          </div>

          {selectedTemplate && (
            <div className="mt-5 rounded-2xl border border-zinc-800 bg-[#0d0f12] p-4 text-sm text-zinc-400">
              Selected template:{" "}
              <span className="font-semibold text-zinc-100">
                {selectedTemplate.name}
              </span>{" "}
              ·{" "}
              <span className="font-semibold text-zinc-100">
                {selectedTemplate.jobs.length}
              </span>{" "}
              standard jobs
            </div>
          )}
        </div>

        <div className="rounded-3xl border border-red-900/50 bg-[#181315] p-6 shadow-xl">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-red-400">
            Special Job
          </p>

          <h2 className="mt-3 text-2xl font-semibold text-red-100">
            Add Special Evening Job
          </h2>

          <p className="mt-2 text-sm leading-6 text-zinc-400">
            Use this for car-specific repairs, engineer requests, damage checks
            or urgent prep work. Adding a special job marks the list as draft
            until published again.
          </p>

          <div className="mt-5 space-y-3">
            <input
              value={newSpecialJob}
              onChange={(event) => setNewSpecialJob(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !addingSpecialJob) {
                  addSpecialJob();
                }
              }}
              placeholder="Add special evening job..."
              className="w-full rounded-xl border border-red-900/50 bg-[#0d0f12] px-4 py-3 text-sm outline-none focus:border-red-500"
            />

            <button
              type="button"
              onClick={addSpecialJob}
              disabled={addingSpecialJob}
              className="w-full rounded-xl bg-red-700 px-5 py-3 text-sm font-semibold hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {addingSpecialJob ? "Adding..." : "Add Special Evening Job"}
            </button>
          </div>
        </div>
      </section>

      <section className="mb-6 grid gap-6 xl:grid-cols-2">
        <div className="rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-red-400">
                Standard Jobs
              </p>

              <h2 className="mt-2 text-2xl font-semibold">
                Standard Evening Jobs
              </h2>
            </div>

            <div className="rounded-2xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-sm font-semibold text-red-300">
              {standardJobs.length}
            </div>
          </div>

          <div className="max-h-[620px] space-y-2 overflow-y-auto pr-2">
            {standardJobs.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-zinc-700 bg-[#0d0f12] p-6 text-sm text-zinc-500">
                No standard evening jobs released yet. Update from a template
                above.
              </div>
            ) : (
              standardJobs.map((job, index) => {
                const key = jobKey(job);
                const removing = removingJobKey === key;

                return (
                  <div
                    key={key}
                    className="rounded-xl border border-zinc-800 bg-[#0d0f12] p-3"
                  >
                    <div className="grid grid-cols-[42px_1fr_auto] items-center gap-3">
                      <span className="text-sm text-zinc-500">{index + 1}</span>

                      <input
                        value={job.job_text}
                        onChange={(event) =>
                          updateJobText(job, event.target.value)
                        }
                        className="w-full rounded-lg border border-transparent bg-transparent px-2 py-2 text-sm outline-none focus:border-zinc-700 focus:bg-[#14181d]"
                      />

                      <button
                        type="button"
                        onClick={() => removeJob(job)}
                        disabled={removing}
                        className="rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-400 hover:border-red-500 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {removing ? "Removing..." : "Remove"}
                      </button>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-3 pl-[54px] text-xs text-zinc-500">
                      <StatusPill done={job.done} notes={job.notes} />

                      <span>{niceDateTime(job.updated_at)}</span>

                      {job.updated_by && <span>By {job.updated_by}</span>}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="rounded-3xl border border-red-900/50 bg-[#181315] p-6 shadow-xl">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-red-400">
                Special Jobs
              </p>

              <h2 className="mt-2 text-2xl font-semibold text-red-100">
                Special Evening Jobs
              </h2>
            </div>

            <div className="rounded-2xl border border-red-900/50 bg-[#0d0f12] px-4 py-3 text-sm font-semibold text-red-300">
              {specialJobs.length}
            </div>
          </div>

          <div className="max-h-[620px] space-y-2 overflow-y-auto pr-2">
            {specialJobs.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-red-900/50 bg-[#0d0f12] p-6 text-sm text-zinc-500">
                No special evening jobs released for this car.
              </div>
            ) : (
              specialJobs.map((job, index) => {
                const key = jobKey(job);
                const removing = removingJobKey === key;

                return (
                  <div
                    key={key}
                    className="rounded-xl border border-red-900/40 bg-[#0d0f12] p-3"
                  >
                    <div className="grid grid-cols-[42px_1fr_auto] items-center gap-3">
                      <span className="text-sm text-red-300">{index + 1}</span>

                      <input
                        value={job.job_text}
                        onChange={(event) =>
                          updateJobText(job, event.target.value)
                        }
                        className="w-full rounded-lg border border-transparent bg-transparent px-2 py-2 text-sm text-red-100 outline-none focus:border-red-900/70 focus:bg-[#14181d]"
                      />

                      <button
                        type="button"
                        onClick={() => removeJob(job)}
                        disabled={removing}
                        className="rounded-lg border border-red-900/60 px-3 py-2 text-xs text-zinc-400 hover:border-red-500 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {removing ? "Removing..." : "Remove"}
                      </button>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-3 pl-[54px] text-xs text-zinc-500">
                      <StatusPill done={job.done} notes={job.notes} />

                      <span>{niceDateTime(job.updated_at)}</span>

                      {job.updated_by && <span>By {job.updated_by}</span>}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-red-900/50 bg-[#181315] p-6 shadow-xl">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-red-400">
              Mechanic Feedback
            </p>

            <h2 className="mt-2 text-2xl font-semibold text-red-100">
              Evening Job Notes
            </h2>

            <p className="mt-1 text-sm text-zinc-400">
              Notes added by mechanics against specific evening prep tasks.
            </p>
          </div>

          <div className="rounded-2xl border border-red-900/50 bg-[#0d0f12] px-4 py-3 text-sm font-semibold text-red-300">
            {mechanicNotes.length} notes
          </div>
        </div>

        {mechanicNotes.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-red-900/50 bg-[#0d0f12] p-6 text-sm text-zinc-500">
            No mechanic notes added yet.
          </div>
        ) : (
          <div className="max-h-[520px] space-y-3 overflow-y-auto pr-2">
            {mechanicNotes.map((job) => {
              const noteKey = `${job.section}-${job.job_id}`;
              const isClearing = clearingNoteKey === noteKey;

              return (
                <div
                  key={noteKey}
                  className="rounded-2xl border border-red-900/40 bg-[#0d0f12] p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-red-400">
                        {job.section} job #{job.job_id}
                      </p>

                      <h3 className="mt-2 text-base font-semibold text-zinc-100">
                        {job.job_text}
                      </h3>
                    </div>

                    <div className="rounded-xl border border-zinc-800 bg-[#111418] px-3 py-2 text-xs text-zinc-400">
                      {niceDateTime(job.updated_at)}
                    </div>
                  </div>

                  <div className="mt-4 rounded-xl border border-zinc-800 bg-[#14181d] p-4 text-sm leading-6 text-zinc-200">
                    {job.notes}
                  </div>

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs text-zinc-500">
                      Added by {job.updated_by || "unknown"}
                    </p>

                    <button
                      type="button"
                      onClick={() => clearJobNote(job)}
                      disabled={isClearing}
                      className="rounded-lg border border-red-900/70 px-4 py-2 text-xs font-semibold text-red-300 transition hover:border-red-500 hover:bg-red-950/40 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isClearing ? "Clearing..." : "Clear Note"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}