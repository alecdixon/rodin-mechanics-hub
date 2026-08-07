"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import LogoutButton from "@/app/components/LogoutButton";
import { supabase } from "@/lib/supabase";
import { getLoginRedirect, getUserRole } from "@/lib/userAccess";

type DashboardCar = {
  id: number;
  name: string;
  colour: string | null;
  active: boolean | null;
  sort_order: number | null;
};

type ProgressRow = { car_id: number; done: boolean };

type CarSummary = DashboardCar & {
  workshopDone: number;
  workshopTotal: number;
  eveningDone: number;
  eveningTotal: number;
};

const GLOBAL_LINKS = [
  { href: "/recorded-issues", title: "Recorded Issues", description: "Review known faults and add a new issue." },
  { href: "/sticker-list", title: "Sticker List", description: "Review sticker requirements and add new items." },
  { href: "/dashboard/team-jobs", title: "Team Jobs", description: "View team-wide jobs and create a draft job." },
  { href: "/legality", title: "Surface Table Checks", description: "Open saved setup and legality checks in read-only mode." },
  { href: "/plank-legality", title: "Plank Legality", description: "Review plank measurements and historic reports." },
  { href: "/drain-out", title: "Drain Out", description: "Inspect drain-out figures and previous records." },
] as const;

function percentage(done: number, total: number) {
  return total > 0 ? Math.round((done / total) * 100) : 0;
}

function ProgressBar({ label, done, total, colour }: { label: string; done: number; total: number; colour: string }) {
  const progress = percentage(done, total);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3 text-xs">
        <span className="font-semibold uppercase tracking-[0.18em] text-zinc-500">{label}</span>
        <span className="font-semibold text-zinc-200">{done}/{total} · {progress}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-zinc-800" role="progressbar" aria-label={`${label} completion`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
        <div className="h-full rounded-full" style={{ width: `${progress}%`, backgroundColor: colour }} />
      </div>
    </div>
  );
}

