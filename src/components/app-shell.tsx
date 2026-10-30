"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "./auth-provider";
import { ThemeSelect } from "./theme";
import type { View } from "@/lib/leads";

export type ShellActiveKey = "dashboard" | "whatsapp" | "settings";

const ACCOUNT_NAV_ITEMS: {
  key: Exclude<ShellActiveKey, "dashboard">;
  label: string;
  href: string;
  icon: ReactNode;
}[] = [
  {
    key: "whatsapp",
    label: "WhatsApp inbox",
    href: "/whatsapp",
    icon: (
      <NavIcon path="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.9 8.9 0 0 1-4.1-1L3 20l1.2-4.7A8.4 8.4 0 1 1 21 11.5z" />
    ),
  },
  {
    key: "settings",
    label: "Business settings",
    href: "/settings",
    icon: (
      <NavIcon path="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.1 2.1-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V20h-3v-.08A1.7 1.7 0 0 0 10.7 18.36a1.7 1.7 0 0 0-1.88.34l-.06.06-2.1-2.1.06-.06A1.7 1.7 0 0 0 7.06 14.72 1.7 1.7 0 0 0 5.5 13.7H5.4v-3h.1a1.7 1.7 0 0 0 1.56-1.03 1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.1-2.1.06.06a1.7 1.7 0 0 0 1.88.34 1.7 1.7 0 0 0 1.03-1.56V4.4h3v.08a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.1 2.1-.06.06a1.7 1.7 0 0 0-.34 1.88 1.7 1.7 0 0 0 1.56 1.03h.1v3H21a1.7 1.7 0 0 0-1.6 1.3z" />
    ),
  },
];

const DASHBOARD_NAV_ITEMS: { view: View; label: string; icon: ReactNode }[] = [
  {
    view: "overview",
    label: "Overview",
    icon: <NavIcon path="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" />,
  },
  {
    view: "leads",
    label: "All leads",
    icon: (
      <NavIcon path="M17 20v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M10 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM21 20v-2a4 4 0 0 0-3-3.87M15 3.13a4 4 0 0 1 0 7.75" />
    ),
  },
  {
    view: "follow-ups",
    label: "Follow-ups",
    icon: (
      <NavIcon path="M12 6v6l4 2M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20z" />
    ),
  },
];

