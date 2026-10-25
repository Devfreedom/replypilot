/**
 * The country choices offered by the profile phone control. Keep this list in
 * sync with `src/lib/countries.ts`; an API test compares the two lists so a
 * mismatch cannot silently drift.
 */
export const SUPPORTED_PHONE_COUNTRIES = [
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
] as const;

export type SupportedPhoneCountry =
  (typeof SUPPORTED_PHONE_COUNTRIES)[number];

export const SUPPORTED_PHONE_COUNTRY_SET = new Set<string>(
  SUPPORTED_PHONE_COUNTRIES,
);
