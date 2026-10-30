import { AppShell } from "@/components/app-shell";
import { ProtectedApp } from "@/components/protected-app";
import { WhatsAppInbox } from "@/components/whatsapp-inbox";

export default function WhatsAppPage() {
  return (
    <ProtectedApp>
      <AppShell
        active="whatsapp"
        title="WhatsApp test inbox"
        canManage={false}
      >
        <WhatsAppInbox />
      </AppShell>
    </ProtectedApp>
  );
}
