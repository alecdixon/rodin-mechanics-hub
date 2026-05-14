"use client";

import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { hasPermission } from "@/lib/userAccess";

type Props = {
  children: React.ReactNode;
};

type NavItem = {
  href: string;
  title: string;
  description: string;
};

type NavGroup = {
  section: string;
  items: NavItem[];
};

function NavLink({
  href,
  title,
  description,
  active,
  onClick,
}: {
  href: string;
  title: string;
  description: string;
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
      {title}

      <span
        className={`mt-1 block text-xs font-normal leading-5 ${
          active ? "text-red-200/70" : "text-zinc-500"
        }`}
      >
        {description}
      </span>
    </Link>
  );
}

export default function ChiefCarLayout({ children }: Props) {
  const params = useParams();
  const pathname = usePathname();
  const router = useRouter();

  const carId = String(params.carId ?? "");

  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    async function checkAccess() {
      const { data, error } = await supabase.auth.getUser();

      if (error || !data.user?.email) {
        router.replace("/login");
        return;
      }

      const email = data.user.email.trim().toLowerCase();

      if (!hasPermission(email, "dashboard:view")) {
        router.replace("/dashboard");
        return;
      }

      setLoading(false);
    }

    checkAccess();
  }, [router]);

  const links: NavGroup[] = [
    {
      section: "Dashboard",
      items: [
        {
          href: "/dashboard",
          title: "Dashboard",
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
        },
        {
          href: `/dashboard/car/${carId}/evening-job-list`,
          title: "Evening Prep Job List",
          description: "Set, check and modify evening preparation jobs",
        },
        {
          href: "/dashboard/team-jobs",
          title: "Team Jobs",
          description: "Add and publish team-wide jobs",
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
        },
        {
          href: `/dashboard/car/${carId}/post-event`,
          title: "Post Event Sheet",
          description: "Review post-event information and saved PDFs",
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
          href: "/team-jobs",
          title: "Shared Team Jobs View",
          description: "Open the team-wide jobs page",
        },
      ],
    },
  ];

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0d0f12] text-zinc-400">
        Checking dashboard access...
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
        className={`fixed left-0 top-0 z-50 h-screen w-[390px] max-w-[92vw] overflow-y-auto border-r border-zinc-800 bg-[#101419] p-6 shadow-2xl transition-transform duration-300 ${
          menuOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-red-400">
              Car Hub
            </p>

            <h2 className="mt-3 text-3xl font-semibold text-zinc-100">
              Car {carId}
            </h2>

            <p className="mt-2 text-sm leading-6 text-zinc-500">
              Navigate between dashboard pages and mechanic views for this car.
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