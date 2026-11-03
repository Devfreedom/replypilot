import { AppShell } from "@/components/app-shell";
import { DeliveryProtection } from "@/components/delivery-protection";
import { ProtectedApp } from "@/components/protected-app";

export default function DeliveryPage() {
  return (
    <ProtectedApp>
      <AppShell active="delivery" title="Delivery and protection">
        <DeliveryProtection />
      </AppShell>
    </ProtectedApp>
  );
}
