"use client";

import { useEffect, useId, useRef, useState } from "react";
import { GEAR_RATIOS, gearRatioLabel, type GearRatioType } from "@/lib/gearRatios";
import { useGearRatio } from "./GearRatioProvider";

export default function DashboardGearRatioSelector() {
  const { carId, config, loading, error, canChange, save, refresh } = useGearRatio();
  const [pending, setPending] = useState<{
    ratio: GearRatioType;
    previous: GearRatioType | null;
    version: number;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const selectId = useId();
  const titleId = useId();
  const descriptionId = useId();
  const stale = pending !== null && pending.version !== (config?.version ?? 0);

  useEffect(() => {
    if (pending) dialog.current?.showModal();
    else dialog.current?.close();
  }, [pending]);

  async function confirmChange() {
    if (!pending || saving || stale || error || !canChange) return;
    if (pending.ratio === config?.selected_ratio) {
      setPending(null);
      return;
    }
    setSaving(true);
    setSaveError("");
    try {
      await save(pending.ratio, pending.version);
      setPending(null);
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : "Unable to save gear ratio.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-w-0 rounded-2xl border border-zinc-800 bg-[#0d0f12] p-4">
      <label htmlFor={selectId} className="block text-xs uppercase tracking-[0.22em] text-zinc-500">
        Gear Ratio
      </label>
      <select id={selectId} aria-label={`Gear ratio for Car ${carId}`}
        value={config?.selected_ratio ?? ""}
        disabled={loading || !!error || !canChange || saving || pending !== null}
        onChange={(event) => {
          const ratio = event.target.value as GearRatioType;
          if (!canChange || !Object.hasOwn(GEAR_RATIOS, ratio) || ratio === config?.selected_ratio) return;
          setSaveError("");
          setPending({ ratio, previous: config?.selected_ratio ?? null, version: config?.version ?? 0 });
        }}
        className="mt-2 w-full min-w-0 rounded-lg border border-zinc-700 bg-[#14181d] px-2 py-2 text-xs font-semibold text-zinc-100 focus:outline-none focus:ring-2 focus:ring-red-600/50 disabled:cursor-default xl:-mx-3 xl:w-[calc(100%+1.5rem)] xl:px-1 xl:text-[11px] 2xl:mx-0 2xl:w-full 2xl:px-2 2xl:text-xs">
        <option value="" disabled>{loading ? "Loading…" : error ? "Unavailable" : "NOT SET"}</option>
        {(Object.keys(GEAR_RATIOS) as GearRatioType[]).map((ratio) => (
          <option key={ratio} value={ratio}>{gearRatioLabel(ratio)}</option>
        ))}
      </select>
      {error && <div role="alert" className="mt-2 break-words text-xs text-red-300">
        <p>{error}</p>
        <button type="button" className="mt-1 underline" onClick={() => void refresh()}>Retry</button>
      </div>}
      <dialog ref={dialog} aria-labelledby={titleId} aria-describedby={descriptionId}
        onCancel={(event) => { if (saving) event.preventDefault(); }}
        onClose={() => { if (!dialog.current?.open && !saving) setPending(null); }}
        className="fixed inset-0 m-auto max-h-[85dvh] w-[calc(100%-2rem)] max-w-sm overflow-y-auto rounded-2xl border border-zinc-700 bg-[#14181d] p-6 text-zinc-100 shadow-xl backdrop:bg-black/80">
        <h2 id={titleId} className="text-lg font-semibold">Change Gear Ratio?</h2>
        <p className="mt-4 text-sm text-zinc-400">Car {carId}</p>
        {pending && <p className="mt-2 text-lg font-semibold">
          {gearRatioLabel(pending.previous)} → {gearRatioLabel(pending.ratio)}
        </p>}
        <p id={descriptionId} className="mt-3 text-sm text-zinc-400">
          This will notify the mechanics that the required gear ratio has changed.
        </p>
        {(saveError || error || stale) && <p role="alert" className="mt-4 text-sm text-red-300">
          {saveError || error || "The current ratio changed. Cancel and select again."}
        </p>}
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" autoFocus disabled={saving} onClick={() => setPending(null)}
            className="rounded-xl border border-zinc-700 px-4 py-2 text-sm font-semibold hover:border-zinc-500 disabled:opacity-50">Cancel</button>
          <button type="button" disabled={saving || stale || !!error || !canChange}
            onClick={() => void confirmChange()}
            className="rounded-xl bg-red-700 px-4 py-2 text-sm font-semibold hover:bg-red-600 disabled:opacity-50">
            {saving ? "Saving…" : "Confirm"}
          </button>
        </div>
      </dialog>
    </div>
  );
}
