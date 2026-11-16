/**
 * Central product identity and brand configuration.
 *
 * Keep product name, tagline, metadata copy, and logo mark paths in this file
 * so renaming the product requires editing only this single module.
 */

export type BrandMarkSpec = Readonly<{
  viewBox: string;
  outerPath: string;
  stitchPaths: readonly string[];
  accentDot: Readonly<{ cx: number; cy: number; r: number }>;
}>;

export const BRAND = {
  name: "ReplyPilot",
  shortName: "ReplyPilot",
  tagline: "WhatsApp customer desk",
  defaultPageTitle: "Customer enquiries & bookings",
  metaDescription:
    "Track customer enquiries, manage follow-ups, and draft accurate WhatsApp replies from your approved business details.",
  footerTagline: "Built for service businesses turning WhatsApp enquiries into confirmed bookings.",
  storageThemeKey: "replypilot-theme",
  logoLabel: "home",
  mark: {
    viewBox: "0 0 32 32",
    /** Rounded studio-slate/speech frame representing a customer conversation. */
    outerPath:
      "M7 5h18a4 4 0 0 1 4 4v11a4 4 0 0 1-4 4H13.2l-4.9 3.9A.8.8 0 0 1 7 27.3V24a4 4 0 0 1-4-4V9a4 4 0 0 1 4-4Z",
    /** Two crisp Adire-inspired stitch bars inside the conversation frame. */
    stitchPaths: ["M9.5 12.5h13", "M9.5 16.8h8.5"],
    /** Confirmation accent dot representing a handled booking reply. */
    accentDot: { cx: 22.5, cy: 16.8, r: 1.9 },
  } satisfies BrandMarkSpec,
} as const;

export function brandPageTitle(pageTitle?: string): string {
  const title = pageTitle?.trim();
  return title ? `${BRAND.name} - ${title}` : `${BRAND.name} - ${BRAND.defaultPageTitle}`;
}

export function brandAltText(context?: string): string {
  return context ? `${BRAND.name} ${context}` : `${BRAND.name} logo`;
}
