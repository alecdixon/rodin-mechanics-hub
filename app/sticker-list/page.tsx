"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getAssignedCar, getUserRole } from "@/lib/userAccess";
import LogoutButton from "@/app/components/LogoutButton";

type DashboardCar = {
  id: number;
  name: string;
  colour: string | null;
  active: boolean;
  sort_order: number | null;
};

type StickerCategoryType = "car" | "general" | "custom";

type StickerItem = {
  id: string;
  category_type: StickerCategoryType;
  car_id: number | null;
  custom_category: string | null;
  sticker_text: string;
  quantity: number;
  notes: string | null;
  done: boolean;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type StickerListSettings = {
  id: string;
  need_by: string | null;
  updated_by: string | null;
  updated_at: string | null;
};

type StickerGroup = {
  key: string;
  title: string;
  subtitle: string;
  colour: string;
  sortOrder: number;
  items: StickerItem[];
};

const DEFAULT_CAR_COLOUR = "#b91c1c";
const GENERAL_COLOUR = "#71717a";
const CUSTOM_COLOUR = "#dc2626";
const SETTINGS_ID = "main";

function niceDateTime(value: string | null | undefined) {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function niceDate(value: string | null | undefined) {
  if (!value) return "—";

  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
}

function safeQuantity(value: string) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 1;
  return Math.max(1, Math.round(number));
}

function carDisplayName(car: DashboardCar) {
  return `${car.name} / Car ${car.id}`;
}

function getGroupMeta(
  item: StickerItem,
  cars: DashboardCar[],
): {
  key: string;
  title: string;
  subtitle: string;
  colour: string;
  sortOrder: number;
} {
  if (item.category_type === "car" && item.car_id !== null) {
    const car = cars.find((current) => current.id === item.car_id);

    return {
      key: `car-${item.car_id}`,
      title: car ? carDisplayName(car) : `Car ${item.car_id}`,
      subtitle: "Car sticker list",
      colour: car?.colour || DEFAULT_CAR_COLOUR,
      sortOrder: car?.sort_order ?? item.car_id,
    };
  }

  if (item.category_type === "custom") {
    const title = item.custom_category?.trim() || "Custom";

    return {
      key: `custom-${title.toLowerCase()}`,
      title,
      subtitle: "Custom category",
      colour: CUSTOM_COLOUR,
      sortOrder: 9000,
    };
  }

  return {
    key: "general",
    title: "General",
    subtitle: "General sticker list",
    colour: GENERAL_COLOUR,
    sortOrder: 8000,
  };
}

export default function StickerListPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [clearingAll, setClearingAll] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const [cars, setCars] = useState<DashboardCar[]>([]);
  const [items, setItems] = useState<StickerItem[]>([]);
  const [settings, setSettings] = useState<StickerListSettings>({
    id: SETTINGS_ID,
    need_by: null,
    updated_by: null,
    updated_at: null,
  });

  const [currentUserEmail, setCurrentUserEmail] = useState("");

  const [categoryType, setCategoryType] =
    useState<StickerCategoryType>("general");
  const [selectedCarId, setSelectedCarId] = useState("");
  const [customCategory, setCustomCategory] = useState("");
  const [stickerText, setStickerText] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [notes, setNotes] = useState("");

  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const userRole = useMemo(() => {
    return getUserRole(currentUserEmail);
  }, [currentUserEmail]);

  const isChiefMechanic = userRole === "chief_mechanic";

  const loadCars = useCallback(async () => {
    const { data, error } = await supabase
      .from("dashboard_cars")
      .select("id,name,colour,active,sort_order")
      .eq("active", true)
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true });

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    setCars((data ?? []) as DashboardCar[]);
  }, []);

  const loadStickerItems = useCallback(async () => {
    const { data, error } = await supabase
      .from("sticker_list_items")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    setItems((data ?? []) as StickerItem[]);
  }, []);

  const loadSettings = useCallback(async () => {
    const { data, error } = await supabase
      .from("sticker_list_settings")
      .select("*")
      .eq("id", SETTINGS_ID)
      .maybeSingle();

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    if (data) {
      setSettings(data as StickerListSettings);
      return;
    }

    setSettings({
      id: SETTINGS_ID,
      need_by: null,
      updated_by: null,
      updated_at: null,
    });
  }, []);

  useEffect(() => {
    async function initialisePage() {
      setLoading(true);
      setErrorMessage("");

      const { data, error } = await supabase.auth.getUser();

      if (error || !data.user) {
        router.replace("/login");
        return;
      }

      const email = data.user.email ?? "";
      setCurrentUserEmail(email);

      await loadCars();
      await loadStickerItems();
      await loadSettings();

      setLoading(false);
    }

    initialisePage();
  }, [loadCars, loadSettings, loadStickerItems, router]);

  useEffect(() => {
    const channel = supabase
      .channel("sticker-list-items-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sticker_list_items" },
        () => loadStickerItems(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadStickerItems]);

  useEffect(() => {
    const channel = supabase
      .channel("sticker-list-settings-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sticker_list_settings" },
        () => loadSettings(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadSettings]);

  const sortedCars = useMemo(() => {
    return [...cars].sort(
      (a, b) => (a.sort_order ?? a.id) - (b.sort_order ?? b.id) || a.id - b.id,
    );
  }, [cars]);

  useEffect(() => {
    if (categoryType === "car" && !selectedCarId && sortedCars.length > 0) {
      setSelectedCarId(String(sortedCars[0].id));
    }
  }, [categoryType, selectedCarId, sortedCars]);

  const groupedItems = useMemo<StickerGroup[]>(() => {
    const groupMap = new Map<string, StickerGroup>();

    items.forEach((item) => {
      const meta = getGroupMeta(item, sortedCars);

      if (!groupMap.has(meta.key)) {
        groupMap.set(meta.key, {
          ...meta,
          items: [],
        });
      }

      groupMap.get(meta.key)?.items.push(item);
    });

    return Array.from(groupMap.values())
      .map((group) => ({
        ...group,
        items: [...group.items].sort((a, b) => {
          if (a.done !== b.done) return a.done ? 1 : -1;

          return (
            new Date(a.created_at ?? "").getTime() -
            new Date(b.created_at ?? "").getTime()
          );
        }),
      }))
      .sort(
        (a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title),
      );
  }, [items, sortedCars]);

  const outstandingCount = useMemo(() => {
    return items.filter((item) => !item.done).length;
  }, [items]);

  const completedCount = useMemo(() => {
    return items.filter((item) => item.done).length;
  }, [items]);

  const backHref = useMemo(() => {
    if (userRole === "chief_mechanic" || userRole === "engineer") {
      return "/dashboard";
    }

    if (userRole === "number1_mechanic") {
      const assignedCar = getAssignedCar(currentUserEmail);
      return assignedCar ? `/car/${assignedCar}/job-list` : "/team-jobs";
    }

    return "/team-jobs";
  }, [currentUserEmail, userRole]);

  async function addStickerItem() {
    setMessage("");
    setErrorMessage("");

    const cleanText = stickerText.trim();
    const cleanNotes = notes.trim();
    const cleanCustomCategory = customCategory.trim();

    if (!cleanText) {
      setErrorMessage("Enter the sticker text first.");
      return;
    }

    if (categoryType === "car" && !selectedCarId) {
      setErrorMessage("Select a car for this sticker.");
      return;
    }

    if (categoryType === "custom" && !cleanCustomCategory) {
      setErrorMessage("Enter the custom category name.");
      return;
    }

    const payload = {
      category_type: categoryType,
      car_id: categoryType === "car" ? Number(selectedCarId) : null,
      custom_category: categoryType === "custom" ? cleanCustomCategory : null,
      sticker_text: cleanText,
      quantity: safeQuantity(quantity),
      notes: cleanNotes || null,
      done: false,
      created_by: currentUserEmail || null,
      updated_at: new Date().toISOString(),
    };

    setSaving(true);

    const { error } = await supabase.from("sticker_list_items").insert(payload);

    if (error) {
      setErrorMessage(error.message);
      setSaving(false);
      return;
    }

    setStickerText("");
    setQuantity("1");
    setNotes("");
    setMessage("Sticker added to the list.");

    await loadStickerItems();
    setSaving(false);
  }

  async function saveGeneralNeedByDate() {
    if (!isChiefMechanic) {
      setErrorMessage("Only the chief mechanic can set the general Need by date.");
      return;
    }

    setMessage("");
    setErrorMessage("");
    setSavingSettings(true);

    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from("sticker_list_settings")
      .upsert(
        {
          id: SETTINGS_ID,
          need_by: settings.need_by || null,
          updated_by: currentUserEmail || null,
          updated_at: now,
        },
        { onConflict: "id" },
      )
      .select("*")
      .single();

    if (error) {
      setErrorMessage(error.message);
      setSavingSettings(false);
      return;
    }

    setSettings(data as StickerListSettings);
    setMessage("General Need by date saved.");
    setSavingSettings(false);
  }

  async function clearNeedByDate() {
    if (!isChiefMechanic) {
      setErrorMessage("Only the chief mechanic can clear the general Need by date.");
      return;
    }

    setSettings((current) => ({ ...current, need_by: null }));

    const now = new Date().toISOString();

    setSavingSettings(true);
    setMessage("");
    setErrorMessage("");

    const { data, error } = await supabase
      .from("sticker_list_settings")
      .upsert(
        {
          id: SETTINGS_ID,
          need_by: null,
          updated_by: currentUserEmail || null,
          updated_at: now,
        },
        { onConflict: "id" },
      )
      .select("*")
      .single();

    if (error) {
      setErrorMessage(error.message);
      setSavingSettings(false);
      return;
    }

    setSettings(data as StickerListSettings);
    setMessage("General Need by date cleared.");
    setSavingSettings(false);
  }

  async function toggleDone(item: StickerItem) {
    setMessage("");
    setErrorMessage("");

    const { error } = await supabase
      .from("sticker_list_items")
      .update({
        done: !item.done,
        updated_at: new Date().toISOString(),
      })
      .eq("id", item.id);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    setItems((current) =>
      current.map((currentItem) =>
        currentItem.id === item.id
          ? {
              ...currentItem,
              done: !currentItem.done,
              updated_at: new Date().toISOString(),
            }
          : currentItem,
      ),
    );
  }

  function updateStickerText(item: StickerItem, value: string) {
    setItems((current) =>
      current.map((currentItem) =>
        currentItem.id === item.id
          ? { ...currentItem, sticker_text: value }
          : currentItem,
      ),
    );
  }

  function updateStickerQuantity(item: StickerItem, value: string) {
    const cleanQuantity = safeQuantity(value);

    setItems((current) =>
      current.map((currentItem) =>
        currentItem.id === item.id
          ? { ...currentItem, quantity: cleanQuantity }
          : currentItem,
      ),
    );
  }

  function updateStickerNotes(item: StickerItem, value: string) {
    setItems((current) =>
      current.map((currentItem) =>
        currentItem.id === item.id
          ? { ...currentItem, notes: value }
          : currentItem,
      ),
    );
  }

  async function saveStickerItem(item: StickerItem) {
    setMessage("");
    setErrorMessage("");

    const cleanText = item.sticker_text.trim();

    if (!cleanText) {
      setErrorMessage("Sticker text cannot be empty.");
      return;
    }

    const { error } = await supabase
      .from("sticker_list_items")
      .update({
        sticker_text: cleanText,
        quantity: Math.max(1, Math.round(Number(item.quantity) || 1)),
        notes: item.notes?.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", item.id);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    setMessage("Sticker item saved.");
    await loadStickerItems();
  }

  async function removeStickerItem(item: StickerItem) {
    const confirmed = window.confirm(
      `Remove "${item.sticker_text}" from the sticker list?`,
    );

    if (!confirmed) return;

    setMessage("");
    setErrorMessage("");
    setRemovingId(item.id);

    const { error } = await supabase
      .from("sticker_list_items")
      .delete()
      .eq("id", item.id);

    if (error) {
      setErrorMessage(error.message);
      setRemovingId(null);
      return;
    }

    setMessage("Sticker removed.");
    await loadStickerItems();
    setRemovingId(null);
  }

  async function clearAllStickers() {
    if (!isChiefMechanic) {
      setErrorMessage("Only the chief mechanic can clear all stickers.");
      return;
    }

    if (items.length === 0) {
      setMessage("There are no sticker items to clear.");
      return;
    }

    const confirmed = window.confirm(
      `Clear all ${items.length} sticker item(s)? This cannot be undone.`,
    );

    if (!confirmed) return;

    const doubleConfirmed = window.confirm(
      "Are you absolutely sure? This will delete the complete sticker list for every car/category.",
    );

    if (!doubleConfirmed) return;

    setClearingAll(true);
    setMessage("");
    setErrorMessage("");

    const { error } = await supabase
      .from("sticker_list_items")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");

    if (error) {
      setErrorMessage(error.message);
      setClearingAll(false);
      return;
    }

    setItems([]);
    setMessage("All sticker items cleared.");
    setClearingAll(false);
  }

  function printStickerList() {
    window.print();
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0d0f12] text-zinc-400">
        Loading sticker list...
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0d0f12] p-6 text-zinc-100">
      <style>{`
        @media print {
          body {
            background: white !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }

          .no-print {
            display: none !important;
          }

          .print-area {
            background: white !important;
            color: black !important;
            border: none !important;
            box-shadow: none !important;
          }

          .print-card {
            break-inside: avoid;
            page-break-inside: avoid;
            background: white !important;
            color: black !important;
            box-shadow: none !important;
          }

          .print-car-card {
            background: white !important;
            color: black !important;
            border-width: 3px !important;
          }

          .print-colour-strip {
            display: inline-block !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }

          .print-table-head {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }

          .print-logo-wrap {
            display: flex !important;
            align-items: flex-start !important;
            gap: 22px !important;
          }

          .print-logo {
            width: 170px !important;
            height: auto !important;
            object-fit: contain !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }

          .print-need-by {
            display: inline-flex !important;
            flex-direction: column !important;
            gap: 6px !important;
            border-width: 3px !important;
            padding: 16px 22px !important;
            margin-top: 18px !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }

          .print-need-by-label {
            font-size: 13px !important;
            line-height: 16px !important;
            font-weight: 800 !important;
            letter-spacing: 0.28em !important;
            text-transform: uppercase !important;
          }

          .print-need-by-date {
            font-size: 42px !important;
            line-height: 46px !important;
            font-weight: 900 !important;
            letter-spacing: -0.03em !important;
          }

          .print-text {
            color: black !important;
          }

          .print-muted {
            color: #52525b !important;
          }

          input,
          textarea,
          button,
          select {
            display: none !important;
          }

          .screen-only {
            display: none !important;
          }

          .print-only {
            display: block !important;
          }
        }

        @media screen {
          .print-only {
            display: none !important;
          }
        }
      `}</style>

      <header className="no-print mb-8 rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-5">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-red-400">
              Rodin Motorsport
            </p>

            <h1 className="mt-3 text-4xl font-semibold tracking-tight">
              Sticker List
            </h1>

            <p className="mt-2 max-w-2xl text-sm text-zinc-400">
              Add sticker requirements by car, general jobs or custom category.
              Car categories use the same colour settings as the chief mechanic
              dashboard. The chief mechanic controls the one overall Need by
              date for the whole sticker list.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link
              href={backHref}
              className="rounded-xl border border-zinc-700 bg-[#1b2026] px-5 py-3 text-sm font-semibold text-zinc-200 transition hover:border-red-500 hover:bg-[#222832]"
            >
              Back
            </Link>

            <button
              type="button"
              onClick={printStickerList}
              className="rounded-xl border border-red-600 bg-red-700 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-red-950/30 transition hover:border-red-400 hover:bg-red-600"
            >
              Save as PDF
            </button>

            {isChiefMechanic && (
              <button
                type="button"
                onClick={clearAllStickers}
                disabled={clearingAll || items.length === 0}
                className="rounded-xl border border-red-900/70 bg-red-950/30 px-5 py-3 text-sm font-semibold text-red-200 transition hover:border-red-500 hover:bg-red-950/50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {clearingAll ? "Clearing..." : "Clear All Stickers"}
              </button>
            )}

            <LogoutButton />
          </div>
        </div>
      </header>

      {message && (
        <div className="no-print mb-6 rounded-2xl border border-green-800 bg-green-950/20 p-4 text-sm text-green-300">
          {message}
        </div>
      )}

      {errorMessage && (
        <div className="no-print mb-6 rounded-2xl border border-red-900 bg-red-950/40 p-4 text-sm text-red-200">
          {errorMessage}
        </div>
      )}

      <section className="no-print mb-8 rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-red-400">
              General Deadline
            </p>

            <h2 className="mt-3 text-2xl font-semibold text-zinc-100">
              Need by date
            </h2>

            <p className="mt-2 max-w-2xl text-sm text-zinc-400">
              This is one date for the whole sticker list, not a date per
              sticker. It appears on the printed/PDF list.
            </p>
          </div>

          <div className="rounded-2xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-sm text-zinc-300">
            Current:{" "}
            <span className="font-semibold text-zinc-100">
              {niceDate(settings.need_by)}
            </span>
          </div>
        </div>

        {isChiefMechanic ? (
          <div className="grid gap-3 md:grid-cols-[220px_auto_auto_1fr]">
            <input
              type="date"
              value={settings.need_by ?? ""}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  need_by: event.target.value || null,
                }))
              }
              className="rounded-xl border border-zinc-700 bg-[#111418] px-4 py-3 text-sm text-zinc-100 outline-none focus:border-red-500"
            />

            <button
              type="button"
              onClick={saveGeneralNeedByDate}
              disabled={savingSettings}
              className="rounded-xl bg-red-700 px-5 py-3 text-sm font-semibold text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {savingSettings ? "Saving..." : "Save Date"}
            </button>

            <button
              type="button"
              onClick={clearNeedByDate}
              disabled={savingSettings || !settings.need_by}
              className="rounded-xl border border-zinc-700 px-5 py-3 text-sm font-semibold text-zinc-300 hover:border-red-500 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Clear Date
            </button>

            <p className="flex items-center text-sm text-zinc-500">
              Last updated {niceDateTime(settings.updated_at)}
              {settings.updated_by ? ` by ${settings.updated_by}` : ""}
            </p>
          </div>
        ) : (
          <div className="rounded-2xl border border-yellow-800 bg-yellow-950/20 p-4 text-sm text-yellow-200">
            Only the chief mechanic can change the general Need by date.
          </div>
        )}
      </section>

      <section className="no-print mb-8 rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
        <div className="mb-5">
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-red-400">
            Add Sticker
          </p>

          <h2 className="mt-3 text-2xl font-semibold text-zinc-100">
            New sticker item
          </h2>
        </div>

        <div className="grid gap-4 xl:grid-cols-[220px_240px_1fr_120px_1fr_auto]">
          <label>
            <span className="text-xs uppercase tracking-[0.22em] text-zinc-500">
              Category
            </span>

            <select
              value={categoryType}
              onChange={(event) =>
                setCategoryType(event.target.value as StickerCategoryType)
              }
              className="mt-2 w-full rounded-xl border border-zinc-700 bg-[#111418] px-4 py-3 text-sm text-zinc-100 outline-none focus:border-red-500"
            >
              <option value="general">General</option>
              <option value="car">Car</option>
              <option value="custom">Custom</option>
            </select>
          </label>

          {categoryType === "car" ? (
            <label>
              <span className="text-xs uppercase tracking-[0.22em] text-zinc-500">
                Car
              </span>

              <select
                value={selectedCarId}
                onChange={(event) => setSelectedCarId(event.target.value)}
                className="mt-2 w-full rounded-xl border border-zinc-700 bg-[#111418] px-4 py-3 text-sm text-zinc-100 outline-none focus:border-red-500"
              >
                {sortedCars.length === 0 ? (
                  <option value="">No active cars</option>
                ) : (
                  sortedCars.map((car) => (
                    <option key={car.id} value={car.id}>
                      {carDisplayName(car)}
                    </option>
                  ))
                )}
              </select>
            </label>
          ) : categoryType === "custom" ? (
            <label>
              <span className="text-xs uppercase tracking-[0.22em] text-zinc-500">
                Custom category
              </span>

              <input
                value={customCategory}
                onChange={(event) => setCustomCategory(event.target.value)}
                placeholder="e.g. Pit board"
                className="mt-2 w-full rounded-xl border border-zinc-700 bg-[#111418] px-4 py-3 text-sm text-zinc-100 outline-none focus:border-red-500"
              />
            </label>
          ) : (
            <div className="rounded-xl border border-zinc-800 bg-[#0d0f12] px-4 py-3">
              <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">
                Group
              </p>
              <p className="mt-2 text-sm font-semibold text-zinc-200">
                General
              </p>
            </div>
          )}

          <label>
            <span className="text-xs uppercase tracking-[0.22em] text-zinc-500">
              Sticker
            </span>

            <input
              value={stickerText}
              onChange={(event) => setStickerText(event.target.value)}
              placeholder="e.g. Driver name decal"
              className="mt-2 w-full rounded-xl border border-zinc-700 bg-[#111418] px-4 py-3 text-sm text-zinc-100 outline-none focus:border-red-500"
            />
          </label>

          <label>
            <span className="text-xs uppercase tracking-[0.22em] text-zinc-500">
              Qty
            </span>

            <input
              type="number"
              min={1}
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              className="mt-2 w-full rounded-xl border border-zinc-700 bg-[#111418] px-4 py-3 text-sm text-zinc-100 outline-none focus:border-red-500"
            />
          </label>

          <label>
            <span className="text-xs uppercase tracking-[0.22em] text-zinc-500">
              Notes
            </span>

            <input
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Optional"
              className="mt-2 w-full rounded-xl border border-zinc-700 bg-[#111418] px-4 py-3 text-sm text-zinc-100 outline-none focus:border-red-500"
            />
          </label>

          <div className="flex items-end">
            <button
              type="button"
              onClick={addStickerItem}
              disabled={saving}
              className="w-full rounded-xl bg-red-700 px-5 py-3 text-sm font-semibold text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Adding..." : "Add"}
            </button>
          </div>
        </div>
      </section>

      <section className="print-area rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
        <div className="mb-8 flex flex-wrap items-start justify-between gap-5">
          <div className="print-logo-wrap">
            <Image
              src="/gb3-logo.png"
              alt="GB3 Championship logo"
              width={170}
              height={170}
              priority
              className="print-logo rounded-xl object-contain"
            />

            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-red-400 print-muted">
                Rodin Motorsport
              </p>

              <h2 className="mt-3 text-4xl font-semibold text-zinc-100 print-text">
                Sticker List
              </h2>

              <p className="mt-2 text-sm text-zinc-400 print-muted">
                Generated {niceDateTime(new Date().toISOString())}
              </p>

              <div className="print-need-by rounded-2xl border border-red-700 bg-red-950/20 text-red-200 print-card print-text">
                <span className="print-need-by-label text-red-300">
                  Need by
                </span>

                <span className="print-need-by-date">
                  {niceDate(settings.need_by)}
                </span>
              </div>
            </div>
          </div>

          <div className="grid gap-2 text-sm">
            <div className="rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 print-card">
              <span className="font-semibold text-zinc-100 print-text">
                {items.length}
              </span>{" "}
              <span className="text-zinc-500 print-muted">total items</span>
            </div>

            <div className="rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 print-card">
              <span className="font-semibold text-zinc-100 print-text">
                {outstandingCount}
              </span>{" "}
              <span className="text-zinc-500 print-muted">outstanding</span>
              {" · "}
              <span className="font-semibold text-zinc-100 print-text">
                {completedCount}
              </span>{" "}
              <span className="text-zinc-500 print-muted">complete</span>
            </div>
          </div>
        </div>

        {groupedItems.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-700 bg-[#0d0f12] p-10 text-center text-sm text-zinc-500 print-card">
            No sticker items have been added yet.
          </div>
        ) : (
          <div className="grid gap-5">
            {groupedItems.map((group) => (
              <div
                key={group.key}
                className="print-card print-car-card rounded-2xl border bg-[#0d0f12] p-5"
                style={{
                  borderColor: group.colour,
                  boxShadow: `0 0 0 1px ${group.colour}55`,
                }}
              >
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span
                      className="print-colour-strip h-12 w-2 rounded-full"
                      style={{ backgroundColor: group.colour }}
                    />

                    <div>
                      <h3
                        className="text-2xl font-semibold text-zinc-100 print-text"
                        style={{ color: group.colour }}
                      >
                        {group.title}
                      </h3>

                      <p className="text-xs uppercase tracking-[0.22em] text-zinc-500 print-muted">
                        {group.subtitle}
                      </p>
                    </div>
                  </div>

                  <div
                    className="rounded-full border px-3 py-1 text-xs font-semibold text-zinc-300 print-card print-text"
                    style={{
                      borderColor: group.colour,
                      backgroundColor: `${group.colour}22`,
                    }}
                  >
                    {group.items.length} item
                    {group.items.length === 1 ? "" : "s"}
                  </div>
                </div>

                <div className="overflow-x-auto rounded-xl border border-zinc-800">
                  <table className="w-full min-w-[860px] text-sm">
                    <thead
                      className="print-table-head text-zinc-100"
                      style={{ backgroundColor: group.colour }}
                    >
                      <tr>
                        <th className="w-[90px] px-4 py-3 text-left">
                          Qty
                        </th>
                        <th className="px-4 py-3 text-left">Sticker</th>
                        <th className="px-4 py-3 text-left">Notes</th>
                        <th className="w-[150px] px-4 py-3 text-left">
                          Status
                        </th>
                        <th className="screen-only w-[240px] px-4 py-3 text-left">
                          Actions
                        </th>
                      </tr>
                    </thead>

                    <tbody>
                      {group.items.map((item) => (
                        <tr
                          key={item.id}
                          className="border-t border-zinc-800 align-top"
                        >
                          <td className="px-4 py-3">
                            <span className="print-only font-semibold print-text">
                              {item.quantity}
                            </span>

                            <input
                              type="number"
                              min={1}
                              value={item.quantity}
                              onChange={(event) =>
                                updateStickerQuantity(item, event.target.value)
                              }
                              className="screen-only w-20 rounded-lg border border-zinc-700 bg-[#111418] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-red-500"
                            />
                          </td>

                          <td className="px-4 py-3">
                            <span className="print-only font-semibold print-text">
                              {item.sticker_text}
                            </span>

                            <input
                              value={item.sticker_text}
                              onChange={(event) =>
                                updateStickerText(item, event.target.value)
                              }
                              className={`screen-only w-full rounded-lg border border-zinc-700 bg-[#111418] px-3 py-2 text-sm outline-none focus:border-red-500 ${
                                item.done ? "text-zinc-500" : "text-zinc-100"
                              }`}
                            />

                            <p className="screen-only mt-1 text-xs text-zinc-600">
                              Added {niceDateTime(item.created_at)}
                              {item.created_by ? ` by ${item.created_by}` : ""}
                            </p>
                          </td>

                          <td className="px-4 py-3">
                            <span className="print-only print-text">
                              {item.notes || "—"}
                            </span>

                            <input
                              value={item.notes ?? ""}
                              onChange={(event) =>
                                updateStickerNotes(item, event.target.value)
                              }
                              placeholder="Optional notes"
                              className="screen-only w-full rounded-lg border border-zinc-700 bg-[#111418] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-red-500"
                            />
                          </td>

                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${
                                item.done
                                  ? "border-green-800 bg-green-950/30 text-green-300"
                                  : "border-zinc-700 bg-[#111418] text-zinc-300"
                              }`}
                            >
                              {item.done ? "Completed" : "Open"}
                            </span>
                          </td>

                          <td className="screen-only px-4 py-3">
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => toggleDone(item)}
                                className="rounded-lg border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-300 hover:border-green-600 hover:text-green-300"
                              >
                                {item.done ? "Mark Open" : "Complete"}
                              </button>

                              <button
                                type="button"
                                onClick={() => saveStickerItem(item)}
                                className="rounded-lg bg-red-700 px-3 py-2 text-xs font-semibold text-white hover:bg-red-600"
                              >
                                Save
                              </button>

                              <button
                                type="button"
                                onClick={() => removeStickerItem(item)}
                                disabled={removingId === item.id}
                                className="rounded-lg border border-red-900/70 px-3 py-2 text-xs font-semibold text-red-300 hover:bg-red-950/40 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {removingId === item.id
                                  ? "Removing..."
                                  : "Remove"}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
