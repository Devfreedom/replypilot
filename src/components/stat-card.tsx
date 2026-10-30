export function StatCard({
  label,
  value,
  detail,
  dotColor,
}: {
  label: string;
  value: number;
  detail: string;
  /** Tailwind background class for the small status dot, e.g. `bg-accent`. */
  dotColor: string;
}) {
  return (
    <div className="card p-4 sm:p-5">
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className={`h-2 w-2 rounded-full ${dotColor}`} />
        <p className="text-sm font-medium text-ink-soft">{label}</p>
      </div>
      <p className="mt-3 text-3xl font-bold tracking-tight text-ink">{value}</p>
      <p className="mt-1 text-xs text-ink-faint">{detail}</p>
    </div>
  );
}
