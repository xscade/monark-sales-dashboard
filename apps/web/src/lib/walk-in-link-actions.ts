"use server";

import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { activities, getDb, leadAssignments, leads, leadStageHistory, leadTouchpoints, persons, visits } from "@monark/db";
import { emitConversionEvent, eventKeyFor, ingestLead } from "@monark/services";
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { requirePermission } from "./auth";
import {
  WALK_IN_LINK_EXTRA_FIELDS,
  WALK_IN_LINK_SOURCE,
  WALK_IN_LINK_TYPES,
  type WalkInLinkType,
} from "./walk-in-links";

/** Unambiguous alphabet: no O/0, no I/l. Slugs get read aloud and retyped. */
const SLUG_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

function generateSlug(): string {
  const bytes = randomBytes(12);
  return Array.from(bytes, (byte) => SLUG_ALPHABET[byte % SLUG_ALPHABET.length]).join("");
}

function hashPasscode(passcode: string): string {
  return createHash("sha256").update(passcode.trim(), "utf8").digest("hex");
}

/** Constant-time so a wrong passcode cannot be narrowed down by timing. */
function passcodeMatches(supplied: string, storedHash: string): boolean {
  const a = Buffer.from(hashPasscode(supplied), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

const optionalText = (max: number) =>
  z.preprocess((value) => String(value ?? "").trim() || undefined, z.string().max(max).optional());

const createLinkSchema = z.object({
  label: z.string().trim().min(2, "Name this channel").max(120),
  linkType: z.enum(WALK_IN_LINK_TYPES),
  contactName: optionalText(160),
  contactPhone: optionalText(40),
  passcode: z.string().trim().min(4, "Use at least 4 characters").max(64),
  projectId: z.preprocess(
    (value) => String(value ?? "").trim() || undefined,
    z.string().uuid().optional(),
  ),
  ownerUserId: z.preprocess(
    (value) => String(value ?? "").trim() || undefined,
    z.string().uuid().optional(),
  ),
  expiresAt: z.preprocess(
    (value) => String(value ?? "").trim() || undefined,
    z.string().max(40).optional(),
  ),
});

export interface WalkInLinkState {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string[]>;
  /** Shown once, immediately after creation, and never retrievable again. */
  createdSlug?: string;
}

export async function createWalkInLink(
  _previous: WalkInLinkState,
  formData: FormData,
): Promise<WalkInLinkState> {
  const user = await requirePermission("settings:write");
  const parsed = createLinkSchema.safeParse({
    label: formData.get("label"),
    linkType: formData.get("linkType"),
    contactName: formData.get("contactName"),
    contactPhone: formData.get("contactPhone"),
    passcode: formData.get("passcode"),
    projectId: formData.get("projectId"),
    ownerUserId: formData.get("ownerUserId"),
    expiresAt: formData.get("expiresAt"),
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: "Check the highlighted details",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const extraFields = WALK_IN_LINK_EXTRA_FIELDS.filter(
    (field) => formData.get(`extra:${field}`) === "on",
  );
  const expiresAt = parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null;
  if (expiresAt && Number.isNaN(expiresAt.getTime())) {
    return { ok: false, message: "Check the highlighted details", fieldErrors: { expiresAt: ["Enter a valid date"] } };
  }
  if (expiresAt && expiresAt.getTime() < Date.now()) {
    return { ok: false, message: "Check the highlighted details", fieldErrors: { expiresAt: ["Choose a future date"] } };
  }

  const slug = generateSlug();
  await getDb().execute(sql`
    INSERT INTO walk_in_links (
      id, org_id, slug, label, link_type, contact_name, contact_phone,
      passcode_hash, project_id, owner_user_id, extra_fields, expires_at,
      created_by_user_id
    ) VALUES (
      ${randomUUID()}, ${user.orgId}, ${slug}, ${parsed.data.label},
      ${parsed.data.linkType}::walk_in_link_type, ${parsed.data.contactName ?? null},
      ${parsed.data.contactPhone ?? null}, ${hashPasscode(parsed.data.passcode)},
      ${parsed.data.projectId ?? null}, ${parsed.data.ownerUserId ?? null},
      ${JSON.stringify(extraFields)}::jsonb, ${expiresAt}, ${user.id}
    )
  `);

  revalidatePath("/walk-ins/links");
  revalidatePath("/reports");
  return { ok: true, message: "Link created", createdSlug: slug };
}

export async function setWalkInLinkActive(formData: FormData) {
  const user = await requirePermission("settings:write");
  const input = z
    .object({ linkId: z.string().uuid(), isActive: z.enum(["true", "false"]) })
    .parse(Object.fromEntries(formData));

  await getDb().execute(sql`
    UPDATE walk_in_links
    SET is_active = ${input.isActive === "true"}, updated_at = now()
    WHERE org_id = ${user.orgId} AND id = ${input.linkId}
  `);
  revalidatePath("/walk-ins/links");
  revalidatePath("/reports");
}

/**
 * Deleting a link that has produced visits would sever the attribution it
 * exists to hold, so a used link is deactivated instead.
 */
export async function deleteWalkInLink(formData: FormData) {
  const user = await requirePermission("settings:write");
  const input = z.object({ linkId: z.string().uuid() }).parse(Object.fromEntries(formData));

  const used = await getDb().execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM visits
      WHERE org_id = ${user.orgId} AND walk_in_link_id = ${input.linkId}
    ) AS used
  `);
  if (Boolean(used.rows[0]?.used)) {
    throw new Error("This link already produced visits — deactivate it instead of deleting it");
  }

  await getDb().execute(sql`
    DELETE FROM walk_in_links WHERE org_id = ${user.orgId} AND id = ${input.linkId}
  `);
  revalidatePath("/walk-ins/links");
  revalidatePath("/reports");
}

/**
 * A desk session, not a per-visitor password.
 *
 * The link is opened once at the start of a shift and then used all day by
 * whoever is standing there; asking the visitor for a passcode they were never
 * given was the wrong shape entirely. The passcode now unlocks the device, and
 * each visitor just fills the form.
 *
 * The cookie holds a value derived from the link's own stored hash rather than
 * the passcode itself, so a stolen cookie unlocks this one link and cannot be
 * replayed as the passcode anywhere else. httpOnly keeps it away from any
 * script that manages to run on the page.
 */
function sessionToken(linkId: string, passcodeHash: string): string {
  return createHash("sha256").update(`${linkId}:${passcodeHash}`, "utf8").digest("hex");
}

function sessionCookieName(slug: string): string {
  return `monark_walkin_${slug}`;
}

/** A working day. Long enough for a shift, short enough that an abandoned
 *  tablet does not stay unlocked all week. */
const SESSION_MAX_AGE = 12 * 60 * 60;

interface PublicLinkRow {
  id: string;
  orgId: string;
  linkType: WalkInLinkType;
  label: string;
  passcodeHash: string;
  projectId: string | null;
  ownerUserId: string | null;
  isActive: boolean;
  expiresAt: Date | null;
}

async function loadPublicLink(slug: string): Promise<PublicLinkRow | null> {
  const result = await getDb().execute(sql`
    SELECT id, org_id AS "orgId", link_type::text AS "linkType", label,
           passcode_hash AS "passcodeHash", project_id AS "projectId",
           owner_user_id AS "ownerUserId", is_active AS "isActive", expires_at AS "expiresAt"
    FROM walk_in_links
    WHERE slug = ${slug}
    LIMIT 1
  `);
  return (result.rows[0] as unknown as PublicLinkRow | undefined) ?? null;
}

function linkIsOpen(link: PublicLinkRow): boolean {
  if (!link.isActive) return false;
  return !link.expiresAt || new Date(link.expiresAt).getTime() >= Date.now();
}

/** Whether this browser already unlocked the link. Used by the page to decide
 *  between the passcode gate and the capture screen. */
export async function hasWalkInLinkSession(slug: string): Promise<boolean> {
  const link = await loadPublicLink(slug);
  if (!link || !linkIsOpen(link)) return false;
  const jar = await cookies();
  const supplied = jar.get(sessionCookieName(slug))?.value;
  if (!supplied) return false;
  const expected = sessionToken(link.id, link.passcodeHash);
  const a = Buffer.from(supplied, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface UnlockState {
  ok: boolean;
  message?: string;
}

export async function unlockWalkInLink(
  _previous: UnlockState,
  formData: FormData,
): Promise<UnlockState> {
  const parsed = z
    .object({
      slug: z.string().trim().min(4).max(64),
      passcode: z.string().trim().min(1).max(64),
    })
    .safeParse({ slug: formData.get("slug"), passcode: formData.get("passcode") });
  // Same message for every failure — a public endpoint that distinguishes
  // "no such link" from "wrong passcode" is an oracle for enumerating slugs.
  const rejected = { ok: false as const, message: "That passcode did not work. Check it with the team." };
  if (!parsed.success) return rejected;

  const link = await loadPublicLink(parsed.data.slug);
  if (!link || !linkIsOpen(link)) return rejected;
  if (!passcodeMatches(parsed.data.passcode, link.passcodeHash)) return rejected;

  const jar = await cookies();
  jar.set(sessionCookieName(parsed.data.slug), sessionToken(link.id, link.passcodeHash), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: `/w/${parsed.data.slug}`,
    maxAge: SESSION_MAX_AGE,
  });
  return { ok: true };
}

/** Ends the desk session — the tablet is handed back or the shift is over. */
export async function lockWalkInLink(formData: FormData): Promise<void> {
  const slug = String(formData.get("slug") ?? "").trim();
  if (!slug) return;
  const jar = await cookies();
  jar.delete({ name: sessionCookieName(slug), path: `/w/${slug}` });
}

const publicSubmitSchema = z
  .object({
    slug: z.string().trim().min(4).max(64),
    name: z.string().trim().min(2, "Enter the visitor's name").max(160),
    phone: z.string().trim().min(6, "Enter a phone number").max(40),
    email: z.preprocess(
      (value) => String(value ?? "").trim().toLowerCase() || undefined,
      z.string().email("Enter a valid email address").max(254).optional(),
    ),
    city: optionalText(100),
    preferredLanguage: optionalText(60),
    visitType: z.enum(["corporate_office", "project_site", "experience_centre"]),
    configurations: z.preprocess((value) => {
      const values = String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
      return values.length ? values : undefined;
    }, z.array(z.string().max(120)).max(20).optional()),
    accompanyingCount: z.coerce.number().int().min(0).max(20).default(0),
    intentRating: z.preprocess(
      (value) => String(value ?? "").trim() || undefined,
      z.coerce.number().int().min(1).max(5).optional(),
    ),
    notes: optionalText(2000),
    consent: z.boolean(),
  });

export interface PublicWalkInState {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string[]>;
}

/**
 * Submission from a public link.
 *
 * Authorised by the desk session rather than a passcode in the body — the
 * visitor filling this in was never given one. Everything that would normally
 * come from a signed-in user — organisation, project, lead owner — is taken
 * from the link row rather than the request, so a crafted form body cannot
 * file a lead into another tenant or reassign it.
 */
export async function submitPublicWalkIn(
  _previous: PublicWalkInState,
  formData: FormData,
): Promise<PublicWalkInState> {
  const parsed = publicSubmitSchema.safeParse({
    slug: formData.get("slug"),
    name: formData.get("name"),
    phone: formData.get("phone"),
    email: formData.get("email"),
    city: formData.get("city"),
    preferredLanguage: formData.get("preferredLanguage"),
    visitType: formData.get("visitType") || "corporate_office",
    configurations: formData.get("configurations"),
    accompanyingCount: formData.get("accompanyingCount") || 0,
    intentRating: formData.get("intentRating"),
    notes: formData.get("notes"),
    consent: formData.get("consent") === "on",
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: "Check the highlighted details",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const input = parsed.data;

  const link = await loadPublicLink(input.slug);

  // One message for "no such link", "switched off", "expired" and "session
  // gone". A public endpoint that distinguishes them is an oracle for
  // enumerating valid slugs.
  const rejected = {
    ok: false as const,
    message: "This device is no longer unlocked. Enter the passcode again to continue.",
  };
  if (!link || !linkIsOpen(link)) return rejected;
  // The cookie is the authorisation. Re-checked on every submission so pausing
  // a link or letting it expire takes effect immediately, not at next unlock.
  if (!(await hasWalkInLinkSession(input.slug))) return rejected;

  const visitId = randomUUID();
  try {
    await getDb().transaction(async (tx) => {
      const result = await ingestLead(tx, {
        orgId: link.orgId,
        projectId: link.projectId ?? undefined,
        name: input.name,
        phone: input.phone,
        email: input.email,
        city: input.city,
        source: WALK_IN_LINK_SOURCE[link.linkType],
        sourceDetail: link.label,
        // Somebody standing at the gate who already bought is here about that
        // purchase, not starting a second one.
        attachToBookedLead: true,
        notes: input.notes,
        consent: {
          marketing: input.consent,
          adUserData: input.consent,
          adPersonalization: input.consent,
          collectedVia: `public walk-in link: ${link.label}`,
        },
        rawPayload: { captureSurface: "public walk-in link", walkInLinkId: link.id },
      });

      const now = new Date();
      const [lead] = await tx
        .select({
          stage: leads.stage,
          projectId: leads.projectId,
          firstTouchpointId: leads.firstTouchpointId,
          firstAttributionExpiresAt: leadTouchpoints.attributionExpiresAt,
        })
        .from(leads)
        .leftJoin(leadTouchpoints, eq(leadTouchpoints.id, leads.firstTouchpointId))
        .where(and(eq(leads.id, result.leadId), eq(leads.orgId, link.orgId)))
        .limit(1);
      if (!lead) throw new Error("Lead disappeared during capture");

      if (input.preferredLanguage) {
        await tx
          .update(persons)
          .set({ preferredLanguage: input.preferredLanguage, updatedAt: now })
          .where(and(eq(persons.id, result.personId), eq(persons.orgId, link.orgId)));
      }

      await tx.insert(visits).values({
        id: visitId,
        orgId: link.orgId,
        leadId: result.leadId,
        personId: result.personId,
        projectId: lead.projectId,
        type: input.visitType,
        status: "arrived",
        arrivedAt: now,
        hostUserId: link.ownerUserId,
        accompanyingCount: input.accompanyingCount,
        configurationsViewed: input.configurations ?? null,
        intentRating: input.intentRating ?? null,
        notes: input.notes ?? null,
        checkInMethod: "public_link",
        walkInLinkId: link.id,
      });

      const shouldAdvance = ["new", "contacted", "qualified", "visit_scheduled"].includes(lead.stage);
      if (shouldAdvance) {
        await tx.insert(leadStageHistory).values({
          id: randomUUID(),
          orgId: link.orgId,
          leadId: result.leadId,
          fromStage: lead.stage,
          toStage: "visited",
          // No signed-in actor exists on a public form, so the change is
          // attributed to the surface rather than to a person.
          changedBy: "api",
          reason: `Checked in via ${link.label}`,
        });
      }
      await tx
        .update(leads)
        .set({
          ...(shouldAdvance ? { stage: "visited" as const } : {}),
          ...(result.isNewLead && link.ownerUserId ? { ownerUserId: link.ownerUserId } : {}),
          lastActivityAt: now,
          updatedAt: now,
        })
        .where(eq(leads.id, result.leadId));
      if (result.isNewLead && link.ownerUserId) {
        await tx.insert(leadAssignments).values({
          id: randomUUID(),
          orgId: link.orgId,
          leadId: result.leadId,
          fromUserId: null,
          toUserId: link.ownerUserId,
          rule: "manual",
          reason: `Routed by walk-in link: ${link.label}`,
        });
      }

      // A buyer who already booked is not progressing through the funnel by
      // walking in — they completed it. Reporting another mid-funnel visit for
      // them teaches Meta and Google to optimise for people who have already
      // bought, which is the opposite of what the spend is for.
      if (lead.stage !== "booked") {
        await emitConversionEvent(tx, {
        orgId: link.orgId,
        eventType: input.visitType === "project_site" ? "site_visit_completed" : "walk_in_completed",
        personId: result.personId,
        leadId: result.leadId,
        projectId: lead.projectId,
        touchpointId: result.isNewLead
          ? result.touchpointId
          : (lead.firstTouchpointId ?? result.touchpointId),
        occurredAt: now,
        eventKey: eventKeyFor.visitCompleted(visitId),
        stageAtEvent: shouldAdvance ? "visited" : lead.stage,
        sourceEntityType: "visit",
        sourceEntityId: visitId,
        attributionExpiresAt: result.isNewLead
          ? result.attributionExpiresAt
          : (lead.firstAttributionExpiresAt ?? result.attributionExpiresAt),
        });
      }

      // The visitor is told nothing — they filled a form and it worked. The
      // team, though, needs to know this was somebody already on the books:
      // a returning buyer walking back in is a far stronger signal than a
      // first enquiry, and the dedupe that makes it one record also makes it
      // invisible unless it is written down.
      const returning = !result.isNewLead;
      const detail = [
        `Checked in at ${input.visitType.replace(/_/g, " ")} via ${link.label}`,
        input.configurations?.length ? `Configurations: ${input.configurations.join(", ")}` : null,
        input.accompanyingCount ? `${input.accompanyingCount} accompanying` : null,
        input.intentRating ? `Self-rated interest ${input.intentRating}/5` : null,
        input.notes,
      ]
        .filter(Boolean)
        .join("\n");

      await tx.insert(activities).values({
        id: randomUUID(),
        orgId: link.orgId,
        leadId: result.leadId,
        personId: result.personId,
        type: "note",
        subject: returning
          ? `Returning customer checked in · ${link.label}`
          : `New visitor checked in · ${link.label}`,
        body: detail,
        // Attributed to whoever the link routes to, so it lands in their feed
        // rather than looking like it came from nobody.
        userId: link.ownerUserId,
        metadata: {
          source: "public_walk_in_link",
          walkInLinkId: link.id,
          returning,
          visitType: input.visitType,
        },
        occurredAt: now,
      });

      await tx.execute(sql`
        UPDATE walk_in_links
        SET submission_count = submission_count + 1, last_submission_at = ${now}
        WHERE id = ${link.id}
      `);
    });
  } catch {
    return { ok: false, message: "That could not be saved. Please try again, or ask the team to take your details." };
  }

  revalidatePath("/walk-ins");
  revalidatePath("/reports");
  return { ok: true, message: "Thank you — you are checked in. The team has your details." };
}
