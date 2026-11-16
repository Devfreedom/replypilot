/**
 * Lead WhatsApp phone-number normalization.
 *
 * A lead's WhatsApp number is stored in E.164 form ("+2348012345678"), the same
 * representation `customers.phone_e164` already uses. That makes a lead number
 * and a customer number directly comparable, which is what the linkage checks
 * need.
 *
 * The conversion never guesses a country:
 *
 * - A leading "+" is the explicit international marker. Only a number written
 *   that way may be accepted without a country, and its country is read from
 *   the number itself.
 * - Every other number is a national number, so the country has to be selected.
 *   "08012345678" is only "+2348012345678" when the country is known to be
 *   Nigeria; the leading trunk zero is never stripped by hand, and no country
 *   is ever inferred from a digit prefix.
 *
 * Owner input is validated with libphonenumber, because only a real numbering
 * plan can tell whether a number belongs to the chosen country.
 */

import {
  getCountryCallingCode,
  parsePhoneNumberFromString,
} from "libphonenumber-js";
import type { CountryCode } from "libphonenumber-js";
import { SUPPORTED_PHONE_COUNTRY_SET } from "../business/phone-countries.js";
import { normalizeWhatsAppPhoneE164 } from "../whatsapp/phone.js";

/** The E.164 shape used by `customers.phone_e164` and by lead numbers. */
export const E164_PATTERN = /^\+[1-9][0-9]{4,14}$/;

/** Digits only, as entered by an owner before a country is applied. */
const DIGITS_PATTERN = /^[0-9]{5,32}$/;

/**
 * Phone-shaped input only: an optional leading plus followed by digits and the
 * common visual separators. Letters, dots, underscores and other provider
 * identifier characters are rejected before any digit stripping happens, so
 * they can never be turned into a fabricated number.
 */
const PHONE_SHAPE_PATTERN = /^\+?[0-9\s().-]+$/;

/** The outcome of normalizing an owner-supplied phone number. */
export type PhoneNormalizationResult =
  | Readonly<{
      ok: true;
      /** The canonical E.164 representation, or null when no number was given. */
      e164: string | null;
      /** The ISO country code the number belongs to, when it could be established. */
      countryCode: string | null;
    }>
  | Readonly<{
      ok: false;
      /** A stable machine-readable reason for the rejection. */
      reason:
        | "invalid"
        | "invalid-characters"
        | "ambiguous-country"
        | "country-mismatch"
        | "unsupported-country";
      /** The message shown to the owner. */
      message: string;
    }>;

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * Parses digits as a complete international number.
 *
 * The country calling code is part of the digits, so this never guesses a
 * country: a national number that lacks a calling code does not resolve.
 */
