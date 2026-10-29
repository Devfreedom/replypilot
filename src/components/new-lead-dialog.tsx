"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

export type NewLeadValues = {
  name: string;
  service: string;
  message: string;
  whatsappNumber: string;
  nextFollowUpAt: string;
};

type FieldErrors = Partial<Record<keyof NewLeadValues, string>>;

const inputClassName = "input";

function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="field-label mb-1.5 block">
        {label}
      </label>
      {children}
      {hint ? <p className="help-text">{hint}</p> : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-1.5 text-xs font-medium text-danger-ink">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function NewLeadDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (values: NewLeadValues) => Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [values, setValues] = useState<NewLeadValues>({
    name: "",
    service: "",
    message: "",
    whatsappNumber: "",
    nextFollowUpAt: "",
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;

    if (!dialog) return;

    if (open && !dialog.open) {
      setValues({ name: "", service: "", message: "", whatsappNumber: "", nextFollowUpAt: "" });
      setErrors({});
      setSubmitError(null);
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  function setField(field: keyof NewLeadValues, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
    setSubmitError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSubmitting) return;

    const nextErrors: FieldErrors = {};
    (["name", "service", "message"] as const).forEach((field) => {
      if (!values[field].trim()) {
        nextErrors[field] = "This field is required.";
      }
    });

    const whatsappDigits = values.whatsappNumber.replace(/\D/g, "");

    if (
      values.whatsappNumber.trim() &&
      (whatsappDigits.length < 5 || whatsappDigits.length > 32)
    ) {
      nextErrors.whatsappNumber =
        "Enter 5 to 32 digits, including the country code.";
    }

    if (Object.values(nextErrors).some(Boolean)) {
      setErrors(nextErrors);
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      await onCreate({
        name: values.name.trim(),
        service: values.service.trim(),
        message: values.message.trim(),
        whatsappNumber: values.whatsappNumber.trim(),
        nextFollowUpAt: values.nextFollowUpAt,
      });
      dialogRef.current?.close();
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : "Unable to save this lead.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleBackdropClick(event: React.MouseEvent<HTMLDialogElement>) {
    if (event.target === dialogRef.current) {
      dialogRef.current?.close();
    }
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onClick={handleBackdropClick}
      aria-labelledby="new-lead-title"
      className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl bg-raised p-6 text-ink shadow-2xl sm:p-8"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="new-lead-title" className="text-xl font-bold text-ink">
            Add a new lead
          </h2>
          <p className="mt-2 text-sm leading-6 text-ink-soft">
            Record a customer enquiry to keep it organised.
          </p>
        </div>
        <button
          type="button"
          onClick={() => dialogRef.current?.close()}
          aria-label="Close form"
          className="rounded-lg px-3 py-1 text-2xl leading-none text-ink-faint hover:bg-hushed hover:text-ink"
        >
          &times;
        </button>
      </div>

      <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-5">
        <Field id="lead-name" label="Customer name" error={errors.name}>
          <input
            id="lead-name"
            name="name"
            value={values.name}
            onChange={(event) => setField("name", event.target.value)}
            aria-invalid={Boolean(errors.name)}
            aria-describedby={errors.name ? "lead-name-error" : undefined}
            placeholder="e.g. Mary James"
            className={inputClassName}
          />
        </Field>

        <Field id="lead-service" label="Service requested" error={errors.service}>
          <input
            id="lead-service"
            name="service"
            value={values.service}
            onChange={(event) => setField("service", event.target.value)}
            aria-invalid={Boolean(errors.service)}
            aria-describedby={errors.service ? "lead-service-error" : undefined}
            placeholder="e.g. Wedding photography"
            className={inputClassName}
          />
        </Field>

        <Field id="lead-message" label="Customer enquiry" error={errors.message}>
          <textarea
            id="lead-message"
            name="message"
            rows={4}
            value={values.message}
            onChange={(event) => setField("message", event.target.value)}
            aria-invalid={Boolean(errors.message)}
            aria-describedby={errors.message ? "lead-message-error" : undefined}
            placeholder="What did the customer ask for?"
            className={`${inputClassName} textarea`}
          />
        </Field>

        <Field
          id="lead-whatsapp-number"
          label="WhatsApp number (optional)"
          error={errors.whatsappNumber}
          hint="Used only for an exact match with WhatsApp test-inbox senders."
        >
          <input
            id="lead-whatsapp-number"
            name="whatsappNumber"
            inputMode="tel"
            value={values.whatsappNumber}
            onChange={(event) => setField("whatsappNumber", event.target.value)}
            aria-invalid={Boolean(errors.whatsappNumber)}
            aria-describedby={
              errors.whatsappNumber ? "lead-whatsapp-number-error" : undefined
            }
            placeholder="e.g. 2348031234567"
            className={inputClassName}
          />
        </Field>

        <Field
          id="lead-follow-up"
          label="Follow-up date and time (optional)"
          error={errors.nextFollowUpAt}
        >
          <input
            id="lead-follow-up"
            name="nextFollowUpAt"
            type="datetime-local"
            value={values.nextFollowUpAt}
            onChange={(event) => setField("nextFollowUpAt", event.target.value)}
            aria-invalid={Boolean(errors.nextFollowUpAt)}
            aria-describedby={
              errors.nextFollowUpAt ? "lead-follow-up-error" : undefined
            }
            className={inputClassName}
          />
        </Field>

        {submitError ? (
          <p
            role="alert"
            className="rounded-xl border border-[color-mix(in_oklab,var(--rp-danger)_25%,transparent)] bg-danger-soft px-3.5 py-3 text-sm text-danger-ink"
          >
            {submitError}
          </p>
        ) : null}

        <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            disabled={isSubmitting}
            className="btn btn-secondary"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="btn btn-primary"
          >
            {isSubmitting ? "Saving…" : "Save lead"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
