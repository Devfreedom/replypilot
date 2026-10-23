import { LEAD_STATUSES, type Lead, type LeadStatus } from "@/lib/leads";

const statusStyles: Record<LeadStatus, string> = {
  New: "bg-blue-50 text-blue-700 ring-blue-200",
  Contacted: "bg-violet-50 text-violet-700 ring-violet-200",
  Quoted: "bg-amber-50 text-amber-700 ring-amber-200",
  Booked: "bg-emerald-50 text-emerald-700 ring-emerald-200",
};

export function StatusSelect({
  lead,
  onStatusChange,
}: {
  lead: Pick<Lead, "id" | "name" | "status">;
  onStatusChange: (id: number, status: LeadStatus) => void;
}) {
  return (
    <label className="inline-flex">
      <span className="sr-only">Update status for {lead.name}</span>
      <select
        value={lead.status}
        onChange={(event) =>
          onStatusChange(lead.id, event.target.value as LeadStatus)
        }
        className={`cursor-pointer rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${statusStyles[lead.status]}`}
      >
        {LEAD_STATUSES.map((status) => (
          <option key={status} value={status}>
            {status}
          </option>
        ))}
      </select>
    </label>
  );
}
