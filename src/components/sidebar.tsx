import Link from "next/link";
import type { ReactNode } from "react";
import type { View } from "@/lib/leads";

function Icon({ path }: { path: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 shrink-0"
    >
      <path d={path} />
    </svg>
  );
}

const NAV_ITEMS: { view: View; label: string; icon: ReactNode }[] = [
  {
    view: "overview",
    label: "Overview",
    icon: <Icon path="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" />,
  },
  {
    view: "leads",
    label: "All leads",
    icon: (
      <Icon path="M17 20v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M10 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM21 20v-2a4 4 0 0 0-3-3.87M15 3.13a4 4 0 0 1 0 7.75" />
    ),
  },
  {
    view: "follow-ups",
    label: "Follow-ups",
    icon: <Icon path="M12 6v6l4 2M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20z" />,
  },
];

function initials(name: string): string {
  return (
    name
      .split(" ")
      .map((part) => part[0])
      .filter(Boolean)
      .join("")
      .slice(0, 2)
      .toUpperCase() || "U"
  );
}

export function Sidebar({
  view,
  onSelectView,
  leadCount,
  followUpCount,
  workspaceName,
  userName,
  userEmail,
  role,
  canManage,
  onSignOut,
}: {
  view: View;
  onSelectView: (view: View) => void;
  leadCount: number;
  followUpCount: number;
  workspaceName: string;
  userName: string;
  userEmail: string;
  role: "owner" | "member";
  canManage: boolean;
  onSignOut: () => void;
}) {
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-white px-5 py-6 lg:flex">
      <div className="flex items-center gap-3 px-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-lg font-bold text-white">
          R
        </div>
        <div>
          <p className="text-lg font-bold tracking-tight">ReplyPilot</p>
          <p className="text-xs text-slate-500">Customer workflow</p>
        </div>
      </div>

      <Link
        href="/settings"
        className="mt-5 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
      >
        <Icon path="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.1 2.1-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V20h-3v-.08A1.7 1.7 0 0 0 10.7 18.36a1.7 1.7 0 0 0-1.88.34l-.06.06-2.1-2.1.06-.06A1.7 1.7 0 0 0 7.06 14.72 1.7 1.7 0 0 0 5.5 13.7H5.4v-3h.1a1.7 1.7 0 0 0 1.56-1.03 1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.1-2.1.06.06a1.7 1.7 0 0 0 1.88.34 1.7 1.7 0 0 0 1.03-1.56V4.4h3v.08a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.1 2.1-.06.06a1.7 1.7 0 0 0-.34 1.88 1.7 1.7 0 0 0 1.56 1.03h.1v3H21a1.7 1.7 0 0 0-1.6 1.3z" />
        Business settings
      </Link>

      <Link
        href="/whatsapp"
        className="mt-2 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
      >
        <Icon path="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.9 8.9 0 0 1-4.1-1L3 20l1.2-4.7A8.4 8.4 0 1 1 21 11.5z" />
        WhatsApp test inbox
      </Link>

      <div className="mt-10">
        <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-widest text-slate-400">
          Workspace
        </p>
        <p className="mb-3 truncate px-3 text-sm font-semibold text-slate-700">
          {workspaceName}
        </p>

        <nav className="space-y-1" aria-label="Main navigation">
          {NAV_ITEMS.map((item) => {
            const active = view === item.view;
            const count =
              item.view === "leads"
                ? leadCount
                : item.view === "follow-ups"
                  ? followUpCount
                  : null;

            return (
              <button
                key={item.view}
                onClick={() => onSelectView(item.view)}
                aria-current={active ? "page" : undefined}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
                  active
                    ? "bg-blue-50 text-blue-700"
                    : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                {item.icon}
                {item.label}
                {item.view === "follow-ups" && followUpCount > 0 ? (
                  <span className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                    {followUpCount}
                  </span>
                ) : count !== null ? (
                  <span className="ml-auto text-xs text-slate-400">
                    {count}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="mt-auto rounded-2xl border border-blue-100 bg-blue-50/70 p-4">
        <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-white text-blue-700">
          <Icon path="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
        </div>
        <p className="text-sm font-semibold text-slate-800">Reply assistant</p>
        <p className="mt-1 text-xs leading-5 text-slate-600">
          {canManage
            ? "Draft replies use only this workspace's approved business facts. Review every draft before sending anything."
            : "You are a workspace member. Business data is read-only for your role."}
        </p>
        <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs font-medium text-blue-700 ring-1 ring-blue-100">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-blue-400" />
          Mock generation
        </span>
      </div>

      <div className="mt-5 border-t border-slate-100 pt-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white">
            {initials(userName)}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{userName}</p>
            <p className="truncate text-xs text-slate-500">{userEmail}</p>
            <p className="mt-0.5 text-xs font-medium text-slate-400">
              {role === "owner" ? "Workspace owner" : "Workspace member"}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onSignOut}
          className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2 text-left text-sm font-medium text-slate-600 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
