import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";
import { brandPageTitle } from "@/lib/brand";

export const metadata: Metadata = {
  title: brandPageTitle("Create account"),
};

export default function SignUpPage() {
  return <AuthForm mode="sign-up" />;
}
