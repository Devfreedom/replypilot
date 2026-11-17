export function StatCard({
  label,
  value,
  detail,
  dotColor,
}: {
  label: string;
  value: number;
  detail: string;
  /** Tailwind background class for the status marker, e.g. `bg-accent`. */
  dotColor: string;
}) {
  return (
    <div className="card p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-ink-soft">{label}</p>
        <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-full ${dotColor}`} />
      </div>
      <p className="numeric-tabular mt-3 text-3xl font-bold tracking-tight text-ink">
        {value}
      </p>
      <p className="mt-1 text-xs leading-5 text-ink-soft">{detail}</p>
    </div>
  );
}
