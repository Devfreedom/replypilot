import { LEAD_STATUSES, type Lead, type LeadStatus } from "@/lib/leads";

const statusStyles: Record<LeadStatus, string> = {
  New: "badge-new",
  Contacted: "badge-contacted",
  Quoted: "badge-quoted",
  Booked: "badge-booked",
};

export function StatusSelect({
  lead,
  onStatusChange,
  disabled = false,
}: {
  lead: Pick<Lead, "id" | "name" | "status">;
  onStatusChange: (id: string, status: LeadStatus) => void;
  disabled?: boolean;
}) {
  return (
    <label className="inline-flex">
      <span className="sr-only">Update status for {lead.name}</span>
      <select
        value={lead.status}
        disabled={disabled}
        onChange={(event) =>
          onStatusChange(lead.id, event.target.value as LeadStatus)
        }
        className={`badge min-h-9 cursor-pointer px-3 pr-7 ring-1 ring-inset ring-current/25 outline-none disabled:cursor-not-allowed disabled:opacity-60 ${statusStyles[lead.status]}`}
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
