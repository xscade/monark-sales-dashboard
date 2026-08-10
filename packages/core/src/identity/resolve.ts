import { normalizeEmail } from "../normalize/email";
import { hashEmail, hashPhone, META_HASH_OPTIONS } from "../normalize/hash";
import { normalizePhone } from "../normalize/phone";

/**
 * Identity resolution.
 *
 * The job: decide whether an incoming enquiry belongs to somebody we already
 * know. Getting it wrong is costly in both directions —
 *
 *   Under-merging → the same buyer becomes four leads, four salespeople call
 *   them, the funnel maths double-counts, and campaign attribution fragments.
 *
 *   Over-merging → two different buyers become one record. Their timelines
 *   interleave, one gets the other's follow-ups, and the damage is much harder
 *   to detect and undo than under-merging.
 *
 * Over-merging is the worse failure, so the rules are asymmetric: merge only on
 * unambiguous evidence, and route anything conflicting to a human. This matters
 * particularly in India, where one phone number is genuinely shared across a
 * household, and where a receptionist's number gets entered for three different
 * site visits in an afternoon.
 */

export type MatchRule =
  | "exact_phone"
  | "exact_email"
  | "phone_and_email"
  | "external_id"
  | "meta_lead_id"
  | "manual";

export interface IdentityInput {
  phone?: string | null;
  email?: string | null;
  externalId?: string | null;
  metaLeadId?: string | null;
  fullName?: string | null;
}

export interface NormalizedIdentity {
  phone: { normalized: string; hash: string; raw: string } | null;
  email: { normalized: string; canonical: string; hash: string; raw: string } | null;
  externalId: string | null;
  metaLeadId: string | null;
  isDisposableEmail: boolean;
  isRoleAccount: boolean;
  phoneValid: boolean;
}

export function normalizeIdentity(input: IdentityInput): NormalizedIdentity {
  const phone = normalizePhone(input.phone);
  const email = normalizeEmail(input.email);

  return {
    phone: phone
      ? {
          normalized: phone.e164,
          // Precomputed with Meta's rules. Google's differ (E.164 with '+'), so
          // the Google adapter re-hashes from the stored E.164 rather than
          // reusing this digest.
          hash: hashPhone(phone.e164, META_HASH_OPTIONS) ?? "",
          raw: input.phone ?? "",
        }
      : null,
    email: email
      ? {
          normalized: email.forHashing,
          canonical: email.canonical,
          hash: hashEmail(email.forHashing, META_HASH_OPTIONS) ?? "",
          raw: input.email ?? "",
        }
      : null,
    externalId: input.externalId?.trim() || null,
    metaLeadId: input.metaLeadId?.trim() || null,
    isDisposableEmail: email?.isDisposable ?? false,
    isRoleAccount: email?.isRoleAccount ?? false,
    phoneValid: phone !== null,
  };
}

/** A person the store found for one of the incoming identifiers. */
export interface IdentifierMatch {
  personId: string;
  identifierType: "phone" | "email" | "external_id" | "meta_lead_id";
}

export type ResolutionDecision =
  | { action: "create"; reason: string }
  | { action: "attach"; personId: string; rule: MatchRule; confidence: number; reason: string }
  | {
      /**
       * Identifiers point at different existing people. We attach to the
       * strongest one and raise a review task rather than guessing — an
       * automatic merge here is unreviewable and frequently wrong.
       */
      action: "attach_with_conflict";
      personId: string;
      conflictingPersonIds: string[];
      rule: MatchRule;
      confidence: number;
      reason: string;
    };

/**
 * Pure decision function — no database access, fully unit-testable.
 *
 * Phone outranks email deliberately. In this market phone is verified by the
 * act of calling the buyer, whereas email is frequently mistyped, borrowed
 * from a spouse, or invented to get past a form.
 */
export function decideResolution(matches: readonly IdentifierMatch[]): ResolutionDecision {
  if (matches.length === 0) {
    return { action: "create", reason: "No existing identifier matched" };
  }

  const byPerson = new Map<string, Set<string>>();
  for (const m of matches) {
    const set = byPerson.get(m.personId) ?? new Set<string>();
    set.add(m.identifierType);
    byPerson.set(m.personId, set);
  }

  // Unambiguous: everything points at the same person.
  if (byPerson.size === 1) {
    const [personId, types] = [...byPerson.entries()][0]!;
    const hasPhone = types.has("phone");
    const hasEmail = types.has("email");

    if (hasPhone && hasEmail) {
      return {
        action: "attach",
        personId,
        rule: "phone_and_email",
        confidence: 1.0,
        reason: "Phone and email both matched the same person",
      };
    }
    if (types.has("meta_lead_id")) {
      return {
        action: "attach",
        personId,
        rule: "meta_lead_id",
        confidence: 1.0,
        reason: "Matched on Meta lead id",
      };
    }
    if (types.has("external_id")) {
      return {
        action: "attach",
        personId,
        rule: "external_id",
        confidence: 0.99,
        reason: "Matched on caller-supplied external id",
      };
    }
    if (hasPhone) {
      return {
        action: "attach",
        personId,
        rule: "exact_phone",
        confidence: 0.95,
        reason: "Exact phone match",
      };
    }
    return {
      action: "attach",
      personId,
      rule: "exact_email",
      confidence: 0.9,
      reason: "Exact email match",
    };
  }

  // Conflict. Prefer the phone-matched person, then external id, then email.
  const phoneMatch = matches.find((m) => m.identifierType === "phone");
  const externalMatch = matches.find((m) => m.identifierType === "external_id");
  const winner = phoneMatch ?? externalMatch ?? matches[0]!;
  const conflicting = [...byPerson.keys()].filter((id) => id !== winner.personId);

  return {
    action: "attach_with_conflict",
    personId: winner.personId,
    conflictingPersonIds: conflicting,
    rule: phoneMatch ? "exact_phone" : "exact_email",
    confidence: 0.6,
    reason:
      `Identifiers matched ${byPerson.size} different people — attached to the ` +
      `${winner.identifierType} match and flagged for manual review. ` +
      `Auto-merging here risks combining two real buyers.`,
  };
}

/**
 * Should this person's details be updated from the new touchpoint?
 *
 * Only fill gaps; never overwrite. A later form where the buyer typed "Ravi"
 * must not clobber "Ravi Kumar" captured earlier, and a portal lead with a
 * generic city must not overwrite a verified address. Corrections are a
 * deliberate human action, not a side effect of a form submission.
 */
export function mergeFields<T extends Record<string, unknown>>(
  existing: T,
  incoming: Partial<T>,
): Partial<T> {
  const updates: Partial<T> = {};
  for (const [key, value] of Object.entries(incoming) as [keyof T, T[keyof T]][]) {
    if (value === null || value === undefined || value === "") continue;
    const current = existing[key];
    if (current === null || current === undefined || current === "") {
      updates[key] = value;
    }
  }
  return updates;
}
