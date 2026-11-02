import { AppShell } from "@/components/app-shell";
import { OutboundHistory } from "@/components/outbound-history";
import { ProtectedApp } from "@/components/protected-app";

export default function OutboundPage() {
  return (
    <ProtectedApp>
      <AppShell active="outbound" title="Outbound messages">
        <OutboundHistory />
      </AppShell>
    </ProtectedApp>
  );
}
