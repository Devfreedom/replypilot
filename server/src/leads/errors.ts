/**
 * Stable, shared errors for lead conversation linkage.
 *
 * The linkage endpoints and the outbound send paths all report the same
 * situations, so the codes and the messages live here exactly once. A client
 * distinguishes "this lead has no conversation yet", "this conversation belongs
 * to a different phone number", "the subscriber identity of this lead is not
 * established" and "the WhatsApp connection is disconnected" by the code
 * alone.
 */

/**
 * Stable machine-readable code for a confirmed duplicate lead number.
 *
 * A duplicate is confirmed when an existing lead in the same workspace holds
 * exactly the same subscriber number.
 */
export const WHATSAPP_LEAD_DUPLICATE_NUMBER_CODE =
  "WHATSAPP_LEAD_DUPLICATE_NUMBER";

/** User-facing message paired with {@link WHATSAPP_LEAD_DUPLICATE_NUMBER_CODE}. */
export const WHATSAPP_LEAD_DUPLICATE_NUMBER_MESSAGE =
  "A lead with this WhatsApp number already exists.";

/**
 * Stable machine-readable code for a possible duplicate that could not be
 * resolved.
 *
 * An existing lead stores this number in a national format without its
 * country, so the two leads may or may not describe the same subscriber. The
 * API refuses the new lead rather than guess, and says so.
 */
export const WHATSAPP_LEAD_NUMBER_UNRESOLVED_CODE =
  "WHATSAPP_LEAD_NUMBER_UNRESOLVED";

/** User-facing message paired with {@link WHATSAPP_LEAD_NUMBER_UNRESOLVED_CODE}. */
export const WHATSAPP_LEAD_NUMBER_UNRESOLVED_MESSAGE =
  "Another lead in this workspace may already hold this WhatsApp number, stored in a national format whose country is not recorded, so ReplyPilot cannot confirm that it is a different customer. Review that lead before creating this one.";

/** Stable machine-readable code for a lead without a linked conversation. */
export const WHATSAPP_CONVERSATION_REQUIRED_CODE =
  "WHATSAPP_CONVERSATION_REQUIRED";
/**
 * User-facing message paired with {@link WHATSAPP_CONVERSATION_REQUIRED_CODE}.
 *
 * The message names the two ways forward, because a lead can reach a
 * conversation either by the customer messaging the business number or by the
 * owner linking an existing conversation.
 */
export const WHATSAPP_CONVERSATION_REQUIRED_MESSAGE =
  "This lead has no WhatsApp conversation yet. A conversation is created when the customer messages the business number, or you can link an existing conversation to this lead.";

/** Stable machine-readable code for a phone-number mismatch. */
export const WHATSAPP_CONVERSATION_PHONE_MISMATCH_CODE =
  "WHATSAPP_CONVERSATION_PHONE_MISMATCH";

/** User-facing message paired with {@link WHATSAPP_CONVERSATION_PHONE_MISMATCH_CODE}. */
export const WHATSAPP_CONVERSATION_PHONE_MISMATCH_MESSAGE =
  "This conversation is with a different phone number than the lead. Check the lead's WhatsApp number before linking.";

/**
 * Stable machine-readable code for a lead whose subscriber identity is not
 * established.
 *
 * A lead whose stored number is a national number without a country cannot be
 * compared with a customer. Linking such a lead would be a guess, so it is
 * refused with this code instead.
 */
export const WHATSAPP_CONVERSATION_LEAD_NUMBER_UNKNOWN_CODE =
  "WHATSAPP_CONVERSATION_LEAD_NUMBER_UNKNOWN";

/** User-facing message paired with {@link WHATSAPP_CONVERSATION_LEAD_NUMBER_UNKNOWN_CODE}. */
export const WHATSAPP_CONVERSATION_LEAD_NUMBER_UNKNOWN_MESSAGE =
  "This lead's WhatsApp number is not in international format, so its subscriber cannot be identified. Re-enter the lead's number with its country before linking a conversation.";

/**
 * Stable machine-readable code for a lead that already has an active
 * conversation.
 */
export const WHATSAPP_CONVERSATION_LEAD_ALREADY_LINKED_CODE =
  "WHATSAPP_CONVERSATION_LEAD_ALREADY_LINKED";

/** User-facing message paired with {@link WHATSAPP_CONVERSATION_LEAD_ALREADY_LINKED_CODE}. */
export const WHATSAPP_CONVERSATION_LEAD_ALREADY_LINKED_MESSAGE =
  "This lead already has an active WhatsApp conversation. Link the conversation to a different lead, or remove the existing link first.";

/** Stable machine-readable code for a conversation already linked to a lead. */
export const WHATSAPP_CONVERSATION_ALREADY_LINKED_CODE =
  "WHATSAPP_CONVERSATION_ALREADY_LINKED";

/** User-facing message paired with {@link WHATSAPP_CONVERSATION_ALREADY_LINKED_CODE}. */
export const WHATSAPP_CONVERSATION_ALREADY_LINKED_MESSAGE =
  "This conversation is already linked to another lead. Unlink it first, or choose a different conversation.";

/** Stable machine-readable code for a conversation that cannot be linked. */
export const WHATSAPP_CONVERSATION_NOT_LINKABLE_CODE =
  "WHATSAPP_CONVERSATION_NOT_LINKABLE";

/** User-facing message paired with {@link WHATSAPP_CONVERSATION_NOT_LINKABLE_CODE}. */
export const WHATSAPP_CONVERSATION_NOT_LINKABLE_MESSAGE =
  "Only an active WhatsApp conversation can be linked to a lead.";
