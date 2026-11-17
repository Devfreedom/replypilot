"use client";

import { useState, type ChangeEventHandler, type FocusEventHandler, type ReactNode } from "react";
import {
  buildFieldDescribedBy,
  fieldMessageIds,
  passwordToggleState,
} from "@/lib/field-a11y";

function EyeIcon({ open }: { open: boolean }) {
  if (open) {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-4.5 w-4.5"
      >
        <path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z" />
        <circle cx="12" cy="12" r="2.8" />
      </svg>
    );
  }

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4.5 w-4.5"
    >
      <path d="M3 3l18 18" />
      <path d="M10.6 10.6a2.8 2.8 0 0 0 3.8 3.8" />
      <path d="M9.4 5.2A10.9 10.9 0 0 1 12 5c6.5 0 10 7 10 7a16.8 16.8 0 0 1-3.3 4.3" />
      <path d="M6.6 6.6C4.1 8.4 2 12 2 12s3.5 7 10 7c1.6 0 3-.3 4.2-.8" />
    </svg>
  );
}

export function PasswordInput({
  id,
  name = "password",
  label,
  value,
  onChange,
  onBlur,
  autoComplete,
  required = false,
  minLength,
  maxLength,
  disabled = false,
  placeholder,
  hint,
  error,
  labelAside,
}: {
  id: string;
  name?: string;
  label: string;
  value: string;
  onChange: ChangeEventHandler<HTMLInputElement>;
  onBlur?: FocusEventHandler<HTMLInputElement>;
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  disabled?: boolean;
  placeholder?: string;
  hint?: string;
  error?: string;
  labelAside?: ReactNode;
}) {
  const [visible, setVisible] = useState(false);
  const [hasToggled, setHasToggled] = useState(false);
  const { hintId, errorId } = fieldMessageIds(id);
  const describedBy = buildFieldDescribedBy({
    fieldId: id,
    hasHint: Boolean(hint),
    hasError: Boolean(error),
  });
  const toggle = passwordToggleState(visible);

  function handleToggle() {
    setVisible((current) => !current);
    setHasToggled(true);
  }

  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="field-label">
          {label}
        </label>
        {labelAside}
      </div>

      <div className="relative mt-1.5">
        <input
          id={id}
          name={name}
          type={toggle.inputType}
          autoComplete={autoComplete}
          required={required}
          minLength={minLength}
          maxLength={maxLength}
          value={value}
          onChange={onChange}
          onBlur={onBlur}
          disabled={disabled}
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className="input pr-12"
        />
        <button
          type="button"
          onClick={handleToggle}
          disabled={disabled}
          aria-label={toggle.buttonLabel}
          aria-pressed={visible}
          aria-controls={id}
          className="absolute inset-y-0 right-0 flex w-11 cursor-pointer items-center justify-center rounded-r-xl text-ink-soft hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
        >
          <EyeIcon open={visible} />
        </button>
      </div>

      <span className="sr-only" aria-live="polite">
        {hasToggled ? toggle.announcement : ""}
      </span>

      {hint ? (
        <p id={hintId} className="help-text">
          {hint}
        </p>
      ) : null}

      {error ? (
        <p
          id={errorId}
          role="alert"
          className="mt-1.5 text-xs font-medium text-danger-ink"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
