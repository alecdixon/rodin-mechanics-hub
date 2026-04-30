"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getAssignedCar, getUserRole } from "@/lib/userAccess";

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("dan.crain@rodinmotorsport.com");
  const [password, setPassword] = useState("Rodin123!");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setLoading(true);
    setErrorMessage("");

    const cleanEmail = email.trim().toLowerCase();

    const { data, error } = await supabase.auth.signInWithPassword({
      email: cleanEmail,
      password,
    });

    setLoading(false);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    const userEmail = data.user?.email?.trim().toLowerCase() ?? cleanEmail;
    const role = getUserRole(userEmail);

    if (role === "chief") {
      document.cookie = `user-email=${userEmail}; path=/; max-age=86400`;
      router.replace("/dashboard");
      return;
    }

    if (role === "mechanic") {
      const assignedCar = getAssignedCar(userEmail);

      if (!assignedCar) {
        await supabase.auth.signOut();
        document.cookie = "user-email=; path=/; max-age=0";
        setErrorMessage("Your account is not assigned to a car yet.");
        return;
      }

      document.cookie = `user-email=${userEmail}; path=/; max-age=86400`;
      router.replace(`/car/${assignedCar}`);
      return;
    }

    await supabase.auth.signOut();
    document.cookie = "user-email=; path=/; max-age=0";
    setErrorMessage("Your account is not assigned to a role yet.");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0d0f12] px-6 text-zinc-100">
      <form
        onSubmit={handleLogin}
        className="w-full max-w-md rounded-3xl border border-zinc-800 bg-[#14181d] p-8 shadow-2xl"
      >
        <p className="text-center text-xs uppercase tracking-[0.35em] text-red-400">
          Rodin Motorsport
        </p>

        <h1 className="mt-4 text-center text-3xl font-semibold">
          Mechanics Hub
        </h1>

        <p className="mt-3 text-center text-sm text-zinc-400">
          Sign in to access your assigned workspace.
        </p>

        <div className="mt-8 space-y-4">
          <div>
            <label className="mb-2 block text-xs uppercase tracking-widest text-zinc-500">
              Email
            </label>

            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-zinc-100 outline-none focus:border-red-500"
              required
            />
          </div>

          <div>
            <label className="mb-2 block text-xs uppercase tracking-widest text-zinc-500">
              Password
            </label>

            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-zinc-100 outline-none focus:border-red-500"
              required
            />
          </div>

          {errorMessage && (
            <div className="rounded-xl border border-red-900 bg-red-950/40 p-3 text-sm text-red-200">
              {errorMessage}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-red-700 px-4 py-3 font-semibold text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </div>
      </form>
    </main>
  );
}