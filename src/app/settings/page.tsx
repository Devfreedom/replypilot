import { AppShell } from "@/components/app-shell";
import { ProtectedApp } from "@/components/protected-app";
import { BusinessSettings } from "@/components/business-settings";

export default function SettingsPage() {
  return (
    <ProtectedApp>
      <AppShell active="settings" title="Business settings">
        <BusinessSettings />
      </AppShell>
    </ProtectedApp>
  );
}
