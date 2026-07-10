"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

type LegalityStatus = "legal" | "illegal";
type LegalitySide = "LH" | "RH" | "Centre";

type LegalityPoint = {
  key: string;
  label: string;
  shortLabel: string;
  side: LegalitySide;
  position: string;
  x: number;
  y: number;
  sort_order: number;
  active: boolean;
  heightNotationEnabled: boolean;
};

type LegalityCheckRecord = {
  id: string;
  car_id: number;
  driver: string | null;
  circuit: string | null;
  engineer_name: string | null;
  engineer_email: string | null;
  check_date: string | null;
  corner_weight_fl: number | string | null;
  corner_weight_fr: number | string | null;
  corner_weight_rl: number | string | null;
  corner_weight_rr: number | string | null;
  corner_weight_total: number | string | null;
  camber_fl: number | string | null;
  camber_fr: number | string | null;
  camber_rl: number | string | null;
  camber_rr: number | string | null;
  main_front_wing_shim_lh: string | null;
  main_front_wing_shim_rh: string | null;
  spare_front_wing_shim_lh: string | null;
  spare_front_wing_shim_rh: string | null;
  sent_to_engineer_at: string | null;
  created_at: string | null;
};

type LegalityCheckItemRecord = {
  id: string;
  legality_check_id: string;
  item_key: string;
  item_name: string;
  item_side: string | null;
  item_position: string | null;
  status: LegalityStatus;
  illegal_note: string | null;
  height_notation: number | string | null;
};

type LegalityLayoutPointRecord = {
  point_key: string;
  label: string;
  short_label: string;
  side: LegalitySide;
  position: string | null;
  x_percent: number | string | null;
  y_percent: number | string | null;
  sort_order: number | null;
  active: boolean | null;
  height_notation_enabled: boolean | null;
};

const DEFAULT_LEGALITY_POINTS: LegalityPoint[] = [
  { key: "spare_fwep_lh", label: "Spare Front Wing Endplate LH", shortLabel: "LFWEP", side: "LH", position: "Spare front wing left endplate", x: 14, y: 58, sort_order: 1, active: true, heightNotationEnabled: true },
  { key: "spare_fw", label: "Spare Front Wing", shortLabel: "FW", side: "Centre", position: "Spare front wing main plane", x: 50, y: 28, sort_order: 2, active: true, heightNotationEnabled: false },
  { key: "spare_fwep_rh", label: "Spare Front Wing Endplate RH", shortLabel: "RFWEP", side: "RH", position: "Spare front wing right endplate", x: 86, y: 58, sort_order: 3, active: true, heightNotationEnabled: true },
  { key: "fw_lh", label: "FW LH", shortLabel: "FW", side: "LH", position: "Front wing main plane / endplate area", x: 13, y: 18, sort_order: 10, active: true, heightNotationEnabled: false },
  { key: "fwep_lh", label: "FWEP LH", shortLabel: "FWEP", side: "LH", position: "Front wing endplate", x: 13, y: 26, sort_order: 20, active: true, heightNotationEnabled: true },
  { key: "front_lh", label: "FRONT LH", shortLabel: "FRONT", side: "LH", position: "Front floor / splitter legality point", x: 13, y: 43, sort_order: 30, active: true, heightNotationEnabled: false },
  { key: "mid_lh", label: "MID LH", shortLabel: "MID", side: "LH", position: "Mid floor legality point", x: 13, y: 58, sort_order: 40, active: true, heightNotationEnabled: false },
  { key: "rear_lh", label: "REAR LH", shortLabel: "REAR", side: "LH", position: "Rear floor legality point", x: 13, y: 74, sort_order: 50, active: true, heightNotationEnabled: false },
  { key: "diffuser_lh", label: "DIFFUSER LH", shortLabel: "DIFFUSER", side: "LH", position: "Diffuser legality point", x: 14, y: 85, sort_order: 60, active: true, heightNotationEnabled: false },
  { key: "fw_rh", label: "FW RH", shortLabel: "FW", side: "RH", position: "Front wing main plane / endplate area", x: 87, y: 18, sort_order: 70, active: true, heightNotationEnabled: false },
  { key: "fwep_rh", label: "FWEP RH", shortLabel: "FWEP", side: "RH", position: "Front wing endplate", x: 87, y: 26, sort_order: 80, active: true, heightNotationEnabled: true },
  { key: "front_rh", label: "FRONT RH", shortLabel: "FRONT", side: "RH", position: "Front floor / splitter legality point", x: 87, y: 43, sort_order: 90, active: true, heightNotationEnabled: false },
  { key: "mid_rh", label: "MID RH", shortLabel: "MID", side: "RH", position: "Mid floor legality point", x: 87, y: 58, sort_order: 100, active: true, heightNotationEnabled: false },
  { key: "rear_rh", label: "REAR RH", shortLabel: "REAR", side: "RH", position: "Rear floor legality point", x: 87, y: 74, sort_order: 110, active: true, heightNotationEnabled: false },
  { key: "diffuser_rh", label: "DIFFUSER RH", shortLabel: "DIFFUSER", side: "RH", position: "Diffuser legality point", x: 86, y: 85, sort_order: 120, active: true, heightNotationEnabled: false },
  { key: "rw_gap", label: "RW GAP", shortLabel: "RW GAP", side: "Centre", position: "Rear wing gap measurement", x: 50, y: 95, sort_order: 130, active: true, heightNotationEnabled: false },
];

function niceDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function niceDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function valueText(value: string | number | null | undefined, suffix = "") {
  if (value === null || value === undefined || value === "") return "—";
  return `${value}${suffix}`;
}

function heightText(item: LegalityCheckItemRecord) {
  if (item.height_notation === null || item.height_notation === undefined || item.height_notation === "") return "—";
  return `${item.height_notation}/5`;
}

function isSpareWingPointKey(key: string) {
  return key.startsWith("spare_");
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 50;
  return Math.min(98, Math.max(2, Math.round(value * 10) / 10));
}

function normaliseLayoutPoint(point: LegalityLayoutPointRecord, fallbackIndex: number): LegalityPoint {
  return {
    key: point.point_key,
    label: point.label || point.point_key,
    shortLabel: point.short_label || point.label || point.point_key,
    side: point.side || "Centre",
    position: point.position || "",
    x: clampPercent(Number(point.x_percent ?? 50)),
    y: clampPercent(Number(point.y_percent ?? 50)),
    sort_order: point.sort_order ?? fallbackIndex + 1,
    active: point.active ?? true,
    heightNotationEnabled: point.height_notation_enabled ?? false,
  };
}

function mergeWithDefaultLayoutPoints(points: LegalityPoint[]) {
  const existingKeys = new Set(points.map((point) => point.key));
  const missingDefaultPoints = DEFAULT_LEGALITY_POINTS.filter((point) => !existingKeys.has(point.key));
  return [...points, ...missingDefaultPoints]
    .filter((point) => point.active)
    .sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label));
}

function SummaryCard({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "green" | "red" }) {
  const toneClass = tone === "green" ? "text-green-200" : tone === "red" ? "text-red-200" : "text-zinc-100";
  return (
    <div className="rounded-2xl border border-zinc-800 bg-[#0d0f12] p-4">
      <div className="text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500">{label}</div>
      <div className={`mt-2 text-lg font-bold ${toneClass}`}>{value}</div>
    </div>
  );
}

