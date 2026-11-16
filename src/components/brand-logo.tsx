import { BRAND } from "@/lib/brand";

type BrandLogoSize = "sm" | "md" | "lg";

const MARK_SIZE_CLASSES: Record<BrandLogoSize, string> = {
  sm: "h-9 w-9 rounded-lg",
  md: "h-10 w-10 rounded-xl",
  lg: "h-11 w-11 rounded-xl",
};

const ICON_SIZE_CLASSES: Record<BrandLogoSize, string> = {
  sm: "h-5 w-5",
  md: "h-5 w-5",
  lg: "h-6 w-6",
};

export function BrandLogo({
  size = "md",
  showTagline = true,
}: {
  size?: BrandLogoSize;
  showTagline?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-3">
      <span
        aria-hidden="true"
        className={`flex shrink-0 items-center justify-center bg-accent text-on-accent shadow-xs ${MARK_SIZE_CLASSES[size]}`}
      >
        <svg
          viewBox={BRAND.mark.viewBox}
          fill="none"
          className={ICON_SIZE_CLASSES[size]}
        >
          <path
            d={BRAND.mark.outerPath}
            stroke="currentColor"
            strokeWidth="2.1"
            strokeLinejoin="round"
          />
          {BRAND.mark.stitchPaths.map((d) => (
            <path
              key={d}
              d={d}
              stroke="currentColor"
              strokeWidth="2.1"
              strokeLinecap="round"
            />
          ))}
          <circle
            cx={BRAND.mark.accentDot.cx}
            cy={BRAND.mark.accentDot.cy}
            r={BRAND.mark.accentDot.r}
            fill="var(--rp-success-soft)"
          />
        </svg>
      </span>
      <span className="min-w-0">
        <span className="block truncate text-lg font-bold tracking-tight text-ink">
          {BRAND.name}
        </span>
        {showTagline ? (
          <span className="block truncate text-xs text-ink-soft">
            {BRAND.tagline}
          </span>
        ) : null}
      </span>
    </span>
  );
}
