"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getAssignedCar, getUserRole } from "@/lib/userAccess";

type CarProgress = {
  id: number;
  name: string;
  progress: number;
  status: string;
  total: number;
  completed: number;
};

const CAR_META = [
  { id: 1, name: "GB3-01" },
  { id: 2, name: "GB3-02" },
  { id: 3, name: "GB3-03" },
];

function ProgressDial({ progress }: { progress: number }) {
  const angle = progress * 3.6;

  return (
    <div className="grid h-36 w-36 place-items-center rounded-full shadow-inner" style={{ background: `conic-gradient(#b91c1c ${angle}deg, #2a2f36 ${angle}deg)` }}>
      <div className="grid h-28 w-28 place-items-center rounded-full bg-[#111418]">
        <div className="text-center">
          <div className="text-3xl font-semibold">{progress}%</div>
          <div className="text-xs uppercase tracking-widest text-zinc-500">Jobs</div>
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [cars, setCars] = useState<CarProgress[]>([]);

  const loadProgress = useCallback(async () => {
    const { data, error } = await supabase.from("job_progress").select("car_id,done");

    if (error) console.error(error);

    const carMap: Record<number, { total: number; done: number }> = {};

    (data ?? []).forEach((row: { car_id: number; done: boolean }) => {
      if (!carMap[row.car_id]) carMap[row.car_id] = { total: 0, done: 0 };
      carMap[row.car_id].total += 1;
      if (row.done) carMap[row.car_id].done += 1;
    });

    setCars(
      CAR_META.map((car) => {
        const stats = carMap[car.id] ?? { total: 0, done: 0 };
        const progress = stats.total ? Math.round((stats.done / stats.total) * 100) : 0;
        const status = progress === 100 && stats.total > 0 ? "Complete" : progress > 0 ? "In Progress" : "Open Jobs";

        return {
          id: car.id,
          name: car.name,
          progress,
          status,
          total: stats.total,
          completed: stats.done,
        };
      }),
    );
  }, []);

  useEffect(() => {
    async function checkAccess() {
      const { data } = await supabase.auth.getUser();
      const email = data.user?.email ?? "";
      const role = getUserRole(email);

      if (role === "mechanic") {
        const carId = getAssignedCar(email);
        router.replace(`/car/${carId}/job-list`);
        return;
      }

      if (role !== "chief") {
        router.replace("/login");
        return;
      }

      await loadProgress();
      setLoading(false);
    }

    checkAccess();
  }, [loadProgress, router]);

  useEffect(() => {
    const channel = supabase
      .channel("dashboard-job-progress")
      .on("postgres_changes", { event: "*", schema: "public", table: "job_progress" }, () => loadProgress())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadProgress]);

  if (loading) {
    return <main className="flex min-h-screen items-center justify-center bg-[#0d0f12] text-zinc-400">Loading chief dashboard...</main>;
  }

  return (
    <main className="min-h-screen bg-[#0d0f12] p-6 text-zinc-100">
      <header className="mb-8 rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-5">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-red-400">Rodin Motorsport</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight">Chief Mechanic Dashboard</h1>
            <p className="mt-2 max-w-2xl text-sm text-zinc-400">Live overview of car preparation progress, clutch measurements and post-event records.</p>
          </div>

          <button
            onClick={async () => {
              await supabase.auth.signOut();
              document.cookie = "user-email=; path=/; max-age=0";
              router.replace("/login");
            }}
            className="rounded-xl border border-zinc-700 bg-[#1b2026] px-5 py-3 text-sm font-medium text-zinc-200 hover:border-red-500 hover:bg-[#222832]"
          >
            Logout
          </button>
        </div>
      </header>

      <section className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {cars.map((car) => (
          <Link key={car.id} href={`/dashboard/car/${car.id}/viewer`} className="group rounded-3xl border border-zinc-800 bg-[#14181d] p-7 shadow-lg transition hover:-translate-y-1 hover:border-red-500/70 hover:bg-[#181d23]">
            <div className="flex flex-col items-center">
              <ProgressDial progress={car.progress} />
              <div className="mt-6 text-center">
                <h2 className="text-2xl font-semibold tracking-tight">{car.name}</h2>
                <div className="mt-3 inline-flex rounded-full border border-zinc-700 bg-[#0d0f12] px-3 py-1 text-xs text-zinc-300">{car.status}</div>
                <p className="mt-3 text-sm text-zinc-500">{car.completed} of {car.total || "—"} jobs complete</p>
                <p className="mt-4 text-sm text-zinc-500 group-hover:text-zinc-300">Open car viewer →</p>
              </div>
            </div>
          </Link>
        ))}
      </section>
    </main>
  );
}
