"use client";

import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function LogoutButton() {
  const router = useRouter();

  async function handleLogout() {
    await supabase.auth.signOut();

    document.cookie = "user-email=; path=/; max-age=0";
    document.cookie = "user-role=; path=/; max-age=0";
    document.cookie = "assigned-car-id=; path=/; max-age=0";

    router.push("/login");
  }

  return (
    <button
      onClick={handleLogout}
      className="rounded-xl border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-red-500 hover:bg-red-950/40 hover:text-white"
    >
      Logout
    </button>
  );
}