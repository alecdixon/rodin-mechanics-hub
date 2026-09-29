"use client";

import { useEffect, useId, useRef, useState, type ComponentProps } from "react";
import Link from "next/link";
import { GEAR_RATIOS, gearRatioLabel, type GearRatioType } from "@/lib/gearRatios";
import { useGearRatio } from "./GearRatioProvider";

export function GearRatioNavigationLink(props: ComponentProps<typeof Link>) {
  const { openPanel } = useGearRatio();
  return <Link {...props} onClick={(event) => {
    props.onClick?.(event);
    if (!event.defaultPrevented && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) openPanel();
  }} />;
}

export function GearRatioDetailsButton({ ratio, summary = false }: { ratio: GearRatioType; summary?: boolean }) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={summary
        ? "font-semibold text-red-300 underline decoration-red-900 underline-offset-4 hover:text-red-200"
        : "rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-sm font-semibold hover:border-red-500"}>
        {summary ? gearRatioLabel(ratio) : "View ratios"}
      </button>
      <dialog ref={dialog} aria-labelledby={titleId} onClose={() => setOpen(false)}
        className="fixed inset-0 m-auto max-h-[85dvh] w-[calc(100%-2rem)] max-w-sm overflow-y-auto rounded-2xl border border-zinc-700 bg-[#14181d] p-6 text-zinc-100 shadow-xl backdrop:bg-black/80">
        <h2 id={titleId} className="text-lg font-semibold">{gearRatioLabel(ratio)} GEAR RATIOS</h2>
        <table className="my-5 w-full text-left text-sm">
          <thead><tr className="border-b border-zinc-700 text-zinc-400"><th className="py-2">Gear</th><th className="py-2">Ratio</th></tr></thead>
          <tbody>{GEAR_RATIOS[ratio].gears.map((pair, index) => (
            <tr key={index} className="border-b border-zinc-800"><th scope="row" className="py-2 font-normal">Gear {index + 1}</th><td className="py-2 font-semibold">{pair}</td></tr>
          ))}</tbody>
        </table>
        <button type="button" onClick={() => setOpen(false)} className="w-full rounded-xl border border-zinc-700 px-4 py-3 text-sm font-semibold hover:border-red-500">Close</button>
      </dialog>
    </>
  );
}

export function GearRatioSummary() {
  const { config, loading, error, refresh } = useGearRatio();
  return (
    <span className="inline-flex flex-wrap items-center gap-2 text-sm">
      Gear Ratio:
      {loading ? <span>Loading…</span> : error ? (
        <button type="button" title={error} onClick={() => void refresh()} className="text-amber-300 underline">Unavailable — retry</button>
      ) : config ? <GearRatioDetailsButton ratio={config.selected_ratio} summary /> : <strong>NOT SET</strong>}
    </span>
  );
}

export function GearRatioBadge() {
  const { changed, error } = useGearRatio();
  if (!changed && !error) return null;
  return <span className="ml-2 inline-flex h-5 w-5 items-center justify-center rounded-full border border-amber-700/60 bg-amber-950/30 text-xs text-amber-300"
    title={error ? `Unable to check gear ratio: ${error}` : "There has been a change to the requested gearbox configuration."}
    aria-label={error ? "Gear ratio status unavailable" : "Gear ratio changed"}>{error ? "?" : "!"}</span>;
}
