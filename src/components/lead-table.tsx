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
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2);
}

const STATUS_BADGES: Record<LeadStatus, string> = {
  New: "badge badge-new",
  Contacted: "badge badge-contacted",
  Quoted: "badge badge-quoted",
  Booked: "badge badge-booked",
};

function StatusBadge({ lead }: { lead: Lead }) {
  return (
    <span className={STATUS_BADGES[lead.status]}>{lead.status}</span>
  );
}

function FollowUpIndicator({ lead }: { lead: Lead }) {
  if (isFollowUpDue(lead)) {
    const overdueDays = followUpOverdueDays(lead);

    return (
      <span
        className={`inline-flex items-center gap-2 whitespace-nowrap text-xs font-medium ${
          overdueDays > 0 ? "text-danger-ink" : "text-warning-ink"
        }`}
      >
        <span
          aria-hidden="true"
          className={`h-2 w-2 rounded-full ${
            overdueDays > 0 ? "bg-danger" : "bg-warning"
          }`}
        />
        Follow-up due
      </span>
    );
  }

  const scheduled = lead.nextFollowUpAt && !Number.isNaN(Date.parse(lead.nextFollowUpAt))
    ? formatFollowUpDate(lead.nextFollowUpAt)
    : null;

  if (scheduled && lead.status !== "Booked") {
    return <span className="text-xs text-ink-soft">Follow-up {scheduled}</span>;
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
          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-line-strong" />
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
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-hushed text-sm font-bold text-ink-soft"
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
      className={`btn btn-quiet ${block ? "w-fit" : "whitespace-nowrap"}`}
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
      {/* Accessible card layout for small screens; the table is used from md up. */}
      <ul className="divide-y divide-line md:hidden">
        {leads.map((lead) => (
          <li key={lead.id} className="p-4">
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

            <p className="mt-3 text-sm leading-6 text-ink-soft">
              {lead.lastMessage}
            </p>

            {canManage ? (
              <div className="mt-2">
                <DraftReplyButton lead={lead} onDraftReply={onDraftReply} block />
              </div>
            ) : null}

            <dl className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-soft">
              <div className="flex items-center gap-1.5">
                <dt className="sr-only">Channel</dt>
                <dd>
                  <Channel lead={lead} />
                </dd>
              </div>
              <div className="flex items-center gap-1.5">
                <dt className="sr-only">Received</dt>
                <dd>{formatCreatedAt(lead.createdAt)}</dd>
              </div>
              <div className="flex items-center">
                <dt className="sr-only">Follow-up</dt>
                <dd>
                  <FollowUpIndicator lead={lead} />
                </dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>

      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-left">
          <thead className="bg-hushed">
            <tr className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
              <th scope="col" className="px-6 py-3.5 font-semibold">
                Customer
              </th>
              <th scope="col" className="px-6 py-3.5 font-semibold">
                Service / enquiry
              </th>
              <th scope="col" className="px-6 py-3.5 font-semibold">
                Channel
              </th>
              <th scope="col" className="px-6 py-3.5 font-semibold">
                Status
              </th>
              <th scope="col" className="px-6 py-3.5 font-semibold">
                Follow-up
              </th>
              <th scope="col" className="px-6 py-3.5 font-semibold">
                Received
              </th>
              <th scope="col" className="px-6 py-3.5 font-semibold">
                Action
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-line">
            {leads.map((lead) => (
              <tr key={lead.id} className="transition-colors hover:bg-hushed/60">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <Avatar name={lead.name} />
                    <span className="whitespace-nowrap text-sm font-semibold text-ink">
                      {lead.name}
                    </span>
                  </div>
                </td>

                <td className="max-w-xs px-6 py-4">
                  <p className="text-sm font-medium text-ink">{lead.service}</p>
                  <p className="mt-1 truncate text-xs text-ink-faint">
                    {lead.lastMessage}
                  </p>
                </td>

                <td className="px-6 py-4">
                  <Channel lead={lead} />
                </td>

                <td className="px-6 py-4">
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

                <td className="px-6 py-4">
                  <FollowUpIndicator lead={lead} />
                </td>

                <td className="whitespace-nowrap px-6 py-4 text-xs text-ink-soft">
                  {formatCreatedAt(lead.createdAt)}
                </td>

                <td className="px-6 py-4">
                  {canManage ? (
                    <DraftReplyButton lead={lead} onDraftReply={onDraftReply} />
                  ) : (
                    <span className="text-xs text-ink-faint">Read-only</span>
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
