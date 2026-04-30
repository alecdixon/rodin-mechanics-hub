"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getAssignedCar, getUserRole } from "@/lib/userAccess";

const CARS = [
  { id: 1, name: "GB3-01", progress: 72, status: "In Progress" },
  { id: 2, name: "GB3-02", progress: 38, status: "Open Jobs" },
  { id: 3, name: "GB3-03", progress: 100, status: "Complete" },
];

function ProgressDial({ progress }: { progress: number }) {
  const angle = progress * 3.6;

  return (
    <div
      className="grid h-36 w-36 place-items-center rounded-full shadow-inner"
      style={{
        background: `conic-gradient(#b91c1c ${angle}deg, #2a2f36 ${angle}deg)`,
      }}
    >
      <div className="grid h-28 w-28 place-items-center rounded-full bg-[#111418]">
        <div className="text-center">
          <div className="text-3xl font-semibold">{progress}%</div>
          <div className="text-xs uppercase tracking-widest text-zinc-500">
            Jobs
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function checkAccess() {
      const { data } = await supabase.auth.getUser();
      const email = data.user?.email ?? "";

      const role = getUserRole(email);

      // 🚫 Mechanics should NEVER be here
      if (role === "mechanic") {
        const carId = getAssignedCar(email);
        router.replace(`/car/${carId}`);
        return;
      }

      // 🚫 Unknown users
      if (role !== "chief") {
        router.replace("/login");
        return;
      }

      setLoading(false);
    }

    checkAccess();
  }, [router]);

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[#0d0f12] text-zinc-400">
        Checking access...
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0d0f12] p-6 text-zinc-100">
      <header className="mb-8 rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-5">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-red-400">
              Rodin Motorsport
            </p>

            <h1 className="mt-3 text-4xl font-semibold tracking-tight">
              Mechanics Hub
            </h1>

            <p className="mt-2 max-w-2xl text-sm text-zinc-400">
              Chief mechanic overview for car preparation, job progress and
              event workshop control.
            </p>
          </div>

          <Link
            href="/dashboard/settings"
            className="rounded-xl border border-zinc-700 bg-[#1b2026] px-5 py-3 text-sm font-medium text-zinc-200 hover:border-red-500 hover:bg-[#222832]"
          >
            Settings
          </Link>
        </div>
      </header>

      <section className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {CARS.map((car) => (
          <Link
            key={car.id}
            href={`/car/${car.id}`}
            className="group rounded-3xl border border-zinc-800 bg-[#14181d] p-7 shadow-lg transition hover:-translate-y-1 hover:border-red-500/70 hover:bg-[#181d23]"
          >
            <div className="flex flex-col items-center">
              <ProgressDial progress={car.progress} />

              <div className="mt-6 text-center">
                <h2 className="text-2xl font-semibold tracking-tight">
                  {car.name}
                </h2>

                <div className="mt-3 inline-flex rounded-full border border-zinc-700 bg-[#0d0f12] px-3 py-1 text-xs text-zinc-300">
                  {car.status}
                </div>

                <p className="mt-4 text-sm text-zinc-500 group-hover:text-zinc-300">
                  Open car workspace →
                </p>
              </div>
            </div>
          </Link>
        ))}
      </section>
    </main>
  );
}