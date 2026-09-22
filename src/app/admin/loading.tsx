export default function AdminLoading() {
  return (
    <div className="space-y-6">
      <div className="h-8 w-56 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-800" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="card h-28 animate-pulse" />
        ))}
      </div>
      <div className="card h-72 animate-pulse" />
    </div>
  );
}
