import type { Tx } from "@monark/services";
import { sql } from "drizzle-orm";

interface LeadMutationActor {
  id: string;
  role: string;
}

/**
 * Serialize every workflow that may change a lead's stage.
 *
 * Reading a stage and updating it later without holding this lock allows a
 * stale action to overwrite a booking that committed in between. Commercial
 * workflows already take their first lock on the lead row, so using the same
 * first lock here also keeps the cross-workflow lock order consistent.
 *
 * Passing the actor also enforces the CRM's individual-contributor scope:
 * sales agents may mutate only leads assigned to them. Other roles continue to
 * use the organisation-wide permission granted by the calling server action.
 */
export async function lockLeadForUpdate(
  tx: Tx,
  orgId: string,
  leadId: string,
  actor?: LeadMutationActor,
): Promise<boolean> {
  const result = actor?.role === "sales_agent"
    ? await tx.execute(sql`
        SELECT id
        FROM leads
        WHERE org_id = ${orgId} AND id = ${leadId}
          AND owner_user_id = ${actor.id}
        FOR UPDATE
      `)
    : await tx.execute(sql`
        SELECT id
        FROM leads
        WHERE org_id = ${orgId} AND id = ${leadId}
        FOR UPDATE
      `);
  return Boolean(result.rows[0]);
}
