import Link from "next/link";

type Props = {
  params: Promise<{ carId: string }>;
};

export default async function CarPage({ params }: Props) {
  const { carId } = await params;

  const sections = [
    {
      title: "Job List",
      description: "Complete the released preparation and post-event jobs.",
      href: `/car/${carId}/job-list`,
      status: "Open",
    },
    {
      title: "Clutch Measurement",
      description: "Record clutch pack, bearing and release measurements.",
      href: `/car/${carId}/clutch-measurement`,
      status: "Not Started",
    },
    {
      title: "Post Event",
      description: "Complete fuel, diff and event close-out information.",
      href: `/car/${carId}/post-event`,
      status: "Draft",
    },
  ];

  return (
    <div>
      <div className="mb-8">
        <p className="text-xs uppercase tracking-[0.3em] text-red-400">
          Mechanic Workspace
        </p>

        <h1 className="mt-3 text-4xl font-semibold">Car {carId}</h1>

        <p className="mt-3 max-w-2xl text-sm text-zinc-400">
          Complete the required car sheets from this device. Progress will
          later be visible to the chief mechanic dashboard.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        {sections.map((section) => (
          <Link
            key={section.title}
            href={section.href}
            className="rounded-3xl border border-zinc-800 bg-[#14181d] p-6 shadow-lg transition hover:-translate-y-1 hover:border-red-500/70 hover:bg-[#181d23]"
          >
            <div className="mb-5 flex items-start justify-between gap-4">
              <h2 className="text-2xl font-semibold">{section.title}</h2>

              <span className="rounded-full border border-zinc-700 bg-[#0d0f12] px-3 py-1 text-xs text-zinc-400">
                {section.status}
              </span>
            </div>

            <p className="text-sm leading-6 text-zinc-400">
              {section.description}
            </p>

            <p className="mt-6 text-sm text-red-400">
              Open section →
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}