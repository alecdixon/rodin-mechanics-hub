export default function HomePage() {
  return (
    <main className="min-h-screen bg-black text-white flex items-center justify-center">
      <div className="text-center">
        <p className="text-sm uppercase tracking-[0.4em] text-red-500">
          Rodin Motorsport
        </p>

        <h1 className="mt-4 text-5xl font-bold">
          Mechanics Hub
        </h1>

        <p className="mt-4 text-neutral-400 max-w-md">
          Workshop jobs, car sheets, measurements, parts tracking and event control.
        </p>
      </div>
    </main>
  );
}