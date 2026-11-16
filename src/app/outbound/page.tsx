import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { OutboundHistory } from "@/components/outbound-history";
import { ProtectedApp } from "@/components/protected-app";
import { brandPageTitle } from "@/lib/brand";

export const metadata: Metadata = {
  title: brandPageTitle("Outbound messages"),
};

export default function OutboundPage() {
  return (
    <ProtectedApp>
      <AppShell active="outbound" title="Outbound messages">
        <OutboundHistory />
      </AppShell>
    </ProtectedApp>
  );
}