function parseAsInternational(digits: string) {
  try {
    const parsed = parsePhoneNumberFromString(`+${digits}`);
    return parsed && parsed.isValid() && parsed.country ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Normalizes an owner-supplied WhatsApp number to E.164.
 *
 * `countryCode` is the explicit calling-code country of the number, for example
 * "NG" for a Nigerian national number. It is required unless the number is
 * written in international form with a leading "+".
 */
export function normalizeLeadPhoneNumber(
  number: string | null | undefined,
  countryCode: string | null | undefined,
): PhoneNormalizationResult {
  const trimmed = (number ?? "").trim();

  // The country is validated even when no number is given, so an unsupported
  // country is always reported rather than silently accepted.
  const requestedCountry = (countryCode ?? "").trim().toUpperCase();

  if (requestedCountry && !SUPPORTED_PHONE_COUNTRY_SET.has(requestedCountry)) {
    return {
      ok: false,
      reason: "unsupported-country",
      message: "Choose a supported phone country for this WhatsApp number.",
    };
  }

  if (!trimmed) {
    return { ok: true, e164: null, countryCode: null };
  }

  if (!PHONE_SHAPE_PATTERN.test(trimmed)) {
    return {
      ok: false,
      reason: "invalid-characters",
      message:
        "Enter only digits, spaces and the usual separators, for example +234 803 123 4567. Letters and other characters are not accepted.",
    };
  }

  const digits = digitsOnly(trimmed);

  if (!DIGITS_PATTERN.test(digits)) {
    return {
      ok: false,
      reason: "invalid",
      message:
        "Enter a valid international WhatsApp number, for example +2348031234567.",
    };
  }

  // A leading "+" is the explicit international marker. Only such a number may
  // be accepted without a country selection.
  if (trimmed.startsWith("+")) {
    const international = parseAsInternational(digits);

    if (!international) {
      return {
        ok: false,
        reason: "invalid",
        message:
          "Enter a valid international WhatsApp number, for example +2348031234567.",
      };
    }

    if (requestedCountry && international.country !== requestedCountry) {
      return {
        ok: false,
        reason: "country-mismatch",
        message: `This number belongs to ${international.country}, not ${requestedCountry}. Choose the right country or correct the number.`,
      };
    }

    if (!SUPPORTED_PHONE_COUNTRY_SET.has(international.country ?? "")) {
      return {
        ok: false,
        reason: "unsupported-country",
        message: `This number belongs to ${international.country}, which is not a supported phone country.`,
      };
    }

    return {
      ok: true,
      e164: international.number,
      countryCode: international.country ?? null,
    };
  }

  // Without a leading "+" the digits are a national number, so the country has
  // to be explicit. Nothing is inferred from the digits.
  if (!requestedCountry) {
    return {
      ok: false,
      reason: "ambiguous-country",
      message:
        "Choose the country for this WhatsApp number, or enter it in international format starting with + (for example +2348031234567). ReplyPilot cannot guess a country code from the digits alone.",
    };
  }

  let national: ReturnType<typeof parsePhoneNumberFromString>;

  try {
    national = parsePhoneNumberFromString(
      digits,
      requestedCountry as CountryCode,
    );
  } catch {
    national = undefined;
  }

  if (national && national.isValid() && national.country === requestedCountry) {
    return {
      ok: true,
      e164: national.number,
      countryCode: national.country,
    };
  }

  return {
    ok: false,
    reason: "invalid",
    message: `Enter a valid WhatsApp number for ${requestedCountry}, for example +2348031234567.`,
  };
}

/**
 * Normalizes a number for comparison between a lead, a customer, and an
 * inbound sender.
 *
 * This uses the same rule the repository already applies to
 * `customers.phone_e164`, so a lead number and a customer number are equal
 * exactly when they describe the same subscriber, whether either side was
 * stored with or without a leading "+".
 */
export function normalizeComparableNumber(
  value: string | null | undefined,
): string | null {
  return normalizeWhatsAppPhoneE164(value ?? null);
}

/**
 * The country an E.164 number belongs to.
 *
 * E.164 already carries its calling code, so this reads the country rather
 * than guessing it. A number that cannot be parsed has no country.
 */
export function countryOfE164Number(
  value: string | null | undefined,
): string | null {
  const normalized = normalizeComparableNumber(value);

  if (!normalized) {
    return null;
  }

  try {
    const parsed = parsePhoneNumberFromString(normalized);
    return parsed?.country ?? null;
  } catch {
    return null;
  }
}

/**
 * The comparable identity of a stored lead number.
 *
 * A stored number is only resolved when it yields a comparable E.164 value. A
 * legacy national number that was written without a country ("08012345678")
 * does not resolve, because its country is unknown. Such a number must never
 * be silently treated as compatible with any customer.
 */
export type LeadNumberIdentity = Readonly<{
  /** The comparable E.164 number, or null when it cannot be resolved. */
  e164: string | null;
  /** Bare national digits when the stored number has no explicit international prefix. */
  normalizedNational: string | null;
  /** True when the subscriber identity is fully established. */
  resolved: boolean;
}>;

/**
 * Resolves the comparable identity of a stored lead number.
 *
 * The resolution is deliberately strict: only values with an explicit
 * international prefix ("+" or "00") can resolve to an E.164 identity. Bare
 * digits without an international prefix keep only `normalizedNational` and
 * return `resolved: false` so they are never misclassified as another country's
 * E.164 calling code.
 */
export function describeLeadNumber(
  storedNumber: string | null | undefined,
): LeadNumberIdentity {
  if (!storedNumber) {
    return { e164: null, normalizedNational: null, resolved: false };
  }

  const trimmed = storedNumber.trim();

  if (!trimmed || !PHONE_SHAPE_PATTERN.test(trimmed)) {
    return { e164: null, normalizedNational: null, resolved: false };
  }

  const hasPlusPrefix = trimmed.startsWith("+");
  const hasDoubleZeroPrefix = trimmed.startsWith("00");

  if (!hasPlusPrefix && !hasDoubleZeroPrefix) {
    const digits = digitsOnly(trimmed);
    return {
      e164: null,
      normalizedNational: DIGITS_PATTERN.test(digits) ? digits : null,
      resolved: false,
    };
  }

  const digits = digitsOnly(trimmed);
  const internationalDigits = hasPlusPrefix ? digits : digits.slice(2);
  const e164 = `+${internationalDigits}`;

  if (!E164_PATTERN.test(e164)) {
    return { e164: null, normalizedNational: null, resolved: false };
  }

  // The identity is only established when the number belongs to a real
  // numbering plan.
  let parsed: ReturnType<typeof parsePhoneNumberFromString>;

  try {
    parsed = parsePhoneNumberFromString(e164);
  } catch {
    parsed = undefined;
  }

  if (!parsed || !parsed.isValid() || !parsed.country) {
    return { e164: null, normalizedNational: null, resolved: false };
  }

  return { e164: parsed.number, normalizedNational: null, resolved: true };
}

/**
 * The national digit forms that denote exactly this E.164 number in its own
 * country.
 *
 * A legacy row may store a lead number in national form ("090574839393")
 * instead of the E.164 form. Recognising that row requires knowing the
 * country's numbering plan, so each candidate form is only accepted when
 * libphonenumber maps it to exactly this number in exactly this country.
 *
 * Nothing is stripped generically: a form is included because the numbering
 * plan proves it denotes this subscriber, never because a digit was removed.
 * A form from a different country therefore never matches.
 */
export function nationalFormsOfE164(e164: string): string[] {
  const country = countryOfE164Number(e164);

  if (!country) {
    return [];
  }

  const digits = e164.replace(/^\+/, "");

  let callingCode: string;

  try {
    callingCode = String(getCountryCallingCode(country as CountryCode));
  } catch {
    return [];
  }

  if (!digits.startsWith(callingCode)) {
    return [];
  }

  const significant = digits.slice(callingCode.length);

  if (!significant) {
    return [];
  }

  const forms = new Set<string>();
  const candidates = [significant];

  // A national trunk prefix is a single digit in every supported numbering
  // plan. Each candidate is still verified against the plan below, so an
  // unsuitable prefix is simply not accepted.
  for (let prefix = 0; prefix <= 9; prefix += 1) {
    candidates.push(`${prefix}${significant}`);
  }

  for (const candidate of candidates) {
    let parsed: ReturnType<typeof parsePhoneNumberFromString>;

    try {
      parsed = parsePhoneNumberFromString(
        candidate,
        country as CountryCode,
      );
    } catch {
      continue;
    }

    if (parsed && parsed.isValid() && parsed.number === e164) {
      forms.add(candidate);
    }
  }

  return [...forms];
}
