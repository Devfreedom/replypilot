import { StatusSelect } from "@/components/status-select";
import {
  formatCreatedAt,
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

function FollowUpIndicator({ lead }: { lead: Lead }) {
  if (isFollowUpDue(lead)) {
    return (
      <span className="inline-flex items-center gap-2 whitespace-nowrap text-xs font-medium text-amber-700">
        <span aria-hidden="true" className="h-2 w-2 rounded-full bg-amber-500" />
        Follow-up due
      </span>
    );
  }

  return <span className="text-xs text-slate-400">Up to date</span>;
}

function Channel({ lead }: { lead: Lead }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-slate-600">
      {lead.channel === "WhatsApp" ? (
        <>
          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-emerald-500" />
          WhatsApp
        </>
      ) : (
        <>
          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-slate-300" />
          Manual
        </>
      )}
    </span>
  );
}

export function LeadTable({
  leads,
  onStatusChange,
  pendingStatusIds,
}: {
  leads: Lead[];
  onStatusChange: (id: string, status: LeadStatus) => void;
  pendingStatusIds: ReadonlySet<string>;
}) {
  return (
    <>
      {/* Accessible card layout for small screens; the table is used from md up. */}
      <ul className="divide-y divide-slate-100 md:hidden">
        {leads.map((lead) => (
          <li key={lead.id} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span
                  aria-hidden="true"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-bold text-slate-600"
                >
                  {initials(lead.name)}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-800">
                    {lead.name}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {lead.service}
                  </p>
                </div>
              </div>
              <StatusSelect
                lead={lead}
                onStatusChange={onStatusChange}
                disabled={pendingStatusIds.has(lead.id)}
              />
            </div>

            <p className="mt-3 text-sm leading-6 text-slate-600">
              {lead.lastMessage}
            </p>

            <dl className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
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
          <thead className="bg-slate-50/80">
            <tr className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              <th scope="col" className="px-6 py-4">
                Customer
              </th>
              <th scope="col" className="px-6 py-4">
                Service / enquiry
              </th>
              <th scope="col" className="px-6 py-4">
                Channel
              </th>
              <th scope="col" className="px-6 py-4">
                Status
              </th>
              <th scope="col" className="px-6 py-4">
                Follow-up
              </th>
              <th scope="col" className="px-6 py-4">
                Received
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-100">
            {leads.map((lead) => (
              <tr key={lead.id} className="hover:bg-slate-50/70">
                <td className="px-6 py-5">
                  <div className="flex items-center gap-3">
                    <span
                      aria-hidden="true"
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-bold text-slate-600"
                    >
                      {initials(lead.name)}
                    </span>
                    <span className="whitespace-nowrap text-sm font-semibold text-slate-800">
                      {lead.name}
                    </span>
                  </div>
                </td>

                <td className="max-w-xs px-6 py-5">
                  <p className="text-sm font-medium text-slate-700">
                    {lead.service}
                  </p>
                  <p className="mt-1 truncate text-xs text-slate-400">
                    {lead.lastMessage}
                  </p>
                </td>

                <td className="px-6 py-5">
                  <Channel lead={lead} />
                </td>

                <td className="px-6 py-5">
                  <StatusSelect
                    lead={lead}
                    onStatusChange={onStatusChange}
                    disabled={pendingStatusIds.has(lead.id)}
                  />
                </td>

                <td className="px-6 py-5">
                  <FollowUpIndicator lead={lead} />
                </td>

                <td className="whitespace-nowrap px-6 py-5 text-xs text-slate-500">
                  {formatCreatedAt(lead.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
