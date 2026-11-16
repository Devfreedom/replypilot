import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";
import { brandPageTitle } from "@/lib/brand";

export const metadata: Metadata = {
  title: brandPageTitle("Sign in"),
};

export default function SignInPage() {
  return <AuthForm mode="sign-in" />;
}
