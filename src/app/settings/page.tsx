import { AppShell } from "@/components/app-shell";
import { ProtectedApp } from "@/components/protected-app";
import { BusinessSettings } from "@/components/business-settings";
import { MessagingSettings } from "@/components/messaging-settings";

export default function SettingsPage() {
  return (
    <ProtectedApp>
      <AppShell active="settings" title="Business settings">
        <div className="space-y-6">
          <MessagingSettings />
          <BusinessSettings />
        </div>
      </AppShell>
    </ProtectedApp>
  );
}
