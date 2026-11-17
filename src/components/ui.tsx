import type { ReactNode } from "react";
import { buildFieldDescribedBy, fieldMessageIds } from "@/lib/field-a11y";

/** Consistent inline alert banner. */
const ALERT_TONES = {
  info: "border-[color-mix(in_oklab,var(--rp-accent)_32%,transparent)] bg-accent-soft text-accent-ink",
  warning:
    "border-[color-mix(in_oklab,var(--rp-warning)_32%,transparent)] bg-warning-soft text-warning-ink",
  danger:
    "border-[color-mix(in_oklab,var(--rp-danger)_35%,transparent)] bg-danger-soft text-danger-ink",
  success:
    "border-[color-mix(in_oklab,var(--rp-success)_32%,transparent)] bg-success-soft text-success-ink",
} as const;

export type AlertTone = keyof typeof ALERT_TONES;

export function Alert({
  tone = "info",
  role,
  children,
}: {
  tone?: AlertTone;
  role?: string;
  children: ReactNode;
}) {
  return (
    <div
      role={role ?? (tone === "danger" ? "alert" : undefined)}
      className={`rp-feedback rounded-xl border px-4 py-3 text-sm leading-6 ${ALERT_TONES[tone]}`}
    >
      {children}
    </div>
  );
}

/** Centered section state used for loading, empty, and error message blocks. */
export function SectionState({
  icon,
  title,
  children,
  action,
}: {
  icon?: string;
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="px-6 py-12 text-center sm:py-16">
      {icon ? (
        <div aria-hidden="true" className="text-3xl text-ink-soft">
          {icon}
        </div>
      ) : null}
      {title ? (
        <h3 className={`text-base font-semibold text-ink ${icon ? "mt-3" : ""}`}>
          {title}
        </h3>
      ) : null}
      {children ? (
        <div className="mx-auto mt-1.5 max-w-md text-sm leading-6 text-ink-soft">
          {children}
        </div>
      ) : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

/** Spinner used for loading states. */
export function Spinner({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-spin rounded-full border-2 border-line-strong border-t-accent ${className}`}
    />
  );
}

/** Page title + description block. */
export function PageHeading({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
          {title}
        </h1>
        {description ? (
          <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-soft">
            {description}
          </p>
        ) : null}
      </div>
      {children ? <div className="shrink-0">{children}</div> : null}
    </div>
  );
}

/** Labelled section wrapper used across cards. */
export function CardSection({
  title,
  description,
  children,
  className = "",
}: {
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card p-5 sm:p-6 ${className}`}>
      {title ? (
        <div className="mb-4">
          <h2 className="text-lg font-bold text-ink">{title}</h2>
          {description ? (
            <p className="mt-1 max-w-2xl text-sm leading-6 text-ink-soft">
              {description}
            </p>
          ) : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/**
 * Shared accessible form field wrapper with deterministic `aria-describedby`
 * wiring for hint text and inline field error messages.
 */
export function FormField({
  id,
  label,
  hint,
  error,
  labelAside,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  labelAside?: ReactNode;
  children: (props: {
    id: string;
    "aria-invalid": true | undefined;
    "aria-describedby": string | undefined;
  }) => ReactNode;
}) {
  const { hintId, errorId } = fieldMessageIds(id);
  const describedBy = buildFieldDescribedBy({
    fieldId: id,
    hasHint: Boolean(hint),
    hasError: Boolean(error),
  });

  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="field-label">
          {label}
        </label>
        {labelAside}
      </div>
      <div className="mt-1.5">
        {children({
          id,
          "aria-invalid": error ? true : undefined,
          "aria-describedby": describedBy,
        })}
      </div>
      {hint ? (
        <p id={hintId} className="help-text">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="mt-1.5 text-xs font-medium text-danger-ink">
          {error}
        </p>
      ) : null}
    </div>
  );
}
