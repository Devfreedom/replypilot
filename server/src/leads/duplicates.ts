/**
 * Classifying lead WhatsApp numbers for duplicate detection.
 *
 * Two leads can only be duplicates when they describe the same subscriber.
 * Two facts are needed for that, and only one of them is always available:
 *
 * - The digits. Two rows with the same digits always describe the same
 *   subscriber, whichever form each row stores. This is a confirmed duplicate.
 * - The country. A number stored in a national form ("090574839393") does not
 *   carry its country, and the country cannot be recovered from the workspace:
 *   a customer's E.164 number never has a national form, so no customer row
 *   can corroborate such a lead. A legacy row's country is therefore unknown.
 *
 * When the country is unknown, the digits may denote a subscriber in more than
 * one country. The national forms of the candidate's own country are used to
 * decide whether the legacy row could be the same subscriber at all, and the
 * numbering plan of that country is the only thing consulted. A row whose
 * digits are not a valid national form of the candidate's country describes a
 * different subscriber and is not a conflict. A row whose digits are such a
 * form cannot be told apart from the candidate, so the API reports an
 * unresolved possible duplicate instead of claiming that a duplicate exists.
 */

import type { PoolClient } from "pg";
import { describeLeadNumber, nationalFormsOfE164 } from "./phone.js";

/** A lead in the workspace whose number may conflict with a candidate. */
export type LeadNumberConflict = Readonly<{
  /**
   * "confirmed" when both leads provably describe the same subscriber.
   * "unresolved" when the other lead stores a national number whose country
   * is not recorded, so the subscriber cannot be told apart.
   */
  kind: "confirmed" | "unresolved";
  /** The conflicting lead. */
  leadId: string;
  /** The number the conflicting lead stores. */
  storedNumber: string;
}>;

/**
 * Finds the leads in the workspace whose number may conflict with a candidate.
 *
 * The candidate is an E.164 number. Rows are matched on the exact digits and
 * on the national forms of the candidate's own country; nothing else is
 * compared, and no country is inferred for the other rows.
 */
export async function findLeadNumberConflicts(
  client: PoolClient,
  workspaceId: string,
  candidateE164: string,
): Promise<LeadNumberConflict[]> {
  const digits = candidateE164.replace(/^\+/, "");
  const nationalForms = nationalFormsOfE164(candidateE164);

  const result = await client.query<{
    id: string;
    stored_number: string;
  }>(
    `
      SELECT id, whatsapp_number AS stored_number
      FROM leads
      WHERE workspace_id = $1
        AND whatsapp_number IS NOT NULL
        AND (
          ltrim(whatsapp_number, '+') = $2
          OR (
            whatsapp_number ~ '^[0-9]+$'
            AND whatsapp_number = ANY($3::text[])
          )
        )
    `,
    [workspaceId, digits, nationalForms],
  );

  const conflicts: LeadNumberConflict[] = [];
  const candidateIdentity = describeLeadNumber(candidateE164);

  for (const row of result.rows) {
    const stored = row.stored_number;
    const storedIdentity = describeLeadNumber(stored);

    if (
      candidateIdentity.resolved &&
      storedIdentity.resolved &&
      candidateIdentity.e164 !== null &&
      storedIdentity.e164 === candidateIdentity.e164
    ) {
      conflicts.push({
        kind: "confirmed",
        leadId: row.id,
        storedNumber: stored,
      });
      continue;
    }

    // Either the row stores a bare number without an explicit international
    // prefix or its E.164 identity is unverified, so its subscriber country
    // cannot be confirmed from these digits alone.
    conflicts.push({
      kind: "unresolved",
      leadId: row.id,
      storedNumber: stored,
    });
  }

  return conflicts;
}