function MeasurementBlock({ title, unit, values }: { title: string; unit: string; values: Array<[string, string]> }) {
  return (
    <section className="rounded-3xl border border-zinc-800 bg-[#14181d] p-5 shadow-xl shadow-black/20">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-sm font-black uppercase tracking-[0.28em] text-red-400">{title}</h2>
        <span className="rounded-full border border-zinc-700 bg-[#0d0f12] px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">{unit}</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {values.map(([label, value]) => (
          <div key={`${title}-${label}`} className="rounded-2xl border border-zinc-800 bg-[#0d0f12] p-4">
            <div className="text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500">{label}</div>
            <div className="mt-2 text-2xl font-black text-white">{value}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function OverviewCanvas({
  title,
  subtitle,
  imageSrc,
  points,
  itemsByKey,
  aspectClass,
}: {
  title: string;
  subtitle: string;
  imageSrc: string;
  points: LegalityPoint[];
  itemsByKey: Map<string, LegalityCheckItemRecord>;
  aspectClass: string;
}) {
  return (
    <section className="rounded-3xl border border-zinc-800 bg-[#14181d] p-5 shadow-xl shadow-black/20">
      <div className="mb-4">
        <h2 className="text-sm font-black uppercase tracking-[0.28em] text-red-400">{title}</h2>
        <p className="mt-2 text-xs leading-5 text-zinc-400">{subtitle}</p>
      </div>

      <div className={`relative mx-auto ${aspectClass} w-full overflow-visible rounded-[2rem] border border-zinc-700 bg-[#030507] shadow-inner shadow-black/40`}>
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgba(82,82,91,0.34)_1px,transparent_1px),linear-gradient(to_bottom,rgba(82,82,91,0.34)_1px,transparent_1px)] bg-[size:28px_28px]" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(239,68,68,0.12),transparent_58%)]" />
        <img src={imageSrc} alt="" className="pointer-events-none absolute inset-[5%] h-[90%] w-[90%] object-contain opacity-95 [filter:contrast(1.1)_drop-shadow(0_0_10px_rgba(255,255,255,0.10))]" />

        {points.map((point) => {
          const item = itemsByKey.get(point.key);
          const isIllegal = item?.status === "illegal";
          const statusClasses = isIllegal
            ? "border-red-500 bg-red-950/85 text-red-100 shadow-red-950/40"
            : "border-green-500 bg-green-950/75 text-green-100 shadow-green-950/30";

          return (
            <div key={point.key} style={{ left: `${point.x}%`, top: `${point.y}%` }} className="absolute z-20 -translate-x-1/2 -translate-y-1/2">
              <div className={`min-w-[116px] rounded-xl border px-3 py-2 text-left shadow-lg backdrop-blur-sm ${statusClasses}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-black uppercase tracking-[0.16em] text-zinc-100">{point.shortLabel}</span>
                  <span className={`rounded-full border px-2 py-1 text-[8px] font-black uppercase tracking-[0.14em] ${isIllegal ? "border-red-300 bg-red-600 text-white" : "border-green-300 bg-green-600 text-white"}`}>
                    {isIllegal ? "Red" : "Legal"}
                  </span>
                </div>
                {point.heightNotationEnabled && item?.status === "legal" && (
                  <div className="mt-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-300">Height {heightText(item)}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ItemTable({ title, items, points }: { title: string; items: LegalityCheckItemRecord[]; points: LegalityPoint[] }) {
  const pointOrder = new Map(points.map((point) => [point.key, point.sort_order]));
  const sorted = [...items].sort((a, b) => (pointOrder.get(a.item_key) ?? 999) - (pointOrder.get(b.item_key) ?? 999));

  return (
    <section className="rounded-3xl border border-zinc-800 bg-[#14181d] p-5 shadow-xl shadow-black/20">
      <h2 className="text-sm font-black uppercase tracking-[0.28em] text-red-400">{title}</h2>
      <div className="mt-4 overflow-x-auto rounded-2xl border border-zinc-800">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-zinc-950 text-zinc-400">
            <tr>
              <th className="px-4 py-3 text-left">Point</th>
              <th className="px-4 py-3 text-left">Side</th>
              <th className="px-4 py-3 text-left">Position</th>
              <th className="px-4 py-3 text-left">Height</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-left">Note</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((item) => {
              const isIllegal = item.status === "illegal";
              return (
                <tr key={item.id} className={`border-t border-zinc-800 ${isIllegal ? "bg-red-950/30" : "bg-[#0d0f12]"}`}>
                  <td className="px-4 py-3 font-semibold text-zinc-100">{item.item_name}</td>
                  <td className="px-4 py-3 text-zinc-300">{item.item_side || "—"}</td>
                  <td className="px-4 py-3 text-zinc-400">{item.item_position || "—"}</td>
                  <td className="px-4 py-3 text-zinc-300">{heightText(item)}</td>
                  <td className={`px-4 py-3 font-black uppercase ${isIllegal ? "text-red-300" : "text-green-300"}`}>{item.status}</td>
                  <td className="px-4 py-3 text-zinc-300">{item.illegal_note || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function SurfaceTableReportPage() {
  const params = useParams();
  const checkId = Array.isArray(params.checkId) ? params.checkId[0] : params.checkId;

  const [check, setCheck] = useState<LegalityCheckRecord | null>(null);
  const [items, setItems] = useState<LegalityCheckItemRecord[]>([]);
  const [layoutPoints, setLayoutPoints] = useState<LegalityPoint[]>(DEFAULT_LEGALITY_POINTS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadReport() {
      if (!checkId || typeof checkId !== "string") {
        setError("No surface table check ID was found in the link.");
        setLoading(false);
        return;
      }

      setLoading(true);
      setError("");

      try {
        const [{ data: checkData, error: checkError }, { data: itemData, error: itemError }, { data: layoutData }] = await Promise.all([
          supabase.from("legality_checks").select("*").eq("id", checkId).limit(1).maybeSingle(),
          supabase.from("legality_check_items").select("*").eq("legality_check_id", checkId),
          supabase.from("legality_layout_points").select("point_key, label, short_label, side, position, x_percent, y_percent, sort_order, active, height_notation_enabled").eq("active", true),
        ]);

        if (checkError) throw new Error(checkError.message);
        if (itemError) throw new Error(itemError.message);
        if (!checkData) throw new Error("Surface table check not found.");

        const points = Array.isArray(layoutData)
          ? mergeWithDefaultLayoutPoints((layoutData as LegalityLayoutPointRecord[]).map(normaliseLayoutPoint))
          : DEFAULT_LEGALITY_POINTS;

        setCheck(checkData as LegalityCheckRecord);
        setItems((itemData ?? []) as LegalityCheckItemRecord[]);
        setLayoutPoints(points);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Could not load the surface table report.");
      } finally {
        setLoading(false);
      }
    }

    loadReport();
  }, [checkId]);

  const itemsByKey = useMemo(() => new Map(items.map((item) => [item.item_key, item])), [items]);
  const spareItems = useMemo(() => items.filter((item) => isSpareWingPointKey(item.item_key)), [items]);
  const carItems = useMemo(() => items.filter((item) => !isSpareWingPointKey(item.item_key)), [items]);
  const sparePoints = useMemo(() => layoutPoints.filter((point) => isSpareWingPointKey(point.key)), [layoutPoints]);
  const carPoints = useMemo(() => layoutPoints.filter((point) => !isSpareWingPointKey(point.key)), [layoutPoints]);
  const illegalItems = useMemo(() => items.filter((item) => item.status === "illegal"), [items]);
  const summary = items.length === 0 ? "No items saved" : illegalItems.length === 0 ? `${items.length}/${items.length} legal` : `${illegalItems.length} illegal · ${items.length - illegalItems.length} legal`;

  if (loading) {
    return <main className="flex min-h-screen items-center justify-center bg-[#0d0f12] text-zinc-400">Loading surface table report...</main>;
  }

  if (error || !check) {
    return (
      <main className="min-h-screen bg-[#0d0f12] p-6 text-zinc-100">
        <div className="mx-auto max-w-3xl rounded-3xl border border-red-900 bg-red-950/30 p-6 text-red-100">
          <h1 className="text-2xl font-bold">Could not open report</h1>
          <p className="mt-3 text-sm leading-6">{error || "Surface table check not found."}</p>
          <Link href="/legality" className="mt-5 inline-block rounded-xl bg-red-700 px-4 py-2 text-sm font-bold text-white hover:bg-red-600">Back to Surface Table Checks</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0d0f12] p-6 text-zinc-100 print:bg-white print:p-0">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="overflow-hidden rounded-[2rem] border border-zinc-800 bg-[#111418] shadow-2xl shadow-black/30">
          <div className="relative isolate overflow-hidden bg-gradient-to-br from-black via-[#101317] to-[#171114] p-8">
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[#0d0f12]/70 via-[#111418]/70 to-[#0d0f12]/70" />
            <div className="relative flex flex-wrap items-start justify-between gap-6">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.42em] text-red-400">Rodin Motorsport</p>
                <h1 className="mt-4 text-4xl font-bold tracking-tight text-white md:text-5xl">Surface Table Checks</h1>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-400">Browser report link generated from the completed mechanic sheet.</p>
              </div>
              <div className={`rounded-2xl border px-5 py-4 text-right ${illegalItems.length ? "border-red-700 bg-red-950/50 text-red-100" : "border-green-700 bg-green-950/35 text-green-100"}`}>
                <div className="text-xs font-black uppercase tracking-[0.24em] opacity-70">Summary</div>
                <div className="mt-2 text-2xl font-black">{summary}</div>
              </div>
            </div>
          </div>
        </header>

        <section className="grid gap-4 md:grid-cols-5">
          <SummaryCard label="Date" value={niceDate(check.check_date)} />
          <SummaryCard label="Circuit" value={check.circuit || "—"} />
          <SummaryCard label="Car" value={`Car ${check.car_id}`} />
          <SummaryCard label="Driver" value={check.driver || "—"} />
          <SummaryCard label="Engineer" value={check.engineer_name || "—"} />
        </section>

        <section className="grid gap-6 xl:grid-cols-[430px_1fr]">
          <div className="space-y-6">
            <MeasurementBlock
              title="Corner Weight Measurements"
              unit="kg"
              values={[
                ["FL", valueText(check.corner_weight_fl, " kg")],
                ["FR", valueText(check.corner_weight_fr, " kg")],
                ["RL", valueText(check.corner_weight_rl, " kg")],
                ["RR", valueText(check.corner_weight_rr, " kg")],
                ["Total", valueText(check.corner_weight_total, " kg")],
              ]}
            />
            <MeasurementBlock
              title="Camber Measurements"
              unit="deg"
              values={[
                ["FL", valueText(check.camber_fl, "°")],
                ["FR", valueText(check.camber_fr, "°")],
                ["RL", valueText(check.camber_rl, "°")],
                ["RR", valueText(check.camber_rr, "°")],
              ]}
            />
            <MeasurementBlock
              title="Front Wing Shims"
              unit="shims"
              values={[
                ["Main LH", valueText(check.main_front_wing_shim_lh)],
                ["Main RH", valueText(check.main_front_wing_shim_rh)],
                ["Spare LH", valueText(check.spare_front_wing_shim_lh)],
                ["Spare RH", valueText(check.spare_front_wing_shim_rh)],
              ]}
            />
          </div>

          <div className="space-y-6">
            <OverviewCanvas title="Spare Front Wing Overview" subtitle="Same visual reference used on the mechanic input sheet." imageSrc="/legality-spare-front-wing.png" points={sparePoints} itemsByKey={itemsByKey} aspectClass="aspect-[12/7] min-h-[240px]" />
            <OverviewCanvas title="Car Surface Overview" subtitle="Surface table status points shown over the top-down car view." imageSrc="/legality-car-overview-inverted.png" points={carPoints} itemsByKey={itemsByKey} aspectClass="aspect-[3/4] min-h-[620px] max-w-[640px]" />
          </div>
        </section>

        {illegalItems.length > 0 && (
          <section className="rounded-3xl border border-red-900 bg-red-950/30 p-5 text-red-100">
            <h2 className="text-sm font-black uppercase tracking-[0.28em] text-red-300">Illegal Notes</h2>
            <div className="mt-4 grid gap-3">
              {illegalItems.map((item) => (
                <div key={`note-${item.id}`} className="rounded-2xl border border-red-800 bg-red-950/40 p-4">
                  <div className="font-bold">{item.item_name}</div>
                  <div className="mt-1 text-sm text-red-100/80">{item.illegal_note || "No note recorded"}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="grid gap-6 xl:grid-cols-2">
          <ItemTable title="Spare Front Wing Elements" items={spareItems} points={layoutPoints} />
          <ItemTable title="Total Car Surface Elements" items={carItems} points={layoutPoints} />
        </section>

        <footer className="pb-8 text-xs text-zinc-500">
          Report opened from link · Check ID {check.id} · Sent {niceDateTime(check.sent_to_engineer_at)}
        </footer>
      </div>
    </main>
  );
}

