const WHATSAPP_PHONE_E164_PATTERN = /^\+[1-9][0-9]{4,14}$/;

/**
 * WhatsApp `from` values are international digits without a leading plus.
 * E.164 adds the plus, so the same number always maps to one workspace-scoped
 * customer. Values that cannot be a plausible E.164 number return null; the
 * caller then keeps the original provider identifier instead of inventing a
 * phone number.
 */
export function normalizeWhatsAppPhoneE164(
  value: string | null | undefined,
): string | null {
  if (!value) {
    return null;
  }

  const digits = value.trim().replace(/\D/g, "");
  const candidate = `+${digits}`;

  return WHATSAPP_PHONE_E164_PATTERN.test(candidate) ? candidate : null;
}
