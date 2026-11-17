import { z } from "zod";
import { KNOWLEDGE_ENTRY_TYPES } from "./business";
import { isSupportedCurrencyCode } from "./currencies";
import { SUPPRESSION_REASONS } from "./delivery";
import { parseMajorPriceToMinor } from "./money";
import { validatePhoneInput } from "./phone";
import { isValidTimezone } from "./timezones";

/**
 * Character and enum bounds synchronized with `server/src/business/schemas.ts`
 * and `server/src/whatsapp/operations-routes.ts`.
 */
export const BUSINESS_LIMITS = {
  businessNameMax: 160,
  businessDescriptionMax: 2000,
  contactEmailMax: 254,
  contactPhoneMax: 60,
  businessAddressMax: 500,
  timezoneMax: 100,
  catalogueNameMax: 160,
  catalogueDescriptionMax: 2000,
  catalogueAvailabilityMax: 1000,
  knowledgeTitleMax: 240,
  knowledgeAnswerMax: 4000,
  suppressionNotesMax: 500,
} as const;

export type ApiValidationDetail = Readonly<{
  field: string;
  message: string;
}>;

type ParsedApiErrorPayload = Readonly<{
  error?: string;
  details: readonly ApiValidationDetail[];
}>;

function parseApiErrorPayload(data: unknown): ParsedApiErrorPayload {
  if (typeof data !== "object" || data === null) {
    return { details: [] };
  }

  const errorText =
    "error" in data && typeof data.error === "string" ? data.error : undefined;

  if (!("details" in data) || !Array.isArray(data.details)) {
    return { error: errorText, details: [] };
  }

  const details: ApiValidationDetail[] = [];

  for (const item of data.details) {
    if (
      typeof item === "object" &&
      item !== null &&
      "field" in item &&
      typeof item.field === "string" &&
      "message" in item &&
      typeof item.message === "string"
    ) {
      details.push({
        field: item.field.replace(/^body\./, ""),
        message: item.message,
      });
    }
  }

  return { error: errorText, details };
}

export function hasFieldErrors<T extends Record<string, string | undefined>>(
  errors: T,
): boolean {
  return Object.values(errors).some((value) => Boolean(value));
}

/* -------------------------------------------------------------------------- */
/* Business profile validation                                                */
/* -------------------------------------------------------------------------- */

export type BusinessProfileFormValues = Readonly<{
  businessName: string;
  timezone: string;
  businessDescription: string;
  contactEmail: string;
  currency: string;
  phoneCountry: string;
  phoneNational: string;
  businessAddress: string;
}>;

export type BusinessProfileField = keyof BusinessProfileFieldErrors;

export type BusinessProfileFieldErrors = {
  businessName?: string;
  timezone?: string;
  businessDescription?: string;
  contactEmail?: string;
  currency?: string;
  phoneCountry?: string;
  phoneNumber?: string;
  businessAddress?: string;
  openingHours?: string;
};

export function validateBusinessProfileField(
  field: BusinessProfileField,
  values: BusinessProfileFormValues,
): string | undefined {
  switch (field) {
    case "businessName": {
      const trimmed = values.businessName.trim();
      if (!trimmed) {
        return "Enter your business name.";
      }
      if (trimmed.length > BUSINESS_LIMITS.businessNameMax) {
        return `Business name must be ${BUSINESS_LIMITS.businessNameMax} characters or fewer.`;
      }
      return undefined;
    }

    case "timezone": {
      const trimmed = values.timezone.trim();
      if (!trimmed) {
        return "Choose the timezone that matches the business.";
      }
      if (
        trimmed.length > BUSINESS_LIMITS.timezoneMax ||
        !isValidTimezone(trimmed)
      ) {
        return "Choose a valid IANA timezone.";
      }
      return undefined;
    }

    case "businessDescription": {
      if (
        values.businessDescription.trim().length >
        BUSINESS_LIMITS.businessDescriptionMax
      ) {
        return `Business description must be ${BUSINESS_LIMITS.businessDescriptionMax} characters or fewer.`;
      }
      return undefined;
    }

    case "contactEmail": {
      const trimmed = values.contactEmail.trim();
      if (!trimmed) {
        return undefined;
      }
      if (
        trimmed.length > BUSINESS_LIMITS.contactEmailMax ||
        !z.email().safeParse(trimmed).success
      ) {
        return "Enter a valid contact email address (for example hello@studio.ng).";
      }
      return undefined;
    }

    case "currency": {
      const trimmed = values.currency.trim();
      if (trimmed && !isSupportedCurrencyCode(trimmed)) {
        return "Choose a valid ISO 4217 currency.";
      }
      return undefined;
    }

    case "phoneCountry":
      return validatePhoneInput(values.phoneCountry, values.phoneNational)
        .errors.country;

    case "phoneNumber": {
      const phoneResult = validatePhoneInput(
        values.phoneCountry,
        values.phoneNational,
      );
      if (phoneResult.errors.number) {
        return phoneResult.errors.number;
      }
      if (
        phoneResult.phone &&
        phoneResult.phone.length > BUSINESS_LIMITS.contactPhoneMax
      ) {
        return `Phone number must be ${BUSINESS_LIMITS.contactPhoneMax} characters or fewer.`;
      }
      return undefined;
    }

    case "businessAddress": {
      if (
        values.businessAddress.trim().length >
        BUSINESS_LIMITS.businessAddressMax
      ) {
        return `Business address must be ${BUSINESS_LIMITS.businessAddressMax} characters or fewer.`;
      }
      return undefined;
    }

    case "openingHours":
      return undefined;
  }
}

