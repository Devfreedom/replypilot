/**
 * Persist and apply Meta delivery-status events. Event identity and ordering
 * are enforced in PostgreSQL so webhook retries and concurrent workers remain
 * idempotent across process restarts.
 */

import type { Pool } from "pg";
import { processOutboundDeliveryEvent } from "../outbound/repository.js";
import type { DeliveryStatusEvent } from "./types.js";

export type DeliveryProcessResult = Readonly<{
  processed: number;
  ignored: number;
  duplicates: number;
}>;

const MAX_FAILURE_REASON_LENGTH = 500;

function boundedFailureReason(description: string | null): string | null {
  if (!description) return null;
  return [...description].slice(0, MAX_FAILURE_REASON_LENGTH).join("");
}

export async function processDeliveryStatusEvents(
  pool: Pool,
  workspaceId: string,
  events: readonly DeliveryStatusEvent[],
): Promise<DeliveryProcessResult> {
  let processed = 0;
  let ignored = 0;
  let duplicates = 0;

  for (const event of events) {
    const outcome = await processOutboundDeliveryEvent(
      pool,
      workspaceId,
      event,
      event.status === "failed"
        ? boundedFailureReason(event.errorDescription)
        : null,
    );

    if (outcome === "processed") {
      processed += 1;
    } else if (outcome === "duplicate") {
      duplicates += 1;
    } else {
      ignored += 1;
    }
  }

  return { processed, ignored, duplicates };
}
