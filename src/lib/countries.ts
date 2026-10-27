import { getCountryCallingCode, type CountryCode } from "libphonenumber-js";
import type { SearchOption } from "./search-option.js";

/**
 * The curated country choices used by the profile phone control. Keep this
 * list in sync with `server/src/business/phone-countries.ts`; an API test
 * compares both lists.
 */
export const CURATED_PHONE_COUNTRY_CODES = [
  "NG",
  "GH",
  "KE",
  "ZA",
  "EG",
  "MA",
  "TZ",
  "UG",
  "RW",
  "ET",
  "CI",
  "SN",
  "CM",
  "GB",
  "IE",
  "FR",
  "DE",
  "ES",
  "IT",
  "NL",
  "BE",
  "PT",
  "CH",
  "SE",
  "NO",
  "DK",
  "FI",
  "PL",
  "US",
  "CA",
  "BR",
  "MX",
  "AR",
  "CL",
  "CO",
  "IN",
  "SG",
  "MY",
  "PH",
  "JP",
  "CN",
  "PK",
  "BD",
  "AE",
  "SA",
  "IL",
  "QA",
  "TR",
  "AU",
  "NZ",
] as const satisfies readonly CountryCode[];

export type CuratedPhoneCountryCode =
  (typeof CURATED_PHONE_COUNTRY_CODES)[number];

const CURATED_PHONE_COUNTRY_SET = new Set<string>(
  CURATED_PHONE_COUNTRY_CODES,
);

let regionDisplayNames: Intl.DisplayNames | null = null;

try {
  regionDisplayNames = new Intl.DisplayNames(["en"], { type: "region" });
} catch {
  regionDisplayNames = null;
}

export function isCuratedPhoneCountryCode(
  value: string,
): value is CuratedPhoneCountryCode {
  return CURATED_PHONE_COUNTRY_SET.has(value);
}

export function countryName(code: string): string {
  const name = regionDisplayNames?.of(code);
  return name && name !== "Unknown Region" ? name : code;
}

/**
 * Build a flag emoji from a two-letter ISO country code. The flag becomes a
 * pair of regional-indicator symbols; unsupported platforms simply render the
 * letters, so the country name remains visible in the label.
 */
export function countryFlag(code: string): string {
  const normalized = code.trim().toUpperCase();

  if (!/^[A-Z]{2}$/.test(normalized)) {
    return "";
  }

  return String.fromCodePoint(
    ...[...normalized].map(
      (character) => 127397 + character.charCodeAt(0),
    ),
  );
}

export function getCountryCallingCodeFor(
  code: string,
): string | null {
  if (!isCuratedPhoneCountryCode(code)) {
    return null;
  }

  try {
    return getCountryCallingCode(code);
  } catch {
    return null;
  }
}

export type PhoneCountry = Readonly<{
  code: CuratedPhoneCountryCode;
  name: string;
  flag: string;
  callingCode: string;
}>;

export const PHONE_COUNTRIES: readonly PhoneCountry[] =
  CURATED_PHONE_COUNTRY_CODES.map((code) => ({
    code,
    name: countryName(code),
    flag: countryFlag(code),
    callingCode: getCountryCallingCode(code),
  }));

const PHONE_COUNTRY_BY_CODE = new Map(
  PHONE_COUNTRIES.map((country) => [country.code, country]),
);

export function getPhoneCountry(code: string): PhoneCountry | null {
  return PHONE_COUNTRY_BY_CODE.get(code as CuratedPhoneCountryCode) ?? null;
}

export const PHONE_COUNTRY_OPTIONS: readonly SearchOption[] =
  PHONE_COUNTRIES.map((country) => ({
    value: country.code,
    label: `${country.flag} ${country.name} (+${country.callingCode})`,
    description: `${country.code} · +${country.callingCode}`,
    searchText: `${country.name} ${country.code} +${country.callingCode} ${country.callingCode}`,
  }));
