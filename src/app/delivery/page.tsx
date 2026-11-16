import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { DeliveryProtection } from "@/components/delivery-protection";
import { ProtectedApp } from "@/components/protected-app";
import { brandPageTitle } from "@/lib/brand";

export const metadata: Metadata = {
  title: brandPageTitle("Delivery and protection"),
};

export default function DeliveryPage() {
  return (
    <ProtectedApp>
      <AppShell active="delivery" title="Delivery and protection">
        <DeliveryProtection />
      </AppShell>
    </ProtectedApp>
  );
}
