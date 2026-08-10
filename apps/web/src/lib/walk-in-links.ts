/**
 * Shared vocabulary for public walk-in links.
 *
 * Client-safe: the public form, the admin screen and the report all read from
 * here so a channel cannot be labelled three different ways.
 */
export const WALK_IN_LINK_TYPES = [
  "corporate_office",
  "project_site",
  "broker",
  "sales_team",
] as const;

export type WalkInLinkType = (typeof WALK_IN_LINK_TYPES)[number];

export const WALK_IN_LINK_TYPE_LABELS: Record<WalkInLinkType, string> = {
  corporate_office: "Corporate office",
  project_site: "Project site",
  broker: "Broker",
  sales_team: "Sales team",
};

/**
 * How a channel maps to the lead's touchpoint source.
 *
 * A broker-forwarded form is a broker enquiry that happens to arrive as a
 * walk-in; reporting it as `walk_in` would hide the channel we built this for.
 */
export const WALK_IN_LINK_SOURCE: Record<WalkInLinkType, "walk_in" | "broker" | "referral"> = {
  corporate_office: "walk_in",
  project_site: "walk_in",
  broker: "broker",
  sales_team: "referral",
};

/** Default arrival location implied by the channel. Overridable on the form. */
export const WALK_IN_LINK_VISIT_TYPE: Record<WalkInLinkType, "corporate_office" | "project_site" | "experience_centre"> = {
  corporate_office: "corporate_office",
  project_site: "project_site",
  broker: "corporate_office",
  sales_team: "corporate_office",
};

/**
 * Optional questions a link may ask.
 *
 * Deliberately small, and every entry maps to a real column. A QR taped to a
 * gate should ask for almost nothing — each extra field measurably costs
 * completions — so the admin opts in per channel rather than getting all of it.
 */
export const WALK_IN_LINK_EXTRA_FIELDS = [
  "email",
  "city",
  "preferredLanguage",
  "configurations",
  "accompanying",
  "intent",
  "notes",
] as const;

export type WalkInLinkExtraField = (typeof WALK_IN_LINK_EXTRA_FIELDS)[number];

export const WALK_IN_LINK_EXTRA_FIELD_LABELS: Record<WalkInLinkExtraField, string> = {
  email: "Email address",
  city: "City",
  preferredLanguage: "Preferred language",
  configurations: "Configurations of interest",
  accompanying: "How many people are with them",
  intent: "Self-rated interest",
  notes: "Anything else",
};

export function isExtraField(value: string): value is WalkInLinkExtraField {
  return (WALK_IN_LINK_EXTRA_FIELDS as readonly string[]).includes(value);
}

export function walkInLinkPath(slug: string): string {
  return `/w/${slug}`;
}
