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

function formatResetPerson(email: string | null) {
  if (!email) return "";
  if (email === "dan.crain@rodinmotorsport.com") return "Chief Mechanic";
  return email;
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
        .select("id,label,sort_order,is_active,is_checked,checked_at,checked_by,created_at,created_by,updated_at,updated_by")
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
    <main className="min-h-screen bg-black p-4 text-white md:p-6">
      <div className="mx-auto max-w-5xl">
        <header className="rounded-3xl border border-zinc-800 bg-gradient-to-br from-[#15191e] via-[#101317] to-[#211014] p-6 shadow-2xl shadow-black/30 md:p-8">
          <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.36em] text-red-400">Rodin Motorsport</p>
              <h1 className="mt-3 text-3xl font-bold tracking-tight md:text-5xl">Truck Stock Checklist</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">One shared event-preparation checklist for the whole team.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href={backHref} className="rounded-xl border border-zinc-700 bg-[#15191e] px-4 py-2.5 text-sm font-semibold text-zinc-200 hover:border-red-500">Back</Link>
              <LogoutButton />
            </div>
          </div>

          <div className="mt-7 grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
            <div>
              <div className="flex items-end justify-between gap-4">
                <p className="text-2xl font-bold text-white">{completed} / {items.length} Complete</p>
                <p className="text-lg font-semibold text-red-300">{progress}%</p>
              </div>
              <div className="mt-3 h-3 overflow-hidden rounded-full bg-zinc-800" role="progressbar" aria-label="Truck Stock Checklist completion" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
                <div className="h-full rounded-full bg-red-600 transition-[width] duration-300" style={{ width: `${progress}%` }} />
              </div>
            </div>
            {canManage && (
              <div className="flex flex-wrap gap-3">
                <button type="button" onClick={openAddDialog} className="rounded-xl bg-red-700 px-4 py-3 text-sm font-semibold hover:bg-red-600">+ Add Item</button>
                <button type="button" onClick={() => { setError(""); setMessage(""); setResetDialogOpen(true); }} disabled={!items.length} className="rounded-xl border border-zinc-600 px-4 py-3 text-sm font-semibold text-zinc-200 hover:border-red-500 disabled:opacity-40">Clear All Checks</button>
              </div>
            )}
          </div>

          {checklistState?.last_reset_at && (
            <p className="mt-4 text-xs text-zinc-500">Checklist reset {new Date(checklistState.last_reset_at).toLocaleString()} by {formatResetPerson(checklistState.last_reset_by)}</p>
          )}
        </header>

        {!canToggle && (
          <div className="mt-5 rounded-2xl border border-amber-900/70 bg-amber-950/25 p-4 text-sm text-amber-200">View-only access. Mechanics and the Chief can update checklist completion.</div>
        )}
        {message && <div className="mt-5 rounded-2xl border border-emerald-800 bg-emerald-950/30 p-4 text-sm text-emerald-200">{message}</div>}
        {error && <div role="alert" className="mt-5 rounded-2xl border border-red-800 bg-red-950/35 p-4 text-sm text-red-200">{error}</div>}

        <section className="mt-6 space-y-3" aria-label="Truck Stock Checklist items">
          {items.map((item, index) => {
            const saving = savingIds.has(item.id);
            return (
              <div key={item.id} className={`grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-2xl border p-3 transition md:p-4 ${item.is_checked ? "border-emerald-800/70 bg-emerald-950/20" : "border-zinc-800 bg-[#111418]"}`}>
                <button type="button" role="checkbox" aria-checked={item.is_checked} aria-label={`${item.is_checked ? "Mark incomplete" : "Mark complete"}: ${item.label}`} onClick={() => toggleItem(item)} disabled={!canToggle || saving} className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl border text-xl font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${item.is_checked ? "border-emerald-500 bg-emerald-600 text-white" : "border-zinc-600 bg-[#0d0f12] text-transparent hover:border-red-500"}`}>✓</button>
                <button type="button" onClick={() => toggleItem(item)} disabled={!canToggle || saving} className="min-w-0 py-2 text-left disabled:cursor-default">
                  <span className="mr-3 text-xs font-semibold text-zinc-600">{index + 1}</span>
                  <span className={`text-sm font-semibold leading-6 md:text-base ${item.is_checked ? "text-zinc-400 line-through" : "text-zinc-100"}`}>{item.label}</span>
                </button>
                {canManage && <button type="button" onClick={() => openEditDialog(item)} className="rounded-lg border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-300 hover:border-red-500 hover:text-red-300">Edit</button>}
              </div>
            );
          })}
          {!items.length && !error && <div className="rounded-2xl border border-dashed border-zinc-800 p-10 text-center text-zinc-500">No active checklist items.</div>}
        </section>
      </div>

      {itemDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={itemDialog === "add" ? "Add Truck Stock Item" : "Edit Truck Stock Item"}>
          <div className="w-full max-w-lg rounded-3xl border border-zinc-700 bg-[#15191e] p-6 shadow-2xl">
            <h2 className="text-2xl font-bold">{itemDialog === "add" ? "Add Truck Stock Item" : "Edit Truck Stock Item"}</h2>
            <label className="mt-6 block text-sm text-zinc-400">Item<input autoFocus value={itemText} onChange={(event) => setItemText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") saveDefinition(); }} className="mt-2 w-full rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-zinc-100 outline-none focus:border-red-500" /></label>
            {error && <p role="alert" className="mt-4 text-sm text-red-300">{error}</p>}
            <div className="mt-6 flex flex-wrap justify-end gap-3">
              {itemDialog === "edit" && editingItem && <button type="button" onClick={() => archiveItem(editingItem)} className="mr-auto rounded-xl border border-red-800 px-4 py-2.5 text-sm font-semibold text-red-300 hover:bg-red-950/30">Remove</button>}
              <button type="button" onClick={() => setItemDialog(null)} className="rounded-xl border border-zinc-700 px-4 py-2.5 text-sm font-semibold">Cancel</button>
              <button type="button" disabled={savingItem} onClick={saveDefinition} className="rounded-xl bg-red-700 px-4 py-2.5 text-sm font-semibold hover:bg-red-600 disabled:opacity-50">{savingItem ? "Saving..." : itemDialog === "add" ? "Add" : "Save"}</button>
            </div>
          </div>
        </div>
      )}

      {resetDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Reset Truck Stock Checklist">
          <div className="w-full max-w-lg rounded-3xl border border-zinc-700 bg-[#15191e] p-6 shadow-2xl">
            <h2 className="text-2xl font-bold">Reset Truck Stock Checklist?</h2>
            <p className="mt-4 text-sm leading-6 text-zinc-400">This will mark all checklist items as incomplete ready for the next event.</p>
            {error && <p role="alert" className="mt-4 text-sm text-red-300">{error}</p>}
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setResetDialogOpen(false)} disabled={resetting} className="rounded-xl border border-zinc-700 px-4 py-2.5 text-sm font-semibold">Cancel</button>
              <button type="button" onClick={clearAllChecks} disabled={resetting} className="rounded-xl bg-red-700 px-4 py-2.5 text-sm font-semibold hover:bg-red-600 disabled:opacity-50">{resetting ? "Clearing..." : "Clear All"}</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
