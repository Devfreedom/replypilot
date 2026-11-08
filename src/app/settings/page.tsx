import { AppShell } from "@/components/app-shell";
import { ProtectedApp } from "@/components/protected-app";
import { BusinessSettings } from "@/components/business-settings";
import { MessagingSettings } from "@/components/messaging-settings";
import { WhatsAppConnections } from "@/components/whatsapp-connections";

export default function SettingsPage() {
  return (
    <ProtectedApp>
      <AppShell active="settings" title="Business settings">
        <div className="mx-auto max-w-5xl px-4 pt-8 sm:px-6 lg:px-8">
          <MessagingSettings />
        </div>
        <div className="mx-auto max-w-5xl px-4 pt-6 sm:px-6 lg:px-8">
          <WhatsAppConnections />
        </div>
        <BusinessSettings />
      </AppShell>
    </ProtectedApp>
  );
}
