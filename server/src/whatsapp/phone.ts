const WHATSAPP_PHONE_E164_PATTERN = /^\+[1-9][0-9]{4,14}$/;
// Phone-shaped input: an optional leading plus followed by digits and the
// common visual separators. Letters, dots, underscores, and other provider
// identifier characters are rejected before any digit stripping happens.
const WHATSAPP_PHONE_SHAPE_PATTERN = /^\+?[0-9\s()-]+$/;

/**
 * WhatsApp `from` values are international digits without a leading plus.
 * E.164 adds the plus, so the same number always maps to one workspace-scoped
 * customer. Values that cannot be a plausible E.164 number return null; the
 * caller then keeps the original provider identifier instead of inventing a
 * phone number.
 *
 * Only phone-shaped input is normalized. Provider identifiers such as
 * business-scoped user IDs (for example `US.13491208655302741918`) contain
 * characters that are not valid in a phone number and are rejected before
 * digit stripping, so they can never become fabricated E.164 numbers.
 */
export function normalizeWhatsAppPhoneE164(
  value: string | null | undefined,
): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();

  if (!WHATSAPP_PHONE_SHAPE_PATTERN.test(trimmed)) {
    return null;
  }

  const digits = trimmed.replace(/\D/g, "");
  const candidate = `+${digits}`;

  return WHATSAPP_PHONE_E164_PATTERN.test(candidate) ? candidate : null;
}
