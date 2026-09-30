"use client";

import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import LogoutButton from "@/app/components/LogoutButton";
import { getCurrentUserEmail } from "@/lib/authHelpers";
import { supabase } from "@/lib/supabase";
import { getLoginRedirect, isChiefMechanic } from "@/lib/userAccess";

const BUCKET = "truck-inventory-images";
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const STATUSES = ["TRACKED", "NEEDS_REVIEW", "IGNORED", "SUPERSEDED", "OBSOLETE"] as const;
type TrackingStatus = (typeof STATUSES)[number];

type InventoryItem = {
  id: string;
  catalogue_part_id: string | null;
  part_number: string | null;
  description: string | null;
  target_quantity: number | null;
  baseline_quantity_2025: number | null;
  category: string | null;
  truck_location: string | null;
  tracking_status: TrackingStatus;
  notes: string | null;
  primary_image_path: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
};

type Draft = {
  part_number: string;
  description: string;
  target_quantity: string;
  category: string;
  truck_location: string;
  tracking_status: TrackingStatus;
  notes: string;
};

const EMPTY_DRAFT: Draft = {
  part_number: "",
  description: "",
  target_quantity: "0",
  category: "",
  truck_location: "",
  tracking_status: "TRACKED",
  notes: "",
};

function toDraft(item: InventoryItem): Draft {
  return {
    part_number: item.part_number ?? "",
    description: item.description ?? "",
    target_quantity: item.target_quantity == null ? "" : String(item.target_quantity),
    category: item.category ?? "",
    truck_location: item.truck_location ?? "",
    tracking_status: item.tracking_status,
    notes: item.notes ?? "",
  };
}

function statusClass(status: TrackingStatus) {
  if (status === "TRACKED") return "border-emerald-700 bg-emerald-950/45 text-emerald-200";
  if (status === "NEEDS_REVIEW") return "border-amber-700 bg-amber-950/45 text-amber-200";
  return "border-zinc-600 bg-zinc-900 text-zinc-300";
}

function nullable(value: string) {
  const trimmed = value.trim();
  return trimmed || null;
}

