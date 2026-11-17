"use client";

import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { PHONE_COUNTRY_OPTIONS } from "@/lib/countries";
import {
  LEAD_MESSAGE_MAX_LENGTH,
  LEAD_NAME_MAX_LENGTH,
  LEAD_SERVICE_MAX_LENGTH,
  LEAD_WHATSAPP_NUMBER_MAX_LENGTH,
  mapLeadServerErrors,
  validateLeadFollowUp,
  validateLeadMessage,
  validateLeadName,
  validateLeadPhoneFields,
  validateLeadService,
  validateNewLeadFields,
  type LeadFieldErrors,
  type LeadFieldName,
} from "@/lib/lead-validation";
import {
  LeadApiError,
  WHATSAPP_LEAD_NUMBER_UNRESOLVED_CODE,
} from "@/lib/leads";
import { SearchableCombobox } from "./searchable-combobox";
import { Alert, FormField } from "./ui";

export type NewLeadValues = {
  name: string;
  service: string;
  message: string;
  whatsappNumber: string;
  whatsappCountryCode: string;
  /**
   * Confirms that the WhatsApp number belongs to a different customer when
   * another lead may already hold it in a national format whose country is
   * not recorded.
   */
  confirmUnresolvedNumber: boolean;
  nextFollowUpAt: string;
};

const FIELD_DOM_IDS: Record<LeadFieldName, string> = {
  name: "lead-name",
  service: "lead-service",
  message: "lead-message",
  whatsappCountryCode: "lead-whatsapp-country",
  whatsappNumber: "lead-whatsapp-number",
  nextFollowUpAt: "lead-follow-up",
};

const FIELD_ORDER: LeadFieldName[] = [
  "name",
  "service",
  "message",
  "whatsappCountryCode",
  "whatsappNumber",
  "nextFollowUpAt",
];

