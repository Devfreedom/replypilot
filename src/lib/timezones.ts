import type { SearchOption } from "./search-option.js";

const FALLBACK_TIMEZONE_IDS = [
  "UTC",
  "Africa/Accra",
  "Africa/Cairo",
  "Africa/Johannesburg",
  "Africa/Lagos",
  "Africa/Nairobi",
  "America/Argentina/Buenos_Aires",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Mexico_City",
  "America/New_York",
  "America/Sao_Paulo",
  "America/Toronto",
  "Asia/Dhaka",
  "Asia/Dubai",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Manila",
  "Asia/Riyadh",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Europe/Amsterdam",
  "Europe/Berlin",
  "Europe/London",
  "Europe/Madrid",
  "Europe/Paris",
  "Europe/Rome",
  "Pacific/Auckland",
];

/**
 * Some ICU versions return an older canonical spelling. Include the modern
 * identifiers people recognize and keep both values selectable when both are
 * valid.
 */
const ADDITIONAL_TIMEZONE_IDS = ["Asia/Kolkata"];

export function isValidTimezone(value: string): boolean {
  if (!value.trim()) {
    return false;
  }

  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function getSupportedTimezoneIds(): string[] {
  try {
    if (typeof Intl.supportedValuesOf === "function") {
      return Intl.supportedValuesOf("timeZone");
    }
  } catch {
    // Fall back to the common identifiers below when ICU data is unavailable.
  }

  return FALLBACK_TIMEZONE_IDS;
}

const BASE_TIMEZONE_IDS = Array.from(
  new Set([
    ...getSupportedTimezoneIds(),
    ...ADDITIONAL_TIMEZONE_IDS,
    "UTC",
  ]),
).sort((left, right) => left.localeCompare(right));

function timezoneGroup(identifier: string): string {
  return identifier.includes("/") ? identifier.split("/")[0] : "UTC";
}

function toTimezoneOption(identifier: string): SearchOption {
  return {
    value: identifier,
    label: identifier,
    group: timezoneGroup(identifier),
    searchText: identifier.replace(/[_/]/g, " "),
  };
}

export const TIMEZONE_OPTIONS: readonly SearchOption[] =
  BASE_TIMEZONE_IDS.map(toTimezoneOption);

/**
 * Include a saved identifier even when it is a valid alias that the runtime's
 * supported-values list omits. Invalid saved values are deliberately not
 * presented as valid choices.
 */
export function buildTimezoneOptions(
  savedTimezone?: string | null,
): readonly SearchOption[] {
  const saved = savedTimezone?.trim();

  if (
    !saved ||
    BASE_TIMEZONE_IDS.includes(saved) ||
    !isValidTimezone(saved)
  ) {
    return TIMEZONE_OPTIONS;
  }

  return [...TIMEZONE_OPTIONS, toTimezoneOption(saved)].sort((left, right) =>
    left.label.localeCompare(right.label),
  );
}
