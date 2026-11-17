import { MAX_SAFE_PRICE_MINOR } from "./business";

export function currencyFractionDigits(currencyCode: string): number {
  const normalized = currencyCode.trim().toUpperCase();

  if (!/^[A-Z]{3}$/.test(normalized)) {
    return 2;
  }

  try {
    const options = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: normalized,
    }).resolvedOptions();

    return options.maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

function pow10BigInt(digits: number): bigint {
  return BigInt(`1${"0".repeat(Math.max(0, digits))}`);
}

/**
 * Formats integer minor units (e.g. kobo, cents) into a readable display
 * string (e.g. `NGN 15,000.00`) without floating-point rounding drift.
 */
export function formatMajorPrice(
  minorAmount: number,
  currencyCode: string,
): string {
  if (!Number.isSafeInteger(minorAmount) || minorAmount < 0) {
    throw new Error("Price must be a non-negative safe integer.");
  }

  const normalizedCode = currencyCode.trim().toUpperCase();
  const digits = currencyFractionDigits(normalizedCode);
  const factor = pow10BigInt(digits);
  const value = BigInt(minorAmount);
  const whole = value / factor;
  const fraction = value % factor;
  const groupedWhole = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(whole);

  if (digits === 0) {
    return `${normalizedCode} ${groupedWhole}`;
  }

  return `${normalizedCode} ${groupedWhole}.${fraction
    .toString()
    .padStart(digits, "0")}`;
}

/**
 * Formats stored integer minor units for editing in a plain major-unit field
 * without thousand-grouping commas.
 */
export function formatMinorToMajorInput(
  minorAmount: number | null,
  currencyCode: string,
): string {
  if (
    minorAmount === null ||
    !Number.isSafeInteger(minorAmount) ||
    minorAmount < 0
  ) {
    return "";
  }

  const digits = currencyFractionDigits(currencyCode);
  const factor = pow10BigInt(digits);
  const value = BigInt(minorAmount);
  const whole = value / factor;
  const fraction = value % factor;

  if (digits === 0) {
    return whole.toString();
  }

  return `${whole.toString()}.${fraction.toString().padStart(digits, "0")}`;
}

export type ParsedPriceResult =
  | { ok: true; minor: number | null }
  | { ok: false; message: string };

/**
 * Parses a human major-unit currency string (such as `15000`, `15,000.50`)
 * directly into non-negative integer minor units using BigInt arithmetic.
 */
export function parseMajorPriceToMinor(
  rawInput: string,
  currencyCode: string,
  maxSafeMinor: number = MAX_SAFE_PRICE_MINOR,
): ParsedPriceResult {
  const trimmed = rawInput.trim();

  if (!trimmed) {
    return { ok: true, minor: null };
  }

  const normalizedCode = /^[A-Z]{3}$/.test(currencyCode.trim().toUpperCase())
    ? currencyCode.trim().toUpperCase()
    : "this currency";

  if (trimmed.startsWith("-")) {
    return {
      ok: false,
      message:
        "Price cannot be negative. Enter 0 or higher, or leave blank when pricing is not fixed.",
    };
  }

  const validSyntax =
    /^\d+(?:\.\d+)?$/.test(trimmed) ||
    /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(trimmed);

  if (!validSyntax) {
    return {
      ok: false,
      message:
        "Enter a valid amount (for example 15000 or 15000.50), or leave blank.",
    };
  }

  const plain = trimmed.replaceAll(",", "");
  const [wholePart, fracPart = ""] = plain.split(".");
  const digits = currencyFractionDigits(normalizedCode);

  if (digits === 0 && fracPart.length > 0) {
    return {
      ok: false,
      message: `${normalizedCode} uses whole amounts only without decimal places.`,
    };
  }

  if (fracPart.length > digits) {
    return {
      ok: false,
      message: `${normalizedCode} allows at most ${digits} decimal ${digits === 1 ? "place" : "places"} (for example 1500.${"0".repeat(digits)}).`,
    };
  }

  const paddedFraction = digits === 0 ? "0" : fracPart.padEnd(digits, "0");
  const totalMinor =
    BigInt(wholePart) * pow10BigInt(digits) + BigInt(paddedFraction);

  if (totalMinor > BigInt(maxSafeMinor)) {
    return {
      ok: false,
      message: "Price exceeds the maximum supported amount.",
    };
  }

  return { ok: true, minor: Number(totalMinor) };
}