export function validateBusinessProfileFields(
  values: BusinessProfileFormValues,
): BusinessProfileFieldErrors {
  const errors: BusinessProfileFieldErrors = {};

  const businessName = validateBusinessProfileField("businessName", values);
  const timezone = validateBusinessProfileField("timezone", values);
  const businessDescription = validateBusinessProfileField(
    "businessDescription",
    values,
  );
  const contactEmail = validateBusinessProfileField("contactEmail", values);
  const currency = validateBusinessProfileField("currency", values);
  const phoneCountry = validateBusinessProfileField("phoneCountry", values);
  const phoneNumber = validateBusinessProfileField("phoneNumber", values);
  const businessAddress = validateBusinessProfileField(
    "businessAddress",
    values,
  );

  if (businessName) errors.businessName = businessName;
  if (timezone) errors.timezone = timezone;
  if (businessDescription) errors.businessDescription = businessDescription;
  if (contactEmail) errors.contactEmail = contactEmail;
  if (currency) errors.currency = currency;
  if (phoneCountry) errors.phoneCountry = phoneCountry;
  if (phoneNumber) errors.phoneNumber = phoneNumber;
  if (businessAddress) errors.businessAddress = businessAddress;

  return errors;
}

export function mapBusinessProfileServerErrors(
  data: unknown,
  fallback = "Unable to save business profile.",
): Readonly<{
  fieldErrors: BusinessProfileFieldErrors;
  formError: string | null;
}> {
  const { error, details } = parseApiErrorPayload(data);
  const fieldErrors: BusinessProfileFieldErrors = {};
  let unmappedMessage: string | null = null;

  for (const detail of details) {
    if (detail.field === "businessName") {
      fieldErrors.businessName ??= detail.message;
    } else if (detail.field === "timezone") {
      fieldErrors.timezone ??= detail.message;
    } else if (detail.field === "businessDescription") {
      fieldErrors.businessDescription ??= detail.message;
    } else if (detail.field === "contactEmail") {
      fieldErrors.contactEmail ??= detail.message;
    } else if (detail.field === "currencyCode") {
      fieldErrors.currency ??= detail.message;
    } else if (detail.field === "contactPhone") {
      fieldErrors.phoneNumber ??= detail.message;
    } else if (detail.field === "contactPhoneCountry") {
      fieldErrors.phoneCountry ??= detail.message;
    } else if (detail.field === "businessAddress") {
      fieldErrors.businessAddress ??= detail.message;
    } else if (detail.field.startsWith("openingHours")) {
      fieldErrors.openingHours ??= detail.message;
    } else {
      unmappedMessage ??= detail.message;
    }
  }

  const hasFields = hasFieldErrors(fieldErrors);

  return {
    fieldErrors,
    formError:
      unmappedMessage ??
      (hasFields
        ? "Check the highlighted business profile fields and try again."
        : (error ?? fallback)),
  };
}

/* -------------------------------------------------------------------------- */
/* Products & services catalogue validation                                   */
/* -------------------------------------------------------------------------- */

export type CatalogueFormValues = Readonly<{
  name: string;
  currencyCode: string;
  priceMajor: string;
  availabilityNotes: string;
  description: string;
}>;

export type CatalogueField = keyof CatalogueFieldErrors;

export type CatalogueFieldErrors = {
  name?: string;
  currencyCode?: string;
  priceMajor?: string;
  availabilityNotes?: string;
  description?: string;
};

