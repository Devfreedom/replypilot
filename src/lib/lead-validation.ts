import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";
import { countryName, isCuratedPhoneCountryCode } from "./countries";
import {
  WHATSAPP_LEAD_DUPLICATE_NUMBER_CODE,
  type LeadValidationDetail,
} from "./leads";

export const LEAD_NAME_MAX_LENGTH = 120;
export const LEAD_SERVICE_MAX_LENGTH = 160;
export const LEAD_MESSAGE_MAX_LENGTH = 2000;
export const LEAD_WHATSAPP_NUMBER_MAX_LENGTH = 32;
export const REPLY_DRAFT_MAX_LENGTH = 2000;

const DIGITS_PATTERN = /^[0-9]{5,32}$/;
const PHONE_SHAPE_PATTERN = /^\+?[0-9\s().-]+$/;

export type LeadFormValues = Readonly<{
  name: string;
  service: string;
  message: string;
  whatsappNumber: string;
  whatsappCountryCode: string;
  nextFollowUpAt: string;
}>;

export type LeadFieldName = keyof LeadFormValues;
export type LeadFieldErrors = Partial<Record<LeadFieldName, string>>;

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

export function validateLeadName(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return "Enter the customer's name.";
  if (trimmed.length > LEAD_NAME_MAX_LENGTH) {
    return `Name must be ${LEAD_NAME_MAX_LENGTH} characters or fewer.`;
  }
  return undefined;
}

export function validateLeadService(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return "Enter the service the customer asked about.";
  if (trimmed.length > LEAD_SERVICE_MAX_LENGTH) {
    return `Service must be ${LEAD_SERVICE_MAX_LENGTH} characters or fewer.`;
  }
  return undefined;
}

export function validateLeadMessage(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return "Enter the customer's enquiry message.";
  if (trimmed.length > LEAD_MESSAGE_MAX_LENGTH) {
    return `Enquiry must be ${LEAD_MESSAGE_MAX_LENGTH} characters or fewer.`;
  }
  return undefined;
}

export function validateLeadFollowUp(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed)) {
    return "Enter a valid follow-up date and time.";
  }
  return undefined;
}

/**
 * Mirrors `server/src/leads/phone.ts#normalizeLeadPhoneNumber` strictly on the
 * client so invalid national or international numbers never slip past UI
 * validation only to fail on submit.
 */
export function validateLeadPhoneFields(
  number: string,
  countryCode: string,
): Readonly<{
  errors: Pick<LeadFieldErrors, "whatsappNumber" | "whatsappCountryCode">;
  e164: string | null;
}> {
  const trimmed = number.trim();
  const requestedCountry = countryCode.trim().toUpperCase();

  if (requestedCountry && !isCuratedPhoneCountryCode(requestedCountry)) {
    return {
      e164: null,
      errors: {
        whatsappCountryCode:
          "Choose a supported phone country for this WhatsApp number.",
      },
    };
  }

  if (!trimmed) {
    return { e164: null, errors: {} };
  }

  if (trimmed.length > LEAD_WHATSAPP_NUMBER_MAX_LENGTH) {
    return {
      e164: null,
      errors: {
        whatsappNumber: `WhatsApp number must be ${LEAD_WHATSAPP_NUMBER_MAX_LENGTH} characters or fewer.`,
      },
    };
  }

  if (!PHONE_SHAPE_PATTERN.test(trimmed)) {
    return {
      e164: null,
      errors: {
        whatsappNumber:
          "Enter only digits, spaces and standard separators, for example +234 803 123 4567.",
      },
    };
  }

  const digits = digitsOnly(trimmed);

  if (!DIGITS_PATTERN.test(digits)) {
    return {
      e164: null,
      errors: {
        whatsappNumber:
          "Enter a valid international WhatsApp number, for example +2348031234567.",
      },
    };
  }

  if (trimmed.startsWith("+")) {
    let parsed: ReturnType<typeof parsePhoneNumberFromString>;
    try {
      parsed = parsePhoneNumberFromString(`+${digits}`);
    } catch {
      parsed = undefined;
    }

    if (!parsed || !parsed.isValid() || !parsed.country) {
      return {
        e164: null,
        errors: {
          whatsappNumber:
            "Enter a valid international WhatsApp number, for example +2348031234567.",
        },
      };
    }

    if (requestedCountry && parsed.country !== requestedCountry) {
      return {
        e164: null,
        errors: {
          whatsappNumber: `This number belongs to ${countryName(
            parsed.country,
          )}, not ${countryName(requestedCountry)}. Choose the right country or fix the number.`,
        },
      };
    }

    if (!isCuratedPhoneCountryCode(parsed.country)) {
      return {
        e164: null,
        errors: {
          whatsappNumber: `This number belongs to ${parsed.country}, which is not a supported phone country.`,
        },
      };
    }

    return { e164: parsed.number, errors: {} };
  }

  if (!requestedCountry) {
    return {
      e164: null,
      errors: {
        whatsappCountryCode:
          "Choose the country for this WhatsApp number, or start with + (for example +2348031234567).",
      },
    };
  }

  let national: ReturnType<typeof parsePhoneNumberFromString>;
  try {
    national = parsePhoneNumberFromString(digits, requestedCountry as CountryCode);
  } catch {
    national = undefined;
  }

  if (national && national.isValid() && national.country === requestedCountry) {
    return { e164: national.number, errors: {} };
  }

  return {
    e164: null,
    errors: {
      whatsappNumber: `Enter a valid WhatsApp number for ${countryName(
        requestedCountry,
      )}, for example +2348031234567.`,
    },
  };
}

