import Link from "next/link";

type Props = {
  children: React.ReactNode;
  params: Promise<{ carId: string }>;
};

export default async function CarLayout({ children, params }: Props) {
  const { carId } = await params;

  const navItems = [
    { name: "Job List", href: `/car/${carId}/job-list` },
    { name: "Clutch Measurement", href: `/car/${carId}/clutch-measurement` },
    { name: "Post Event", href: `/car/${carId}/post-event` },
  ];

  return (
    <div className="flex min-h-screen bg-black text-white">
      <aside className="w-64 border-r border-neutral-800 bg-neutral-950 p-5">
        <Link href="/dashboard" className="text-sm text-red-400 hover:text-red-300">
          ← Dashboard
        </Link>

        <div className="mt-6">
          <p className="text-xs uppercase tracking-[0.35em] text-red-500">
            Rodin Motorsport
          </p>
          <h2 className="mt-2 text-xl font-bold">Car {carId}</h2>
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
        </nav>
      </aside>

      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}