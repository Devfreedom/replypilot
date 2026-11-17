import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { ProtectedApp } from "@/components/protected-app";
import { WhatsAppInbox } from "@/components/whatsapp-inbox";
import { brandPageTitle } from "@/lib/brand";

export const metadata: Metadata = {
  title: brandPageTitle("WhatsApp inbox"),
};

export default function WhatsAppPage() {
  return (
    <ProtectedApp>
      <AppShell active="whatsapp" title="WhatsApp inbox">
        <WhatsAppInbox />
      </AppShell>
    </ProtectedApp>
  );
}
