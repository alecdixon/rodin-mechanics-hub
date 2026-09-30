"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import LogoutButton from "@/app/components/LogoutButton";
import { getCurrentUserEmail } from "@/lib/authHelpers";
import { supabase } from "@/lib/supabase";
import {
  canAccessTruckStock,
  canCheckTruckStock,
  getLoginRedirect,
  isChiefMechanic,
} from "@/lib/userAccess";

type ChecklistItem = {
  id: string;
  label: string;
  sort_order: number;
  baseline_source_key: string | null;
  is_active: boolean;
  is_checked: boolean;
  checked_at: string | null;
  checked_by: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
};

type ChecklistState = {
  last_reset_at: string | null;
  last_reset_by: string | null;
};

const CHECKLIST_SECTIONS = [
  { key: "consumables", label: "Consumables" },
  { key: "fluids", label: "Fluids / Chemicals" },
  { key: "tyre", label: "Tyre / Wheel" },
  { key: "workshop", label: "Workshop / Hardware" },
  { key: "garage", label: "Garage / General" },
  { key: "other", label: "Other" },
] as const;

type ChecklistSectionKey = (typeof CHECKLIST_SECTIONS)[number]["key"];

const BASELINE_SECTIONS: Record<string, ChecklistSectionKey> = {
  "01": "consumables",
  "02": "consumables",
  "03": "consumables",
  "04": "consumables",
  "05": "consumables",
  "06": "consumables",
  "07": "fluids",
  "08": "consumables",
  "09": "fluids",
  "10": "garage",
  "11": "garage",
  "12": "workshop",
  "13": "fluids",
  "14": "fluids",
  "15": "fluids",
  "16": "fluids",
  "17": "garage",
  "18": "tyre",
  "19": "tyre",
  "20": "tyre",
  "21": "tyre",
  "22": "workshop",
  "23": "workshop",
  "24": "workshop",
  "25": "workshop",
  "26": "garage",
  "27": "garage",
  "28": "fluids",
  "29": "workshop",
  "30": "garage",
};

function getItemSection(item: ChecklistItem): ChecklistSectionKey {
  const sourceKey = item.baseline_source_key?.split(":").at(-1);
  return (sourceKey && BASELINE_SECTIONS[sourceKey]) || "other";
}

function formatCompactDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function formatCompactTime(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatResetPerson(email: string | null) {
  if (!email) return "";
  if (email === "dan.crain@rodinmotorsport.com") return "Chief Mechanic";
  if (email === "guest@rodinmotorsport.com") return "Guest";
  return email
    .split("@")[0]
    .split(".")
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

function formatItemLabel(label: string) {
  return label
    .toLocaleLowerCase("en-GB")
    .replace(/(^|[\s/(&-])([a-z])/g, (_, prefix: string, letter: string) => `${prefix}${letter.toUpperCase()}`)
    .replace(/\bWd40\b/g, "WD40")
    .replace(/\bZx1\b/g, "ZX1")
    .replace(/\bPtfe\b/g, "PTFE")
    .replace(/\bAa\b/g, "AA")
    .replace(/\bAaa\b/g, "AAA")
    .replace(/\bLr\b/g, "LR")
    .replace(/\bCr\b/g, "CR")
    .replace(/\b(\d+(?:\.\d+)?)l\b/g, "$1L");
}

export default function TruckStockPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [checklistState, setChecklistState] = useState<ChecklistState | null>(null);
  const [userEmail, setUserEmail] = useState("");
  const [canToggle, setCanToggle] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [itemDialog, setItemDialog] = useState<"add" | "edit" | null>(null);
  const [editingItem, setEditingItem] = useState<ChecklistItem | null>(null);
  const [itemText, setItemText] = useState("");
  const [savingItem, setSavingItem] = useState(false);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadChecklist = useCallback(async () => {
    const [itemsResult, stateResult] = await Promise.all([
      supabase
        .from("truck_stock_checklist_items")
        .select("id,label,sort_order,baseline_source_key,is_active,is_checked,checked_at,checked_by,created_at,created_by,updated_at,updated_by")
        .eq("is_active", true)
        .order("sort_order", { ascending: true }),
      supabase
        .from("truck_stock_checklist_state")
        .select("last_reset_at,last_reset_by")
        .eq("singleton", true)
        .maybeSingle(),
    ]);

    if (itemsResult.error) throw itemsResult.error;
    if (stateResult.error) throw stateResult.error;
    setItems((itemsResult.data ?? []) as ChecklistItem[]);
    setChecklistState((stateResult.data as ChecklistState | null) ?? null);
  }, []);

  useEffect(() => {
    let mounted = true;
    async function initialise() {
      try {
        const email = await getCurrentUserEmail();
        if (!mounted) return;
        if (!email || !canAccessTruckStock(email)) {
          router.replace(email ? getLoginRedirect(email) : "/login");
          return;
        }
        setUserEmail(email);
        setCanToggle(canCheckTruckStock(email));
        setCanManage(isChiefMechanic(email));
        await loadChecklist();
      } catch (caught) {
        if (mounted) setError(caught instanceof Error ? caught.message : "Unable to load the Truck Stock Checklist.");
      } finally {
        if (mounted) setLoading(false);
      }
    }
    initialise();
    return () => { mounted = false; };
  }, [loadChecklist, router]);

  useEffect(() => {
    if (!userEmail) return;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const channel = supabase
      .channel("truck-stock-checklist-shared")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "truck_stock_checklist_items" },
        () => {
          if (refreshTimer) clearTimeout(refreshTimer);
          refreshTimer = setTimeout(() => {
            loadChecklist().catch(() => setError("The checklist changed, but the page could not refresh."));
          }, 100);
        },
      )
      .subscribe();
    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      supabase.removeChannel(channel);
    };
  }, [loadChecklist, userEmail]);

  const completed = useMemo(() => items.filter((item) => item.is_checked).length, [items]);
  const progress = items.length ? Math.round((completed / items.length) * 100) : 0;
  const groupedItems = useMemo(() => CHECKLIST_SECTIONS.map((section) => ({
    ...section,
    items: items.filter((item) => getItemSection(item) === section.key),
  })).filter((section) => section.items.length > 0), [items]);
  const orderedItems = useMemo(() => groupedItems.flatMap((section) => section.items), [groupedItems]);
  const lastUpdatedItem = useMemo(() => items.reduce<ChecklistItem | null>((latest, item) => (
    !latest || new Date(item.updated_at) > new Date(latest.updated_at) ? item : latest
  ), null), [items]);
  const backHref = userEmail ? getLoginRedirect(userEmail) : "/login";

  async function toggleItem(item: ChecklistItem) {
    if (!canToggle || savingIds.has(item.id)) return;
    const nextChecked = !item.is_checked;
    setMessage("");
    setError("");
    setSavingIds((current) => new Set(current).add(item.id));
    setItems((current) => current.map((candidate) => candidate.id === item.id
      ? { ...candidate, is_checked: nextChecked }
      : candidate));

    const { error: toggleError } = await supabase.rpc("set_truck_stock_item_checked", {
      p_item_id: item.id,
      p_is_checked: nextChecked,
    });
    if (toggleError) {
      setError(toggleError.message);
      try {
        await loadChecklist();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "The update failed and the checklist could not refresh.");
      }
    }
    setSavingIds((current) => {
      const next = new Set(current);
      next.delete(item.id);
      return next;
    });
  }

  function openAddDialog() {
    setEditingItem(null);
    setItemText("");
    setItemDialog("add");
    setError("");
    setMessage("");
  }

  function openEditDialog(item: ChecklistItem) {
    setEditingItem(item);
    setItemText(item.label);
    setItemDialog("edit");
    setError("");
    setMessage("");
  }

  async function saveDefinition() {
    if (savingItem) return;
    const cleanText = itemText.trim();
    if (!cleanText) return setError("Item text is required.");
    setSavingItem(true);
    setError("");
    const result = itemDialog === "edit" && editingItem
      ? await supabase.rpc("rename_truck_stock_checklist_item", {
          p_item_id: editingItem.id,
          p_label: cleanText,
        })
      : await supabase.rpc("add_truck_stock_checklist_item", { p_label: cleanText });
    setSavingItem(false);
    if (result.error) return setError(result.error.message);
    setItemDialog(null);
    setEditingItem(null);
    setItemText("");
    setMessage(itemDialog === "edit" ? "Checklist item updated." : "Checklist item added.");
    try { await loadChecklist(); } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Saved, but the checklist could not refresh.");
    }
  }

  async function archiveItem(item: ChecklistItem) {
    if (!window.confirm(`Remove “${item.label}” from the active checklist?\n\nThe item will be archived, not deleted.`)) return;
    setError("");
    setMessage("");
    const { error: archiveError } = await supabase.rpc("archive_truck_stock_checklist_item", {
      p_item_id: item.id,
    });
    if (archiveError) return setError(archiveError.message);
    setItemDialog(null);
    setEditingItem(null);
    setMessage("Checklist item archived.");
    try { await loadChecklist(); } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Archived, but the checklist could not refresh.");
    }
  }

  async function clearAllChecks() {
    setResetting(true);
    setError("");
    setMessage("");
    const { error: resetError } = await supabase.rpc("reset_truck_stock_checklist");
    setResetting(false);
    if (resetError) return setError(resetError.message);
    setResetDialogOpen(false);
    setMessage("Truck Stock Checklist cleared for the next event.");
    try { await loadChecklist(); } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Cleared, but the checklist could not refresh.");
    }
  }

  if (loading) {
    return <main className="flex min-h-screen items-center justify-center bg-black text-zinc-400">Loading Truck Stock Checklist...</main>;
  }

  return (
    <main className="min-h-screen bg-black px-4 py-5 text-white md:px-6 md:py-7">
      <div className="mx-auto max-w-4xl">
        <header className="border-b border-zinc-800 pb-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-red-400">Truck Stock</p>
              <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-zinc-100 md:text-3xl">Event Preparation Checklist</h1>
            </div>
            <div className="flex items-center gap-2">
              {canManage && (
                <>
                  <button type="button" onClick={openAddDialog} className="rounded-lg bg-red-700 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-500/60">+ Add Item</button>
                  <details className="relative">
                    <summary className="grid h-9 w-9 cursor-pointer list-none place-items-center rounded-lg border border-zinc-700 text-zinc-400 transition hover:border-zinc-500 hover:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-red-500/50 [&::-webkit-details-marker]:hidden" aria-label="Checklist management actions">
                      <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4 fill-current"><circle cx="4" cy="10" r="1.5"/><circle cx="10" cy="10" r="1.5"/><circle cx="16" cy="10" r="1.5"/></svg>
                    </summary>
                    <div className="absolute right-0 z-30 mt-2 w-52 rounded-lg border border-zinc-700 bg-[#15191e] p-1.5 shadow-xl shadow-black/40">
                      <button type="button" onClick={() => { setError(""); setMessage(""); setResetDialogOpen(true); }} disabled={!items.length} className="w-full rounded-md px-3 py-2 text-left text-sm text-zinc-300 transition hover:bg-zinc-800 hover:text-white disabled:opacity-40">Reset for Next Event</button>
                    </div>
                  </details>
                </>
              )}
              <Link href={backHref} className="rounded-lg border border-zinc-700 px-3.5 py-2 text-sm font-medium text-zinc-300 transition hover:border-zinc-500 hover:text-white">Back</Link>
              <LogoutButton />
            </div>
          </div>

          <div className="mt-5">
            <div className="flex items-baseline justify-between gap-4 text-sm">
              <p className="font-medium text-zinc-200">{completed} of {items.length} complete</p>
              <p className="tabular-nums text-zinc-500">{progress}%</p>
            </div>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-zinc-800" role="progressbar" aria-label="Truck Stock Checklist completion" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
              <div className="h-full rounded-full bg-red-600/80 transition-[width] duration-300" style={{ width: `${progress}%` }} />
            </div>
          </div>

          {(checklistState?.last_reset_at || lastUpdatedItem) && (
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-zinc-600">
              {checklistState?.last_reset_at && (
                <p>Last reset: {formatCompactDate(checklistState.last_reset_at)} · {formatResetPerson(checklistState.last_reset_by)}</p>
              )}
              {lastUpdatedItem && (
                <p>Last updated: {formatCompactTime(lastUpdatedItem.updated_at)}{lastUpdatedItem.updated_by ? ` · ${formatResetPerson(lastUpdatedItem.updated_by)}` : ""}</p>
              )}
            </div>
          )}
        </header>

        {!canToggle && (
          <p className="mt-4 border-l-2 border-zinc-700 pl-3 text-xs text-zinc-500">View-only access. Mechanics and the Chief can update completion.</p>
        )}
        {message && <div className="mt-4 rounded-lg border border-zinc-700 bg-zinc-900/70 px-3 py-2 text-sm text-zinc-300">{message}</div>}
        {error && <div role="alert" className="mt-4 rounded-lg border border-red-900/70 bg-red-950/25 px-3 py-2 text-sm text-red-200">{error}</div>}

        <section className="mt-6" aria-label="Truck Stock Checklist items">
          {orderedItems.map((item, index) => {
            const saving = savingIds.has(item.id);
            const sectionKey = getItemSection(item);
            const previousSectionKey = index > 0 ? getItemSection(orderedItems[index - 1]!) : null;
            const section = CHECKLIST_SECTIONS.find((candidate) => candidate.key === sectionKey);
            const sectionItems = groupedItems.find((candidate) => candidate.key === sectionKey)?.items ?? [];
            const sectionComplete = sectionItems.filter((candidate) => candidate.is_checked).length;
            return (
              <div key={item.id}>
                {sectionKey !== previousSectionKey && (
                  <div className={`${index ? "mt-7" : ""} mb-1.5 flex items-center justify-between border-b border-zinc-800 px-1 pb-2`}>
                    <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">{section?.label}</h2>
                    <span className="text-xs tabular-nums text-zinc-600">{sectionComplete} / {sectionItems.length}</span>
                  </div>
                )}
              <div className={`group flex min-h-12 items-center border-b border-zinc-900 px-1 transition-colors hover:bg-zinc-900/45 ${item.is_checked ? "text-zinc-600" : "text-zinc-200"}`}>
                <button type="button" role="checkbox" aria-checked={item.is_checked} aria-label={`${item.is_checked ? "Mark incomplete" : "Mark complete"}: ${item.label}`} onClick={() => toggleItem(item)} disabled={!canToggle || saving} className="grid h-11 w-10 shrink-0 place-items-center disabled:cursor-not-allowed disabled:opacity-40">
                  <span className={`grid h-[18px] w-[18px] place-items-center rounded-full border transition ${item.is_checked ? "border-zinc-500 bg-zinc-700 text-zinc-200" : "border-zinc-600 text-transparent group-hover:border-zinc-400"}`}>
                    <svg viewBox="0 0 20 20" aria-hidden="true" className="h-3 w-3 fill-none stroke-current stroke-[2.4]"><path d="m5 10 3 3 7-7" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </span>
                </button>
                <button type="button" onClick={() => toggleItem(item)} disabled={!canToggle || saving} className="min-w-0 flex-1 py-3 text-left disabled:cursor-default">
                  <span className={`block text-sm leading-5 ${item.is_checked ? "text-zinc-600 line-through decoration-zinc-700" : "font-medium text-zinc-200"}`}>{formatItemLabel(item.label)}</span>
                </button>
                <span className={`hidden px-3 text-xs sm:block ${item.is_checked ? "text-zinc-600" : "text-zinc-700"}`}>{item.is_checked ? "Done" : "Open"}</span>
                {canManage && (
                  <details className="relative ml-1 shrink-0">
                    <summary className="grid h-9 w-9 cursor-pointer list-none place-items-center rounded-md text-zinc-600 opacity-70 transition hover:bg-zinc-800 hover:text-zinc-200 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-red-500/40 md:opacity-0 md:group-hover:opacity-100 [&::-webkit-details-marker]:hidden" aria-label={`Manage ${item.label}`}>
                      <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4 fill-current"><circle cx="4" cy="10" r="1.5"/><circle cx="10" cy="10" r="1.5"/><circle cx="16" cy="10" r="1.5"/></svg>
                    </summary>
                    <div className="absolute right-0 z-20 mt-1 w-32 rounded-lg border border-zinc-700 bg-[#15191e] p-1.5 shadow-xl shadow-black/40">
                      <button type="button" onClick={() => openEditDialog(item)} className="w-full rounded-md px-3 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-800 hover:text-white">Edit</button>
                      <button type="button" onClick={() => archiveItem(item)} className="w-full rounded-md px-3 py-2 text-left text-sm text-zinc-400 hover:bg-zinc-800 hover:text-red-300">Remove</button>
                    </div>
                  </details>
                )}
              </div>
              </div>
            );
          })}
          {!items.length && !error && <div className="border-y border-zinc-800 py-10 text-center text-sm text-zinc-500">No active checklist items.</div>}
        </section>
      </div>

      {itemDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={itemDialog === "add" ? "Add Truck Stock Item" : "Edit Truck Stock Item"}>
          <div className="w-full max-w-md rounded-xl border border-zinc-700 bg-[#15191e] p-5 shadow-2xl">
            <h2 className="text-lg font-semibold">{itemDialog === "add" ? "Add Truck Stock Item" : "Edit Truck Stock Item"}</h2>
            <label className="mt-5 block text-sm text-zinc-400">Item<input autoFocus value={itemText} onChange={(event) => setItemText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") saveDefinition(); }} className="mt-2 w-full rounded-lg border border-zinc-700 bg-[#0d0f12] px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-red-500" /></label>
            {error && <p role="alert" className="mt-4 text-sm text-red-300">{error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setItemDialog(null)} className="rounded-lg border border-zinc-700 px-3.5 py-2 text-sm font-medium text-zinc-300 hover:border-zinc-500">Cancel</button>
              <button type="button" disabled={savingItem} onClick={saveDefinition} className="rounded-lg bg-red-700 px-3.5 py-2 text-sm font-semibold hover:bg-red-600 disabled:opacity-50">{savingItem ? "Saving..." : itemDialog === "add" ? "Add Item" : "Save"}</button>
            </div>
          </div>
        </div>
      )}

      {resetDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Reset Truck Stock Checklist">
          <div className="w-full max-w-md rounded-xl border border-zinc-700 bg-[#15191e] p-5 shadow-2xl">
            <h2 className="text-lg font-semibold">Reset checklist for next event?</h2>
            <p className="mt-3 text-sm leading-6 text-zinc-400">All {items.length} checklist items will be marked incomplete. The item list itself will not be changed.</p>
            {error && <p role="alert" className="mt-4 text-sm text-red-300">{error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setResetDialogOpen(false)} disabled={resetting} className="rounded-lg border border-zinc-700 px-3.5 py-2 text-sm font-medium text-zinc-300 hover:border-zinc-500">Cancel</button>
              <button type="button" onClick={clearAllChecks} disabled={resetting} className="rounded-lg bg-red-700 px-3.5 py-2 text-sm font-semibold hover:bg-red-600 disabled:opacity-50">{resetting ? "Resetting..." : "Reset Checklist"}</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
