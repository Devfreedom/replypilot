import { BusinessSettings } from "@/components/business-settings";
import { ProtectedApp } from "@/components/protected-app";

export default function SettingsPage() {
  return (
    <ProtectedApp>
      <BusinessSettings />
    </ProtectedApp>
  );
}
