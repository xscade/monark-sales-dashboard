import { getDb } from "@monark/db";
import { sql, type SQL } from "drizzle-orm";

const db = () => getDb();

// A sales agent gets a personal work queue. Management, marketing, reception
// and read-only oversight roles are intentionally organisation-wide; reception
// in particular must be able to find a visitor regardless of who owns the lead.
const TEAM_ROLES = new Set([
  "owner",
  "admin",
  "marketing",
  "sales_manager",
  "receptionist",
  "read_only",
]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Sales agents stay scoped to themselves even if an owner id is added to the
 * URL. Roles with organisation-wide read duties may select an agent or team.
 */
export function resolveSalesOwnerFilter(
  role: string,
  currentUserId: string,
  requestedOwnerId?: string,
): string | undefined {
  if (!TEAM_ROLES.has(role)) return currentUserId;
  return requestedOwnerId && UUID_RE.test(requestedOwnerId) ? requestedOwnerId : undefined;
}

export function canViewSalesTeam(role: string): boolean {
  return TEAM_ROLES.has(role);
}

export function canManageSalesTeam(role: string): boolean {
  return role === "owner" || role === "admin" || role === "sales_manager";
}

export type TaskStatus = "open" | "overdue" | "today" | "upcoming" | "completed";

export function normalizeTaskStatus(value?: string): TaskStatus {
  return value === "overdue" ||
    value === "today" ||
    value === "upcoming" ||
    value === "completed"
    ? value
    : "open";
}

export interface SalesOwnerOption {
  id: string;
  name: string;
  role: string;
}

export async function listSalesOwners(orgId: string): Promise<SalesOwnerOption[]> {
  const result = await db().execute(sql`
    SELECT id, name, role::text AS role
    FROM users
    WHERE org_id = ${orgId}
      AND is_active = true
      AND role IN ('owner', 'admin', 'sales_manager', 'sales_agent', 'receptionist')
    ORDER BY
      CASE role
        WHEN 'sales_manager' THEN 1
        WHEN 'sales_agent' THEN 2
        WHEN 'receptionist' THEN 3
        ELSE 4
      END,
      name
  `);
  return result.rows as unknown as SalesOwnerOption[];
}

export interface SalesTaskRow {
  id: string;
  subject: string | null;
  body: string | null;
  dueAt: Date | string | null;
  completedAt: Date | string | null;
  createdAt: Date | string;
  userId: string | null;
  assigneeName: string | null;
  leadId: string | null;
  leadReference: string | null;
  personId: string | null;
  customerName: string | null;
  primaryPhone: string | null;
  projectName: string | null;
}

export interface TodayLeadRow {
  id: string;
  reference: string;
  stage: string;
  fullName: string | null;
  primaryPhone: string | null;
  projectName: string | null;
  ownerName: string | null;
  createdAt: Date | string;
}

export interface TodayVisitRow {
  id: string;
  type: string;
  status: string;
  scheduledAt: Date | string;
  leadId: string;
  leadReference: string;
  personId: string;
  customerName: string | null;
  primaryPhone: string | null;
  projectName: string | null;
  hostName: string | null;
}

export async function getTodaySalesQueue(
  orgId: string,
  timezone: string,
  ownerId?: string,
): Promise<{ newLeads: TodayLeadRow[]; tasks: SalesTaskRow[]; visits: TodayVisitRow[] }> {
  const leadConditions: SQL[] = [
    sql`l.org_id = ${orgId}`,
    sql`l.is_test = false`,
    sql`l.stage = 'new'`,
  ];
  const taskConditions: SQL[] = [
    sql`a.org_id = ${orgId}`,
    sql`a.type = 'task'`,
    sql`a.completed_at IS NULL`,
    sql`a.due_at IS NOT NULL`,
    sql`(a.due_at AT TIME ZONE ${timezone})::date <= (now() AT TIME ZONE ${timezone})::date`,
  ];
  const visitConditions: SQL[] = [
    sql`v.org_id = ${orgId}`,
    sql`v.scheduled_at IS NOT NULL`,
    sql`v.status IN ('scheduled', 'confirmed', 'arrived')`,
    sql`(v.scheduled_at AT TIME ZONE ${timezone})::date = (now() AT TIME ZONE ${timezone})::date`,
  ];

  if (ownerId) {
    leadConditions.push(sql`l.owner_user_id = ${ownerId}`);
    taskConditions.push(sql`a.user_id = ${ownerId}`);
    visitConditions.push(sql`v.host_user_id = ${ownerId}`);
  }

  const [leadResult, taskResult, visitResult] = await Promise.all([
    db().execute(sql`
      SELECT l.id, l.reference, l.stage::text AS stage,
             p.full_name AS "fullName", p.primary_phone AS "primaryPhone",
             pr.name AS "projectName", u.name AS "ownerName",
             l.created_at AS "createdAt"
      FROM leads l
      JOIN persons p ON p.id = l.person_id
      LEFT JOIN projects pr ON pr.id = l.project_id
      LEFT JOIN users u ON u.id = l.owner_user_id
      WHERE ${sql.join(leadConditions, sql` AND `)}
      ORDER BY l.created_at ASC
      LIMIT 30
    `),
    db().execute(sql`
      SELECT a.id, a.subject, a.body, a.due_at AS "dueAt",
             a.completed_at AS "completedAt", a.created_at AS "createdAt",
             a.user_id AS "userId", u.name AS "assigneeName",
             l.id AS "leadId", l.reference AS "leadReference",
             p.id AS "personId", p.full_name AS "customerName",
             p.primary_phone AS "primaryPhone", pr.name AS "projectName"
      FROM activities a
      LEFT JOIN leads l ON l.id = a.lead_id AND l.org_id = a.org_id
      LEFT JOIN persons p ON p.id = COALESCE(a.person_id, l.person_id) AND p.org_id = a.org_id
      LEFT JOIN projects pr ON pr.id = l.project_id
      LEFT JOIN users u ON u.id = a.user_id
      WHERE ${sql.join(taskConditions, sql` AND `)}
      ORDER BY a.due_at ASC, a.created_at ASC
      LIMIT 60
    `),
    db().execute(sql`
      SELECT v.id, v.type::text AS type, v.status::text AS status,
             v.scheduled_at AS "scheduledAt", l.id AS "leadId",
             l.reference AS "leadReference", p.id AS "personId",
             p.full_name AS "customerName", p.primary_phone AS "primaryPhone",
             pr.name AS "projectName", u.name AS "hostName"
      FROM visits v
      JOIN leads l ON l.id = v.lead_id AND l.org_id = v.org_id
      JOIN persons p ON p.id = v.person_id AND p.org_id = v.org_id
      LEFT JOIN projects pr ON pr.id = v.project_id
      LEFT JOIN users u ON u.id = v.host_user_id
      WHERE ${sql.join(visitConditions, sql` AND `)}
      ORDER BY v.scheduled_at ASC
      LIMIT 60
    `),
  ]);

  return {
    newLeads: leadResult.rows as unknown as TodayLeadRow[],
    tasks: taskResult.rows as unknown as SalesTaskRow[],
    visits: visitResult.rows as unknown as TodayVisitRow[],
  };
}

export interface TaskListFilters {
  ownerId?: string;
  status?: TaskStatus;
  search?: string;
  limit?: number;
}

export async function listSalesTasks(
  orgId: string,
  timezone: string,
  filters: TaskListFilters = {},
): Promise<SalesTaskRow[]> {
  const conditions: SQL[] = [sql`a.org_id = ${orgId}`, sql`a.type = 'task'`];
  const status = filters.status ?? "open";

  if (filters.ownerId) conditions.push(sql`a.user_id = ${filters.ownerId}`);
  if (filters.search?.trim()) {
    const term = `%${filters.search.trim().replace(/[%_]/g, "")}%`;
    conditions.push(sql`(
      a.subject ILIKE ${term} OR a.body ILIKE ${term} OR
      p.full_name ILIKE ${term} OR p.primary_phone ILIKE ${term} OR
      l.reference ILIKE ${term}
    )`);
  }

  if (status === "completed") {
    conditions.push(sql`a.completed_at IS NOT NULL`);
  } else {
    conditions.push(sql`a.completed_at IS NULL`);
    if (status === "overdue") conditions.push(sql`a.due_at < now()`);
    if (status === "today") {
      conditions.push(
        sql`(a.due_at AT TIME ZONE ${timezone})::date = (now() AT TIME ZONE ${timezone})::date`,
      );
    }
    if (status === "upcoming") {
      conditions.push(
        sql`(a.due_at AT TIME ZONE ${timezone})::date > (now() AT TIME ZONE ${timezone})::date`,
      );
    }
  }

  const limit = Math.min(Math.max(filters.limit ?? 150, 1), 250);
  const result = await db().execute(sql`
    SELECT a.id, a.subject, a.body, a.due_at AS "dueAt",
           a.completed_at AS "completedAt", a.created_at AS "createdAt",
           a.user_id AS "userId", u.name AS "assigneeName",
           l.id AS "leadId", l.reference AS "leadReference",
           p.id AS "personId", p.full_name AS "customerName",
           p.primary_phone AS "primaryPhone", pr.name AS "projectName"
    FROM activities a
    LEFT JOIN leads l ON l.id = a.lead_id AND l.org_id = a.org_id
    LEFT JOIN persons p ON p.id = COALESCE(a.person_id, l.person_id) AND p.org_id = a.org_id
    LEFT JOIN projects pr ON pr.id = l.project_id
    LEFT JOIN users u ON u.id = a.user_id
    WHERE ${sql.join(conditions, sql` AND `)}
    ORDER BY
      CASE WHEN a.completed_at IS NULL THEN 0 ELSE 1 END,
      a.due_at ASC NULLS LAST,
      a.completed_at DESC NULLS LAST,
      a.created_at DESC
    LIMIT ${limit}
  `);
  return result.rows as unknown as SalesTaskRow[];
}

export interface TaskTargetRow {
  id: string;
  reference: string;
  fullName: string | null;
  projectName: string | null;
  ownerUserId: string | null;
}

export async function listTaskTargets(orgId: string, ownerId?: string): Promise<TaskTargetRow[]> {
  const conditions: SQL[] = [
    sql`l.org_id = ${orgId}`,
    sql`l.is_test = false`,
    sql`l.stage NOT IN ('booked', 'lost', 'disqualified')`,
  ];
  if (ownerId) conditions.push(sql`l.owner_user_id = ${ownerId}`);

  const result = await db().execute(sql`
    SELECT l.id, l.reference, p.full_name AS "fullName",
           pr.name AS "projectName", l.owner_user_id AS "ownerUserId"
    FROM leads l
    JOIN persons p ON p.id = l.person_id
    LEFT JOIN projects pr ON pr.id = l.project_id
    WHERE ${sql.join(conditions, sql` AND `)}
    ORDER BY COALESCE(l.last_activity_at, l.created_at) DESC
    LIMIT 200
  `);
  return result.rows as unknown as TaskTargetRow[];
}

export interface CustomerListRow {
  id: string;
  fullName: string | null;
  primaryPhone: string | null;
  primaryEmail: string | null;
  city: string | null;
  isNri: boolean;
  isSuppressed: boolean;
  opportunityCount: number;
  openOpportunityCount: number;
  bookingCount: number;
  projectNames: string | null;
  ownerNames: string | null;
  lastActivityAt: Date | string;
  totalCount: number;
}

/**
 * A lead is somebody who enquired. A customer is somebody who bought.
 *
 * Listing every captured enquiry under "Customers" made the word meaningless —
 * the count on that screen was really "people in the CRM", which nobody needs
 * a dedicated page for. `customers` is the segment backed by a live booking;
 * `contacts` is the full address book, one click away, so nothing is hidden.
 */
export type CustomerSegment = "customers" | "contacts";

export function normalizeCustomerSegment(value?: string): CustomerSegment {
  return value === "contacts" ? "contacts" : "customers";
}

/** A cancelled booking un-makes the customer, the same way it un-books the unit. */
const hasLiveBooking = sql`EXISTS (
  SELECT 1 FROM bookings bk
  WHERE bk.org_id = p.org_id AND bk.person_id = p.id AND bk.status <> 'cancelled'
)`;

export interface CustomerListFilters {
  ownerId?: string;
  search?: string;
  segment?: CustomerSegment;
  limit?: number;
  offset?: number;
}

export async function listCustomers(
  orgId: string,
  filters: CustomerListFilters = {},
): Promise<CustomerListRow[]> {
  const conditions: SQL[] = [
    sql`p.org_id = ${orgId}`,
    sql`p.merged_into_person_id IS NULL`,
  ];
  if ((filters.segment ?? "customers") === "customers") conditions.push(hasLiveBooking);
  if (filters.ownerId) {
    conditions.push(sql`EXISTS (
      SELECT 1 FROM leads owned
      WHERE owned.org_id = p.org_id
        AND owned.person_id = p.id
        AND owned.owner_user_id = ${filters.ownerId}
    )`);
  }
  if (filters.search?.trim()) {
    const term = `%${filters.search.trim().replace(/[%_]/g, "")}%`;
    conditions.push(sql`(
      p.full_name ILIKE ${term} OR p.primary_phone ILIKE ${term} OR
      p.primary_email ILIKE ${term} OR EXISTS (
        SELECT 1 FROM leads searched
        WHERE searched.org_id = p.org_id
          AND searched.person_id = p.id
          ${filters.ownerId ? sql`AND searched.owner_user_id = ${filters.ownerId}` : sql``}
          AND searched.reference ILIKE ${term}
      )
    )`);
  }

  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  const offset = Math.max(filters.offset ?? 0, 0);
  const result = await db().execute(sql`
    SELECT p.id, p.full_name AS "fullName", p.primary_phone AS "primaryPhone",
           p.primary_email AS "primaryEmail", p.city,
           p.is_nri AS "isNri", p.is_suppressed AS "isSuppressed",
           COUNT(DISTINCT l.id)::int AS "opportunityCount",
           COUNT(DISTINCT l.id) FILTER (
             WHERE l.stage NOT IN ('booked', 'lost', 'disqualified')
           )::int AS "openOpportunityCount",
           (
             SELECT COUNT(*)::int FROM bookings bk
             WHERE bk.org_id = p.org_id AND bk.person_id = p.id AND bk.status <> 'cancelled'
           ) AS "bookingCount",
           STRING_AGG(DISTINCT pr.name, ', ' ORDER BY pr.name) AS "projectNames",
           STRING_AGG(DISTINCT u.name, ', ' ORDER BY u.name) AS "ownerNames",
           MAX(COALESCE(l.last_activity_at, l.updated_at, p.updated_at)) AS "lastActivityAt",
           COUNT(*) OVER()::int AS "totalCount"
    FROM persons p
    LEFT JOIN leads l ON l.person_id = p.id AND l.org_id = p.org_id
      ${filters.ownerId ? sql`AND l.owner_user_id = ${filters.ownerId}` : sql``}
    LEFT JOIN projects pr ON pr.id = l.project_id
    LEFT JOIN users u ON u.id = l.owner_user_id
    WHERE ${sql.join(conditions, sql` AND `)}
    GROUP BY p.id
    ORDER BY MAX(COALESCE(l.last_activity_at, l.updated_at, p.updated_at)) DESC
    LIMIT ${limit} OFFSET ${offset}
  `);
  return result.rows as unknown as CustomerListRow[];
}

export interface CustomerDetail {
  customer: {
    id: string;
    fullName: string | null;
    primaryPhone: string | null;
    primaryEmail: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
    preferredLanguage: string | null;
    isNri: boolean;
    isSuppressed: boolean;
    suppressionReason: string | null;
    createdAt: Date | string;
  };
  opportunities: Array<{
    id: string;
    ownerUserId: string | null;
    reference: string;
    stage: string;
    projectName: string | null;
    ownerName: string | null;
    source: string | null;
    createdAt: Date | string;
    lastActivityAt: Date | string | null;
  }>;
  activities: Array<{
    id: string;
    type: string;
    subject: string | null;
    body: string | null;
    occurredAt: Date | string;
    dueAt: Date | string | null;
    completedAt: Date | string | null;
    userName: string | null;
    leadId: string | null;
    leadReference: string | null;
  }>;
  visits: Array<{
    id: string;
    type: string;
    status: string;
    scheduledAt: Date | string | null;
    arrivedAt: Date | string | null;
    notes: string | null;
    hostName: string | null;
    leadId: string;
    leadReference: string;
  }>;
}

export async function getCustomerDetail(
  orgId: string,
  personId: string,
  ownerId?: string,
): Promise<CustomerDetail | null> {
  const [customerResult, opportunityResult, activityResult, visitResult] = await Promise.all([
    db().execute(sql`
      SELECT p.id, p.full_name AS "fullName", p.primary_phone AS "primaryPhone",
             p.primary_email AS "primaryEmail", p.city, p.state, p.postal_code AS "postalCode",
             p.preferred_language AS "preferredLanguage", p.is_nri AS "isNri",
             p.is_suppressed AS "isSuppressed", p.suppression_reason AS "suppressionReason",
             p.created_at AS "createdAt"
      FROM persons p
      WHERE p.org_id = ${orgId} AND p.id = ${personId} AND p.merged_into_person_id IS NULL
        ${ownerId ? sql`AND EXISTS (
          SELECT 1 FROM leads visible
          WHERE visible.org_id = p.org_id
            AND visible.person_id = p.id
            AND visible.owner_user_id = ${ownerId}
        )` : sql``}
      LIMIT 1
    `),
    db().execute(sql`
      SELECT l.id, l.owner_user_id AS "ownerUserId", l.reference, l.stage::text AS stage,
             pr.name AS "projectName", u.name AS "ownerName",
             t.source::text AS source, l.created_at AS "createdAt",
             l.last_activity_at AS "lastActivityAt"
      FROM leads l
      LEFT JOIN projects pr ON pr.id = l.project_id
      LEFT JOIN users u ON u.id = l.owner_user_id
      LEFT JOIN lead_touchpoints t ON t.id = l.first_touchpoint_id
      WHERE l.org_id = ${orgId} AND l.person_id = ${personId}
        ${ownerId ? sql`AND l.owner_user_id = ${ownerId}` : sql``}
      ORDER BY l.created_at DESC
    `),
    db().execute(sql`
      SELECT a.id, a.type, a.subject, a.body, a.occurred_at AS "occurredAt",
             a.due_at AS "dueAt", a.completed_at AS "completedAt",
             u.name AS "userName", l.id AS "leadId", l.reference AS "leadReference"
      FROM activities a
      LEFT JOIN users u ON u.id = a.user_id
      LEFT JOIN leads l ON l.id = a.lead_id AND l.org_id = a.org_id
      WHERE a.org_id = ${orgId}
        AND COALESCE(a.person_id, l.person_id) = ${personId}
        ${ownerId ? sql`AND l.owner_user_id = ${ownerId}` : sql``}
      ORDER BY a.occurred_at DESC
      LIMIT 200
    `),
    db().execute(sql`
      SELECT v.id, v.type::text AS type, v.status::text AS status,
             v.scheduled_at AS "scheduledAt", v.arrived_at AS "arrivedAt",
             v.notes, u.name AS "hostName", l.id AS "leadId",
             l.reference AS "leadReference"
      FROM visits v
      JOIN leads l ON l.id = v.lead_id AND l.org_id = v.org_id
      LEFT JOIN users u ON u.id = v.host_user_id
      WHERE v.org_id = ${orgId} AND v.person_id = ${personId}
        ${ownerId ? sql`AND l.owner_user_id = ${ownerId}` : sql``}
      ORDER BY COALESCE(v.arrived_at, v.scheduled_at, v.created_at) DESC
      LIMIT 100
    `),
  ]);

  const customer = (customerResult.rows as unknown as CustomerDetail["customer"][])[0];
  if (!customer) return null;

  return {
    customer,
    opportunities: opportunityResult.rows as unknown as CustomerDetail["opportunities"],
    activities: activityResult.rows as unknown as CustomerDetail["activities"],
    visits: visitResult.rows as unknown as CustomerDetail["visits"],
  };
}
