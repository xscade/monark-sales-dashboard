/**
 * Email normalization.
 *
 * Two different normal forms are needed and conflating them causes real bugs:
 *
 *   `canonical` — aggressive, used for OUR deduplication. Gmail dot-stripping
 *   and +tag removal are applied so ravi.kumar+site@gmail.com and
 *   ravikumar@gmail.com resolve to one person.
 *
 *   `forHashing` — conservative: lowercase and trim only. Meta and Google
 *   specify exactly this, and applying our aggressive rules before hashing
 *   would produce a digest that does not match the one the platform computed
 *   from the same address, quietly costing match rate.
 *
 * Gmail's dot-insensitivity is a real Gmail behaviour, but it is a Gmail
 * behaviour — applying it to other providers would merge distinct people, so
 * it is scoped to Google-hosted domains only.
 */

const GMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

export interface NormalizedEmail {
  canonical: string;
  forHashing: string;
  domain: string;
  isRoleAccount: boolean;
  isDisposable: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@.]+\.[^\s@]+$/;

/** Addresses that are almost never a single buyer. Worth flagging rather than
 *  rejecting — an enquiry from info@ is still an enquiry. */
const ROLE_LOCAL_PARTS = new Set([
  "info", "admin", "sales", "support", "contact", "office",
  "enquiry", "enquiries", "hello", "team", "noreply", "no-reply",
]);

const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com", "guerrillamail.com", "10minutemail.com",
  "yopmail.com", "tempmail.com", "throwawaymail.com", "trashmail.com",
  "sharklasers.com", "getnada.com", "temp-mail.org",
]);

export function normalizeEmail(input: string | null | undefined): NormalizedEmail | null {
  if (!input) return null;

  const trimmed = input.trim().toLowerCase();
  if (!trimmed || !EMAIL_RE.test(trimmed)) return null;

  const atIndex = trimmed.lastIndexOf("@");
  const localPart = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex + 1);
  if (!localPart || !domain) return null;

  let canonicalLocal = localPart;

  // Strip +tags. Supported by Gmail, Outlook, Fastmail and most modern hosts.
  const plusIndex = canonicalLocal.indexOf("+");
  if (plusIndex > 0) canonicalLocal = canonicalLocal.slice(0, plusIndex);

  // Gmail ignores dots in the local part; nobody else reliably does.
  if (GMAIL_DOMAINS.has(domain)) {
    canonicalLocal = canonicalLocal.replace(/\./g, "");
  }

  if (!canonicalLocal) return null;

  return {
    canonical: `${canonicalLocal}@${domain}`,
    // Platform hashing input: lowercase + trim ONLY. Do not "improve" this.
    forHashing: trimmed,
    domain,
    isRoleAccount: ROLE_LOCAL_PARTS.has(canonicalLocal),
    isDisposable: DISPOSABLE_DOMAINS.has(domain),
  };
}

/** Normalize a person/city/state string for hashing: lowercase, collapse
 *  whitespace, strip punctuation and diacritics. Shared by Meta and Google. */
export function normalizeNamePart(input: string | null | undefined): string | null {
  if (!input) return null;
  const cleaned = input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || null;
}

/** Best-effort split of a single name field into given/family parts.
 *  Indian naming conventions vary enormously, so this is a heuristic used only
 *  to improve ad-platform match rate — never to address the customer. */
export function splitName(fullName: string | null | undefined): {
  firstName: string | null;
  lastName: string | null;
} {
  if (!fullName) return { firstName: null, lastName: null };
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: null, lastName: null };
  if (parts.length === 1) return { firstName: parts[0] ?? null, lastName: null };
  return {
    firstName: parts[0] ?? null,
    lastName: parts[parts.length - 1] ?? null,
  };
}
