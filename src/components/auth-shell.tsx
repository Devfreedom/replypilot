"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { BRAND, brandAltText } from "@/lib/brand";
import { BrandLogo } from "./brand-logo";
import { ThemeSelect } from "./theme";

export function AuthShell({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="flex min-h-screen flex-col justify-between bg-canvas px-4 py-6 sm:px-6 sm:py-10">
      <div className="mx-auto flex w-full max-w-md items-center justify-between gap-3">
        <Link
          href="/sign-in"
          aria-label={brandAltText(BRAND.logoLabel)}
          className="inline-flex items-center rounded-xl py-1"
        >
          <BrandLogo size="md" />
        </Link>
        <ThemeSelect />
      </div>

      <div className="mx-auto my-8 w-full max-w-md">
        <section className="card p-6 sm:p-8">
          <h1 className="text-2xl font-bold tracking-tight text-ink">
            {title}
          </h1>
          <p className="mt-2 text-sm leading-6 text-ink-soft">{description}</p>

          {children}

          {footer ? (
            <div className="mt-6 border-t border-line pt-5 text-center text-sm text-ink-soft">
              {footer}
            </div>
          ) : null}
        </section>

        <p className="mt-5 px-2 text-center text-xs leading-5 text-ink-faint">
          {BRAND.name} keeps customer sessions in HTTP-only cookies and holds
          every AI reply draft for owner approval before queueing to WhatsApp.
        </p>
      </div>

      <div aria-hidden="true" />
    </main>
  );
}
