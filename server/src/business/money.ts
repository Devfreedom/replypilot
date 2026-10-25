function currencyFractionDigits(currencyCode: string): number {
  try {
    const options = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currencyCode,
    }).resolvedOptions();

    return options.maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/**
 * Formats safe integer minor units without floating-point money arithmetic.
 * Grouping and the fractional part are calculated with BigInt.
 */
export function formatMinorUnits(
  amount: number,
  currencyCode: string,
): string {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new Error("Price must be a non-negative safe integer.");
  }

  const digits = currencyFractionDigits(currencyCode);
  const factor = 10n ** BigInt(digits);
  const value = BigInt(amount);
  const whole = Number(value / factor);
  const fraction = Number(value % factor);
  const groupedWhole = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(whole);

  if (digits === 0) {
    return `${currencyCode} ${groupedWhole}`;
  }

  return `${currencyCode} ${groupedWhole}.${String(fraction).padStart(
    digits,
    "0",
  )}`;
}
