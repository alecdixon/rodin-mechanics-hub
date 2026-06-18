import Link from "next/link";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-[#0d0f12] p-8 text-white">
      <div className="mx-auto max-w-3xl rounded-3xl border border-zinc-800 bg-[#14181d] p-8 shadow-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.35em] text-red-400">
          Rodin Mechanics Hub
        </p>

        <h1 className="mt-4 text-4xl font-semibold">
          Mechanics Hub
        </h1>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <Link
            href="/dashboard"
            className="rounded-2xl border border-zinc-700 bg-[#1b2026] px-6 py-5 font-semibold transition hover:border-red-500 hover:bg-[#222832]"
          >
            Dashboard
          </Link>

          <Link
            href="/legality"
            className="rounded-2xl border border-red-700 bg-red-950/40 px-6 py-5 font-semibold text-red-100 transition hover:border-red-400 hover:bg-red-900/50"
          >
            Legality
          </Link>

          <Link
            href="/login"
            className="rounded-2xl border border-zinc-700 bg-[#1b2026] px-6 py-5 font-semibold transition hover:border-red-500 hover:bg-[#222832]"
          >
            Login
          </Link>
        </div>
      </div>
    </main>
  );
}
