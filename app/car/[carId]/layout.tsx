"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getAssignedCar, getUserRole } from "@/lib/userAccess";

type Props = {
  children: React.ReactNode;
};

export default function CarLayout({ children }: Props) {
  const router = useRouter();
  const params = useParams();
  const carId = String(params.carId ?? "");

  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<"chief" | "mechanic" | "unknown">(
    "unknown",
  );

  useEffect(() => {
    async function checkAccess() {
      const { data } = await supabase.auth.getUser();
      const email = data.user?.email ?? "";
      const userRole = getUserRole(email);
      const assignedCar = getAssignedCar(email);

      if (userRole === "chief") {
        setRole("chief");
        setLoading(false);
        return;
      }

      if (userRole === "mechanic") {
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
  }, [carId, router]);

  const navItems = [
    {
      name: "Job List",
      href: `/car/${carId}/job-list`,
    },
    {
      name: "Evening Job List",
      href: `/car/${carId}/evening-job-list`,
    },
    {
      name: "Clutch Measurement",
      href: `/car/${carId}/clutch-measurement`,
    },
    {
      name: "Post Event",
      href: `/car/${carId}/post-event`,
    },
  ];

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black text-zinc-400">
        Checking access...
      </main>
    );
  }

  return (
    <div className="flex min-h-screen bg-black text-white">
      <aside className="w-64 border-r border-neutral-800 bg-neutral-950 p-5">
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
        </div>

        <nav className="mt-8 space-y-2">
          {navItems.map((item) => (
            <Link
              key={item.name}
              href={item.href}
              className="block rounded-lg border border-neutral-800 bg-black px-4 py-3 text-sm hover:border-red-500"
            >
              {item.name}
            </Link>
          ))}

          {role === "chief" && (
            <div className="mt-6 space-y-2">
              <Link
                href={`/dashboard/car/${carId}/viewer`}
                className="block rounded-lg border border-red-800 bg-red-950/30 px-4 py-3 text-sm font-semibold text-red-200 hover:border-red-500"
              >
                Chief Viewer
              </Link>

              <Link
                href={`/dashboard/car/${carId}/evening-job-list`}
                className="block rounded-lg border border-red-800 bg-red-950/30 px-4 py-3 text-sm font-semibold text-red-200 hover:border-red-500"
              >
                Edit Evening Job List
              </Link>
            </div>
          )}
        </nav>
      </aside>

      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}