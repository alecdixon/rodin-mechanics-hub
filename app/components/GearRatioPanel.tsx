"use client";

import { useEffect, useRef, useState } from "react";
import { GEAR_RATIOS, gearRatioLabel, type GearRatioType } from "@/lib/gearRatios";
import { useGearRatio } from "./GearRatioProvider";
import { GearRatioDetailsButton } from "./GearRatioDetails";

export default function GearRatioPanel() {
  const { carId, config, history, loading, error, canChange, canAcknowledge, changed, save, acknowledge, refresh, openCount } = useGearRatio();
  const [draft, setDraft] = useState<{ ratio: GearRatioType; version: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [acknowledging, setAcknowledging] = useState(false);
  const [actionError, setActionError] = useState("");
  const [message, setMessage] = useState("");
  const opened = useRef<number | null>(null);

  // The provider/sidebar never acknowledges. Only this visible, mounted panel
  // acknowledges its first displayed version; subsequent changes stay flagged
  // until reopened or explicitly acknowledged.
  useEffect(() => {
    const acknowledgeOpening = () => {
      if (opened.current === openCount || loading || error || !canAcknowledge || document.visibilityState !== "visible") return;
      opened.current = openCount;
      if (config && changed) {
        void acknowledge(config.version).catch((cause: Error) => setActionError(cause.message));
      }
    };
    acknowledgeOpening();
    document.addEventListener("visibilitychange", acknowledgeOpening);
    return () => document.removeEventListener("visibilitychange", acknowledgeOpening);
  }, [loading, error, canAcknowledge, config, changed, acknowledge, openCount]);

  async function handleSave() {
    if (!draft || saving) return;
    setSaving(true);
    setActionError("");
    setMessage("");
    try {
      await save(draft.ratio, draft.version);
      setDraft(null);
      setMessage("Gear ratio saved.");
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Unable to save gear ratio.");
    } finally {
      setSaving(false);
    }
  }

  async function handleAcknowledge() {
    if (!config || acknowledging) return;
    setAcknowledging(true);
    setActionError("");
    try { await acknowledge(config.version); }
    catch (cause) { setActionError(cause instanceof Error ? cause.message : "Unable to acknowledge gear ratio."); }
    finally { setAcknowledging(false); }
  }

  const staleDraft = draft !== null && draft.version !== (config?.version ?? 0);
  const selected = draft?.ratio ?? config?.selected_ratio;

  return (
    <section className="mx-auto w-full max-w-3xl space-y-6 p-2 text-zinc-100 sm:p-6">
      <div className="rounded-3xl border border-zinc-800 bg-[#14181d] p-5 shadow-xl sm:p-8">
        <p className="text-xs uppercase tracking-[0.3em] text-red-400">Car {carId}</p>
        <h1 className="mt-3 text-xl font-semibold">GEAR RATIO</h1>
        {loading ? <p className="mt-4 text-zinc-400">Loading gear ratio…</p> : <>
          {error ? <div role="alert" className="mt-4 text-amber-300">
            <p>Unable to load the current gear ratio: {error}</p>
            <button type="button" onClick={() => void refresh()} className="mt-2 underline">Retry</button>
          </div> : <>
            {canChange && <p className="mt-4 text-sm text-zinc-400">Current:</p>}
            <p className="my-5 break-words text-4xl font-bold sm:text-5xl">{gearRatioLabel(config?.selected_ratio)}</p>
            {changed && <p className="mb-4 text-sm text-amber-300">Changed — new gearbox configuration</p>}
            {config && <GearRatioDetailsButton ratio={config.selected_ratio} />}
            {canAcknowledge && changed && <button type="button" disabled={acknowledging} onClick={() => void handleAcknowledge()}
              className="ml-2 mt-2 rounded-xl border border-zinc-700 px-4 py-3 text-sm disabled:opacity-50">{acknowledging ? "Acknowledging…" : "Acknowledge change"}</button>}
          </>}
          {canChange && !error && <div className="mt-8 border-t border-zinc-800 pt-6">
            <fieldset disabled={saving}>
              <legend className="mb-3 text-sm text-zinc-400">Select configuration</legend>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(GEAR_RATIOS) as GearRatioType[]).map((ratio) => <button key={ratio} type="button" aria-pressed={selected === ratio}
                  onClick={() => { setDraft({ ratio, version: config?.version ?? 0 }); setMessage(""); setActionError(""); }}
                  className={`rounded-xl border px-4 py-3 text-sm font-semibold ${selected === ratio ? "border-red-500 bg-red-950/40 text-red-100" : "border-zinc-700 hover:border-red-500"}`}>
                  {gearRatioLabel(ratio)}
                </button>)}
              </div>
            </fieldset>
            <p className="my-4 text-sm">Selected: <strong>{gearRatioLabel(selected)}</strong></p>
            {staleDraft && <p className="mb-4 text-sm text-amber-300">The current ratio changed. Select a configuration again before saving.</p>}
            <button type="button" disabled={saving || !draft || staleDraft || draft.ratio === config?.selected_ratio} onClick={() => void handleSave()}
              className="rounded-xl bg-red-700 px-5 py-3 text-sm font-semibold hover:bg-red-600 disabled:opacity-50">{saving ? "Saving…" : "Save Gear Ratio"}</button>
          </div>}
        </>}
        {actionError && <p role="alert" className="mt-4 text-sm text-red-300">{actionError}</p>}
        {message && <p role="status" className="mt-4 text-sm text-green-300">{message}</p>}
      </div>
      {canChange && <section className="rounded-3xl border border-zinc-800 bg-[#14181d] p-5 sm:p-8">
        <h2 className="text-lg font-semibold">Gear Ratio History</h2>
        {!history.length && <p className="mt-3 text-sm text-zinc-400">No changes recorded.</p>}
        <ul className="mt-4 divide-y divide-zinc-800">{history.map((entry) => <li key={entry.version} className="space-y-1 py-3 text-sm">
          <p className="font-semibold">{gearRatioLabel(entry.previous_ratio)} → {gearRatioLabel(entry.selected_ratio)}</p>
          <p className="text-zinc-400">{new Date(entry.updated_at).toLocaleString("en-GB")} · Version {entry.version}</p>
          <p className="break-words text-zinc-400">Changed by {entry.updated_by_email}</p>
        </li>)}</ul>
      </section>}
    </section>
  );
}
