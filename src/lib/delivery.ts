import { z } from "zod";
import { OUTBOUND_MESSAGE_STATUSES } from "./messaging";

const isoDateTime = z.iso.datetime({ offset: true });

export const SUPPRESSION_REASONS = ["opt_out", "blocked", "admin"] as const;
export type SuppressionReason = (typeof SUPPRESSION_REASONS)[number];

export const SUPPRESSION_REASON_LABELS: Record<SuppressionReason, string> = {
  opt_out: "Customer opt-out",
  blocked: "Blocked",
  admin: "Added by owner",
};

export const DELIVERY_EVENT_OUTCOMES = [
  "processing",
  "processed",
  "ignored",
  "failed",
] as const;
export type DeliveryEventOutcome = (typeof DELIVERY_EVENT_OUTCOMES)[number];

const outboundStatusSchema = z.enum(OUTBOUND_MESSAGE_STATUSES);

export const protectedCustomerSchema = z.object({
  id: z.uuid(),
  displayName: z.string().nullable(),
  phoneE164: z.string().nullable(),
  providerContactId: z.string().nullable(),
});
export type ProtectedCustomer = z.infer<typeof protectedCustomerSchema>;

const suppressionSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  customerId: z.uuid(),
  reason: z.enum(SUPPRESSION_REASONS),
  notes: z.string().nullable(),
  suppressedAt: isoDateTime,
  suppressedBy: z.uuid().nullable(),
});

const customerSuppressionItemSchema = z.object({
  suppression: suppressionSchema,
  customer: protectedCustomerSchema,
  conversationCount: z.number().int().nonnegative(),
});
export type CustomerSuppressionItem = z.infer<
  typeof customerSuppressionItemSchema
>;

const suppressionsResponseSchema = z.object({
  suppressions: z.array(customerSuppressionItemSchema),
  total: z.number().int().nonnegative(),
});

const deliveryEventSchema = z.object({
  id: z.uuid(),
  outboundMessageId: z.uuid().nullable(),
  providerMessageId: z.string(),
  phoneNumberId: z.string(),
  providerStatus: z.string(),
  providerTimestamp: isoDateTime,
  receivedAt: isoDateTime,
  lastReceivedAt: isoDateTime,
  duplicateCount: z.number().int().nonnegative(),
  processingOutcome: z.enum(DELIVERY_EVENT_OUTCOMES),
  processingReason: z.string().nullable(),
  failureReason: z.string().nullable(),
  outboundStatus: outboundStatusSchema.nullable(),
  outboundContent: z.string().nullable(),
});
export type DeliveryEvent = z.infer<typeof deliveryEventSchema>;

const deliveryEventsResponseSchema = z.object({
  events: z.array(deliveryEventSchema),
  pagination: z.object({
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
    hasMore: z.boolean(),
    nextOffset: z.number().int().nonnegative().nullable(),
  }),
});

const serviceWindowSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("open"),
    lastInboundAt: isoDateTime,
    expiresAt: isoDateTime,
  }),
  z.object({
    kind: z.literal("expired"),
    lastInboundAt: isoDateTime,
    expiresAt: isoDateTime,
  }),
  z.object({ kind: z.literal("no-inbound-message") }),
  z.object({ kind: z.literal("invalid-timestamp") }),
]);
export type ServiceWindow = z.infer<typeof serviceWindowSchema>;

const conversationProtectionSchema = z.object({
  customer: protectedCustomerSchema,
  serviceWindow: serviceWindowSchema,
  suppression: suppressionSchema.nullable(),
});
export type ConversationProtection = z.infer<
  typeof conversationProtectionSchema
>;

const conversationProtectionResponseSchema = z.object({
  protection: conversationProtectionSchema,
});

