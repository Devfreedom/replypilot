/**
 * Delivery-status webhook event processor.
 *
 * Processes Meta's delivery-status events (sent, delivered, read, failed)
 * and updates the corresponding outbound_messages rows. Each event type is
 * handled with anti-regression rules:
 *
 *  - delivered and read cannot regress to sent
 *  - read cannot regress to delivered
 *  - Out-of-order events are handled safely (older events cannot overwrite
 *    newer valid states)
 *  - Events are workspace-scoped to prevent cross-workspace data leakage
 *
 * Deduplication is handled naturally by the UPDATE WHERE clauses: a duplicate
 * event for the same wamid in the same direction will update zero rows without
 * error.
 */

import type { Pool } from "pg";
import {
  markOutboundDeliveryEventDelivered,
  markOutboundDeliveryEventFailed,
  markOutboundDeliveryEventRead,
  markOutboundDeliveryEventSent,
} from "../outbound/repository.js";
import type { DeliveryStatusEvent } from "./types.js";

export type DeliveryProcessResult = Readonly<{
  processed: number;
  ignored: number;
}>;

const MAX_FAILURE_REASON_LENGTH = 500;

function boundedFailureReason(description: string | null): string {
  if (!description) {
    return "Meta reported delivery failure (no error details available).";
  }

  // Truncate to code-point boundary.
  let codePointLength = 0;
  let characterLength = 0;

  for (const character of description) {
    if (codePointLength === MAX_FAILURE_REASON_LENGTH) break;
    codePointLength += 1;
    characterLength += character.length;
  }

  return `Delivery failed: ${description.slice(0, characterLength)}`;
}

/**
 * Processes a batch of delivery-status events within a single workspace.
 *
 * Each event is processed independently. A single event failure does not
 * abort the batch; the error is counted as ignored.
 *
 * Workspace isolation is enforced by all underlying repository functions.
 */
export async function processDeliveryStatusEvents(
  pool: Pool,
  workspaceId: string,
  events: readonly DeliveryStatusEvent[],
): Promise<DeliveryProcessResult> {
  let processed = 0;
  let ignored = 0;

  for (const event of events) {
    try {
      let updated = false;

      switch (event.status) {
        case "sent":
          updated = await markOutboundDeliveryEventSent(
            pool,
            workspaceId,
            event.providerMessageId,
            event.providerTimestamp,
          );
          break;

        case "delivered":
          updated = await markOutboundDeliveryEventDelivered(
            pool,
            workspaceId,
            event.providerMessageId,
            event.providerTimestamp,
          );
          break;

        case "read":
          updated = await markOutboundDeliveryEventRead(
            pool,
            workspaceId,
            event.providerMessageId,
            event.providerTimestamp,
          );
          break;

        case "failed":
          updated = await markOutboundDeliveryEventFailed(
            pool,
            workspaceId,
            event.providerMessageId,
            event.providerTimestamp,
            boundedFailureReason(event.errorDescription),
          );
          break;

        default:
          // Unknown status (e.g. "warning", future Meta statuses). Ignore
          // gracefully rather than erroring — Meta may add new statuses.
          ignored += 1;
          continue;
      }

      if (updated) {
        processed += 1;
      } else {
        // No row was updated: either the wamid doesn't exist in this workspace,
        // or the current status doesn't allow transition (anti-regression rule).
        ignored += 1;
      }
    } catch {
      // Log and continue. A single event failure must not abort the batch.
      ignored += 1;
    }
  }

  return { processed, ignored };
}
