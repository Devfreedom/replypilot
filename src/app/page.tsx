"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { AppShell } from "@/components/app-shell";
import { LeadTable } from "@/components/lead-table";
import { DraftReplyDialog } from "@/components/draft-reply-dialog";
import {
  NewLeadDialog,
  type NewLeadValues,
} from "@/components/new-lead-dialog";
import { ProtectedApp } from "@/components/protected-app";
import { StatCard } from "@/components/stat-card";
import { Alert, PageHeading, SectionState } from "@/components/ui";
import {
  LEAD_FILTERS,
  followUpOverdueDays,
  formatFollowUpDate,
  isFollowUpDue,
  parseLeadResponse,
  parseLeadsResponse,
  type Lead,
  type LeadFilter,
  type LeadStatus,
  type View,
} from "@/lib/leads";

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function errorMessage(data: unknown, fallback: string): string {
  if (
    typeof data === "object" &&
    data !== null &&
    "error" in data &&
    typeof data.error === "string"
  ) {
    return data.error;
  }

  return fallback;
}

const VIEW_TITLES: Record<View, { title: string; description: string }> = {
  overview: {
    title: "Overview",
    description: "Here's what's happening with your enquiries.",
  },
  leads: {
    title: "All leads",
    description: "Manage customer enquiries and booking opportunities.",
  },
  "follow-ups": {
    title: "Follow-ups",
    description: "Keep track of enquiries that need your attention.",
  },
};

const FILTER_LABELS: Record<LeadFilter, string> = {
  All: "All",
  New: "New",
  Contacted: "Contacted",
  Quoted: "Quoted",
  Booked: "Booked",
};

const STATUS_BADGES: Record<LeadStatus, string> = {
  New: "badge badge-new",
  Contacted: "badge badge-contacted",
  Quoted: "badge badge-quoted",
  Booked: "badge badge-booked",
};

/** Compact list of enquiries whose follow-up time has passed. */
function AttentionItem({
  lead,
  canManage,
  onDraftReply,
}: {
  lead: Lead;
  canManage: boolean;
  onDraftReply: (lead: Lead) => void;
}) {
  const dueDate = lead.nextFollowUpAt
    ? formatFollowUpDate(lead.nextFollowUpAt)
    : null;
  const overdueDays = followUpOverdueDays(lead);

  return (
    <li className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span
          aria-hidden="true"
          className={`h-2 w-2 shrink-0 rounded-full ${
            overdueDays > 0 ? "bg-danger" : "bg-warning"
          }`}
        />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">{lead.name}</p>
          <p className="truncate text-xs text-ink-soft">{lead.service}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-soft">
        <span className={STATUS_BADGES[lead.status]}>{lead.status}</span>
        <span className="whitespace-nowrap font-medium">
          {overdueDays > 0
            ? dueDate
              ? `Overdue — was due ${dueDate}`
              : "Overdue"
            : dueDate
              ? `Due ${dueDate}`
              : "Follow-up due"}
        </span>
      </div>

      {canManage ? (
        <button
          type="button"
          onClick={() => onDraftReply(lead)}
          className="btn btn-quiet shrink-0"
        >
          Draft reply
        </button>
      ) : null}
    </li>
  );
}

/**
 * Contextual next-steps panel. Copy stays truthful: reply drafting uses the
 * mock provider, WhatsApp is inbound-only, and business facts come from
 * Business settings.
 */
function NextSteps({ leadCount }: { leadCount: number }) {
  return (
    <section
      aria-labelledby="next-steps-title"
      className="card border-line p-5 sm:p-6"
    >
      <h2 id="next-steps-title" className="text-sm font-bold text-ink">
        Next steps
      </h2>
      <ol className="mt-3 space-y-3 text-sm leading-6 text-ink-soft">
        {leadCount === 0 ? (
          <li className="flex gap-2.5">
            <span aria-hidden="true" className="font-semibold text-ink">
              1.
            </span>
            <span>
              Record your first customer enquiry with{" "}
              <strong className="font-semibold text-ink">New lead</strong> so
              you can track it and prepare a reply.
            </span>
          </li>
        ) : (
          <li className="flex gap-2.5">
            <span aria-hidden="true" className="font-semibold text-ink">
              1.
            </span>
            <span>
              Keep every enquiry moving by setting a follow-up date on leads
              waiting on a response. Follow-ups due appear at the top of this
              dashboard.
            </span>
          </li>
        )}
        <li className="flex gap-2.5">
          <span aria-hidden="true" className="font-semibold text-ink">
            {leadCount === 0 ? "2." : "2."}
          </span>
          <span>
            In{" "}
            <a
              href="/settings"
              className="font-semibold text-accent-ink hover:underline"
            >
              Business settings
            </a>
            , add the services, prices, opening hours and policies you want
            reply drafts to use.
          </span>
        </li>
        <li className="flex gap-2.5">
          <span aria-hidden="true" className="font-semibold text-ink">
            3.
          </span>
          <span>
            Open a lead and draft a reply. Drafts are demonstration output from
            a mock provider and never send a customer message — review them
            before sending anything yourself.
          </span>
        </li>
      </ol>
    </section>
  );
}