function NavIcon({ path }: { path: string }) {
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

function DashboardNavList({
  dashboardView,
  followUpCount,
  leadCount,
  onSelectDashboardView,
}: {
  dashboardView: View;
  followUpCount: number;
  leadCount: number;
  onSelectDashboardView: (view: View) => void;
}) {
  return (
    <nav className="space-y-1" aria-label="Dashboard views">
      {DASHBOARD_NAV_ITEMS.map((item) => {
        const active = item.view === dashboardView;

        return (
          <button
            key={item.view}
            type="button"
            onClick={() => onSelectDashboardView(item.view)}
            aria-current={active ? "page" : undefined}
            className="nav-item"
          >
            {item.icon}
            {item.label}
            {item.view === "follow-ups" && followUpCount > 0 ? (
              <span className="ml-auto badge bg-warning-soft text-warning-ink">
                {followUpCount}
              </span>
            ) : item.view === "leads" ? (
              <span className="ml-auto text-xs text-ink-faint">{leadCount}</span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}

function AccountNavList({
  active,
  onNavigate,
}: {
  active: ShellActiveKey;
  onNavigate?: () => void;
}) {
  return (
    <nav className="space-y-1" aria-label="Application pages">
      {ACCOUNT_NAV_ITEMS.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          onClick={onNavigate}
          aria-current={active === item.key ? "page" : undefined}
          className="nav-item"
        >
          {item.icon}
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

function BrandBlock() {
  return (
    <Link href="/" className="flex items-center gap-3 px-2">
      <div
        aria-hidden="true"
        className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-lg font-bold text-on-accent"
      >
        R
      </div>
      <div>
        <p className="text-lg font-bold tracking-tight text-ink">ReplyPilot</p>
        <p className="text-xs text-ink-soft">Customer workflow</p>
      </div>
    </Link>
  );
}

function UserFooter({ onSignOut }: { onSignOut: () => Promise<void> }) {
  const { user, role } = useAuth();

  return (
    <div className="mt-auto border-t border-line pt-4">
      <div className="flex items-center gap-3 px-2">
        <div
          aria-hidden="true"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink text-sm font-semibold text-surface"
        >
          {initials(user?.name ?? "Account")}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">
            {user?.name ?? "Account"}
          </p>
          <p className="truncate text-xs text-ink-soft">{user?.email ?? ""}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => void onSignOut()}
        className="mt-3 w-full rounded-xl border border-line px-3 py-2 text-left text-sm font-medium text-ink-soft hover:bg-hushed"
      >
        Sign out
      </button>
      <p className="mt-3 px-2 text-[11px] leading-4 text-ink-faint">
        {role === "owner"
          ? "You are the workspace owner."
          : "Read-only member: only the owner can make changes."}
      </p>
    </div>
  );
}

function AssistantNote({ canManage }: { canManage: boolean }) {
  return (
    <div className="rounded-2xl border border-line bg-hushed p-4">
      <p className="text-sm font-semibold text-ink">Reply drafts</p>
      <p className="mt-1 text-xs leading-5 text-ink-soft">
        {canManage
          ? "Drafts are generated from this workspace’s approved business facts. Review every draft before using it."
          : "You can review leads and approved drafts; only the workspace owner can make changes."}
      </p>
      <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-raised px-2.5 py-1 text-xs font-medium text-ink-soft ring-1 ring-line">
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 rounded-full bg-ink-faint"
        />
        Mock provider · no live AI
      </span>
    </div>
  );
}

export function AppShell({
  active,
  dashboardView,
  onSelectDashboardView,
  leadCount = 0,
  followUpCount = 0,
  canManage = false,
  title,
  subtitle,
  actions,
  children,
}: {
  active: ShellActiveKey;
  /** Current dashboard sub-view; required when the shell is used by the dashboard. */
  dashboardView?: View;
  onSelectDashboardView?: (view: View) => void;
  leadCount?: number;
  followUpCount?: number;
  canManage?: boolean;
  /** Page title shown in the top bar and drawer. */
  title: string;
  /** Current sub-page name, shown in the breadcrumb context. */
  subtitle?: string;
  /** Right side of the top bar: page-scoped actions. Theme control is always present. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const drawerRef = useRef<HTMLDialogElement>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { user, workspace, signOut } = useAuth();

  useEffect(() => {
    const drawer = drawerRef.current;

    if (!drawer) return;

    if (drawerOpen && !drawer.open) {
      drawer.showModal();
    } else if (!drawerOpen && drawer.open) {
      drawer.close();
    }
  }, [drawerOpen]);

  function closeDrawer() {
    setDrawerOpen(false);
  }

  function handleDrawerBackdropClick(event: React.MouseEvent<HTMLDialogElement>) {
    if (event.target === drawerRef.current) {
      closeDrawer();
    }
  }

  const onDashboard = active === "dashboard";
  const dashboardControls = onDashboard
    ? { dashboardView: dashboardView ?? "overview", leadCount, followUpCount }
    : null;

  return (
    <div className="flex min-h-screen bg-canvas text-ink">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col overflow-y-auto border-r border-line bg-surface px-5 py-6 lg:flex">
        <BrandBlock />

        <div className="mt-6 rounded-xl bg-hushed px-3 py-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-ink-faint">
            Workspace
          </p>
          <p className="mt-0.5 truncate text-sm font-semibold text-ink">
            {workspace?.name ?? "Workspace"}
          </p>
        </div>

        <div className="mt-6">
          <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-widest text-ink-faint">
            Leads
          </p>
          {dashboardControls ? (
            <DashboardNavList
              dashboardView={dashboardControls.dashboardView}
              followUpCount={dashboardControls.followUpCount}
              leadCount={dashboardControls.leadCount}
              onSelectDashboardView={(view) => {
                onSelectDashboardView?.(view);
                closeDrawer();
              }}
            />
          ) : null}
        </div>

        <div className="mt-6">
          <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-widest text-ink-faint">
            Navigate
          </p>
          <AccountNavList active={active} />
        </div>

        <div className="mt-8">
          <AssistantNote canManage={canManage} />
        </div>

        <UserFooter onSignOut={signOut} />
      </aside>

      {/* Mobile drawer navigation */}
      <dialog
        ref={drawerRef}
        onClose={closeDrawer}
        onClick={handleDrawerBackdropClick}
        aria-label="Navigation"
        className="fixed left-0 top-0 m-0 h-dvh w-72 bg-surface p-0 text-ink shadow-2xl"
      >
        <div className="flex h-full w-72 flex-col overflow-y-auto px-5 py-6">
          <div className="flex items-center justify-between">
            <BrandBlock />
            <button
              type="button"
              onClick={closeDrawer}
              aria-label="Close navigation"
              className="rounded-lg px-2.5 py-1 text-2xl leading-none text-ink-faint hover:bg-hushed hover:text-ink"
            >
              &times;
            </button>
          </div>

          <div className="mt-6 rounded-xl bg-hushed px-3 py-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-ink-faint">
              Workspace
            </p>
            <p className="mt-0.5 truncate text-sm font-semibold text-ink">
              {workspace?.name ?? "Workspace"}
            </p>
          </div>

          {dashboardControls ? (
            <div className="mt-6">
              <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-widest text-ink-faint">
                Leads
              </p>
              <DashboardNavList
                dashboardView={dashboardControls.dashboardView}
                followUpCount={dashboardControls.followUpCount}
                leadCount={dashboardControls.leadCount}
                onSelectDashboardView={(view) => {
                  onSelectDashboardView?.(view);
                  closeDrawer();
                }}
              />
            </div>
          ) : null}

          <div className="mt-6">
            <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-widest text-ink-faint">
              Navigate
            </p>
            <AccountNavList active={active} onNavigate={closeDrawer} />
          </div>

          <div className="mt-8">
            <AssistantNote canManage={canManage} />
          </div>

          <UserFooter onSignOut={signOut} />
        </div>
      </dialog>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-b border-line bg-surface">
          <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open navigation"
              className="rounded-xl border border-line p-2 text-ink-soft hover:bg-hushed hover:text-ink lg:hidden"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                className="h-5 w-5"
              >
                <path d="M3 6h18M3 12h18M3 18h18" />
              </svg>
            </button>

            <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
              <p className="truncate text-xs text-ink-faint">
                <span className="font-medium text-ink-soft">
                  {workspace?.name ?? "Workspace"}
                </span>{" "}
                <span aria-hidden="true">/</span>{" "}
                <span className="font-semibold text-ink">{title}</span>
                {subtitle ? (
                  <>
                    {" "}
                    <span aria-hidden="true">/</span> {subtitle}
                  </>
                ) : null}
              </p>
              <p className="truncate text-[11px] text-ink-faint lg:hidden">
                {user?.email}
              </p>
            </nav>

            <div className="ml-auto flex items-center gap-2">
              {actions}
              <ThemeSelect />
            </div>
          </div>
        </header>

        <main className="flex-1 pb-16">{children}</main>
      </div>
    </div>
  );
}
