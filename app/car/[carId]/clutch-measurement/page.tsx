"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

type ClutchRow = { id?: string; car_id: number; measurement?: string | null; notes?: string | null; created_at?: string | null; created_by?: string | null };

export default function ClutchMeasurementPage() {
  const params = useParams();
  const carId = Number(params.carId);
  const [measurement, setMeasurement] = useState("");
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<ClutchRow[]>([]);
  const [message, setMessage] = useState("");

  async function loadRows() {
    const { data } = await supabase.from("clutch_measurements").select("*").eq("car_id", carId).order("created_at", { ascending: false });
    setRows((data ?? []) as ClutchRow[]);
  }

  useEffect(() => { if (carId) loadRows(); }, [carId]);

  async function saveMeasurement() {
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase.from("clutch_measurements").insert({ car_id: carId, measurement, notes, created_by: userData.user?.email ?? null });
    if (error) { setMessage(error.message); return; }
    setMeasurement(""); setNotes(""); setMessage("Clutch measurement saved."); await loadRows();
  }

  return (
    <main className="min-h-screen bg-[#0d0f12] p-6 text-zinc-100">
      <h1 className="text-4xl font-semibold">Car {carId} Clutch Measurement</h1>
      <p className="mt-3 text-sm text-zinc-400">Save and review clutch clearance records for this car.</p>

      <section className="mt-8 rounded-3xl border border-zinc-800 bg-[#14181d] p-6">
        <div className="grid gap-4 md:grid-cols-2">
          <input value={measurement} onChange={(e) => setMeasurement(e.target.value)} placeholder="Measurement / clearance" className="rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 outline-none focus:border-red-500" />
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes" className="rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 outline-none focus:border-red-500" />
        </div>
        <button onClick={saveMeasurement} className="mt-4 rounded-xl bg-red-700 px-5 py-3 text-sm font-semibold hover:bg-red-600">Save Measurement</button>
        {message && <p className="mt-3 text-sm text-zinc-400">{message}</p>}
      </section>

      <section className="mt-6 rounded-3xl border border-zinc-800 bg-[#14181d] p-6">
        <h2 className="text-2xl font-semibold">Previous Measurements</h2>
        <div className="mt-4 space-y-2">
          {rows.length === 0 ? <p className="text-sm text-zinc-500">No saved measurements.</p> : rows.map((row, index) => (
            <div key={row.id ?? index} className="rounded-xl border border-zinc-800 bg-[#0d0f12] p-4 text-sm">
              <div className="font-semibold">{row.measurement}</div>
              <div className="mt-1 text-zinc-400">{row.notes}</div>
              <div className="mt-2 text-xs text-zinc-500">{row.created_at ? new Date(row.created_at).toLocaleString() : ""} · {row.created_by}</div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