function Dashboard() {
  const { role } = useAuth();
  const canManage = role === "owner";
  const [leads, setLeads] = useState<Lead[]>([]);
  const [view, setView] = useState<View>("overview");
  const [filter, setFilter] = useState<LeadFilter>("All");
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [pendingStatusIds, setPendingStatusIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [operationError, setOperationError] = useState<string | null>(null);
  const [draftLead, setDraftLead] = useState<Lead | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function loadLeads() {
      setIsLoading(true);
      setLoadError(null);

      try {
        const response = await fetch("/api/leads", { signal: controller.signal });
        const data = await readJson(response);

        if (!response.ok) {
          throw new Error(errorMessage(data, "Unable to load leads."));
        }

        const nextLeads = parseLeadsResponse(data);

        if (!nextLeads) {
          throw new Error("The lead service returned an unexpected response.");
        }

        setLeads(nextLeads);
      } catch (error) {
        if (controller.signal.aborted) return;

        setLoadError(
          error instanceof Error ? error.message : "Unable to load leads.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    void loadLeads();
    return () => controller.abort();
  }, [loadAttempt]);

  const displayedLeads = useMemo(() => {
    const query = search.trim().toLowerCase();

    return leads.filter((lead) => {
      const matchesSearch =
        !query ||
        lead.name.toLowerCase().includes(query) ||
        lead.service.toLowerCase().includes(query) ||
        lead.lastMessage.toLowerCase().includes(query);

      const matchesFilter = filter === "All" || lead.status === filter;

      const matchesView =
        view !== "follow-ups" || isFollowUpDue(lead);

      return matchesSearch && matchesFilter && matchesView;
    });
  }, [leads, search, filter, view]);

  const followUpLeads = useMemo(
    () =>
      leads
        .filter((lead) => isFollowUpDue(lead))
        .sort((a, b) => {
          const aTime = a.nextFollowUpAt ? Date.parse(a.nextFollowUpAt) : 0;
          const bTime = b.nextFollowUpAt ? Date.parse(b.nextFollowUpAt) : 0;
          return (Number.isFinite(aTime) ? aTime : 0) - (Number.isFinite(bTime) ? bTime : 0);
        }),
    [leads],
  );

  const followUpCount = followUpLeads.length;

  const quotedCount = leads.filter((lead) => lead.status === "Quoted").length;

  const bookedCount = leads.filter((lead) => lead.status === "Booked").length;

  async function updateStatus(id: string, status: LeadStatus) {
    if (pendingStatusIds.has(id)) return;

    setOperationError(null);
    setPendingStatusIds((current) => new Set(current).add(id));

    try {
      const response = await fetch(`/api/leads/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await readJson(response);

      if (!response.ok) {
        throw new Error(errorMessage(data, "Unable to update this lead."));
      }

      const updatedLead = parseLeadResponse(data);

      if (!updatedLead) {
        throw new Error("The lead service returned an unexpected response.");
      }

      setLeads((current) =>
        current.map((lead) => (lead.id === id ? updatedLead : lead)),
      );
    } catch (error) {
      setOperationError(
        error instanceof Error ? error.message : "Unable to update this lead.",
      );
    } finally {
      setPendingStatusIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }

  async function createLead(values: NewLeadValues) {
    let nextFollowUpAt: string | null = null;

    if (values.nextFollowUpAt) {
      const followUpDate = new Date(values.nextFollowUpAt);

      if (Number.isNaN(followUpDate.getTime())) {
        throw new Error("Enter a valid follow-up date and time.");
      }

      nextFollowUpAt = followUpDate.toISOString();
    }

    const response = await fetch("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: values.name,
        service: values.service,
        lastMessage: values.message,
        whatsappNumber: values.whatsappNumber || null,
        channel: "Manual",
        status: "New",
        nextFollowUpAt,
      }),
    });
    const data = await readJson(response);

    if (!response.ok) {
      throw new Error(errorMessage(data, "Unable to create this lead."));
    }

    const newLead = parseLeadResponse(data);

    if (!newLead) {
      throw new Error("The lead service returned an unexpected response.");
    }

    setLeads((current) => [newLead, ...current]);
    setView("leads");
    setFilter("All");
    setSearch("");
    setModalOpen(false);
  }

  function selectView(nextView: View) {
    setView(nextView);
    setFilter("All");
    setSearch("");
  }

  function clearFilters() {
    setSearch("");
    setFilter("All");
  }

  const newLeadButton = canManage ? (
    <button type="button" onClick={() => setModalOpen(true)} className="btn btn-primary">
      <span aria-hidden="true">＋</span>
      New lead
    </button>
  ) : null;
  const sectionTitle =
    view === "follow-ups"
      ? "Enquiries needing attention"
      : view === "leads"
        ? "All customer enquiries"
        : "Recent leads";

  return (
    <AppShell
      active="dashboard"
      dashboardView={view}
      onSelectDashboardView={selectView}
      leadCount={leads.length}
      followUpCount={followUpCount}
      canManage={canManage}
      title={VIEW_TITLES[view].title}
      /* The primary action sits in the page heading below sm so the mobile
         top bar keeps room for the breadcrumb and theme control. */
      actions={newLeadButton ? (
        <span className="hidden sm:inline-flex">{newLeadButton}</span>
      ) : null}
    >
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {!canManage ? (
          <div className="mb-6">
            <Alert tone="info" role="status">
              You are signed in as a workspace member. Leads and approved
              business data are visible, but only the workspace owner can make
              changes.
            </Alert>
          </div>
        ) : null}

        <PageHeading
          title={VIEW_TITLES[view].title}
          description={VIEW_TITLES[view].description}
        >
          {newLeadButton ? <span className="sm:hidden">{newLeadButton}</span> : null}
        </PageHeading>

        {view === "overview" && (
          <>
            {/* 1. What needs my attention? */}
            <section
              aria-labelledby="attention-title"
              className="card mt-8"
            >
              <div className="flex flex-col justify-between gap-2 border-b border-line px-5 py-4 sm:flex-row sm:items-center sm:px-6">
                <div>
                  <h2 id="attention-title" className="font-bold text-ink">
                    Needs your attention
                  </h2>
                  <p className="mt-0.5 text-xs text-ink-soft">
                    {followUpCount > 0
                      ? `${followUpCount} ${followUpCount === 1 ? "follow-up" : "follow-ups"} overdue or due today`
                      : "Nothing is overdue right now."}
                  </p>
                </div>
                {followUpCount > 0 ? (
                  <button
                    type="button"
                    onClick={() => selectView("follow-ups")}
                    className="btn btn-quiet"
                  >
                    View the follow-ups list →
                  </button>
                ) : null}
              </div>

              {isLoading ? (
                <SectionState title="Checking follow-ups…">
                  <p>One moment while follow-ups load.</p>
                </SectionState>
              ) : loadError ? (
                <SectionState
                  title="Unable to load leads"
                  action={
                    <button
                      type="button"
                      onClick={() => setLoadAttempt((current) => current + 1)}
                      className="btn btn-quiet"
                    >
                      Try again
                    </button>
                  }
                >
                  <p>{loadError}</p>
                </SectionState>
              ) : followUpCount === 0 ? (
                <SectionState icon="✓" title="No follow-ups due">
                  <p>
                    Enquiries with a follow-up date will appear here when the
                    date arrives. You can set one when adding or editing a lead.
                  </p>
                </SectionState>
              ) : (
                <ul className="divide-y divide-line">
                  {followUpLeads.map((lead) => (
                    <AttentionItem
                      key={lead.id}
                      lead={lead}
                      canManage={canManage}
                      onDraftReply={setDraftLead}
                    />
                  ))}
                </ul>
              )}
            </section>

            {/* 2. What is happening with my enquiries? */}
            <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                label="Total leads"
                value={leads.length}
                detail="All recorded enquiries"
                dotColor="bg-accent"
              />
              <StatCard
                label="Need follow-up"
                value={followUpCount}
                detail="Due or overdue"
                dotColor="bg-warning"
              />
              <StatCard
                label="Quotes sent"
                value={quotedCount}
                detail="Awaiting a decision"
                dotColor="bg-violet"
              />
              <StatCard
                label="Bookings"
                value={bookedCount}
                detail="Marked as confirmed"
                dotColor="bg-success"
              />
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              {/* 3. Which leads should I review next? */}
              <section className="card overflow-hidden">
                <div className="border-b border-line px-5 py-4 sm:px-6">
                  <h2 className="font-bold text-ink">{sectionTitle}</h2>
                  <p className="mt-0.5 text-xs text-ink-soft">
                    The most recent enquiries come first.
                  </p>
                </div>
                {buildLeadsSection()}
              </section>

              <NextSteps leadCount={leads.length} />
            </div>
          </>
        )}

        {view !== "overview" && <div className="mt-8">{buildLeadsSection()}</div>}

        <footer className="py-10 text-center text-xs text-ink-faint">
          ReplyPilot · Built to help small businesses follow up
        </footer>
      </div>

      <NewLeadDialog
        open={canManage && modalOpen}
        onClose={() => setModalOpen(false)}
        onCreate={createLead}
      />
      <DraftReplyDialog lead={draftLead} onClose={() => setDraftLead(null)} />
    </AppShell>
  );

  function buildLeadsSection() {
    return (
      <>
        <div className="flex flex-col gap-4 px-5 py-4 sm:px-6 xl:flex-row xl:items-center xl:justify-between">
          <label className="relative block w-full xl:max-w-xs">
            <span className="sr-only">Search leads</span>
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-ink-faint"
            >
              ⌕
            </span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, service or enquiry..."
              className="input rounded-xl bg-hushed pl-9"
            />
          </label>

          <div
            role="group"
            aria-label="Filter leads by status"
            className="flex flex-wrap gap-2"
          >
            {LEAD_FILTERS.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setFilter(item)}
                aria-pressed={filter === item}
                className={`cursor-pointer rounded-lg px-3 py-2 text-xs font-semibold ${
                  filter === item
                    ? "bg-ink text-surface"
                    : "bg-hushed text-ink-soft hover:text-ink"
                }`}
              >
                {FILTER_LABELS[item]}
                {item === "All" ? ` (${leads.length})` : ""}
              </button>
            ))}
          </div>
        </div>

        {operationError ? (
          <div className="px-5 pb-4 sm:px-6">
            <Alert tone="danger">{operationError}</Alert>
          </div>
        ) : null}

        {isLoading ? (
          <div
            role="status"
            className="border-t border-line px-6 py-16 text-center text-sm text-ink-soft"
          >
            Loading leads…
          </div>
        ) : loadError ? (
          <div className="border-t border-line">
            <SectionState
              title="Unable to load leads"
              action={
                <button
                  type="button"
                  onClick={() => setLoadAttempt((current) => current + 1)}
                  className="btn btn-quiet"
                >
                  Try again
                </button>
              }
            >
              <p>{loadError}</p>
            </SectionState>
          </div>
        ) : leads.length === 0 ? (
          <div className="border-t border-line">
            <SectionState
              title="No leads yet"
              action={
                canManage ? (
                  <button
                    type="button"
                    onClick={() => setModalOpen(true)}
                    className="btn btn-primary"
                  >
                    Add a lead
                  </button>
                ) : null
              }
            >
              <p>
                {canManage
                  ? "Add your first customer enquiry to begin tracking it here."
                  : "No leads have been added to this workspace yet."}
              </p>
            </SectionState>
          </div>
        ) : displayedLeads.length === 0 ? (
          <div className="border-t border-line">
            <SectionState
              icon="⌕"
              title="No matching leads"
              action={
                <button
                  type="button"
                  onClick={clearFilters}
                  className="btn btn-quiet"
                >
                  Clear filters
                </button>
              }
            >
              <p>Try another search, change your filter or add a new lead.</p>
            </SectionState>
          </div>
        ) : (
          <div className="border-t border-line">
            <LeadTable
              leads={displayedLeads}
              onStatusChange={updateStatus}
              onDraftReply={setDraftLead}
              pendingStatusIds={pendingStatusIds}
              canManage={canManage}
            />

            <div className="flex flex-col justify-between gap-2 px-5 py-3 text-xs text-ink-faint sm:flex-row sm:items-center sm:px-6">
              <span>
                Showing {displayedLeads.length} of {leads.length} leads
              </span>
              <span>Status changes are saved to the local development API.</span>
            </div>
          </div>
        )}
      </>
    );
  }
}

export default function Home() {
  return (
    <ProtectedApp>
      <Dashboard />
    </ProtectedApp>
  );
}