export function validateNewLeadFields(values: LeadFormValues): LeadFieldErrors {
  const errors: LeadFieldErrors = {};

  const nameError = validateLeadName(values.name);
  if (nameError) errors.name = nameError;

  const serviceError = validateLeadService(values.service);
  if (serviceError) errors.service = serviceError;

  const messageError = validateLeadMessage(values.message);
  if (messageError) errors.message = messageError;

  const phoneResult = validateLeadPhoneFields(
    values.whatsappNumber,
    values.whatsappCountryCode,
  );
  if (phoneResult.errors.whatsappNumber) {
    errors.whatsappNumber = phoneResult.errors.whatsappNumber;
  }
  if (phoneResult.errors.whatsappCountryCode) {
    errors.whatsappCountryCode = phoneResult.errors.whatsappCountryCode;
  }

  const followUpError = validateLeadFollowUp(values.nextFollowUpAt);
  if (followUpError) errors.nextFollowUpAt = followUpError;

  return errors;
}

export function validateDraftReplyText(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return "Reply text cannot be empty. Enter a message before saving.";
  }
  if (trimmed.length > REPLY_DRAFT_MAX_LENGTH) {
    return `Reply text must be ${REPLY_DRAFT_MAX_LENGTH} characters or fewer.`;
  }
  return undefined;
}

const SERVER_LEAD_FIELD_MAP: Readonly<Record<string, LeadFieldName>> = {
  name: "name",
  service: "service",
  lastMessage: "message",
  whatsappNumber: "whatsappNumber",
  whatsappCountryCode: "whatsappCountryCode",
  nextFollowUpAt: "nextFollowUpAt",
};

export function mapLeadServerErrors(error: {
  code?: string;
  message: string;
  details?: readonly LeadValidationDetail[];
}): Readonly<{ fieldErrors: LeadFieldErrors; formError: string | null }> {
  const fieldErrors: LeadFieldErrors = {};
  const unmappedMessages: string[] = [];

  for (const detail of error.details ?? []) {
    const rawKey = detail.field.replace(/^body\./, "");
    const mappedField = SERVER_LEAD_FIELD_MAP[rawKey];
    if (mappedField) {
      if (!fieldErrors[mappedField]) {
        fieldErrors[mappedField] = detail.message;
      }
    } else if (detail.message) {
      unmappedMessages.push(detail.message);
    }
  }

  if (error.code === WHATSAPP_LEAD_DUPLICATE_NUMBER_CODE) {
    fieldErrors.whatsappNumber = error.message;
    return { fieldErrors, formError: null };
  }

  if (Object.keys(fieldErrors).length > 0 && unmappedMessages.length === 0) {
    return { fieldErrors, formError: null };
  }

  return {
    fieldErrors,
    formError: unmappedMessages[0] ?? error.message,
  };
}
