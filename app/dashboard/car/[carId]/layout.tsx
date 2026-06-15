"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import ChiefCarNavigation from "@/app/components/ChiefCarNavigation";
import { supabase } from "@/lib/supabase";
import { hasPermission } from "@/lib/userAccess";

type Props = {
  children: ReactNode;
};

export default function ChiefCarLayout({ children }: Props) {
  const params = useParams();
  const router = useRouter();

  const carId = String(params.carId ?? "");
  const numericCarId = Number(carId);

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function checkAccess() {
      setLoading(true);

      if (!Number.isFinite(numericCarId) || numericCarId <= 0) {
        router.replace("/dashboard");
        return;
      }

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

      if (mounted) {
        setLoading(false);
      }
    }

    checkAccess();

    return () => {
      mounted = false;
    };
  }, [numericCarId, router]);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0d0f12] text-zinc-400">
        Checking dashboard access...
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-[#0d0f12] text-zinc-100">
      <ChiefCarNavigation carId={carId} />
      {children}
    </div>
  );
}