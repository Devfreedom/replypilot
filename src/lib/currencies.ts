import countryToCurrency from "country-to-currency";
import { countryName } from "./countries";
import type { SearchOption } from "./search-option";

const SUPPORTED_CURRENCY_CODES = new Set(
  Intl.supportedValuesOf("currency"),
);

let currencyDisplayNames: Intl.DisplayNames | null = null;

try {
  currencyDisplayNames = new Intl.DisplayNames(["en"], {
    type: "currency",
    style: "long",
  });
} catch {
  currencyDisplayNames = null;
}

const countryCodesByCurrency = new Map<string, string[]>();
const countryEntries = Object.entries(countryToCurrency) as Array<
  [string, string]
>;

for (const [countryCode, currencyCode] of countryEntries) {
  if (!SUPPORTED_CURRENCY_CODES.has(currencyCode)) {
    continue;
  }

  const current = countryCodesByCurrency.get(currencyCode) ?? [];
  current.push(countryCode);
  countryCodesByCurrency.set(currencyCode, current);
}

export function isSupportedCurrencyCode(value: string): boolean {
  return SUPPORTED_CURRENCY_CODES.has(value);
}

export function currencyName(code: string): string {
  return currencyDisplayNames?.of(code) ?? code;
}

export function currencyLabel(code: string): string {
  return `${currencyName(code)} (${code})`;
}

export function currencyCountryNames(code: string): string[] {
  const countryCodes = countryCodesByCurrency.get(code) ?? [];

  return countryCodes
    .map((countryCode) => countryName(countryCode))
    .filter((name) => name !== "Unknown Region")
    .sort((left, right) => left.localeCompare(right));
}

function currencyDescription(code: string): string | undefined {
  const names = currencyCountryNames(code);

  if (names.length === 0) {
    return undefined;
  }

  const visible = names.slice(0, 3).join(", ");
  return names.length > 3
    ? `${visible}, +${names.length - 3} more`
    : visible;
}

/**
 * Build one option per supported ISO 4217 code. Country names are included in
 * the search text so a user can find a currency by country without creating
 * duplicate options for shared currencies such as EUR.
 */
export const CURRENCY_OPTIONS: readonly SearchOption[] = Array.from(
  SUPPORTED_CURRENCY_CODES,
)
  .sort((left, right) => currencyName(left).localeCompare(currencyName(right)))
  .map((code) => {
    const countries = currencyCountryNames(code);

    return {
      value: code,
      label: currencyLabel(code),
      description: currencyDescription(code),
      searchText: `${code} ${currencyName(code)} ${countries.join(" ")}`,
    };
  });

/**
 * Existing catalogue entries keep their own currency. Only the initial value
 * for a new entry follows the profile setting; when no business currency is
 * configured, the catalogue API's existing NGN default remains the fallback.
 */
export function defaultCatalogueCurrency(
  profileCurrencyCode: string | null | undefined,
): string {
  return profileCurrencyCode &&
    isSupportedCurrencyCode(profileCurrencyCode)
    ? profileCurrencyCode
    : "NGN";
}
