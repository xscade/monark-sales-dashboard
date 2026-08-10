import { getDb } from "@monark/db";
import { sql } from "drizzle-orm";
import type { WalkInLinkType } from "./walk-in-links";

const db = () => getDb();

export interface WalkInLinkRow {
  id: string;
  slug: string;
  label: string;
  linkType: WalkInLinkType;
  contactName: string | null;
  contactPhone: string | null;
  projectId: string | null;
  projectName: string | null;
  ownerUserId: string | null;
  ownerName: string | null;
  extraFields: string[];
  isActive: boolean;
  expiresAt: string | null;
  viewCount: number;
  submissionCount: number;
  lastSubmissionAt: string | null;
  createdAt: string;
}

export async function listWalkInLinks(orgId: string): Promise<WalkInLinkRow[]> {
  const result = await db().execute(sql`
    SELECT wl.id, wl.slug, wl.label, wl.link_type::text AS "linkType",
           wl.contact_name AS "contactName", wl.contact_phone AS "contactPhone",
           wl.project_id AS "projectId", pr.name AS "projectName",
           wl.owner_user_id AS "ownerUserId", u.name AS "ownerName",
           wl.extra_fields AS "extraFields", wl.is_active AS "isActive",
           wl.expires_at AS "expiresAt", wl.view_count AS "viewCount",
           wl.submission_count AS "submissionCount",
           wl.last_submission_at AS "lastSubmissionAt", wl.created_at AS "createdAt"
    FROM walk_in_links wl
    LEFT JOIN projects pr ON pr.id = wl.project_id
    LEFT JOIN users u ON u.id = wl.owner_user_id
    WHERE wl.org_id = ${orgId}
    ORDER BY wl.is_active DESC, wl.created_at DESC
    LIMIT 200
  `);
  return result.rows as unknown as WalkInLinkRow[];
}

export interface WalkInLinkPerformanceRow {
  id: string;
  label: string;
  linkType: WalkInLinkType;
  contactName: string | null;
  projectName: string | null;
  isActive: boolean;
  viewCount: number;
  submissionCount: number;
  /** Distinct people, so one buyer resubmitting does not inflate the channel. */
  leadCount: number;
  arrivedCount: number;
  siteVisitCount: number;
  bookedCount: number;
  bookedValue: string | null;
  lastSubmissionAt: string | null;
}

/**
 * Channel performance, joined all the way to money.
 *
 * Submissions alone would rank a link that collects a hundred tyre-kickers
 * above one that produced four bookings, which is exactly the mistake this
 * table exists to prevent. Views are counted on the link row; everything from
 * `leadCount` rightwards is derived from the visits the link produced.
 */
export async function getWalkInLinkPerformance(orgId: string): Promise<WalkInLinkPerformanceRow[]> {
  // Two independent lateral aggregates rather than one join chain. Joining
  // visits and bookings together fans out — a lead with three visits would
  // count its booking value three times and quietly overstate the channel.
  const result = await db().execute(sql`
    SELECT wl.id, wl.label, wl.link_type::text AS "linkType",
           wl.contact_name AS "contactName", pr.name AS "projectName",
           wl.is_active AS "isActive",
           wl.view_count AS "viewCount", wl.submission_count AS "submissionCount",
           wl.last_submission_at AS "lastSubmissionAt",
           v."leadCount", v."arrivedCount", v."siteVisitCount",
           bk."bookedCount", bk."bookedValue"
    FROM walk_in_links wl
    LEFT JOIN projects pr ON pr.id = wl.project_id
    LEFT JOIN LATERAL (
      SELECT COUNT(DISTINCT vi.lead_id)::int AS "leadCount",
             COUNT(*) FILTER (WHERE vi.arrived_at IS NOT NULL)::int AS "arrivedCount",
             COUNT(*) FILTER (WHERE vi.type = 'project_site')::int AS "siteVisitCount"
      FROM visits vi
      WHERE vi.org_id = wl.org_id AND vi.walk_in_link_id = wl.id
    ) v ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS "bookedCount",
             COALESCE(SUM(b.agreement_value), 0)::text AS "bookedValue"
      FROM bookings b
      WHERE b.org_id = wl.org_id
        AND b.status <> 'cancelled'
        AND b.lead_id IN (
          SELECT vi2.lead_id FROM visits vi2
          WHERE vi2.org_id = wl.org_id AND vi2.walk_in_link_id = wl.id
        )
    ) bk ON true
    WHERE wl.org_id = ${orgId}
    ORDER BY bk."bookedCount" DESC, v."leadCount" DESC, wl.created_at DESC
    LIMIT 100
  `);
  return result.rows as unknown as WalkInLinkPerformanceRow[];
}

export interface PublicWalkInLink {
  id: string;
  orgId: string;
  slug: string;
  label: string;
  linkType: WalkInLinkType;
  passcodeHash: string;
  projectId: string | null;
  projectName: string | null;
  ownerUserId: string | null;
  extraFields: string[];
  isActive: boolean;
  expiresAt: Date | null;
  orgName: string;
  timezone: string;
}

/**
 * Look a link up for the public form.
 *
 * Returns the row regardless of active/expired state so the page can explain
 * itself; the submit path is what enforces the gate. Never widen this to
 * include the contact phone — the public page must not leak the broker's
 * number to anyone who guesses a slug.
 */
export async function getPublicWalkInLink(slug: string): Promise<PublicWalkInLink | null> {
  const result = await db().execute(sql`
    SELECT wl.id, wl.org_id AS "orgId", wl.slug, wl.label, wl.link_type::text AS "linkType",
           wl.passcode_hash AS "passcodeHash", wl.project_id AS "projectId",
           pr.name AS "projectName", wl.owner_user_id AS "ownerUserId",
           wl.extra_fields AS "extraFields", wl.is_active AS "isActive",
           wl.expires_at AS "expiresAt", o.name AS "orgName", o.timezone
    FROM walk_in_links wl
    JOIN orgs o ON o.id = wl.org_id
    LEFT JOIN projects pr ON pr.id = wl.project_id
    WHERE wl.slug = ${slug}
    LIMIT 1
  `);
  return (result.rows[0] as unknown as PublicWalkInLink | undefined) ?? null;
}

/** Counted on render. A view without a submission is the signal that a channel
 *  is being seen and ignored, which is not visible any other way. */
export async function recordWalkInLinkView(id: string): Promise<void> {
  await db().execute(sql`
    UPDATE walk_in_links SET view_count = view_count + 1 WHERE id = ${id}
  `);
}
