"use client";

import { Activity, type KeyboardEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "./auth-provider";
import { BusinessSettings, type BusinessSettingsSection } from "./business-settings";
import { MessagingSettings } from "./messaging-settings";
import { Alert, PageHeading } from "./ui";
import { WhatsAppConnections } from "./whatsapp-connections";

export type SettingsTab = BusinessSettingsSection | "whatsapp";

const SETTINGS_TABS: readonly Readonly<{
  id: SettingsTab;
  label: string;
}>[] = [
  { id: "profile", label: "Profile & hours" },
  { id: "catalogue", label: "Services & prices" },
  { id: "knowledge", label: "FAQs & policies" },
  { id: "whatsapp", label: "WhatsApp & approval" },
];

export function parseSettingsTab(value: string | null): SettingsTab {
  if (
    value === "profile" ||
    value === "catalogue" ||
    value === "knowledge" ||
    value === "whatsapp"
  ) {
    return value;
  }

  return "profile";
}

export function SettingsWorkspace() {
  const { workspace } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = parseSettingsTab(searchParams.get("section"));

  function selectTab(next: SettingsTab) {
    if (next === activeTab) {
      return;
    }

    const href = next === "profile" ? "/settings" : `/settings?section=${next}`;
    router.replace(href, { scroll: false });
  }

  function handleTabKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    let targetIndex: number | null = null;

    if (event.key === "ArrowRight") {
      targetIndex = (index + 1) % SETTINGS_TABS.length;
    } else if (event.key === "ArrowLeft") {
      targetIndex = (index - 1 + SETTINGS_TABS.length) % SETTINGS_TABS.length;
    } else if (event.key === "Home") {
      targetIndex = 0;
    } else if (event.key === "End") {
      targetIndex = SETTINGS_TABS.length - 1;
    }

    if (targetIndex === null) {
      return;
    }

    event.preventDefault();
    const target = SETTINGS_TABS[targetIndex];
    selectTab(target.id);
    const button = document.getElementById(`settings-tab-${target.id}`);
    button?.focus();
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <PageHeading
        title="Business settings"
        description="Manage your approved business profile, service pricing, FAQs, and WhatsApp preferences."
      />

      <div className="mt-5">
        <Alert tone="info" role="status">
          Signed in to{" "}
          <strong className="break-words">
            {workspace?.name ?? "this workspace"}
          </strong>
          . Business details, prices, and WhatsApp connections apply only to
          this business.
        </Alert>
      </div>

      <div
        role="tablist"
        aria-label="Settings sections"
        className="mt-6 flex flex-wrap gap-2 border-b border-line pb-3"
      >
        {SETTINGS_TABS.map((tab, index) => {
          const selected = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              id={`settings-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`settings-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => selectTab(tab.id)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
              className={`min-h-11 cursor-pointer rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${
                selected
                  ? "bg-accent text-on-accent shadow-xs"
                  : "bg-hushed text-ink-soft hover:bg-line hover:text-ink"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="mt-6">
        <BusinessSettings
          embedded
          activeSection={activeTab === "whatsapp" ? null : activeTab}
        />

        <Activity mode={activeTab === "whatsapp" ? "visible" : "hidden"}>
          <div
            id="settings-panel-whatsapp"
            role="tabpanel"
            aria-labelledby="settings-tab-whatsapp"
            className="space-y-6"
          >
            <MessagingSettings />
            <WhatsAppConnections />
          </div>
        </Activity>
      </div>
    </div>
  );
}
