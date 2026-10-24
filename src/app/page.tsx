"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { LeadTable } from "@/components/lead-table";
import { DraftReplyDialog } from "@/components/draft-reply-dialog";
import {
  NewLeadDialog,
  type NewLeadValues,
} from "@/components/new-lead-dialog";
import { Sidebar } from "@/components/sidebar";
import { StatCard } from "@/components/stat-card";
import {
  LEAD_FILTERS,
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

export default function Home() {
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

  const followUpCount = leads.filter(
    (lead) => isFollowUpDue(lead),
  ).length;

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

  const { title: pageTitle, description: pageDescription } = VIEW_TITLES[view];

  const sectionTitle =
    view === "follow-ups"
      ? "Enquiries needing attention"
      : view === "leads"
        ? "All customer enquiries"
        : "Recent leads";

  return (
    <div className="flex min-h-screen">
      <Sidebar
        view={view}
        onSelectView={selectView}
        leadCount={leads.length}
        followUpCount={followUpCount}
      />

      <main className="min-w-0 flex-1">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
            <div className="flex items-center gap-3">
              <div
                aria-hidden="true"
                className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-base font-bold text-white lg:hidden"
              >
                R
              </div>
              <nav aria-label="Breadcrumb">
                <p className="text-xs text-slate-500">
                  Workspace <span aria-hidden="true">/</span>{" "}
                  <span className="font-semibold text-slate-700">
                    {pageTitle}
                  </span>
                </p>
              </nav>
            </div>

            <div className="flex items-center gap-3">
              <span className="hidden items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500 sm:inline-flex">
                <span
                  aria-hidden="true"
                  className="h-1.5 w-1.5 rounded-full bg-amber-400"
                />
                Development · Local API
              </span>
              <button
                onClick={() => setModalOpen(true)}
                className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
              >
                <span aria-hidden="true">＋ </span>
                New lead
              </button>
            </div>
          </div>
        </header>

        <div className="mx-auto max-w-7xl px-5 py-8 sm:px-8">
          <nav
            className="mb-6 flex gap-2 overflow-x-auto pb-1 lg:hidden"
            aria-label="Mobile navigation"
          >
            {(Object.keys(VIEW_TITLES) as View[]).map((navView) => (
              <button
                key={navView}
                onClick={() => selectView(navView)}
                aria-current={view === navView ? "page" : undefined}
                className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
                  view === navView
                    ? "bg-blue-100 text-blue-700"
                    : "bg-white text-slate-600 ring-1 ring-slate-200"
                }`}
              >
                {VIEW_TITLES[navView].title}
              </button>
            ))}
            <Link
              href="/settings"
              className="whitespace-nowrap rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-600 ring-1 ring-slate-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
            >
              Settings
            </Link>
          </nav>

          <div className="mb-8">
            <h1 className="text-3xl font-bold tracking-tight text-slate-950">
              {pageTitle}
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">
              {pageDescription}
            </p>
          </div>

          {view === "overview" && (
            <>
              <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard
                  label="Total leads"
                  value={leads.length}
                  detail="All recorded enquiries"
                  icon="♧"
                  accent="blue"
                />
                <StatCard
                  label="Need follow-up"
                  value={followUpCount}
                  detail="Require your attention"
                  icon="◷"
                  accent="amber"
                />
                <StatCard
                  label="Quotes sent"
                  value={quotedCount}
                  detail="Awaiting a decision"
                  icon="↗"
                  accent="violet"
                />
                <StatCard
                  label="Bookings"
                  value={bookedCount}
                  detail="Marked as confirmed"
                  icon="✓"
                  accent="green"
                />
              </div>

              <div className="mb-8 rounded-2xl border border-blue-100 bg-blue-50/60 p-5 sm:p-6">
                <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                  <div className="flex gap-4">
                    <div
                      aria-hidden="true"
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white text-lg text-blue-700 shadow-sm"
                    >
                      ✦
                    </div>
                    <div>
                      <h2 className="font-semibold text-slate-900">
                        Your AI workflow starts here
                      </h2>
                      <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
                        Record an enquiry today. Next, we&apos;ll teach
                        ReplyPilot to extract customer details and prepare a
                        helpful reply for your approval.
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setModalOpen(true)}
                    className="shrink-0 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                  >
                    Add an enquiry
                  </button>
                </div>
              </div>
            </>
          )}

          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 p-5 sm:p-6">
              <h2 className="text-lg font-bold text-slate-900">
                {sectionTitle}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Search, review and update your lead records.
              </p>

              <div className="mt-5 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                <label className="relative block w-full xl:max-w-xs">
                  <span className="sr-only">Search leads</span>
                  <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">
                    ⌕
                  </span>
                  <input
                    type="search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search name, service or enquiry..."
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm outline-none placeholder:text-slate-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
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
                      onClick={() => setFilter(item)}
                      aria-pressed={filter === item}
                      className={`rounded-lg px-3 py-2 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
                        filter === item
                          ? "bg-slate-900 text-white"
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      }`}
                    >
                      {FILTER_LABELS[item]}
                      {item === "All" ? ` (${leads.length})` : ""}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {operationError ? (
              <p role="alert" className="mx-6 mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
                {operationError}
              </p>
            ) : null}

            {isLoading ? (
              <div role="status" className="px-6 py-16 text-center text-sm text-slate-500">
                Loading leads…
              </div>
            ) : loadError ? (
              <div role="alert" className="px-6 py-16 text-center">
                <h3 className="font-semibold text-slate-900">Unable to load leads</h3>
                <p className="mt-1 text-sm text-slate-500">{loadError}</p>
                <button
                  onClick={() => setLoadAttempt((current) => current + 1)}
                  className="mt-4 rounded-lg text-sm font-semibold text-blue-700 hover:text-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                >
                  Try again
                </button>
              </div>
            ) : leads.length === 0 ? (
              <div className="px-6 py-16 text-center">
                <h3 className="font-semibold text-slate-900">No leads yet</h3>
                <p className="mt-1 text-sm text-slate-500">
                  Add your first customer enquiry to begin tracking it here.
                </p>
                <button
                  onClick={() => setModalOpen(true)}
                  className="mt-4 rounded-lg text-sm font-semibold text-blue-700 hover:text-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                >
                  Add a lead
                </button>
              </div>
            ) : displayedLeads.length === 0 ? (
              <div className="px-6 py-16 text-center">
                <div aria-hidden="true" className="text-3xl text-slate-300">
                  ⌕
                </div>
                <h3 className="mt-3 font-semibold text-slate-900">
                  No matching leads
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  Try another search, change your filter or add a new lead.
                </p>
                <button
                  onClick={clearFilters}
                  className="mt-4 rounded-lg text-sm font-semibold text-blue-700 hover:text-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                >
                  Clear filters
                </button>
              </div>
            ) : (
              <>
                <LeadTable
                  leads={displayedLeads}
                  onStatusChange={updateStatus}
                  onDraftReply={setDraftLead}
                  pendingStatusIds={pendingStatusIds}
                />

                <div className="flex flex-col justify-between gap-2 border-t border-slate-100 px-6 py-4 text-xs text-slate-400 sm:flex-row sm:items-center">
                  <span>
                    Showing {displayedLeads.length} of {leads.length} leads
                  </span>
                  <span>Status changes are saved to the local development API.</span>
                </div>
              </>
            )}
          </section>

          <footer className="py-8 text-center text-xs text-slate-400">
            ReplyPilot · Built to help small businesses follow up
          </footer>
        </div>
      </main>

      <NewLeadDialog
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreate={createLead}
      />
      <DraftReplyDialog lead={draftLead} onClose={() => setDraftLead(null)} />
    </div>
  );
}