export default function EngineerDashboardPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [cars, setCars] = useState<CarSummary[]>([]);
  const [openIssues, setOpenIssues] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  const loadSummary = useCallback(async () => {
    const [carsResult, workshopResult, eveningResult, issuesResult] = await Promise.all([
      supabase.from("dashboard_cars").select("id,name,colour,active,sort_order").eq("active", true).order("sort_order", { ascending: true }),
      supabase.from("job_progress").select("car_id,done"),
      supabase.from("evening_job_progress").select("car_id,done"),
      supabase.from("recorded_issues").select("id", { count: "exact", head: true }).eq("solution_approved", false),
    ]);

    const firstError = carsResult.error || workshopResult.error || eveningResult.error || issuesResult.error;
    if (firstError) {
      setErrorMessage(firstError.message);
      return;
    }

    const workshop = (workshopResult.data ?? []) as ProgressRow[];
    const evening = (eveningResult.data ?? []) as ProgressRow[];

    setCars(((carsResult.data ?? []) as DashboardCar[]).map((car) => {
      const workshopRows = workshop.filter((row) => row.car_id === car.id);
      const eveningRows = evening.filter((row) => row.car_id === car.id);

      return {
        ...car,
        workshopDone: workshopRows.filter((row) => row.done).length,
        workshopTotal: workshopRows.length,
        eveningDone: eveningRows.filter((row) => row.done).length,
        eveningTotal: eveningRows.length,
      };
    }));
    setOpenIssues(issuesResult.count ?? 0);
  }, []);

  useEffect(() => {
    let mounted = true;

    async function initialise() {
      const { data, error } = await supabase.auth.getUser();
      const email = data.user?.email?.trim().toLowerCase() ?? "";

      if (error || !email) {
        router.replace("/login");
        return;
      }

      if (getUserRole(email) !== "engineer") {
        router.replace(getLoginRedirect(email));
        return;
      }

      await loadSummary();
      if (mounted) setLoading(false);
    }

    void initialise();
    return () => { mounted = false; };
  }, [loadSummary, router]);

  const averageProgress = useMemo(() => {
    const done = cars.reduce((total, car) => total + car.workshopDone + car.eveningDone, 0);
    const jobs = cars.reduce((total, car) => total + car.workshopTotal + car.eveningTotal, 0);
    return percentage(done, jobs);
  }, [cars]);

  if (loading) {
    return <main className="flex min-h-screen items-center justify-center bg-[#0d0f12] text-zinc-400">Loading Engineer Dashboard...</main>;
  }

  return (
    <main className="min-h-screen bg-[#0d0f12] px-4 py-6 text-white sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1500px]">
        <header className="rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-2xl sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-red-400">Rodin Motorsport</p>
              <h1 className="mt-3 text-3xl font-semibold text-zinc-100 sm:text-4xl">Engineer Dashboard</h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-400">A read-focused overview of current car activity, checks and team information. Creation access is limited to Issues, Stickers and Team Jobs.</p>
            </div>
            <LogoutButton />
          </div>

          <div className="mt-7 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-zinc-800 bg-[#0d0f12] p-4"><p className="text-3xl font-semibold">{cars.length}</p><p className="mt-1 text-xs uppercase tracking-[0.2em] text-zinc-500">Active cars</p></div>
            <div className="rounded-2xl border border-zinc-800 bg-[#0d0f12] p-4"><p className="text-3xl font-semibold text-red-300">{openIssues ?? "—"}</p><p className="mt-1 text-xs uppercase tracking-[0.2em] text-zinc-500">Open issues</p></div>
            <div className="rounded-2xl border border-zinc-800 bg-[#0d0f12] p-4"><p className="text-3xl font-semibold text-green-300">{averageProgress}%</p><p className="mt-1 text-xs uppercase tracking-[0.2em] text-zinc-500">Combined job progress</p></div>
          </div>
        </header>

        {errorMessage && <div className="mt-6 rounded-2xl border border-red-900 bg-red-950/30 p-4 text-sm text-red-200">{errorMessage}</div>}

        <section className="mt-8">
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-red-400">Quick access</p>
          <h2 className="mt-3 text-2xl font-semibold">Engineer tools</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {GLOBAL_LINKS.map((link) => (
              <Link key={link.href} href={link.href} className="rounded-2xl border border-zinc-700 bg-[#1b2026] p-5 transition hover:border-red-500 hover:bg-[#222832]">
                <span className="font-semibold text-zinc-100">{link.title}</span>
                <span className="mt-2 block text-sm leading-6 text-zinc-400">{link.description}</span>
              </Link>
            ))}
          </div>
        </section>

        <section className="mt-10">
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-red-400">Car overview</p>
          <h2 className="mt-3 text-2xl font-semibold">Workshop and evening progress</h2>
          <div className="mt-5 grid gap-5 xl:grid-cols-3">
            {cars.map((car) => {
              const colour = car.colour || "#ef4444";
              return (
                <article key={car.id} className="rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-xl">
                  <div className="flex items-center gap-3"><span className="h-12 w-2 rounded-full" style={{ backgroundColor: colour }} /><div><p className="text-xs uppercase tracking-[0.22em] text-zinc-500">Car {car.id}</p><h3 className="text-xl font-semibold">{car.name}</h3></div></div>
                  <div className="mt-6 space-y-5"><ProgressBar label="Workshop" done={car.workshopDone} total={car.workshopTotal} colour={colour} /><ProgressBar label="Evening Prep" done={car.eveningDone} total={car.eveningTotal} colour={colour} /></div>
                  <div className="mt-6 grid gap-2 sm:grid-cols-2">
                    <Link href={`/dashboard/car/${car.id}/job-list`} className="rounded-xl border border-zinc-700 px-3 py-3 text-center text-sm font-semibold hover:border-red-500">Workshop Jobs</Link>
                    <Link href={`/dashboard/car/${car.id}/evening-job-list`} className="rounded-xl border border-zinc-700 px-3 py-3 text-center text-sm font-semibold hover:border-red-500">Evening Prep</Link>
                    <Link href={`/dashboard/car/${car.id}/viewer`} className="rounded-xl border border-zinc-700 px-3 py-3 text-center text-sm font-semibold hover:border-red-500">Car Overview</Link>
                    <Link href={`/dashboard/car/${car.id}/post-event`} className="rounded-xl border border-zinc-700 px-3 py-3 text-center text-sm font-semibold hover:border-red-500">Post Event</Link>
                    <Link href={`/dashboard/car/${car.id}/clutch-measurement`} className="rounded-xl border border-zinc-700 px-3 py-3 text-center text-sm font-semibold hover:border-red-500 sm:col-span-2">Clutch Records</Link>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}
