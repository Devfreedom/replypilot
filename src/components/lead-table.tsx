import { StatusSelect } from "@/components/status-select";
import {
  followUpOverdueDays,
  formatCreatedAt,
  formatFollowUpDate,
  isFollowUpDue,
  type Lead,
  type LeadStatus,
} from "@/lib/leads";

function initials(name: string): string {
  return (
    name
      .split(" ")
      .map((part) => part[0])
      .filter(Boolean)
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?"
  );
}

const STATUS_BADGES: Record<LeadStatus, string> = {
  New: "badge badge-new",
  Contacted: "badge badge-contacted",
  Quoted: "badge badge-quoted",
  Booked: "badge badge-booked",
};

function StatusBadge({ lead }: { lead: Lead }) {
  return <span className={STATUS_BADGES[lead.status]}>{lead.status}</span>;
}

function FollowUpIndicator({ lead }: { lead: Lead }) {
  if (isFollowUpDue(lead)) {
    const overdueDays = followUpOverdueDays(lead);

    return (
      <span
        className={`inline-flex items-center gap-2 whitespace-nowrap text-xs font-semibold ${
          overdueDays > 0 ? "text-danger-ink" : "text-warning-ink"
        }`}
      >
        <span
          aria-hidden="true"
          className={`h-2 w-2 rounded-full ${
            overdueDays > 0 ? "bg-danger" : "bg-warning"
          }`}
        />
        {overdueDays > 0 ? "Overdue follow-up" : "Follow-up due"}
      </span>
    );
  }

  const scheduled =
    lead.nextFollowUpAt && !Number.isNaN(Date.parse(lead.nextFollowUpAt))
      ? formatFollowUpDate(lead.nextFollowUpAt)
      : null;

  if (scheduled && lead.status !== "Booked") {
    return (
      <span className="numeric-tabular text-xs text-ink-soft">
        Follow-up {scheduled}
      </span>
    );
  }

  return <span className="text-xs text-ink-faint">Up to date</span>;
}

function Channel({ lead }: { lead: Lead }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-ink-soft">
      {lead.channel === "WhatsApp" ? (
        <>
          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-success" />
          WhatsApp
        </>
      ) : (
        <>
          <span
            aria-hidden="true"
            className="h-2 w-2 rounded-full bg-line-strong"
          />
          Manual
        </>
      )}
    </span>
  );
}

function Avatar({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-bold text-accent-ink"
    >
      {initials(name)}
    </span>
  );
}

function DraftReplyButton({
  onDraftReply,
  lead,
  block = false,
}: {
  onDraftReply: (lead: Lead) => void;
  lead: Lead;
  block?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onDraftReply(lead)}
      className={`btn btn-secondary min-h-10 px-3.5 py-2 text-xs ${
        block ? "w-full sm:w-auto" : "whitespace-nowrap"
      }`}
    >
      Draft reply
    </button>
  );
}

function ReadOnlyStatus({ lead }: { lead: Lead }) {
  return <StatusBadge lead={lead} />;
}

export function LeadTable({
  leads,
  onStatusChange,
  onDraftReply,
  pendingStatusIds,
  canManage,
}: {
  leads: Lead[];
  onStatusChange: (id: string, status: LeadStatus) => void;
  onDraftReply: (lead: Lead) => void;
  pendingStatusIds: ReadonlySet<string>;
  canManage: boolean;
}) {
  return (
    <>
      {/* Card list optimised for single-thumb mobile scanning below md. */}
      <ul className="divide-y divide-line md:hidden">
        {leads.map((lead) => (
          <li key={lead.id} className="space-y-3 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar name={lead.name} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">
                    {lead.name}
                  </p>
                  <p className="truncate text-xs text-ink-soft">
                    {lead.service}
                  </p>
                </div>
              </div>
              {canManage ? (
                <StatusSelect
                  lead={lead}
                  onStatusChange={onStatusChange}
                  disabled={pendingStatusIds.has(lead.id)}
                />
              ) : (
                <ReadOnlyStatus lead={lead} />
              )}
            </div>

            <p className="line-clamp-3 text-sm leading-6 text-ink-soft">
              {lead.lastMessage}
            </p>

            <dl className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-ink-soft">
              <div className="flex items-center gap-1.5">
                <dt className="sr-only">Channel</dt>
                <dd>
                  <Channel lead={lead} />
                </dd>
              </div>
              <div className="flex items-center gap-1.5">
                <dt className="sr-only">Received</dt>
                <dd className="numeric-tabular">
                  {formatCreatedAt(lead.createdAt)}
                </dd>
              </div>
              <div className="flex items-center">
                <dt className="sr-only">Follow-up</dt>
                <dd>
                  <FollowUpIndicator lead={lead} />
                </dd>
              </div>
            </dl>

            {canManage ? (
              <div className="pt-1">
                <DraftReplyButton
                  lead={lead}
                  onDraftReply={onDraftReply}
                  block
                />
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-left">
          <thead className="border-b border-line bg-hushed/70">
            <tr className="text-xs font-semibold text-ink-soft">
              <th scope="col" className="px-4 py-3.5 font-semibold xl:px-6">
                Customer
              </th>
              <th scope="col" className="px-4 py-3.5 font-semibold xl:px-6">
                Service &amp; enquiry
              </th>
              <th
                scope="col"
                className="hidden px-4 py-3.5 font-semibold lg:table-cell xl:px-6"
              >
                Channel
              </th>
              <th scope="col" className="px-4 py-3.5 font-semibold xl:px-6">
                Status
              </th>
              <th scope="col" className="px-4 py-3.5 font-semibold xl:px-6">
                Follow-up
              </th>
              <th
                scope="col"
                className="hidden whitespace-nowrap px-4 py-3.5 font-semibold xl:table-cell xl:px-6"
              >
                Received
              </th>
              <th scope="col" className="px-4 py-3.5 font-semibold xl:px-6">
                Action
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-line">
            {leads.map((lead) => (
              <tr key={lead.id} className="transition-colors hover:bg-hushed/50">
                <td className="px-4 py-4 xl:px-6">
                  <div className="flex items-center gap-3">
                    <Avatar name={lead.name} />
                    <span className="whitespace-nowrap text-sm font-semibold text-ink">
                      {lead.name}
                    </span>
                  </div>
                </td>

                <td className="max-w-xs px-4 py-4 xl:px-6">
                  <p className="text-sm font-medium text-ink">{lead.service}</p>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-ink-soft">
                    {lead.lastMessage}
                  </p>
                </td>

                <td className="hidden px-4 py-4 lg:table-cell xl:px-6">
                  <Channel lead={lead} />
                </td>

                <td className="px-4 py-4 xl:px-6">
                  {canManage ? (
                    <StatusSelect
                      lead={lead}
                      onStatusChange={onStatusChange}
                      disabled={pendingStatusIds.has(lead.id)}
                    />
                  ) : (
                    <ReadOnlyStatus lead={lead} />
                  )}
                </td>

                <td className="px-4 py-4 xl:px-6">
                  <FollowUpIndicator lead={lead} />
                </td>

                <td className="numeric-tabular hidden whitespace-nowrap px-4 py-4 text-xs text-ink-soft xl:table-cell xl:px-6">
                  {formatCreatedAt(lead.createdAt)}
                </td>

                <td className="px-4 py-4 xl:px-6">
                  {canManage ? (
                    <DraftReplyButton lead={lead} onDraftReply={onDraftReply} />
                  ) : (
                    <span className="text-xs text-ink-soft">Read-only</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