export function validateCatalogueField(
  field: CatalogueField,
  values: CatalogueFormValues,
): string | undefined {
  switch (field) {
    case "name": {
      const trimmed = values.name.trim();
      if (!trimmed) {
        return "Enter a service or product name.";
      }
      if (trimmed.length > BUSINESS_LIMITS.catalogueNameMax) {
        return `Service name must be ${BUSINESS_LIMITS.catalogueNameMax} characters or fewer.`;
      }
      return undefined;
    }

    case "currencyCode": {
      const normalized = values.currencyCode.trim().toUpperCase();
      if (!normalized || !isSupportedCurrencyCode(normalized)) {
        return "Enter a current uppercase ISO 4217 currency code (for example NGN or USD).";
      }
      return undefined;
    }

    case "priceMajor": {
      const normalizedCurrency =
        values.currencyCode.trim().toUpperCase() || "NGN";
      const parsed = parseMajorPriceToMinor(
        values.priceMajor,
        normalizedCurrency,
      );
      return parsed.ok ? undefined : parsed.message;
    }

    case "availabilityNotes": {
      if (
        values.availabilityNotes.trim().length >
        BUSINESS_LIMITS.catalogueAvailabilityMax
      ) {
        return `Availability notes must be ${BUSINESS_LIMITS.catalogueAvailabilityMax} characters or fewer.`;
      }
      return undefined;
    }

    case "description": {
      if (
        values.description.trim().length >
        BUSINESS_LIMITS.catalogueDescriptionMax
      ) {
        return `Description must be ${BUSINESS_LIMITS.catalogueDescriptionMax} characters or fewer.`;
      }
      return undefined;
    }
  }
}

export function validateCatalogueFields(
  values: CatalogueFormValues,
): CatalogueFieldErrors {
  const errors: CatalogueFieldErrors = {};

  const name = validateCatalogueField("name", values);
  const currencyCode = validateCatalogueField("currencyCode", values);
  const priceMajor = validateCatalogueField("priceMajor", values);
  const availabilityNotes = validateCatalogueField(
    "availabilityNotes",
    values,
  );
  const description = validateCatalogueField("description", values);

  if (name) errors.name = name;
  if (currencyCode) errors.currencyCode = currencyCode;
  if (priceMajor) errors.priceMajor = priceMajor;
  if (availabilityNotes) errors.availabilityNotes = availabilityNotes;
  if (description) errors.description = description;

  return errors;
}

export function mapCatalogueServerErrors(
  data: unknown,
  fallback = "Unable to save service.",
): Readonly<{
  fieldErrors: CatalogueFieldErrors;
  formError: string | null;
}> {
  const { error, details } = parseApiErrorPayload(data);
  const fieldErrors: CatalogueFieldErrors = {};
  let unmappedMessage: string | null = null;

  for (const detail of details) {
    if (detail.field === "name") {
      fieldErrors.name ??= detail.message;
    } else if (detail.field === "currencyCode") {
      fieldErrors.currencyCode ??= detail.message;
    } else if (detail.field === "priceMinor") {
      fieldErrors.priceMajor ??= detail.message;
    } else if (detail.field === "availabilityNotes") {
      fieldErrors.availabilityNotes ??= detail.message;
    } else if (detail.field === "description") {
      fieldErrors.description ??= detail.message;
    } else {
      unmappedMessage ??= detail.message;
    }
  }

  const hasFields = hasFieldErrors(fieldErrors);

  return {
    fieldErrors,
    formError:
      unmappedMessage ??
      (hasFields
        ? "Check the highlighted service fields and try again."
        : (error ?? fallback)),
  };
}

/* -------------------------------------------------------------------------- */
/* FAQs & policies knowledge validation                                       */
/* -------------------------------------------------------------------------- */

export type KnowledgeFormValues = Readonly<{
  title: string;
  entryType: string;
  answer: string;
}>;

export type KnowledgeField = keyof KnowledgeFieldErrors;

export type KnowledgeFieldErrors = {
  title?: string;
  entryType?: string;
  answer?: string;
};

export function validateKnowledgeField(
  field: KnowledgeField,
  values: KnowledgeFormValues,
): string | undefined {
  switch (field) {
    case "title": {
      const trimmed = values.title.trim();
      if (!trimmed) {
        return "Enter a title or question.";
      }
      if (trimmed.length > BUSINESS_LIMITS.knowledgeTitleMax) {
        return `Title or question must be ${BUSINESS_LIMITS.knowledgeTitleMax} characters or fewer.`;
      }
      return undefined;
    }

    case "entryType": {
      if (
        !(KNOWLEDGE_ENTRY_TYPES as readonly string[]).includes(values.entryType)
      ) {
        return "Choose FAQ or Policy.";
      }
      return undefined;
    }

    case "answer": {
      const trimmed = values.answer.trim();
      if (!trimmed) {
        return "Enter the approved answer or policy.";
      }
      if (trimmed.length > BUSINESS_LIMITS.knowledgeAnswerMax) {
        return `Approved answer or policy must be ${BUSINESS_LIMITS.knowledgeAnswerMax} characters or fewer.`;
      }
      return undefined;
    }
  }
}