const providerProtectionSchema = z.object({
  runtime: z.string(),
  providerForWorkspace: z.enum(["mock", "whatsapp"]),
  defaultApprovalSendPolicy: z.enum(["approve_only", "approve_and_send"]),
  meta: z.object({
    enabled: z.boolean(),
    senderConfigured: z.boolean(),
    senderPhoneNumberId: z.string().nullable(),
    recipientAllowlistCount: z.number().int().nonnegative(),
    testWorkspaceConfigured: z.boolean(),
    workspaceAllowlistedForMeta: z.boolean(),
    productionBlocked: z.boolean(),
    productionProtection: z.string(),
  }),
  inboundWebhook: z.object({
    configured: z.boolean(),
    phoneNumberId: z.string().nullable(),
    workspaceMatches: z.boolean(),
  }),
  suppressions: z.object({
    count: z.number().int().nonnegative(),
  }),
});
export type ProviderProtection = z.infer<typeof providerProtectionSchema>;

const workerHeartbeatSchema = z.object({
  provider: z.string(),
  workerId: z.string(),
  workerStartedAt: isoDateTime,
  lastSeenAt: isoDateTime,
  lastTick: z.record(z.string(), z.unknown()),
  stale: z.boolean(),
});
export type WorkerHeartbeat = z.infer<typeof workerHeartbeatSchema>;

const queueSummarySchema = z.object({
  counts: z.record(outboundStatusSchema, z.number().int().nonnegative()),
  total: z.number().int().nonnegative(),
  oldestQueuedAt: isoDateTime.nullable(),
});
export type QueueSummary = z.infer<typeof queueSummarySchema>;

const workerStatusResponseSchema = z.object({
  queue: queueSummarySchema,
  heartbeatStaleAfterMs: z.number().int().positive(),
  workers: z.array(workerHeartbeatSchema),
});
export type WorkerStatus = z.infer<typeof workerStatusResponseSchema>;

export function parseSuppressionsResponse(
  data: unknown,
): CustomerSuppressionItem[] | null {
  const parsed = suppressionsResponseSchema.safeParse(data);
  return parsed.success ? parsed.data.suppressions : null;
}

export function parseSuppressionResponse(
  data: unknown,
): CustomerSuppressionItem["suppression"] | null {
  const parsed = z
    .object({ suppression: suppressionSchema })
    .safeParse(data);
  return parsed.success ? parsed.data.suppression : null;
}

export function parseDeliveryEventsResponse(
  data: unknown,
): z.infer<typeof deliveryEventsResponseSchema> | null {
  const parsed = deliveryEventsResponseSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

export function parseConversationProtectionResponse(
  data: unknown,
): ConversationProtection | null {
  const parsed = conversationProtectionResponseSchema.safeParse(data);
  return parsed.success ? parsed.data.protection : null;
}

export function parseProviderProtection(
  data: unknown,
): ProviderProtection | null {
  const parsed = providerProtectionSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

export function parseWorkerStatus(data: unknown): WorkerStatus | null {
  const parsed = workerStatusResponseSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

export function protectedCustomerName(
  customer: ProtectedCustomer,
): string {
  return (
    customer.displayName?.trim() ||
    customer.phoneE164?.trim() ||
    customer.providerContactId?.trim() ||
    `Customer ${customer.id.slice(0, 8)}`
  );
}

export function serviceWindowLabel(window: ServiceWindow): string {
  switch (window.kind) {
    case "open":
      return "Open";
    case "expired":
      return "Expired";
    case "no-inbound-message":
      return "No inbound message";
    case "invalid-timestamp":
      return "Invalid timestamp";
  }
}

export function serviceWindowDescription(window: ServiceWindow): string {
  switch (window.kind) {
    case "open":
      return `A customer message was received within the last 24 hours. The window closes ${window.expiresAt}.`;
    case "expired":
      return `The last customer message was more than 24 hours ago. Free-form replies are blocked until the customer writes again.`;
    case "no-inbound-message":
      return "No inbound provider timestamp exists, so the 24-hour service window cannot be established.";
    case "invalid-timestamp":
      return "The inbound provider timestamp is missing or invalid. Sending fails closed.";
  }
}
