"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function CarTeamJobsRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/team-jobs");
  }, [router]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-black text-neutral-400">
      Opening team jobs...
    </main>
  );
}