export function validateKnowledgeFields(
  values: KnowledgeFormValues,
): KnowledgeFieldErrors {
  const errors: KnowledgeFieldErrors = {};

  const title = validateKnowledgeField("title", values);
  const entryType = validateKnowledgeField("entryType", values);
  const answer = validateKnowledgeField("answer", values);

  if (title) errors.title = title;
  if (entryType) errors.entryType = entryType;
  if (answer) errors.answer = answer;

  return errors;
}

export function mapKnowledgeServerErrors(
  data: unknown,
  fallback = "Unable to save knowledge entry.",
): Readonly<{
  fieldErrors: KnowledgeFieldErrors;
  formError: string | null;
}> {
  const { error, details } = parseApiErrorPayload(data);
  const fieldErrors: KnowledgeFieldErrors = {};
  let unmappedMessage: string | null = null;

  for (const detail of details) {
    if (detail.field === "title") {
      fieldErrors.title ??= detail.message;
    } else if (detail.field === "entryType") {
      fieldErrors.entryType ??= detail.message;
    } else if (detail.field === "answer") {
      fieldErrors.answer ??= detail.message;
    } else {
      unmappedMessage ??= detail.message;
    }
  }

  const hasFields = hasFieldErrors(fieldErrors);

  return {
    fieldErrors,
    formError:
      unmappedMessage ??
      (hasFields
        ? "Check the highlighted entry fields and try again."
        : (error ?? fallback)),
  };
}

/* -------------------------------------------------------------------------- */
/* Customer suppression validation                                            */
/* -------------------------------------------------------------------------- */

export type SuppressionFormValues = Readonly<{
  customerId: string;
  reason: string;
  notes: string;
}>;

export type SuppressionField = keyof SuppressionFieldErrors;

export type SuppressionFieldErrors = {
  customerId?: string;
  reason?: string;
  notes?: string;
};

export function validateSuppressionField(
  field: SuppressionField,
  values: SuppressionFormValues,
): string | undefined {
  switch (field) {
    case "customerId": {
      const trimmed = values.customerId.trim();
      if (!trimmed) {
        return "Choose a customer to suppress.";
      }
      if (!z.uuid().safeParse(trimmed).success) {
        return "Choose a valid customer record.";
      }
      return undefined;
    }

    case "reason": {
      if (!(SUPPRESSION_REASONS as readonly string[]).includes(values.reason)) {
        return "Choose a valid suppression reason.";
      }
      return undefined;
    }

    case "notes": {
      if (values.notes.trim().length > BUSINESS_LIMITS.suppressionNotesMax) {
        return `Notes must be ${BUSINESS_LIMITS.suppressionNotesMax} characters or fewer.`;
      }
      return undefined;
    }
  }
}

export function validateSuppressionFields(
  values: SuppressionFormValues,
): SuppressionFieldErrors {
  const errors: SuppressionFieldErrors = {};

  const customerId = validateSuppressionField("customerId", values);
  const reason = validateSuppressionField("reason", values);
  const notes = validateSuppressionField("notes", values);

  if (customerId) errors.customerId = customerId;
  if (reason) errors.reason = reason;
  if (notes) errors.notes = notes;

  return errors;
}

export function mapSuppressionServerErrors(
  data: unknown,
  fallback = "Unable to suppress this customer.",
): Readonly<{
  fieldErrors: SuppressionFieldErrors;
  formError: string | null;
}> {
  const { error, details } = parseApiErrorPayload(data);
  const fieldErrors: SuppressionFieldErrors = {};
  let unmappedMessage: string | null = null;

  for (const detail of details) {
    if (detail.field === "customerId") {
      fieldErrors.customerId ??= detail.message;
    } else if (detail.field === "reason") {
      fieldErrors.reason ??= detail.message;
    } else if (detail.field === "notes") {
      fieldErrors.notes ??= detail.message;
    } else {
      unmappedMessage ??= detail.message;
    }
  }

  const hasFields = hasFieldErrors(fieldErrors);

  return {
    fieldErrors,
    formError:
      unmappedMessage ??
      (hasFields
        ? "Check the highlighted suppression fields and try again."
        : (error ?? fallback)),
  };
}
