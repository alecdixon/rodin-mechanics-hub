"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import {
  canAccessCarPages,
  getAssignedCar,
  getUserRole,
  type UserRole,
} from "@/lib/userAccess";
import JobListNotificationModal from "@/app/components/JobListNotificationModal";
import TeamJobsNotificationModal from "@/app/components/TeamJobsNotificationModal";

type Props = {
  children: React.ReactNode;
};

type NavItem = {
  name: string;
  href: string;
  description?: string;
};

function isRouteActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function CarLayout({ children }: Props) {
  const router = useRouter();
  const params = useParams();
  const pathname = usePathname();

  const carId = String(params.carId ?? "");
  const numericCarId = Number(carId);

  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<UserRole>("unknown");

  useEffect(() => {
    let mounted = true;

    async function checkAccess() {
      setLoading(true);

      const { data, error } = await supabase.auth.getUser();

      if (error || !data.user?.email) {
        router.replace("/login");
        return;
      }

      const email = data.user.email;
      const userRole = getUserRole(email);
      const assignedCar = getAssignedCar(email);

      if (!mounted) return;

      if (userRole === "number2_mechanic") {
        router.replace("/team-jobs");
        return;
      }

      if (!Number.isFinite(numericCarId) || numericCarId <= 0) {
        router.replace("/login");
        return;
      }

      if (!canAccessCarPages(email, numericCarId)) {
        if (userRole === "number1_mechanic" && assignedCar) {
          router.replace(`/car/${assignedCar}/job-list`);
          return;
        }

        router.replace("/login");
        return;
      }

      setRole(userRole);
      setLoading(false);
    }

    checkAccess();

    return () => {
      mounted = false;
    };
  }, [numericCarId, router]);

  const navItems = useMemo<NavItem[]>(
    () => [
      {
        name: "Job List",
        href: `/car/${carId}/job-list`,
        description: "Workshop job checklist",
      },
      {
        name: "Evening Job List",
        href: `/car/${carId}/evening-job-list`,
        description: "Evening prep checklist",
      },
      {
        name: "Team Jobs",
        href: "/team-jobs",
        description: "Team-wide jobs",
      },
      {
        name: "Sticker List",
        href: "/sticker-list",
        description: "Create and print sticker requirements",
      },
      {
        name: "Recorded Issues",
        href: "/recorded-issues",
        description: "Log and search known faults and fixes",
      },
      {
        name: "Clutch Measurement",
        href: `/car/${carId}/clutch-measurement`,
        description: "Measure and save clutch sheet",
      },
      {
        name: "Drain Out",
        href: `/car/${carId}/drain-out`,
        description: "Report Rig 1 / Rig 2 drain out figure",
      },
      {
        name: "Post Event",
        href: `/car/${carId}/post-event`,
        description: "Post-event report",
      },
    ],
    [carId],
  );

  const chiefItems = useMemo<NavItem[]>(
    () => [
      {
        name: "Chief Viewer",
        href: `/dashboard/car/${carId}/viewer`,
      },
      {
        name: "Edit Job List",
        href: `/dashboard/car/${carId}/job-list`,
      },
      {
        name: "Edit Evening Job List",
        href: `/dashboard/car/${carId}/evening-job-list`,
      },
      {
        name: "Manage Team Jobs",
        href: "/dashboard/team-jobs",
      },
      {
        name: "Sticker List",
        href: "/sticker-list",
      },
      {
        name: "Recorded Issues",
        href: "/recorded-issues",
      },
    ],
    [carId],
  );

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black text-zinc-400">
        Checking access...
      </main>
    );
  }

  return (
    <div className="flex min-h-screen bg-black text-white">
      <aside className="w-64 shrink-0 border-r border-neutral-800 bg-neutral-950 p-5">
        {role === "chief_mechanic" || role === "engineer" ? (
          <Link
            href="/dashboard"
            className="text-sm text-red-400 hover:text-red-300"
          >
            ← Dashboard
          </Link>
        ) : (
          <p className="text-sm text-neutral-500">Car Workspace</p>
        )}

        <div className="mt-6">
          <p className="text-xs uppercase tracking-[0.35em] text-red-500">
            Rodin Motorsport
          </p>

          <h2 className="mt-2 text-xl font-bold">Car {carId}</h2>

          {role === "chief_mechanic" && (
            <p className="mt-2 rounded-full border border-red-900/50 bg-red-950/30 px-3 py-1 text-xs text-red-300">
              Chief mechanic access
            </p>
          )}

          {role === "number1_mechanic" && (
            <p className="mt-2 rounded-full border border-neutral-800 bg-black px-3 py-1 text-xs text-neutral-300">
              Number 1 mechanic access
            </p>
          )}

          {role === "engineer" && (
            <p className="mt-2 rounded-full border border-blue-900/50 bg-blue-950/30 px-3 py-1 text-xs text-blue-300">
              Engineer access
            </p>
          )}
        </div>

        <nav className="mt-8 space-y-2">
          {navItems.map((item) => {
            const active = isRouteActive(pathname, item.href);
            const isDrainOut = item.name === "Drain Out";
            const isStickerList = item.name === "Sticker List";
            const isRecordedIssues = item.name === "Recorded Issues";

            return (
              <Link
                key={item.name}
                href={item.href}
                className={[
                  "block rounded-lg border px-4 py-3 text-sm transition",
                  active
                    ? "border-red-500 bg-red-950/40 text-red-100"
                    : isDrainOut
                      ? "border-red-900/70 bg-red-950/20 text-red-100 hover:border-red-500 hover:bg-red-950/40"
                      : isStickerList || isRecordedIssues
                        ? "border-zinc-700 bg-[#1b2026] text-zinc-100 hover:border-red-500 hover:bg-[#222832]"
                        : "border-neutral-800 bg-black text-neutral-200 hover:border-red-500",
                ].join(" ")}
              >
                <span className="block font-semibold">{item.name}</span>

                {isDrainOut && (
                  <span className="mt-1 block text-xs font-normal leading-4 text-red-300/80">
                    Rig 1 / Rig 2 figure
                  </span>
                )}

                {isStickerList && (
                  <span className="mt-1 block text-xs font-normal leading-4 text-zinc-400">
                    Add / print sticker list
                  </span>
                )}

                {isRecordedIssues && (
                  <span className="mt-1 block text-xs font-normal leading-4 text-zinc-400">
                    Faults / fixes database
                  </span>
                )}
              </Link>
            );
          })}

          {role === "chief_mechanic" && (
            <div className="mt-6 space-y-2 border-t border-neutral-800 pt-6">
              <p className="mb-2 text-xs uppercase tracking-[0.25em] text-neutral-500">
                Chief Tools
              </p>

              {chiefItems.map((item) => {
                const active = isRouteActive(pathname, item.href);
                const isStickerList = item.name === "Sticker List";
                const isRecordedIssues = item.name === "Recorded Issues";

                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    className={[
                      "block rounded-lg border px-4 py-3 text-sm font-semibold transition",
                      active
                        ? "border-red-500 bg-red-950/50 text-red-100"
                        : isStickerList || isRecordedIssues
                          ? "border-zinc-700 bg-[#1b2026] text-zinc-100 hover:border-red-500 hover:bg-[#222832]"
                          : "border-red-800 bg-red-950/30 text-red-200 hover:border-red-500",
                    ].join(" ")}
                  >
                    {item.name}
                  </Link>
                );
              })}
            </div>
          )}
        </nav>
      </aside>

      <main className="flex-1 p-6">{children}</main>

      <JobListNotificationModal
        carId={numericCarId}
        enabled={role === "number1_mechanic" && Number.isFinite(numericCarId)}
      />

      <TeamJobsNotificationModal enabled={role === "number1_mechanic"} />
    </div>
  );
}