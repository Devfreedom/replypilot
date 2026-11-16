"use client";

import Link from "next/link";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { BRAND, brandAltText } from "@/lib/brand";
import { dashboardViewHref, type View } from "@/lib/leads";
import {
  assistantProviderBadgeLabel,
  resolveWorkspaceCanManage,
} from "@/lib/workspace";
import { useAuth } from "./auth-provider";
import { BrandLogo } from "./brand-logo";
import { ThemeSelect } from "./theme";

export type ShellActiveKey =
  | "dashboard"
  | "whatsapp"
  | "outbound"
  | "delivery"
  | "settings";

const ACCOUNT_NAV_ITEMS: {
  key: Exclude<ShellActiveKey, "dashboard">;
  label: string;
  shortLabel: string;
  href: string;
  icon: ReactNode;
}[] = [
  {
    key: "whatsapp",
    label: "WhatsApp inbox",
    shortLabel: "Inbox",
    href: "/whatsapp",
    icon: (
      <NavIcon path="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.9 8.9 0 0 1-4.1-1L3 20l1.2-4.7A8.4 8.4 0 1 1 21 11.5z" />
    ),
  },
  {
    key: "outbound",
    label: "Sent & queued",
    shortLabel: "Queued",
    href: "/outbound",
    icon: (
      <NavIcon path="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" />
    ),
  },
  {
    key: "delivery",
    label: "Safety & delivery",
    shortLabel: "Safety",
    href: "/delivery",
    icon: (
      <NavIcon path="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4" />
    ),
  },
  {
    key: "settings",
    label: "Business settings",
    shortLabel: "Settings",
    href: "/settings",
    icon: (
      <NavIcon path="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.1 2.1-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V20h-3v-.08A1.7 1.7 0 0 0 10.7 18.36a1.7 1.7 0 0 0-1.88.34l-.06.06-2.1-2.1.06-.06A1.7 1.7 0 0 0 7.06 14.72 1.7 1.7 0 0 0 5.5 13.7H5.4v-3h.1a1.7 1.7 0 0 0 1.56-1.03 1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.1-2.1.06.06a1.7 1.7 0 0 0 1.88.34 1.7 1.7 0 0 0 1.03-1.56V4.4h3v.08a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.1 2.1-.06.06a1.7 1.7 0 0 0-.34 1.88 1.7 1.7 0 0 0 1.56 1.03h.1v3H21a1.7 1.7 0 0 0-1.6 1.3z" />
    ),
  },
];

