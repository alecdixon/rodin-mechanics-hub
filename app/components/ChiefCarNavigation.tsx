"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase";

type DashboardCar = {
  id: number;
  name: string;
  colour: string | null;
  active: boolean | null;
  sort_order: number | null;
};

type NavLinkItem = {
  href: string;
  label: string;
  description?: string;
  tone?: "default" | "red" | "muted";
};

type NavGroup = {
  title: string;
  items: NavLinkItem[];
};

const FALLBACK_CARS: DashboardCar[] = [
  { id: 1, name: "Car 1", colour: "#ef4444", active: true, sort_order: 1 },
  { id: 2, name: "Car 2", colour: "#3b82f6", active: true, sort_order: 2 },
  { id: 3, name: "Car 3", colour: "#a855f7", active: true, sort_order: 3 },
];

function isActiveRoute(pathname: string, href: string) {
  if (href === "/dashboard") {
    return pathname === href;
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

function carDisplayName(car: Pick<DashboardCar, "id" | "name">) {
  const cleanName = car.name?.trim();

  if (!cleanName || cleanName.toLowerCase() === `car ${car.id}`) {
    return `Car ${car.id}`;
  }

  return `${cleanName} / Car ${car.id}`;
}

function NavPill({
  item,
  compact = false,
}: {
  item: NavLinkItem;
  compact?: boolean;
}) {
  const pathname = usePathname();
  const active = isActiveRoute(pathname, item.href);

  const baseClass = compact
    ? "rounded-xl border px-3 py-2 text-xs font-semibold transition"
    : "rounded-2xl border px-4 py-3 text-sm font-semibold transition";

  const toneClass = active
    ? "border-red-500 bg-red-950/40 text-red-100 shadow-sm shadow-red-950/30"
    : item.tone === "red"
      ? "border-red-900/60 bg-red-950/20 text-red-200 hover:border-red-500 hover:bg-red-950/40"
      : item.tone === "muted"
        ? "border-zinc-800 bg-[#0d0f12] text-zinc-400 hover:border-zinc-600 hover:text-zinc-100"
        : "border-zinc-700 bg-[#14181d] text-zinc-100 hover:border-red-500/70 hover:bg-[#1b2026] hover:text-red-100";

  return (
    <Link href={item.href} className={`${baseClass} ${toneClass}`}>
      <span>{item.label}</span>

      {!compact && item.description && (
        <span
          className={`mt-1 block text-xs font-normal leading-5 ${
            active ? "text-red-200/80" : "text-zinc-500"
          }`}
        >
          {item.description}
        </span>
      )}
    </Link>
  );
}

export default function ChiefCarNavigation({ carId }: { carId: string }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [cars, setCars] = useState<DashboardCar[]>(FALLBACK_CARS);

  useEffect(() => {
    let mounted = true;

    async function loadCars() {
      const { data, error } = await supabase
        .from("dashboard_cars")
        .select("id,name,colour,active,sort_order")
        .order("sort_order", { ascending: true })
        .order("id", { ascending: true });

      if (!mounted || error || !data || data.length === 0) {
        return;
      }

      setCars((data as DashboardCar[]).filter((car) => car.active !== false));
    }

    loadCars();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  const currentCar = useMemo(() => {
    const numericCarId = Number(carId);
    return cars.find((car) => car.id === numericCarId) ?? null;
  }, [carId, cars]);

  const globalLinks: NavLinkItem[] = [
    {
      href: "/dashboard",
      label: "Dashboard",
      description: "All cars and progress",
    },
    {
      href: "/dashboard/team-jobs",
      label: "Team Jobs",
      description: "Chief team-wide jobs",
    },
    {
      href: "/recorded-issues",
      label: "Issues",
      description: "Known faults and fixes",
    },
    {
      href: "/sticker-list",
      label: "Stickers",
      description: "Sticker list and print sheets",
    },
    {
      href: "/drain-out",
      label: "Drain Out",
      description: "Rig drain-out records",
    },
  ];

  const carToolLinks: NavLinkItem[] = [
    {
      href: `/dashboard/car/${carId}/viewer`,
      label: "Overview",
      description: "Progress, notes and saved records",
    },
    {
      href: `/dashboard/car/${carId}/job-list`,
      label: "Workshop Jobs",
      description: "Edit and publish main job list",
    },
    {
      href: `/dashboard/car/${carId}/evening-job-list`,
      label: "Evening Prep",
      description: "Edit evening preparation list",
    },
    {
      href: `/dashboard/car/${carId}/clutch-measurement`,
      label: "Clutch",
      description: "Review clutch measurement sheet",
    },
    {
      href: `/dashboard/car/${carId}/post-event`,
      label: "Post Event",
      description: "Review post-event sheets and PDFs",
    },
    {
      href: `/car/${carId}/job-list`,
      label: "Mechanic View",
      description: "Open mechanic tick-off view",
      tone: "red",
    },
  ];

  const mobileGroups: NavGroup[] = [
    { title: "Chief Navigation", items: globalLinks },
    { title: `Car ${carId} Tools`, items: carToolLinks },
  ];

  return (
    <div className="sticky top-0 z-40 border-b border-zinc-800 bg-[#0d0f12]/95 text-zinc-100 shadow-xl shadow-black/30 backdrop-blur">
      <div className="mx-auto max-w-[1800px] px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.35em] text-red-400">
              Chief Mechanic Hub
            </p>

            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-zinc-100 sm:text-2xl">
                {currentCar ? carDisplayName(currentCar) : `Car ${carId}`}
              </h2>

              <span className="rounded-full border border-zinc-700 bg-[#14181d] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-400">
                Fast Nav
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setMenuOpen((current) => !current)}
            className="rounded-xl border border-zinc-700 bg-[#14181d] px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-200 transition hover:border-red-500 hover:text-red-200 lg:hidden"
          >
            {menuOpen ? "Close" : "Menu"}
          </button>
        </div>

        <div className="mt-4 hidden gap-3 lg:flex lg:flex-wrap lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            {globalLinks.map((item) => (
              <NavPill key={item.href} item={item} compact />
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            {cars.map((car) => {
              const active = String(car.id) === String(carId);

              return (
                <Link
                  key={car.id}
                  href={`/dashboard/car/${car.id}/viewer`}
                  className={`rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                    active
                      ? "border-red-500 bg-red-950/40 text-red-100"
                      : "border-zinc-700 bg-[#14181d] text-zinc-300 hover:border-red-500/70 hover:text-red-100"
                  }`}
                  style={{
                    borderColor: active ? car.colour || undefined : undefined,
                  }}
                >
                  {carDisplayName(car)}
                </Link>
              );
            })}
          </div>
        </div>

        <div className="mt-3 hidden grid-cols-6 gap-2 xl:grid">
          {carToolLinks.map((item) => (
            <NavPill key={item.href} item={item} />
          ))}
        </div>

        <div className="mt-3 hidden gap-2 lg:flex xl:hidden">
          {carToolLinks.map((item) => (
            <NavPill key={item.href} item={item} compact />
          ))}
        </div>

        {menuOpen && (
          <div className="mt-4 space-y-4 rounded-3xl border border-zinc-800 bg-[#101419] p-4 lg:hidden">
            <section>
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.25em] text-red-400">
                Switch Car
              </p>

              <div className="grid gap-2 sm:grid-cols-3">
                {cars.map((car) => {
                  const active = String(car.id) === String(carId);

                  return (
                    <Link
                      key={car.id}
                      href={`/dashboard/car/${car.id}/viewer`}
                      className={`rounded-xl border px-4 py-3 text-sm font-semibold transition ${
                        active
                          ? "border-red-500 bg-red-950/40 text-red-100"
                          : "border-zinc-700 bg-[#0d0f12] text-zinc-200 hover:border-red-500/70"
                      }`}
                    >
                      {carDisplayName(car)}
                    </Link>
                  );
                })}
              </div>
            </section>

            {mobileGroups.map((group) => (
              <section key={group.title}>
                <p className="mb-3 text-xs font-semibold uppercase tracking-[0.25em] text-red-400">
                  {group.title}
                </p>

                <div className="grid gap-2 sm:grid-cols-2">
                  {group.items.map((item) => (
                    <NavPill key={item.href} item={item} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}