function focusFirstLeadError(errors: LeadFieldErrors) {
  for (const field of FIELD_ORDER) {
    if (errors[field]) {
      document.getElementById(FIELD_DOM_IDS[field])?.focus();
      return;
    }
  }
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
    whatsappCountryCode: "",
    confirmUnresolvedNumber: false,
    nextFollowUpAt: "",
  });
  const [errors, setErrors] = useState<LeadFieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [unresolvedNumber, setUnresolvedNumber] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;

    return () => {
      if (dialog?.open) {
        dialog.close();
      }
    };
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;

    if (!dialog) return;

    if (open && !dialog.open) {
      setValues({
        name: "",
        service: "",
        message: "",
        whatsappNumber: "",
        whatsappCountryCode: "",
        confirmUnresolvedNumber: false,
        nextFollowUpAt: "",
      });
      setErrors({});
      setSubmitError(null);
      setUnresolvedNumber(false);
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  function setField(field: LeadFieldName, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => {
      if (!current[field] && !(field === "whatsappCountryCode" && current.whatsappNumber)) {
        return current;
      }
      return {
        ...current,
        [field]: undefined,
        ...(field === "whatsappCountryCode" ? { whatsappNumber: undefined } : {}),
        ...(field === "whatsappNumber" ? { whatsappCountryCode: undefined } : {}),
      };
    });
    setSubmitError(null);
  }

  function handleBlur(field: LeadFieldName) {
    if (field === "name") {
      setErrors((current) => ({ ...current, name: validateLeadName(values.name) }));
      return;
    }

    if (field === "service") {
      setErrors((current) => ({
        ...current,
        service: validateLeadService(values.service),
      }));
      return;
    }

    if (field === "message") {
      setErrors((current) => ({
        ...current,
        message: validateLeadMessage(values.message),
      }));
      return;
    }

    if (field === "nextFollowUpAt") {
      setErrors((current) => ({
        ...current,
        nextFollowUpAt: validateLeadFollowUp(values.nextFollowUpAt),
      }));
      return;
    }

    const phoneResult = validateLeadPhoneFields(
      values.whatsappNumber,
      values.whatsappCountryCode,
    );
    setErrors((current) => ({
      ...current,
      whatsappNumber: phoneResult.errors.whatsappNumber,
      whatsappCountryCode: phoneResult.errors.whatsappCountryCode,
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    const nextErrors = validateNewLeadFields(values);

    if (Object.values(nextErrors).some(Boolean)) {
      setErrors(nextErrors);
      focusFirstLeadError(nextErrors);
      return;
    }

    setErrors({});
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      await onCreate({
        name: values.name.trim(),
        service: values.service.trim(),
        message: values.message.trim(),
        whatsappNumber: values.whatsappNumber.trim(),
        whatsappCountryCode: values.whatsappCountryCode.trim(),
        confirmUnresolvedNumber: values.confirmUnresolvedNumber,
        nextFollowUpAt: values.nextFollowUpAt,
      });
      dialogRef.current?.close();
    } catch (error) {
      // A number that another lead may already hold in a national format
      // cannot be resolved by the API. The owner is asked to confirm that it
      // is a different customer instead of being told a duplicate exists.
      const unresolved =
        error instanceof LeadApiError &&
        error.code === WHATSAPP_LEAD_NUMBER_UNRESOLVED_CODE;

      setUnresolvedNumber(unresolved);

      if (unresolved) {
        setValues((current) => ({
          ...current,
          confirmUnresolvedNumber: false,
        }));
      }

      if (error instanceof LeadApiError) {
        const mapped = mapLeadServerErrors({
          code: error.code,
          message: error.message,
          details: error.details,
        });
        if (Object.values(mapped.fieldErrors).some(Boolean)) {
          setErrors(mapped.fieldErrors);
          focusFirstLeadError(mapped.fieldErrors);
        }
        setSubmitError(mapped.formError);
      } else {
        setSubmitError(
          error instanceof Error ? error.message : "Unable to save this lead.",
        );
      }
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
      className="m-auto max-h-[90dvh] w-[calc(100%-1.5rem)] max-w-lg overflow-y-auto rounded-2xl border border-line bg-surface p-4 text-ink shadow-2xl sm:p-7"
    >
      <div className="flex items-start justify-between gap-4 border-b border-line pb-4">
        <div>
          <h2 id="new-lead-title" className="text-xl font-bold text-ink">
            Add a customer enquiry
          </h2>
          <p className="mt-1 text-sm leading-6 text-ink-soft">
            Save customer details so you can track follow-ups and draft replies.
          </p>
        </div>
        <button
          type="button"
          onClick={() => dialogRef.current?.close()}
          aria-label="Close form"
          className="flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-xl text-2xl leading-none text-ink-soft hover:bg-hushed hover:text-ink"
        >
          &times;
        </button>
      </div>

      <form onSubmit={handleSubmit} noValidate className="mt-5 space-y-5">
        <FormField
          id="lead-name"
          label="Customer name"
          error={errors.name}
        >
          {(props) => (
            <input
              {...props}
              name="name"
              maxLength={LEAD_NAME_MAX_LENGTH}
              value={values.name}
              onChange={(event) => setField("name", event.target.value)}
              onBlur={() => handleBlur("name")}
              disabled={isSubmitting}
              placeholder="e.g. Chidinma Okafor"
              className="input"
            />
          )}
        </FormField>

        <FormField
          id="lead-service"
          label="Service requested"
          error={errors.service}
        >
          {(props) => (
            <input
              {...props}
              name="service"
              maxLength={LEAD_SERVICE_MAX_LENGTH}
              value={values.service}
              onChange={(event) => setField("service", event.target.value)}
              onBlur={() => handleBlur("service")}
              disabled={isSubmitting}
              placeholder="e.g. Traditional wedding photography"
              className="input"
            />
          )}
        </FormField>

        <FormField
          id="lead-message"
          label="Customer enquiry"
          error={errors.message}
          labelAside={
            <span className="numeric-tabular text-xs text-ink-soft">
              {values.message.length}/{LEAD_MESSAGE_MAX_LENGTH}
            </span>
          }
        >
          {(props) => (
            <textarea
              {...props}
              name="message"
              rows={4}
              maxLength={LEAD_MESSAGE_MAX_LENGTH}
              value={values.message}
              onChange={(event) => setField("message", event.target.value)}
              onBlur={() => handleBlur("message")}
              disabled={isSubmitting}
              placeholder="What dates, venue, or package did the customer ask about?"
              className="textarea"
            />
          )}
        </FormField>

        <div className="grid gap-4 sm:grid-cols-[minmax(0,13.5rem)_minmax(0,1fr)]">
          <SearchableCombobox
            id="lead-whatsapp-country"
            label="WhatsApp country"
            value={values.whatsappCountryCode}
            options={PHONE_COUNTRY_OPTIONS}
            onChange={(value) => {
              setField("whatsappCountryCode", value);
              const nextResult = validateLeadPhoneFields(
                values.whatsappNumber,
                value,
              );
              setErrors((current) => ({
                ...current,
                whatsappCountryCode: nextResult.errors.whatsappCountryCode,
                whatsappNumber: nextResult.errors.whatsappNumber,
              }));
            }}
            placeholder="Select country"
            error={errors.whatsappCountryCode}
            disabled={isSubmitting}
            allowClear
            helpText="Required for local numbers like 0803... unless written with +234."
          />

          <FormField
            id="lead-whatsapp-number"
            label="WhatsApp number (optional)"
            error={errors.whatsappNumber}
            hint="Used to link this enquiry with WhatsApp chats automatically."
          >
            {(props) => (
              <input
                {...props}
                name="whatsappNumber"
                inputMode="tel"
                maxLength={LEAD_WHATSAPP_NUMBER_MAX_LENGTH}
                value={values.whatsappNumber}
                onChange={(event) =>
                  setField("whatsappNumber", event.target.value)
                }
                onBlur={() => handleBlur("whatsappNumber")}
                disabled={isSubmitting}
                placeholder="e.g. 0803 123 4567"
                className="input numeric-tabular"
              />
            )}
          </FormField>
        </div>

        <FormField
          id="lead-follow-up"
          label="Follow-up reminder (optional)"
          error={errors.nextFollowUpAt}
          hint="Enquiries due for a check-in appear at the top of your dashboard."
        >
          {(props) => (
            <input
              {...props}
              name="nextFollowUpAt"
              type="datetime-local"
              value={values.nextFollowUpAt}
              onChange={(event) => setField("nextFollowUpAt", event.target.value)}
              onBlur={() => handleBlur("nextFollowUpAt")}
              disabled={isSubmitting}
              className="input numeric-tabular"
            />
          )}
        </FormField>

        {submitError ? (
          <Alert tone="danger" role="alert">
            {submitError}
          </Alert>
        ) : null}

        {unresolvedNumber ? (
          <label
            htmlFor="lead-confirm-unresolved-number"
            className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-line bg-hushed px-3.5 py-3 text-xs leading-5 text-ink-soft"
          >
            <input
              id="lead-confirm-unresolved-number"
              name="confirmUnresolvedNumber"
              type="checkbox"
              checked={values.confirmUnresolvedNumber}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  confirmUnresolvedNumber: event.target.checked,
                }))
              }
              disabled={isSubmitting}
              className="checkbox mt-0.5"
            />
            <span>
              Confirm this is a different customer. Another saved lead uses
              these digits without a recorded country code, so it could not be
              checked automatically.
            </span>
          </label>
        ) : null}

        <div className="flex flex-col-reverse gap-3 border-t border-line pt-4 sm:flex-row sm:justify-end">
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
            {isSubmitting ? "Saving enquiry…" : "Save enquiry"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
