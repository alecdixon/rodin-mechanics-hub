"use client";

import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getUserRole } from "@/lib/userAccess";

type Props = {
  children: React.ReactNode;
};

type NavItem = {
  href: string;
  title: string;
  description: string;
  stat?: string;
};

type NavGroup = {
  section: string;
  items: NavItem[];
};

type CarHubStats = {
  workshopTotal: number;
  workshopDone: number;
  eveningTotal: number;
  eveningDone: number;
  clutchCount: number;
  latestClutchAt: string | null;
  postEventCount: number;
  latestPostEventAt: string | null;
};

const EMPTY_STATS: CarHubStats = {
  workshopTotal: 0,
  workshopDone: 0,
  eveningTotal: 0,
  eveningDone: 0,
  clutchCount: 0,
  latestClutchAt: null,
  postEventCount: 0,
  latestPostEventAt: null,
};

function niceDateTime(value: string | null | undefined) {
  if (!value) return "No records";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No records";

  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function percent(done: number, total: number) {
  if (!total) return 0;
  return Math.round((done / total) * 100);
}

function SmallStat({ value }: { value?: string }) {
  if (!value) return null;

  return (
    <span className="mt-2 inline-flex rounded-full border border-zinc-700 bg-black/40 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
      {value}
    </span>
  );
}

function NavLink({
  href,
  title,
  description,
  stat,
  active,
  onClick,
}: {
  href: string;
  title: string;
  description: string;
  stat?: string;
  active: boolean;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={`block rounded-xl border px-4 py-3 text-sm font-semibold transition ${
        active
          ? "border-red-500 bg-red-950/30 text-red-100"
          : "border-zinc-700 bg-[#0d0f12] text-zinc-100 hover:border-red-500/70 hover:bg-[#14181d] hover:text-red-200"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          {title}

          <span
            className={`mt-1 block text-xs font-normal leading-5 ${
              active ? "text-red-200/70" : "text-zinc-500"
            }`}
          >
            {description}
          </span>

          <SmallStat value={stat} />
        </div>

        {active && (
          <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-red-400" />
        )}
      </div>
    </Link>
  );
}

function MiniProgress({
  label,
  done,
  total,
}: {
  label: string;
  done: number;
  total: number;
}) {
  const value = percent(done, total);

  return (
    <div className="rounded-2xl border border-zinc-800 bg-[#0d0f12] p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
            {label}
          </p>

          <p className="mt-1 text-sm text-zinc-400">
            <span className="font-semibold text-zinc-100">{done}</span> /{" "}
            <span className="font-semibold text-zinc-100">{total}</span>{" "}
            complete
          </p>
        </div>

        <div className="rounded-xl border border-zinc-700 bg-black px-3 py-2 text-sm font-bold text-zinc-100">
          {value}%
        </div>
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-800">
        <div
          className="h-full rounded-full bg-red-700 transition-all duration-500"
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}

function RecordStat({
  label,
  count,
  latestAt,
}: {
  label: string;
  count: number;
  latestAt: string | null;
}) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-[#0d0f12] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
            {label}
          </p>

          <p className="mt-1 text-sm text-zinc-400">
            <span className="font-semibold text-zinc-100">{count}</span>{" "}
            record{count === 1 ? "" : "s"}
          </p>

          <p className="mt-1 text-xs text-zinc-500">
            Latest:{" "}
            <span className="font-semibold text-zinc-300">
              {niceDateTime(latestAt)}
            </span>
          </p>
        </div>

        <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-red-400" />
      </div>
    </div>
  );
}

export default function ChiefCarLayout({ children }: Props) {
  const params = useParams();
  const pathname = usePathname();
  const router = useRouter();

  const carId = String(params.carId ?? "");
  const carIdNumber = Number(carId);

  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [stats, setStats] = useState<CarHubStats>(EMPTY_STATS);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState("");

  const loadStats = useCallback(async () => {
    if (!carIdNumber) return;

    setStatsError("");
    setStatsLoading(true);

    const [
      workshopResult,
      eveningResult,
      clutchResult,
      postEventResult,
    ] = await Promise.all([
      supabase
        .from("job_progress")
        .select("done")
        .eq("car_id", carIdNumber),

      supabase
        .from("evening_job_progress")
        .select("done")
        .eq("car_id", carIdNumber),

      supabase
        .from("clutch_measurements")
        .select("created_at")
        .eq("car_id", carIdNumber)
        .order("created_at", { ascending: false }),

      supabase
        .from("post_event_sheets")
        .select("created_at")
        .eq("car_id", carIdNumber)
        .order("created_at", { ascending: false }),
    ]);

    if (workshopResult.error) {
      setStatsError(`Workshop stats failed: ${workshopResult.error.message}`);
      setStatsLoading(false);
      return;
    }

    if (eveningResult.error) {
      setStatsError(`Evening stats failed: ${eveningResult.error.message}`);
      setStatsLoading(false);
      return;
    }

    if (clutchResult.error) {
      setStatsError(`Clutch stats failed: ${clutchResult.error.message}`);
      setStatsLoading(false);
      return;
    }

    if (postEventResult.error) {
      setStatsError(`Post-event stats failed: ${postEventResult.error.message}`);
      setStatsLoading(false);
      return;
    }

    const workshopRows = workshopResult.data ?? [];
    const eveningRows = eveningResult.data ?? [];
    const clutchRows = clutchResult.data ?? [];
    const postEventRows = postEventResult.data ?? [];

    setStats({
      workshopTotal: workshopRows.length,
      workshopDone: workshopRows.filter((row) => row.done).length,
      eveningTotal: eveningRows.length,
      eveningDone: eveningRows.filter((row) => row.done).length,
      clutchCount: clutchRows.length,
      latestClutchAt:
        typeof clutchRows[0]?.created_at === "string"
          ? clutchRows[0].created_at
          : null,
      postEventCount: postEventRows.length,
      latestPostEventAt:
        typeof postEventRows[0]?.created_at === "string"
          ? postEventRows[0].created_at
          : null,
    });

    setStatsLoading(false);
  }, [carIdNumber]);

  useEffect(() => {
    async function checkAccess() {
      const { data } = await supabase.auth.getUser();
      const email = data.user?.email ?? "";
      const role = getUserRole(email);

      if (role !== "chief") {
        router.replace("/dashboard");
        return;
      }

      setLoading(false);
    }

    checkAccess();
  }, [router]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  useEffect(() => {
    if (!carIdNumber) return;

    const channel = supabase
      .channel(`chief-car-hub-${carIdNumber}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "job_progress",
          filter: `car_id=eq.${carIdNumber}`,
        },
        () => loadStats(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "evening_job_progress",
          filter: `car_id=eq.${carIdNumber}`,
        },
        () => loadStats(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "clutch_measurements",
          filter: `car_id=eq.${carIdNumber}`,
        },
        () => loadStats(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "post_event_sheets",
          filter: `car_id=eq.${carIdNumber}`,
        },
        () => loadStats(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [carIdNumber, loadStats]);

  const links: NavGroup[] = [
    {
      section: "Dashboard",
      items: [
        {
          href: "/dashboard",
          title: "Chief Dashboard",
          description: "Return to the main car overview",
        },
      ],
    },
    {
      section: "Overview",
      items: [
        {
          href: `/dashboard/car/${carId}/viewer`,
          title: "Car Overview",
          description: "Current progress, notes and records overview",
        },
      ],
    },
    {
      section: "Preparation Lists",
      items: [
        {
          href: `/dashboard/car/${carId}/job-list`,
          title: "Workshop Job List",
          description: "Set, check and modify the main workshop jobs",
          stat: `${stats.workshopDone}/${stats.workshopTotal} complete`,
        },
        {
          href: `/dashboard/car/${carId}/evening-job-list`,
          title: "Evening Prep Job List",
          description: "Set, check and modify evening preparation jobs",
          stat: `${stats.eveningDone}/${stats.eveningTotal} complete`,
        },
      ],
    },
    {
      section: "Sheets / Records",
      items: [
        {
          href: `/dashboard/car/${carId}/clutch-measurement`,
          title: "Clutch Measurement",
          description: "Review clutch data submitted for this car",
          stat: `${stats.clutchCount} record${
            stats.clutchCount === 1 ? "" : "s"
          }`,
        },
        {
          href: `/dashboard/car/${carId}/post-event`,
          title: "Post Event Sheet",
          description: "Review post-event information and saved PDFs",
          stat: `${stats.postEventCount} record${
            stats.postEventCount === 1 ? "" : "s"
          }`,
        },
      ],
    },
    {
      section: "Mechanic View",
      items: [
        {
          href: `/car/${carId}/job-list`,
          title: "Mechanic Workshop View",
          description: "Open the mechanic tick-off job list",
        },
        {
          href: `/car/${carId}/evening-job-list`,
          title: "Mechanic Evening View",
          description: "Open the mechanic evening preparation list",
        },
        {
          href: `/car/${carId}/clutch-measurement`,
          title: "Mechanic Clutch Sheet",
          description: "Open the mechanic clutch measurement form",
        },
        {
          href: `/car/${carId}/post-event`,
          title: "Mechanic Post Event Sheet",
          description: "Open the mechanic post-event form",
        },
      ],
    },
  ];

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0d0f12] text-zinc-400">
        Checking chief access...
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-[#0d0f12] text-zinc-100">
      <button
        type="button"
        onClick={() => setMenuOpen((current) => !current)}
        className="fixed bottom-6 left-6 z-50 flex items-center gap-2 rounded-xl border border-zinc-700 bg-[#111418]/95 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400 shadow-lg backdrop-blur transition hover:border-red-500/70 hover:text-red-200"
      >
        <span
          className={`h-2 w-2 rounded-full ${
            menuOpen ? "bg-red-400" : "bg-zinc-500"
          }`}
        />

        {menuOpen ? "Close" : "Car Menu"}
      </button>

      {menuOpen && (
        <button
          type="button"
          aria-label="Close car navigation"
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[1px]"
          onClick={() => setMenuOpen(false)}
        />
      )}

      <aside
        className={`fixed left-0 top-0 z-50 h-screen w-[410px] max-w-[92vw] overflow-y-auto border-r border-zinc-800 bg-[#101419] p-6 shadow-2xl transition-transform duration-300 ${
          menuOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-red-400">
              Chief Car Hub
            </p>

            <h2 className="mt-3 text-3xl font-semibold text-zinc-100">
              Car {carId}
            </h2>

            <p className="mt-2 text-sm leading-6 text-zinc-500">
              Live car navigation. Counts update when mechanics submit sheets or
              tick off jobs.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setMenuOpen(false)}
            className="rounded-xl border border-zinc-700 px-3 py-2 text-sm font-semibold text-zinc-300 transition hover:border-red-500/70 hover:text-red-200"
          >
            ✕
          </button>
        </div>

        <section className="mt-6 rounded-2xl border border-zinc-800 bg-[#14181d] p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-red-400">
              Live Status
            </p>

            <button
              type="button"
              onClick={loadStats}
              className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-400 transition hover:border-red-500/70 hover:text-red-200"
            >
              Refresh
            </button>
          </div>

          {statsError && (
            <div className="mt-4 rounded-xl border border-red-900 bg-red-950/30 p-3 text-xs leading-5 text-red-200">
              {statsError}
            </div>
          )}

          {statsLoading ? (
            <div className="mt-4 rounded-xl border border-zinc-800 bg-[#0d0f12] p-4 text-sm text-zinc-500">
              Loading live stats...
            </div>
          ) : (
            <div className="mt-4 grid gap-3">
              <MiniProgress
                label="Workshop"
                done={stats.workshopDone}
                total={stats.workshopTotal}
              />

              <MiniProgress
                label="Evening Prep"
                done={stats.eveningDone}
                total={stats.eveningTotal}
              />

              <RecordStat
                label="Clutch Sheets"
                count={stats.clutchCount}
                latestAt={stats.latestClutchAt}
              />

              <RecordStat
                label="Post Event Sheets"
                count={stats.postEventCount}
                latestAt={stats.latestPostEventAt}
              />
            </div>
          )}
        </section>

        <div className="mt-8 space-y-6">
          {links.map((group) => (
            <section
              key={group.section}
              className="rounded-2xl border border-zinc-800 bg-[#14181d] p-4"
            >
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.25em] text-red-400">
                {group.section}
              </p>

              <div className="grid gap-2">
                {group.items.map((item) => (
                  <NavLink
                    key={item.href}
                    href={item.href}
                    title={item.title}
                    description={item.description}
                    stat={item.stat}
                    active={pathname === item.href}
                    onClick={() => setMenuOpen(false)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </aside>

      {children}
    </div>
  );
}