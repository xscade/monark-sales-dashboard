import { getDb } from "@monark/db";
import { sql, type SQL } from "drizzle-orm";
import type { FollowUpScope, FollowUpSort } from "./follow-ups";

const db = () => getDb();

export interface FollowUpRow {
  leadId: string;
  reference: string;
  stage: string;
  score: number;
  fullName: string | null;
  primaryPhone: string | null;
  projectName: string | null;
  ownerName: string | null;
  lastActivityAt: string | null;
  createdAt: string;
  /** Null in the `missing` scope — that is the whole point of that view. */
  taskId: string | null;
  subject: string | null;
  body: string | null;
  dueAt: string | null;
  channel: string | null;
  assigneeName: string | null;
  isOverdue: boolean;
  openFollowUps: number;
  totalCount: number;
}

export interface FollowUpFilters {
  ownerId?: string;
  scope: FollowUpScope;
  sorts: FollowUpSort[];
  search?: string;
  limit?: number;
  offset?: number;
}

export interface FollowUpCounts {
  due: number;
  overdue: number;
  missing: number;
}

/**
 * ORDER BY built from the checked sort keys, in canonical precedence.
 *
 * `createdAt DESC` is always appended: without a total order, two rows that tie
 * on every checked key can swap between pages and a lead silently disappears
 * from the list. Unchecking everything therefore does not mean "no ORDER BY",
 * it means "capture order" — which is what a person means by unsorted anyway.
 */
function orderBy(sorts: FollowUpSort[]): SQL {
  const clauses: SQL[] = [];
  for (const sort of sorts) {
    if (sort === "overdue") {
      clauses.push(sql`(t.due_at IS NOT NULL AND t.due_at < now()) DESC`);
    } else if (sort === "due") {
      clauses.push(sql`t.due_at ASC NULLS LAST`);
    } else if (sort === "score") {
      clauses.push(sql`l.score DESC`);
    } else if (sort === "stage") {
      // Enum position, so "furthest along" follows the funnel rather than the
      // alphabet. Casting to text would sort `booked` before `contacted`.
      clauses.push(sql`l.stage DESC`);
    } else if (sort === "stale") {
      clauses.push(sql`COALESCE(l.last_activity_at, l.created_at) ASC`);
    } else if (sort === "owner") {
      clauses.push(sql`u.name ASC NULLS LAST`);
    }
  }
  clauses.push(sql`l.created_at DESC`);
  return sql.join(clauses, sql`, `);
}

const OPEN_STAGES = sql`l.stage NOT IN ('booked', 'lost', 'disqualified')`;

/** The earliest open follow-up task on a lead — the one that is actually next. */
const nextTask = sql`
  LEFT JOIN LATERAL (
    SELECT a.id, a.subject, a.body, a.due_at, a.user_id,
           a.metadata ->> 'channel' AS channel
    FROM activities a
    WHERE a.org_id = l.org_id
      AND a.lead_id = l.id
      AND a.type = 'task'
      AND a.completed_at IS NULL
      AND a.due_at IS NOT NULL
    ORDER BY a.due_at ASC
    LIMIT 1
  ) t ON true
`;

export async function listFollowUps(
  orgId: string,
  filters: FollowUpFilters,
): Promise<FollowUpRow[]> {
  const conditions: SQL[] = [sql`l.org_id = ${orgId}`, sql`l.is_test = false`, OPEN_STAGES];
  if (filters.ownerId) conditions.push(sql`l.owner_user_id = ${filters.ownerId}`);
  if (filters.scope === "due") conditions.push(sql`t.id IS NOT NULL`);
  if (filters.scope === "missing") conditions.push(sql`t.id IS NULL`);
  if (filters.search?.trim()) {
    const term = `%${filters.search.trim().replace(/[%_]/g, "")}%`;
    conditions.push(sql`(
      p.full_name ILIKE ${term} OR p.primary_phone ILIKE ${term} OR l.reference ILIKE ${term}
    )`);
  }

  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  const offset = Math.max(filters.offset ?? 0, 0);

  const result = await db().execute(sql`
    SELECT l.id AS "leadId", l.reference, l.stage::text AS stage, l.score,
           p.full_name AS "fullName", p.primary_phone AS "primaryPhone",
           pr.name AS "projectName", u.name AS "ownerName",
           l.last_activity_at AS "lastActivityAt", l.created_at AS "createdAt",
           t.id AS "taskId", t.subject, t.body, t.due_at AS "dueAt", t.channel,
           au.name AS "assigneeName",
           (t.due_at IS NOT NULL AND t.due_at < now()) AS "isOverdue",
           (
             SELECT COUNT(*)::int FROM activities a2
             WHERE a2.org_id = l.org_id AND a2.lead_id = l.id
               AND a2.type = 'task' AND a2.completed_at IS NULL
           ) AS "openFollowUps",
           COUNT(*) OVER()::int AS "totalCount"
    FROM leads l
    JOIN persons p ON p.id = l.person_id
    LEFT JOIN projects pr ON pr.id = l.project_id
    LEFT JOIN users u ON u.id = l.owner_user_id
    ${nextTask}
    LEFT JOIN users au ON au.id = t.user_id
    WHERE ${sql.join(conditions, sql` AND `)}
    ORDER BY ${orderBy(filters.sorts)}
    LIMIT ${limit} OFFSET ${offset}
  `);
  return result.rows as unknown as FollowUpRow[];
}

export async function getFollowUpCounts(
  orgId: string,
  ownerId?: string,
): Promise<FollowUpCounts> {
  const owner = ownerId ? sql`AND l.owner_user_id = ${ownerId}` : sql``;
  const result = await db().execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE t.id IS NOT NULL)::int AS due,
      COUNT(*) FILTER (WHERE t.due_at < now())::int AS overdue,
      COUNT(*) FILTER (WHERE t.id IS NULL)::int AS missing
    FROM leads l
    ${nextTask}
    WHERE l.org_id = ${orgId} AND l.is_test = false AND ${OPEN_STAGES} ${owner}
  `);
  return (result.rows[0] as unknown as FollowUpCounts) ?? { due: 0, overdue: 0, missing: 0 };
}
