"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getAssignedCar, getUserRole } from "@/lib/userAccess";
import JobListNotificationModal from "@/app/components/JobListNotificationModal";
import TeamJobsNotificationModal from "@/app/components/TeamJobsNotificationModal";

type Props = {
  children: React.ReactNode;
};

type UserRole = "chief" | "mechanic" | "unknown";

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

      if (userRole === "chief") {
        setRole("chief");
        setLoading(false);
        return;
      }

      if (userRole === "mechanic") {
        if (!assignedCar) {
          router.replace("/login");
          return;
        }

        if (String(assignedCar) !== carId) {
          router.replace(`/car/${assignedCar}/job-list`);
          return;
        }

        setRole("mechanic");
        setLoading(false);
        return;
      }

      router.replace("/login");
    }

    checkAccess();

    return () => {
      mounted = false;
    };
  }, [carId, router]);

  const navItems = useMemo(
    () => [
      {
        name: "Job List",
        href: `/car/${carId}/job-list`,
      },
      {
        name: "Evening Job List",
        href: `/car/${carId}/evening-job-list`,
      },
      {
        name: "Team Jobs",
        href: `/car/${carId}/team-jobs`,
      },
      {
        name: "Clutch Measurement",
        href: `/car/${carId}/clutch-measurement`,
      },
      {
        name: "Post Event",
        href: `/car/${carId}/post-event`,
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
        {role === "chief" ? (
          <Link
            href="/dashboard"
            className="text-sm text-red-400 hover:text-red-300"
          >
            ← Chief Dashboard
          </Link>
        ) : (
          <p className="text-sm text-neutral-500">Car Workspace</p>
        )}

        <div className="mt-6">
          <p className="text-xs uppercase tracking-[0.35em] text-red-500">
            Rodin Motorsport
          </p>

          <h2 className="mt-2 text-xl font-bold">Car {carId}</h2>

          {role === "chief" && (
            <p className="mt-2 rounded-full border border-red-900/50 bg-red-950/30 px-3 py-1 text-xs text-red-300">
              Chief mechanic access
            </p>
          )}

          {role === "mechanic" && (
            <p className="mt-2 rounded-full border border-neutral-800 bg-black px-3 py-1 text-xs text-neutral-300">
              Mechanic access
            </p>
          )}
        </div>

        <nav className="mt-8 space-y-2">
          {navItems.map((item) => {
            const active = pathname === item.href;

            return (
              <Link
                key={item.name}
                href={item.href}
                className={[
                  "block rounded-lg border px-4 py-3 text-sm transition",
                  active
                    ? "border-red-500 bg-red-950/40 text-red-100"
                    : "border-neutral-800 bg-black text-neutral-200 hover:border-red-500",
                ].join(" ")}
              >
                {item.name}
              </Link>
            );
          })}

          {role === "chief" && (
            <div className="mt-6 space-y-2 border-t border-neutral-800 pt-6">
              <p className="mb-2 text-xs uppercase tracking-[0.25em] text-neutral-500">
                Chief Tools
              </p>

              <Link
                href={`/dashboard/car/${carId}/viewer`}
                className="block rounded-lg border border-red-800 bg-red-950/30 px-4 py-3 text-sm font-semibold text-red-200 hover:border-red-500"
              >
                Chief Viewer
              </Link>

              <Link
                href={`/dashboard/car/${carId}/job-list`}
                className="block rounded-lg border border-red-800 bg-red-950/30 px-4 py-3 text-sm font-semibold text-red-200 hover:border-red-500"
              >
                Edit Job List
              </Link>

              <Link
                href={`/dashboard/car/${carId}/evening-job-list`}
                className="block rounded-lg border border-red-800 bg-red-950/30 px-4 py-3 text-sm font-semibold text-red-200 hover:border-red-500"
              >
                Edit Evening Job List
              </Link>

              <Link
                href="/dashboard/team-jobs"
                className="block rounded-lg border border-red-800 bg-red-950/30 px-4 py-3 text-sm font-semibold text-red-200 hover:border-red-500"
              >
                Manage Team Jobs
              </Link>
            </div>
          )}
        </nav>
      </aside>

      <main className="flex-1 p-6">{children}</main>

      <JobListNotificationModal
        carId={numericCarId}
        enabled={role === "mechanic" && Number.isFinite(numericCarId)}
      />

      <TeamJobsNotificationModal enabled={role === "mechanic"} />
    </div>
  );
}