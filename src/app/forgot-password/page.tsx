import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/components/forgot-password-form";
import { brandPageTitle } from "@/lib/brand";

export const metadata: Metadata = {
  title: brandPageTitle("Reset password"),
};

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
