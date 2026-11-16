import type { Metadata } from "next";
import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import { ProtectedApp } from "@/components/protected-app";
import { SettingsWorkspace } from "@/components/settings-workspace";
import { brandPageTitle } from "@/lib/brand";

export const metadata: Metadata = {
  title: brandPageTitle("Business settings"),
};

export default function SettingsPage() {
  return (
    <ProtectedApp>
      <AppShell active="settings" title="Business settings">
        <Suspense
          fallback={
            <div role="status" className="mx-auto max-w-5xl px-4 py-12 text-sm text-ink-soft sm:px-6 lg:px-8">
              Loading settings…
            </div>
          }
        >
          <SettingsWorkspace />
        </Suspense>
      </AppShell>
    </ProtectedApp>
  );
}
