"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getLoginRedirect, getUserRole, resolveLoginIdentifier } from "@/lib/userAccess";

const GUEST_USERNAME = "iamaguest";
const GUEST_EMAIL = "guest@rodinmotorsport.com";

function normaliseLoginIdentifier(value: string) {
  const cleaned = value.trim().toLowerCase();

  if (cleaned === GUEST_USERNAME) {
    return GUEST_EMAIL;
  }

  return resolveLoginIdentifier(cleaned);
}

export default function LoginPage() {
  const router = useRouter();

  const [loginIdentifier, setLoginIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const loginEmail = normaliseLoginIdentifier(loginIdentifier);
    const loginPassword = password.trim();

    if (!loginEmail || !loginPassword) {
      setErrorMessage("Please enter your username/email and password.");
      return;
    }

    setLoading(true);
    setErrorMessage("");

    const { data, error } = await supabase.auth.signInWithPassword({
      email: loginEmail,
      password: loginPassword,
    });

    setLoading(false);

    if (error) {
      setErrorMessage(error.message || "Login failed. Please check your details.");
      return;
    }

    const userEmail = data.user?.email?.trim().toLowerCase() || loginEmail;
    const role = getUserRole(userEmail);

    if (role === "unknown") {
      await supabase.auth.signOut();
      document.cookie = "user-email=; path=/; max-age=0";
      setErrorMessage(
        `Your account is not assigned to a role yet. Logged in email: ${userEmail}`
      );
      return;
    }

    const redirectPath = getLoginRedirect(userEmail);

    if (!redirectPath || redirectPath === "/login") {
      await supabase.auth.signOut();
      document.cookie = "user-email=; path=/; max-age=0";
      setErrorMessage(
        `Your account is not assigned to a valid workspace yet. Logged in email: ${userEmail}`
      );
      return;
    }

    document.cookie = `user-email=${userEmail}; path=/; max-age=86400; SameSite=Lax`;
    router.replace(redirectPath);
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
              Email / Username
            </label>

            <input
              type="text"
              value={loginIdentifier}
              onChange={(event) => setLoginIdentifier(event.target.value)}
              placeholder="Rodin email or IamaGuest"
              className="w-full rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-zinc-100 outline-none focus:border-red-500"
              autoComplete="username"
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
              placeholder="Password"
              className="w-full rounded-xl border border-zinc-700 bg-[#0d0f12] px-4 py-3 text-zinc-100 outline-none focus:border-red-500"
              autoComplete="current-password"
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