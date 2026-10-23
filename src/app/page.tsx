"use client";

import { useMemo, useState, type FormEvent } from "react";

type LeadStatus = "New" | "Contacted" | "Quoted" | "Booked";
type LeadFilter = "All" | LeadStatus;
type View = "overview" | "leads" | "follow-ups";

type Lead = {
  id: number;
  name: string;
  service: string;
  channel: "WhatsApp" | "Manual";
  status: LeadStatus;
  date: string;
  lastMessage: string;
  due: boolean;
};

const initialLeads: Lead[] = [
  {
    id: 1,
    name: "Sarah Musa",
    service: "Wedding photography",
    channel: "WhatsApp",
    status: "New",
    date: "12 min ago",
    lastMessage: "Are you available for a wedding in Jos this December?",
    due: true,
  },
  {
    id: 2,
    name: "Daniel James",
    service: "Event decoration",
    channel: "Manual",
    status: "Quoted",
    date: "1 hr ago",
    lastMessage: "Can you share your packages for a traditional wedding?",
    due: true,
  },
  {
    id: 3,
    name: "Amina Yakubu",
    service: "Portrait photography",
    channel: "WhatsApp",
    status: "Contacted",
    date: "Yesterday",
    lastMessage: "I'm looking for a portrait session next week.",
    due: false,
  },
  {
    id: 4,
    name: "Peter Sunday",
    service: "Wedding photography",
    channel: "Manual",
    status: "Booked",
    date: "2 days ago",
    lastMessage: "I'd like to confirm my photography package.",
    due: false,
  },
  {
    id: 5,
    name: "Grace John",
    service: "Event decoration",
    channel: "WhatsApp",
    status: "New",
    date: "2 days ago",
    lastMessage: "Please send details of your event decoration services.",
    due: true,
  },
];

const statusStyles: Record<LeadStatus, string> = {
  New: "bg-blue-50 text-blue-700 ring-blue-100",
  Contacted: "bg-violet-50 text-violet-700 ring-violet-100",
  Quoted: "bg-amber-50 text-amber-700 ring-amber-100",
  Booked: "bg-emerald-50 text-emerald-700 ring-emerald-100",
};

const filters: LeadFilter[] = [
  "All",
  "New",
  "Contacted",
  "Quoted",
  "Booked",
];

