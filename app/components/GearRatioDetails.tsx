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

export function GearRatioDetailsButton({ ratio }: { ratio: GearRatioType }) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-sm font-semibold hover:border-red-500">
        View ratios
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

function gearOrdinal(index: number) {
  return ["1st", "2nd", "3rd", "4th", "5th", "6th"][index] ?? `Gear ${index + 1}`;
}

export function GearRatioInlineDetails() {
  const { config, loading, error } = useGearRatio();
  return (
    <div className="min-w-0">
      <p className="text-xs font-semibold uppercase tracking-[0.3em]">Gear Ratio</p>
      {loading ? <p className="mt-3 text-sm text-zinc-400">Loading…</p> : error ? (
        <p role="alert" title={error} className="mt-3 text-sm text-amber-300">Unavailable</p>
      ) : config ? <>
        <p className="mt-3 text-2xl font-bold text-zinc-100">{gearRatioLabel(config.selected_ratio)}</p>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:max-w-sm">
          {GEAR_RATIOS[config.selected_ratio].gears.map((pair, index) => (
            <div key={pair} className="flex min-w-0 items-baseline justify-between gap-3 border-b border-zinc-800/80 pb-1">
              <dt className="text-zinc-400">{gearOrdinal(index)}</dt>
              <dd className="font-semibold text-zinc-100">{pair}</dd>
            </div>
          ))}
        </dl>
      </> : <>
        <p className="mt-3 text-2xl font-bold text-zinc-100">NOT SET</p>
        <p className="mt-2 text-sm text-zinc-400">No ratio selected</p>
      </>}
    </div>
  );
}

export function GearRatioBadge() {
  const { changed, error } = useGearRatio();
  if (!changed && !error) return null;
  return <span className="ml-2 inline-flex h-5 w-5 items-center justify-center rounded-full border border-amber-700/60 bg-amber-950/30 text-xs text-amber-300"
    title={error ? `Unable to check gear ratio: ${error}` : "There has been a change to the requested gearbox configuration."}
    aria-label={error ? "Gear ratio status unavailable" : "Gear ratio changed"}>{error ? "?" : "!"}</span>;
}