const DASHBOARD_NAV_ITEMS: {
  view: View;
  label: string;
  shortLabel: string;
  icon: ReactNode;
}[] = [
  {
    view: "overview",
    label: "Overview",
    shortLabel: "Home",
    icon: (
      <NavIcon path="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" />
    ),
  },
  {
    view: "leads",
    label: "All leads",
    shortLabel: "Leads",
    icon: (
      <NavIcon path="M17 20v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M10 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM21 20v-2a4 4 0 0 0-3-3.87M15 3.13a4 4 0 0 1 0 7.75" />
    ),
  },
  {
    view: "follow-ups",
    label: "Follow-ups",
    shortLabel: "Due",
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
      className="h-4.5 w-4.5 shrink-0"
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
  onNavigate,
}: {
  dashboardView?: View;
  followUpCount?: number;
  leadCount?: number;
  onNavigate?: () => void;
}) {
  return (
    <nav className="space-y-1" aria-label="Enquiries and follow-ups">
      {DASHBOARD_NAV_ITEMS.map((item) => {
        const active = item.view === dashboardView;

        return (
          <Link
            key={item.view}
            href={dashboardViewHref(item.view)}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className="nav-item"
          >
            {item.icon}
            <span>{item.label}</span>
            {item.view === "follow-ups" &&
            followUpCount !== undefined &&
            followUpCount > 0 ? (
              <span className="numeric-tabular ml-auto badge bg-warning-soft text-warning-ink">
                {followUpCount}
              </span>
            ) : item.view === "leads" && leadCount !== undefined ? (
              <span className="numeric-tabular ml-auto text-xs font-medium text-ink-soft">
                {leadCount}
              </span>
            ) : null}
          </Link>
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
    <nav className="space-y-1" aria-label="Workspace tools and settings">
      {ACCOUNT_NAV_ITEMS.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          onClick={onNavigate}
          aria-current={active === item.key ? "page" : undefined}
          className="nav-item"
        >
          {item.icon}
          <span>{item.label}</span>
        </Link>
      ))}
    </nav>
  );
}

function BrandBlock({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Link
      href="/"
      onClick={onNavigate}
      aria-label={brandAltText(BRAND.logoLabel)}
      className="inline-flex items-center rounded-xl px-2 py-1 hover:bg-hushed/70"
    >
      <BrandLogo size="md" />
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
        className="btn btn-secondary mt-3 w-full justify-start px-3 py-2 text-sm font-medium text-ink-soft hover:text-ink"
      >
        Sign out
      </button>
      <p className="mt-2.5 px-2 text-xs leading-5 text-ink-faint">
        {role === "owner"
          ? "Workspace owner account"
          : "Read-only member: owner approval is required to make changes."}
      </p>
    </div>
  );
}

function AssistantNote({ canManage }: { canManage: boolean }) {
  const { replyDraftProvider } = useAuth();
  const isGemini = replyDraftProvider === "gemini";

  return (
    <div className="rounded-2xl border border-line bg-hushed p-4">
      <p className="text-sm font-semibold text-ink">Reply assistant</p>
      <p className="mt-1 text-xs leading-5 text-ink-soft">
        {canManage
          ? "Drafts use your saved services, prices, and policies. Every customer message stays unqueued until you approve it."
          : "You can inspect leads and approved drafts; only the workspace owner can edit or queue replies."}
      </p>
      <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-surface px-2.5 py-1 text-xs font-medium text-ink-soft ring-1 ring-line">
        <span
          aria-hidden="true"
          className={`h-2 w-2 rounded-full ${
            isGemini ? "bg-success" : "bg-ink-faint"
          }`}
        />
        {assistantProviderBadgeLabel(replyDraftProvider)}
      </span>
    </div>
  );
}

function MobileBottomBar({
  active,
  currentDashboardView,
  followUpCount,
  onDashboardNavigate,
}: {
  active: ShellActiveKey;
  currentDashboardView?: View;
  followUpCount?: number;
  onDashboardNavigate?: () => void;
}) {
  const whatsappItem = ACCOUNT_NAV_ITEMS[0];

  return (
    <nav
      aria-label="Quick navigation"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur-xs lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <div className="mx-auto grid max-w-lg grid-cols-4 gap-1 px-2 py-1.5">
        {DASHBOARD_NAV_ITEMS.map((item) => {
          const isActive = item.view === currentDashboardView;

          return (
            <Link
              key={item.view}
              href={dashboardViewHref(item.view)}
              onClick={onDashboardNavigate}
              aria-current={isActive ? "page" : undefined}
              className={`relative flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-xl px-2 py-1.5 text-xs font-medium transition-colors ${
                isActive
                  ? "bg-accent-soft font-semibold text-accent-ink"
                  : "text-ink-soft hover:bg-hushed hover:text-ink"
              }`}
            >
              {item.icon}
              <span>{item.shortLabel}</span>
              {item.view === "follow-ups" &&
              followUpCount !== undefined &&
              followUpCount > 0 ? (
                <span className="numeric-tabular absolute right-2 top-1 rounded-full bg-warning-soft px-1.5 text-[11px] font-bold text-warning-ink">
                  {followUpCount}
                </span>
              ) : null}
            </Link>
          );
        })}

        <Link
          href={whatsappItem.href}
          aria-current={active === whatsappItem.key ? "page" : undefined}
          className={`flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-xl px-2 py-1.5 text-xs font-medium transition-colors ${
            active === whatsappItem.key
              ? "bg-accent-soft font-semibold text-accent-ink"
              : "text-ink-soft hover:bg-hushed hover:text-ink"
          }`}
        >
          {whatsappItem.icon}
          <span>{whatsappItem.shortLabel}</span>
        </Link>
      </div>
    </nav>
  );
}

export function AppShell({
  active,
  dashboardView,
  onDashboardNavigate,
  leadCount = 0,
  followUpCount = 0,
  canManage,
  title,
  subtitle,
  actions,
  children,
}: {
  active: ShellActiveKey;
  /** Current dashboard sub-view, used to mark the active navigation item. */
  dashboardView?: View;
  /** Called when a dashboard navigation link is selected, before navigation. */
  onDashboardNavigate?: () => void;
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
  const { user, workspace, role, signOut } = useAuth();
  const effectiveCanManage = resolveWorkspaceCanManage(role, canManage);

  useEffect(() => {
    const drawer = drawerRef.current;

    if (!drawer) return;

    if (drawerOpen && !drawer.open) {
      drawer.showModal();
    } else if (!drawerOpen && drawer.open) {
      drawer.close();
    }
  }, [drawerOpen]);

  // Close the modal drawer when Activity hides this route so its top-layer
  // dialog backdrop never persists across navigation.
  useLayoutEffect(() => {
    const drawer = drawerRef.current;

    return () => {
      if (drawer?.open) {
        drawer.close();
      }

      setDrawerOpen(false);
    };
  }, []);

  function closeDrawer() {
    setDrawerOpen(false);
  }

  function handleDashboardNavigate() {
    onDashboardNavigate?.();
    closeDrawer();
  }

  function handleDrawerBackdropClick(event: React.MouseEvent<HTMLDialogElement>) {
    if (event.target === drawerRef.current) {
      closeDrawer();
    }
  }

  const onDashboard = active === "dashboard";
  const currentDashboardView = onDashboard
    ? (dashboardView ?? "overview")
    : undefined;

  return (
    <div className="flex min-h-screen bg-canvas text-ink">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-68 shrink-0 flex-col overflow-y-auto border-r border-line bg-surface px-4 py-6 lg:flex">
        <BrandBlock />

        <div className="mt-5 rounded-xl border border-line bg-hushed/75 px-3.5 py-2.5">
          <p className="text-xs font-medium text-ink-soft">Active business</p>
          <p className="mt-0.5 break-words text-sm font-semibold text-ink">
            {workspace?.name ?? "Workspace"}
          </p>
        </div>

        <div className="mt-6">
          <p className="mb-1.5 px-3 text-xs font-semibold text-ink-soft">
            Enquiries
          </p>
          <DashboardNavList
            dashboardView={currentDashboardView}
            followUpCount={onDashboard ? followUpCount : undefined}
            leadCount={onDashboard ? leadCount : undefined}
            onNavigate={handleDashboardNavigate}
          />
        </div>

        <div className="mt-6">
          <p className="mb-1.5 px-3 text-xs font-semibold text-ink-soft">
            Inbox &amp; settings
          </p>
          <AccountNavList active={active} />
        </div>

        <div className="mt-8">
          <AssistantNote canManage={effectiveCanManage} />
        </div>

        <UserFooter onSignOut={signOut} />
      </aside>

      {/* Mobile drawer navigation */}
      <dialog
        ref={drawerRef}
        onClose={closeDrawer}
        onClick={handleDrawerBackdropClick}
        aria-label="Full navigation menu"
        className="fixed left-0 top-0 m-0 h-dvh w-76 bg-surface p-0 text-ink shadow-2xl"
      >
        <div className="flex h-full w-76 flex-col overflow-y-auto px-4 py-6">
          <div className="flex items-center justify-between gap-2">
            <BrandBlock onNavigate={closeDrawer} />
            <button
              type="button"
              onClick={closeDrawer}
              aria-label="Close navigation"
              className="flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-xl text-2xl leading-none text-ink-soft hover:bg-hushed hover:text-ink"
            >
              &times;
            </button>
          </div>

          <div className="mt-5 rounded-xl border border-line bg-hushed/75 px-3.5 py-2.5">
            <p className="text-xs font-medium text-ink-soft">Active business</p>
            <p className="mt-0.5 break-words text-sm font-semibold text-ink">
              {workspace?.name ?? "Workspace"}
            </p>
          </div>

          <div className="mt-6">
            <p className="mb-1.5 px-3 text-xs font-semibold text-ink-soft">
              Enquiries
            </p>
            <DashboardNavList
              dashboardView={currentDashboardView}
              followUpCount={onDashboard ? followUpCount : undefined}
              leadCount={onDashboard ? leadCount : undefined}
              onNavigate={handleDashboardNavigate}
            />
          </div>

          <div className="mt-6">
            <p className="mb-1.5 px-3 text-xs font-semibold text-ink-soft">
              Inbox &amp; settings
            </p>
            <AccountNavList active={active} onNavigate={closeDrawer} />
          </div>

          <div className="mt-8">
            <AssistantNote canManage={effectiveCanManage} />
          </div>

          <UserFooter onSignOut={signOut} />
        </div>
      </dialog>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur-xs">
          <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2.5 sm:px-6 lg:px-8">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open navigation menu"
              className="flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-xl border border-line-strong text-ink-soft hover:bg-hushed hover:text-ink lg:hidden"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                className="h-5 w-5"
              >
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </button>

            <nav
              aria-label="Breadcrumb"
              title={
                workspace?.name
                  ? `${workspace.name} / ${title}${subtitle ? ` / ${subtitle}` : ""}`
                  : title
              }
              className="min-w-0 flex-1"
            >
              <p className="truncate text-xs text-ink-soft sm:text-sm">
                <span className="hidden font-medium text-ink-soft sm:inline">
                  {workspace?.name ?? "Workspace"}
                </span>{" "}
                <span
                  aria-hidden="true"
                  className="hidden text-ink-soft sm:inline"
                >
                  /
                </span>{" "}
                <span className="font-semibold text-ink">{title}</span>
                {subtitle ? (
                  <>
                    {" "}
                    <span aria-hidden="true" className="text-ink-soft">
                      /
                    </span>{" "}
                    <span>{subtitle}</span>
                  </>
                ) : null}
              </p>
              <p className="truncate text-xs text-ink-soft lg:hidden">
                {user?.email}
              </p>
            </nav>

            <div className="ml-auto flex items-center gap-2">
              {actions}
              <ThemeSelect />
            </div>
          </div>
        </header>

        <main className="flex-1 pb-24 lg:pb-16">{children}</main>
      </div>

      <MobileBottomBar
        active={active}
        currentDashboardView={currentDashboardView}
        followUpCount={onDashboard ? followUpCount : undefined}
        onDashboardNavigate={onDashboardNavigate}
      />
    </div>
  );
}