export default function TruckInventoryPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ACTIVE");
  const [selected, setSelected] = useState<InventoryItem | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadInventory = useCallback(async () => {
    const { data, error: loadError } = await supabase
      .from("truck_inventory_items")
      .select("id,catalogue_part_id,part_number,description,target_quantity,baseline_quantity_2025,category,truck_location,tracking_status,notes,primary_image_path,created_at,created_by,updated_at,updated_by")
      .order("part_number", { ascending: true, nullsFirst: false });

    if (loadError) throw loadError;
    const loaded = (data ?? []) as InventoryItem[];
    setItems(loaded);

    const paths = [...new Set(loaded.map((item) => item.primary_image_path).filter((path): path is string => Boolean(path)))];
    if (!paths.length) {
      setImageUrls({});
      return;
    }

    const { data: signedData, error: signedError } = await supabase.storage
      .from(BUCKET)
      .createSignedUrls(paths, 60 * 60);
    if (signedError) throw signedError;

    const nextUrls: Record<string, string> = {};
    signedData.forEach((entry, index) => {
      if (entry.signedUrl) nextUrls[paths[index]] = entry.signedUrl;
    });
    setImageUrls(nextUrls);
  }, []);

  useEffect(() => {
    let mounted = true;
    async function initialise() {
      try {
        const email = await getCurrentUserEmail();
        if (!mounted) return;
        if (!email || !isChiefMechanic(email)) {
          router.replace(email ? getLoginRedirect(email) : "/login");
          return;
        }
        await loadInventory();
      } catch (caught) {
        if (mounted) setError(caught instanceof Error ? caught.message : "Unable to load truck inventory.");
      } finally {
        if (mounted) setLoading(false);
      }
    }
    initialise();
    return () => { mounted = false; };
  }, [loadInventory, router]);

  const categories = useMemo(() => [...new Set(items.map((item) => item.category).filter((value): value is string => Boolean(value)))].sort(), [items]);
  const visibleItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items.filter((item) => {
      const matchesSearch = !query || `${item.part_number ?? ""} ${item.description ?? ""}`.toLowerCase().includes(query);
      const matchesCategory = categoryFilter === "ALL" || item.category === categoryFilter;
      const matchesStatus = statusFilter === "ALL"
        || (statusFilter === "ACTIVE" && (item.tracking_status === "TRACKED" || item.tracking_status === "NEEDS_REVIEW"))
        || item.tracking_status === statusFilter;
      return matchesSearch && matchesCategory && matchesStatus;
    });
  }, [categoryFilter, items, search, statusFilter]);

  function openNew() {
    setSelected(null);
    setDraft(EMPTY_DRAFT);
    setError("");
    setMessage("");
    setEditorOpen(true);
  }

  function openItem(item: InventoryItem) {
    setSelected(item);
    setDraft(toDraft(item));
    setError("");
    setMessage("");
    setEditorOpen(true);
  }

  async function saveItem() {
    setError("");
    setMessage("");
    const partNumber = draft.part_number.trim();
    const description = draft.description.trim();
    const quantity = Number(draft.target_quantity);
    if (!partNumber) return setError("Part number is required for manually managed parts.");
    if (!description) return setError("Description is required.");
    if (!Number.isInteger(quantity) || quantity < 0) return setError("Target quantity must be a whole number of zero or more.");

    setSaving(true);
    const payload = {
      part_number: partNumber,
      description,
      target_quantity: quantity,
      category: nullable(draft.category),
      truck_location: nullable(draft.truck_location),
      tracking_status: draft.tracking_status,
      notes: nullable(draft.notes),
    };
    const result = selected
      ? await supabase.from("truck_inventory_items").update(payload).eq("id", selected.id).select().single()
      : await supabase.from("truck_inventory_items").insert(payload).select().single();
    setSaving(false);

    if (result.error) return setError(result.error.message);
    const saved = result.data as InventoryItem;
    setSelected(saved);
    setDraft(toDraft(saved));
    setMessage(selected ? "Inventory item updated." : "Inventory item added. You can now attach an image.");
    try {
      await loadInventory();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Saved, but the list could not be refreshed.");
    }
  }

  async function archiveItem() {
    if (!selected) return;
    setSaving(true);
    setError("");
    const { error: updateError } = await supabase
      .from("truck_inventory_items")
      .update({ tracking_status: "IGNORED" })
      .eq("id", selected.id);
    setSaving(false);
    if (updateError) return setError(updateError.message);
    setDraft((current) => ({ ...current, tracking_status: "IGNORED" }));
    setSelected((current) => current ? { ...current, tracking_status: "IGNORED" } : current);
    setMessage("Item archived as IGNORED. It remains recoverable using the status filter.");
    try { await loadInventory(); } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Archived, but the list could not be refreshed.");
    }
  }

  async function handleImage(file: File | undefined) {
    if (!file || !selected) return;
    setError("");
    setMessage("");
    if (!file.type.startsWith("image/")) return setError("Choose an image file.");
    if (file.size > MAX_IMAGE_BYTES) return setError("Image must be 10 MB or smaller.");

    setImageBusy(true);
    const extension = (file.name.split(".").pop() || file.type.split("/").pop() || "jpg").replace(/[^a-z0-9]/gi, "").toLowerCase() || "jpg";
    const newPath = `${selected.id}/${crypto.randomUUID()}.${extension}`;
    const oldPath = selected.primary_image_path;
    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(newPath, file, {
      cacheControl: "3600",
      contentType: file.type,
      upsert: false,
    });
    if (uploadError) {
      setImageBusy(false);
      return setError(uploadError.message);
    }

    const { error: updateError } = await supabase
      .from("truck_inventory_items")
      .update({ primary_image_path: newPath })
      .eq("id", selected.id);
    if (updateError) {
      const { error: cleanupError } = await supabase.storage.from(BUCKET).remove([newPath]);
      setImageBusy(false);
      return setError(cleanupError
        ? `${updateError.message} The uploaded file also could not be cleaned up: ${cleanupError.message}`
        : updateError.message);
    }
    const oldImageCleanup = oldPath
      ? await supabase.storage.from(BUCKET).remove([oldPath])
      : { error: null };
    setSelected((current) => current ? { ...current, primary_image_path: newPath } : current);
    setMessage(oldPath ? "Image replaced." : "Image added.");
    try { await loadInventory(); } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Image saved, but the list could not be refreshed.");
    }
    if (oldImageCleanup.error) {
      setError(`The replacement was saved, but the old image could not be cleaned up: ${oldImageCleanup.error.message}`);
    }
    setImageBusy(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function removeImage() {
    if (!selected?.primary_image_path) return;
    setImageBusy(true);
    setError("");
    const oldPath = selected.primary_image_path;
    const { error: updateError } = await supabase
      .from("truck_inventory_items")
      .update({ primary_image_path: null })
      .eq("id", selected.id);
    if (updateError) {
      setImageBusy(false);
      return setError(updateError.message);
    }
    const { error: removeError } = await supabase.storage.from(BUCKET).remove([oldPath]);
    setSelected((current) => current ? { ...current, primary_image_path: null } : current);
    setImageBusy(false);
    setMessage("Image removed.");
    if (removeError) setError(`The item was updated, but storage cleanup failed: ${removeError.message}`);
    try { await loadInventory(); } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Image removed, but the list could not be refreshed.");
    }
  }

  if (loading) {
    return <main className="flex min-h-screen items-center justify-center bg-[#0d0f12] text-zinc-400">Loading truck inventory...</main>;
  }

  return (
    <main className="truck-inventory-print-root min-h-screen bg-[#0d0f12] p-4 text-zinc-100 md:p-6">
      <style>{`
        @media print {
          @page {
            size: A4 landscape;
            margin: 8mm;
          }

          body {
            background: white !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }

          .truck-inventory-no-print {
            display: none !important;
          }

          .truck-inventory-print-root {
            min-height: auto !important;
            background: white !important;
            color: #111827 !important;
            padding: 0 !important;
          }

          .truck-inventory-print-header {
            max-width: none !important;
            margin: 0 0 5mm !important;
            border: 0 !important;
            border-bottom: 2px solid #111827 !important;
            border-radius: 0 !important;
            background: white !important;
            box-shadow: none !important;
            padding: 0 0 4mm !important;
          }

          .truck-inventory-print-header * {
            color: #111827 !important;
          }

          .truck-inventory-print-area {
            max-width: none !important;
            border: 0 !important;
            border-radius: 0 !important;
            background: white !important;
            box-shadow: none !important;
            padding: 0 !important;
          }

          .truck-inventory-table-wrap {
            overflow: visible !important;
            border: 1px solid #9ca3af !important;
            border-radius: 0 !important;
          }

          .truck-inventory-table {
            border-collapse: collapse !important;
            font-size: 8pt !important;
            color: #111827 !important;
          }

          .truck-inventory-table thead,
          .truck-inventory-table tbody {
            background: white !important;
          }

          .truck-inventory-table tr {
            break-inside: avoid !important;
            page-break-inside: avoid !important;
          }

          .truck-inventory-table th,
          .truck-inventory-table td {
            border: 1px solid #d1d5db !important;
            color: #111827 !important;
            padding: 2mm !important;
          }

          .truck-inventory-table th {
            background: #f3f4f6 !important;
          }

          .truck-inventory-table span,
          .truck-inventory-table div {
            color: #111827 !important;
          }

          .truck-inventory-table img,
          .truck-inventory-table td:first-child > div {
            width: 10mm !important;
            height: 10mm !important;
          }
        }
      `}</style>
      <header className="truck-inventory-print-header mx-auto mb-6 max-w-[1500px] rounded-[2rem] border border-zinc-800 bg-gradient-to-br from-black via-[#111418] to-[#211014] p-6 shadow-2xl shadow-black/30 md:p-8">
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-red-400">Chief Mechanic</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white md:text-5xl">Truck Inventory</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-400">Manage the parts carried and audited in the truck. The 2025 quantity remains a historical baseline when targets change.</p>
          </div>
          <div className="truck-inventory-no-print flex flex-wrap gap-3">
            <button type="button" onClick={() => window.print()} className="rounded-xl border border-zinc-700 px-4 py-2 text-sm font-semibold hover:border-red-500">Print to PDF</button>
            <Link href="/dashboard" className="rounded-xl border border-zinc-700 px-4 py-2 text-sm font-semibold hover:border-red-500">Back to Dashboard</Link>
            <LogoutButton />
          </div>
        </div>
      </header>

      <section className="truck-inventory-print-area mx-auto max-w-[1500px] rounded-3xl border border-zinc-800 bg-[#15191e] p-4 shadow-xl md:p-6">
        <div className="truck-inventory-no-print grid gap-3 md:grid-cols-[minmax(220px,1fr)_minmax(180px,280px)_minmax(180px,240px)_auto]">
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search part number or description" className="rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-sm outline-none focus:border-red-500" />
          <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className="rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-sm">
            <option value="ALL">All categories</option>
            {categories.map((category) => <option key={category} value={category}>{category}</option>)}
          </select>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-sm">
            <option value="ACTIVE">Active inventory</option>
            <option value="ALL">All statuses</option>
            {STATUSES.map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}
          </select>
          <button type="button" onClick={openNew} className="rounded-xl bg-red-700 px-5 py-3 text-sm font-semibold hover:bg-red-600">Add Part</button>
        </div>

        {error && !editorOpen && <p role="alert" className="truck-inventory-no-print mt-4 rounded-xl border border-red-800 bg-red-950/35 p-3 text-sm text-red-200">{error}</p>}
        <div className="mt-5 flex items-center justify-between text-xs uppercase tracking-[0.18em] text-zinc-500">
          <span>{visibleItems.length} items shown</span><span>{items.length} total records</span>
        </div>

        <div className="truck-inventory-table-wrap mt-3 overflow-x-auto rounded-2xl border border-zinc-800">
          <table className="truck-inventory-table min-w-full divide-y divide-zinc-800 text-left text-sm">
            <thead className="bg-[#0d0f12] text-xs uppercase tracking-[0.14em] text-zinc-500">
              <tr><th className="px-4 py-3">Photo</th><th className="px-4 py-3">Part Number</th><th className="px-4 py-3">Description</th><th className="px-4 py-3">Target Qty</th><th className="px-4 py-3">Truck Qty</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Location</th></tr>
            </thead>
            <tbody className="divide-y divide-zinc-800 bg-[#15191e]">
              {visibleItems.map((item) => (
                <tr key={item.id} onClick={() => openItem(item)} className="cursor-pointer transition hover:bg-[#20252c]" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") openItem(item); }}>
                  <td className="px-4 py-3">{item.primary_image_path && imageUrls[item.primary_image_path] ? <Image unoptimized width={48} height={48} src={imageUrls[item.primary_image_path]} alt="" className="h-12 w-12 rounded-lg border border-zinc-700 object-cover" /> : <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-dashed border-zinc-700 text-[10px] text-zinc-600">No image</div>}</td>
                  <td className="whitespace-nowrap px-4 py-3 font-semibold text-white">{item.part_number || <span className="text-amber-300">Needs review</span>}</td>
                  <td className="min-w-64 px-4 py-3 text-zinc-300">{item.description || "—"}</td>
                  <td className="px-4 py-3 text-zinc-200">{item.target_quantity ?? "—"}</td>
                  <td className="px-4 py-3 text-zinc-400">{item.baseline_quantity_2025 ?? "—"}</td>
                  <td className="px-4 py-3"><span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusClass(item.tracking_status)}`}>{item.tracking_status.replaceAll("_", " ")}</span></td>
                  <td className="whitespace-nowrap px-4 py-3 text-zinc-400">{item.truck_location || "—"}</td>
                </tr>
              ))}
              {!visibleItems.length && <tr><td colSpan={7} className="px-4 py-12 text-center text-zinc-500">No inventory items match these filters.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {editorOpen && (
        <div className="truck-inventory-no-print fixed inset-0 z-50 overflow-y-auto bg-black/75 p-3 backdrop-blur-sm md:p-8" role="dialog" aria-modal="true" aria-label={selected ? "Edit inventory item" : "Add inventory item"}>
          <div className="mx-auto max-w-4xl rounded-3xl border border-zinc-700 bg-[#15191e] p-5 shadow-2xl md:p-8">
            <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.3em] text-red-400">{selected ? "Inventory detail" : "Manual part"}</p><h2 className="mt-2 text-2xl font-semibold">{selected ? (selected.part_number || "Review item") : "Add a part"}</h2></div><button type="button" onClick={() => setEditorOpen(false)} className="rounded-lg border border-zinc-700 px-3 py-2 text-sm hover:border-red-500">Close</button></div>

            <div className="mt-6 grid gap-5 md:grid-cols-[180px_1fr]">
              <div>
                <div className="flex h-44 items-center justify-center overflow-hidden rounded-2xl border border-zinc-700 bg-[#0d0f12]">
                  {selected?.primary_image_path && imageUrls[selected.primary_image_path] ? <Image unoptimized width={180} height={176} src={imageUrls[selected.primary_image_path]} alt={selected.description || selected.part_number || "Inventory part"} className="h-full w-full object-cover" /> : <span className="text-sm text-zinc-600">No image</span>}
                </div>
                <input ref={fileInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(event) => handleImage(event.target.files?.[0])} />
                <button type="button" disabled={!selected || imageBusy} onClick={() => fileInputRef.current?.click()} className="mt-3 w-full rounded-xl border border-zinc-600 px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40">{imageBusy ? "Working..." : selected?.primary_image_path ? "Replace Image" : "Take / Add Image"}</button>
                {selected?.primary_image_path && <button type="button" disabled={imageBusy} onClick={removeImage} className="mt-2 w-full rounded-xl px-3 py-2 text-sm text-red-300 hover:bg-red-950/30">Remove Image</button>}
                {!selected && <p className="mt-2 text-xs leading-5 text-zinc-500">Save the part before adding an image.</p>}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-sm text-zinc-400">Part Number<input value={draft.part_number} onChange={(event) => setDraft({ ...draft, part_number: event.target.value })} className="mt-2 w-full rounded-xl border border-zinc-700 bg-[#0d0f12] px-3 py-2.5 text-zinc-100" /></label>
                <label className="text-sm text-zinc-400">Target Quantity<input type="number" min="0" step="1" value={draft.target_quantity} onChange={(event) => setDraft({ ...draft, target_quantity: event.target.value })} className="mt-2 w-full rounded-xl border border-zinc-700 bg-[#0d0f12] px-3 py-2.5 text-zinc-100" /></label>
                <label className="text-sm text-zinc-400 sm:col-span-2">Description<input value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} className="mt-2 w-full rounded-xl border border-zinc-700 bg-[#0d0f12] px-3 py-2.5 text-zinc-100" /></label>
                <label className="text-sm text-zinc-400">Category<input list="inventory-categories" value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })} className="mt-2 w-full rounded-xl border border-zinc-700 bg-[#0d0f12] px-3 py-2.5 text-zinc-100" /><datalist id="inventory-categories">{categories.map((category) => <option key={category} value={category} />)}</datalist></label>
                <label className="text-sm text-zinc-400">Truck Location<input value={draft.truck_location} onChange={(event) => setDraft({ ...draft, truck_location: event.target.value })} className="mt-2 w-full rounded-xl border border-zinc-700 bg-[#0d0f12] px-3 py-2.5 text-zinc-100" /></label>
                <label className="text-sm text-zinc-400">Status<select value={draft.tracking_status} onChange={(event) => setDraft({ ...draft, tracking_status: event.target.value as TrackingStatus })} className="mt-2 w-full rounded-xl border border-zinc-700 bg-[#0d0f12] px-3 py-2.5 text-zinc-100">{STATUSES.map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}</select></label>
                <div className="rounded-xl border border-zinc-800 bg-[#0d0f12] p-3"><p className="text-xs uppercase tracking-[0.15em] text-zinc-500">2025 baseline</p><p className="mt-1 text-lg font-semibold">{selected?.baseline_quantity_2025 ?? "—"}</p>{selected?.baseline_quantity_2025 != null && Number.isInteger(Number(draft.target_quantity)) && <p className="text-xs text-zinc-500">Difference: {Number(draft.target_quantity) - selected.baseline_quantity_2025 >= 0 ? "+" : ""}{Number(draft.target_quantity) - selected.baseline_quantity_2025}</p>}</div>
                <label className="text-sm text-zinc-400 sm:col-span-2">Notes<textarea rows={5} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} className="mt-2 w-full rounded-xl border border-zinc-700 bg-[#0d0f12] px-3 py-2.5 text-zinc-100" /></label>
              </div>
            </div>

            {error && <p role="alert" className="mt-5 rounded-xl border border-red-800 bg-red-950/35 p-3 text-sm text-red-200">{error}</p>}
            {message && <p className="mt-5 rounded-xl border border-emerald-800 bg-emerald-950/30 p-3 text-sm text-emerald-200">{message}</p>}
            <div className="mt-6 flex flex-wrap justify-end gap-3">
              {selected && selected.tracking_status !== "IGNORED" && <button type="button" disabled={saving} onClick={archiveItem} className="rounded-xl border border-red-800 px-4 py-2.5 text-sm font-semibold text-red-300 hover:bg-red-950/30 disabled:opacity-50">Archive / Ignore</button>}
              <button type="button" disabled={saving} onClick={saveItem} className="rounded-xl bg-red-700 px-5 py-2.5 text-sm font-semibold hover:bg-red-600 disabled:opacity-50">{saving ? "Saving..." : selected ? "Save Changes" : "Add Part"}</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
