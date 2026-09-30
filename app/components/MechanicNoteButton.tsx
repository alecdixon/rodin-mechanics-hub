"use client";

import { useEffect, useId, useRef, useState } from "react";

export default function MechanicNoteButton({ note }: { note: string }) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full border border-red-900/60 bg-red-950/30 px-3 py-1 text-xs font-semibold text-red-300 hover:border-red-700 hover:text-red-200"
      >
        Has Note
      </button>

      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        onClose={() => setOpen(false)}
        className="fixed inset-0 m-auto max-h-[85dvh] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-2xl border border-zinc-700 bg-[#14181d] p-6 text-zinc-100 shadow-xl backdrop:bg-black/80"
      >
        <h2 id={titleId} className="text-lg font-semibold">
          Mechanic Note
        </h2>

        <p className="mt-4 max-h-[55dvh] overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-zinc-800 bg-[#0d0f12] p-4 text-sm leading-6 text-zinc-300">
          {note}
        </p>

        <button
          type="button"
          onClick={() => setOpen(false)}
          className="mt-5 w-full rounded-xl border border-zinc-700 px-4 py-3 text-sm font-semibold hover:border-red-500"
        >
          Close
        </button>
      </dialog>
    </>
  );
}
