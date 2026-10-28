import { ProtectedApp } from "@/components/protected-app";
import { WhatsAppInbox } from "@/components/whatsapp-inbox";

export default function WhatsAppPage() {
  return (
    <ProtectedApp>
      <WhatsAppInbox />
    </ProtectedApp>
  );
}
