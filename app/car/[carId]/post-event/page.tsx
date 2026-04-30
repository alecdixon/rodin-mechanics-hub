"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

type PostEventRow = { id?: string; car_id: number; event_name?: string | null; notes?: string | null; created_at?: string | null; created_by?: string | null };

export default function PostEventPage() {
  const params = useParams();
  const carId = Number(params.carId);
  const [eventName, setEventName] = useState("");
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<PostEventRow[]>([]);
  const [message, setMessage] = useState("");

  async function loadRows() {
    const { data } = await supabase.from("post_event_sheets").select("*").eq("car_id", carId).order("created_at", { ascending: false });
    setRows((data ?? []) as PostEventRow[]);
  }

  useEffect(() => { if (carId) loadRows(); }, [carId]);

  async function saveSheet() {
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase.from("post_event_sheets").insert({ car_id: carId, event_name: eventName, notes, created_by: userData.user?.email ?? null });
    if (error) { setMessage(error.message); return; }
    setEventName(""); setNotes(""); setMessage("Post-event sheet saved."); await loadRows();
  }

  return (
    <main className="min-h-screen bg-[#0d0f12] p-6 text-zinc-100">
      <h1 className="text-4xl font-semibold">Car {carId} Post Event</h1>
      <p className="mt-3 text-sm text-zinc-400">Save and review post-event notes for this car.</p>

      <section className="mt-8 rounded-3xl border border-zinc-800 bg-[#14181d] p-6">
        <div className="grid gap-4 md:grid-cols-2">
          <input value={eventName} onChange={(e) => setEventName(e.target.value)} placeholder="Event / test / session" className="rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 outline-none focus:border-red-500" />
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes" className="rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 outline-none focus:border-red-500" />
        </div>
        <button onClick={saveSheet} className="mt-4 rounded-xl bg-red-700 px-5 py-3 text-sm font-semibold hover:bg-red-600">Save Post Event Sheet</button>
        {message && <p className="mt-3 text-sm text-zinc-400">{message}</p>}
      </section>

      <section className="mt-6 rounded-3xl border border-zinc-800 bg-[#14181d] p-6">
        <h2 className="text-2xl font-semibold">Previous Post Event Sheets</h2>
        <div className="mt-4 space-y-2">
          {rows.length === 0 ? <p className="text-sm text-zinc-500">No saved post-event sheets.</p> : rows.map((row, index) => (
            <div key={row.id ?? index} className="rounded-xl border border-zinc-800 bg-[#0d0f12] p-4 text-sm">
              <div className="font-semibold">{row.event_name}</div>
              <div className="mt-1 text-zinc-400">{row.notes}</div>
              <div className="mt-2 text-xs text-zinc-500">{row.created_at ? new Date(row.created_at).toLocaleString() : ""} · {row.created_by}</div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