export default function Home() {
  const [leads, setLeads] = useState<Lead[]>(initialLeads);
  const [view, setView] = useState<View>("overview");
  const [filter, setFilter] = useState<LeadFilter>("All");
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);

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
        view !== "follow-ups" ||
        (lead.due && lead.status !== "Booked");

      return matchesSearch && matchesFilter && matchesView;
    });
  }, [leads, search, filter, view]);

  const followUpCount = leads.filter(
    (lead) => lead.due && lead.status !== "Booked",
  ).length;

  const quotedCount = leads.filter(
    (lead) => lead.status === "Quoted",
  ).length;

  const bookedCount = leads.filter(
    (lead) => lead.status === "Booked",
  ).length;

  function updateStatus(id: number, status: LeadStatus) {
    setLeads((current) =>
      current.map((lead) =>
        lead.id === id
          ? {
              ...lead,
              status,
              due: status === "Booked" ? false : lead.due,
            }
          : lead,
      ),
    );
  }

  function createLead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const service = String(form.get("service") ?? "").trim();
    const message = String(form.get("message") ?? "").trim();

    if (!name || !service || !message) return;

    const newLead: Lead = {
      id: Date.now(),
      name,
      service,
      channel: "Manual",
      status: "New",
      date: "Just now",
      lastMessage: message,
      due: true,
    };

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

  const pageTitle =
    view === "overview"
      ? "Overview"
      : view === "leads"
        ? "All leads"
        : "Follow-ups";

  const pageDescription =
    view === "overview"
      ? "Here's what's happening with your enquiries."
      : view === "leads"
        ? "Manage customer enquiries and booking opportunities."
        : "Keep track of enquiries that need your attention.";

  return (
    <div className="min-h-screen bg-[#f6f8fc] text-slate-900">
      <div className="flex min-h-screen">
        <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-white px-5 py-6 lg:flex">
          <div className="flex items-center gap-3 px-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-xl font-bold text-white">
              R
            </div>
            <div>
              <p className="text-lg font-bold tracking-tight">ReplyPilot</p>
              <p className="text-xs text-slate-500">Customer workflow</p>
            </div>
          </div>

          <div className="mt-10">
            <p className="mb-3 px-3 text-xs font-semibold uppercase tracking-widest text-slate-400">
              Workspace
            </p>

            <nav className="space-y-1" aria-label="Main navigation">
              <button
                onClick={() => selectView("overview")}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium ${
                  view === "overview"
                    ? "bg-blue-50 text-blue-700"
                    : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                <span aria-hidden="true">◫</span>
                Overview
              </button>

              <button
                onClick={() => selectView("leads")}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium ${
                  view === "leads"
                    ? "bg-blue-50 text-blue-700"
                    : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                <span aria-hidden="true">♧</span>
                All leads
                <span className="ml-auto text-xs">{leads.length}</span>
              </button>

              <button
                onClick={() => selectView("follow-ups")}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium ${
                  view === "follow-ups"
                    ? "bg-blue-50 text-blue-700"
                    : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                <span aria-hidden="true">◷</span>
                Follow-ups
                {followUpCount > 0 && (
                  <span className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                    {followUpCount}
                  </span>
                )}
              </button>
            </nav>
          </div>

          <div className="mt-auto rounded-2xl border border-blue-100 bg-blue-50/70 p-4">
            <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-white text-lg">
              ✦
            </div>
            <p className="text-sm font-semibold text-slate-800">
              AI assistant
            </p>
            <p className="mt-1 text-xs leading-5 text-slate-600">
              AI-generated replies are coming next. For now, manage your
              customer enquiries here.
            </p>
            <span className="mt-3 inline-flex rounded-full bg-white px-2.5 py-1 text-xs font-medium text-blue-700">
              In development
            </span>
          </div>

          <div className="mt-5 flex items-center gap-3 border-t border-slate-100 pt-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-900 font-semibold text-white">
              F
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">Your business</p>
              <p className="text-xs text-slate-500">Workspace owner</p>
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <header className="border-b border-slate-200 bg-white">
            <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
              <div>
                <p className="text-sm font-semibold lg:hidden">
                  ReplyPilot
                </p>
                <p className="text-xs text-slate-500">
                  Workspace / {pageTitle}
                </p>
              </div>

              <div className="flex items-center gap-3">
                <span className="hidden text-xs text-slate-500 sm:inline">
                  Prototype · Sample data
                </span>
                <button
                  onClick={() => setModalOpen(true)}
                  className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                >
                  <span aria-hidden="true">＋ </span>
                  New lead
                </button>
              </div>
            </div>
          </header>

          <div className="mx-auto max-w-7xl px-5 py-8 sm:px-8">
            <nav
              className="mb-6 flex gap-2 overflow-x-auto lg:hidden"
              aria-label="Mobile navigation"
            >
              {(
                [
                  ["overview", "Overview"],
                  ["leads", "All leads"],
                  ["follow-ups", "Follow-ups"],
                ] as [View, string][]
              ).map(([navView, label]) => (
                <button
                  key={navView}
                  onClick={() => selectView(navView)}
                  className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium ${
                    view === navView
                      ? "bg-blue-100 text-blue-700"
                      : "bg-white text-slate-600 ring-1 ring-slate-200"
                  }`}
                >
                  {label}
                </button>
              ))}
            </nav>

            <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-blue-700">
                  Your workspace
                </p>
                <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">
                  {pageTitle}
                </h1>
                <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">
                  {pageDescription}
                </p>
              </div>

              <p className="text-xs text-slate-400">
                A clearer view of your customer pipeline
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

                <div className="mb-6 rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-50 to-white p-5 sm:p-6">
                  <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                    <div className="flex gap-4">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white text-xl text-blue-700 shadow-sm">
                        ✦
                      </div>
                      <div>
                        <h2 className="font-semibold text-slate-900">
                          Your AI workflow starts here
                        </h2>
                        <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
                          Record an enquiry today. Next, we&apos;ll teach
                          ReplyPilot to extract customer details and prepare
                          a helpful reply for your approval.
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => setModalOpen(true)}
                      className="shrink-0 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Add an enquiry
                    </button>
                  </div>
                </div>
              </>
            )}

            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 p-5 sm:p-6">
                <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-center">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">
                      {view === "follow-ups"
                        ? "Enquiries needing attention"
                        : view === "leads"
                          ? "All customer enquiries"
                          : "Recent leads"}
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">
                      Search, review and update your lead records.
                    </p>
                  </div>

                  <label className="relative block w-full xl:max-w-xs">
                    <span className="sr-only">Search leads</span>
                    <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">
                      ⌕
                    </span>
                    <input
                      type="search"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Search name or enquiry..."
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-50"
                    />
                  </label>
                </div>

                <div className="mt-5 flex flex-wrap gap-2">
                  {filters.map((item) => (
                    <button
                      key={item}
                      onClick={() => setFilter(item)}
                      className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${
                        filter === item
                          ? "bg-slate-900 text-white"
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      }`}
                    >
                      {item}
                      {item === "All" ? ` (${leads.length})` : ""}
                    </button>
                  ))}
                </div>
              </div>

              {displayedLeads.length === 0 ? (
                <div className="px-6 py-16 text-center">
                  <div className="text-3xl text-slate-300">⌕</div>
                  <h3 className="mt-3 font-semibold text-slate-900">
                    No matching leads
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">
                    Try another search, change your filter or add a new lead.
                  </p>
                  <button
                    onClick={() => {
                      setSearch("");
                      setFilter("All");
                    }}
                    className="mt-4 text-sm font-semibold text-blue-700 hover:text-blue-800"
                  >
                    Clear filters
                  </button>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-left">
                    <thead className="bg-slate-50/80">
                      <tr className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                        <th className="px-6 py-4">Customer</th>
                        <th className="px-6 py-4">Service / enquiry</th>
                        <th className="px-6 py-4">Channel</th>
                        <th className="px-6 py-4">Status</th>
                        <th className="px-6 py-4">Follow-up</th>
                        <th className="px-6 py-4">Received</th>
                      </tr>
                    </thead>

                    <tbody className="divide-y divide-slate-100">
                      {displayedLeads.map((lead) => (
                        <tr
                          key={lead.id}
                          className="transition hover:bg-slate-50/70"
                        >
                          <td className="px-6 py-5">
                            <div className="flex items-center gap-3">
                              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-bold text-slate-600">
                                {lead.name
                                  .split(" ")
                                  .map((part) => part[0])
                                  .join("")
                                  .slice(0, 2)}
                              </div>
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
                            <span className="text-sm text-slate-600">
                              {lead.channel === "WhatsApp"
                                ? "◉ WhatsApp"
                                : "＋ Manual"}
                            </span>
                          </td>

                          <td className="px-6 py-5">
                            <label>
                              <span className="sr-only">
                                Update status for {lead.name}
                              </span>
                              <select
                                value={lead.status}
                                onChange={(event) =>
                                  updateStatus(
                                    lead.id,
                                    event.target.value as LeadStatus,
                                  )
                                }
                                className={`cursor-pointer rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset outline-none focus:ring-2 focus:ring-blue-400 ${statusStyles[lead.status]}`}
                              >
                                {(
                                  [
                                    "New",
                                    "Contacted",
                                    "Quoted",
                                    "Booked",
                                  ] as LeadStatus[]
                                ).map((status) => (
                                  <option key={status} value={status}>
                                    {status}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </td>

                          <td className="px-6 py-5">
                            {lead.due && lead.status !== "Booked" ? (
                              <span className="inline-flex items-center gap-2 whitespace-nowrap text-xs font-medium text-amber-700">
                                <span className="h-2 w-2 rounded-full bg-amber-500" />
                                Follow-up due
                              </span>
                            ) : (
                              <span className="text-xs text-slate-400">
                                Up to date
                              </span>
                            )}
                          </td>

                          <td className="whitespace-nowrap px-6 py-5 text-xs text-slate-500">
                            {lead.date}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="flex flex-col justify-between gap-2 border-t border-slate-100 px-6 py-4 text-xs text-slate-400 sm:flex-row sm:items-center">
                <span>
                  Showing {displayedLeads.length} of {leads.length} leads
                </span>
                <span>Status changes apply to this demo session only.</span>
              </div>
            </section>

            <footer className="py-8 text-center text-xs text-slate-400">
              ReplyPilot · Built to help small businesses follow up
            </footer>
          </div>
        </main>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/40 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-lead-title"
            className="my-8 w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl sm:p-8"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2
                  id="new-lead-title"
                  className="text-xl font-bold text-slate-950"
                >
                  Add a new lead
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  Record a customer enquiry to keep it organised.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                aria-label="Close form"
                className="rounded-lg px-3 py-1 text-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                ×
              </button>
            </div>

            <form onSubmit={createLead} className="mt-6 space-y-5">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">
                  Customer name
                </span>
                <input
                  required
                  name="name"
                  autoFocus
                  placeholder="e.g. Mary James"
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-3 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">
                  Service requested
                </span>
                <input
                  required
                  name="service"
                  placeholder="e.g. Wedding photography"
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-3 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">
                  Customer enquiry
                </span>
                <textarea
                  required
                  name="message"
                  rows={4}
                  placeholder="What did the customer ask for?"
                  className="w-full resize-y rounded-xl border border-slate-200 px-3.5 py-3 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
                />
              </label>

              <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                >
                  Save lead
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  detail,
  icon,
  accent,
}: {
  label: string;
  value: number;
  detail: string;
  icon: string;
  accent: "blue" | "amber" | "violet" | "green";
}) {
  const accentStyles = {
    blue: "bg-blue-50 text-blue-700",
    amber: "bg-amber-50 text-amber-700",
    violet: "bg-violet-50 text-violet-700",
    green: "bg-emerald-50 text-emerald-700",
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-slate-500">{label}</p>
        <div
          className={`flex h-10 w-10 items-center justify-center rounded-xl text-lg ${accentStyles[accent]}`}
        >
          {icon}
        </div>
      </div>
      <p className="mt-4 text-3xl font-bold tracking-tight text-slate-950">
        {value}
      </p>
      <p className="mt-1 text-xs text-slate-400">{detail}</p>
    </div>
  );
}
