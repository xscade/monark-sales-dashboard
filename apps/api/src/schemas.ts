import { z } from "zod";

/**
 * Public ingestion contract.
 *
 * snake_case because this is consumed by web developers and agencies, not by
 * our own TypeScript. Deliberately permissive about *shape* and strict about
 * *meaning*: unknown fields are kept in rawPayload rather than rejected, so a
 * website adding a new hidden field never breaks lead capture at 2am.
 *
 * The one thing that IS strict: at least one contactable identifier. A lead we
 * cannot call, message, or match against an ad platform is not a lead.
 */
export const LeadIngestSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    phone: z.string().trim().max(32).optional(),
    email: z.string().trim().max(320).optional(),
    city: z.string().trim().max(120).optional(),
    state: z.string().trim().max(120).optional(),
    postal_code: z.string().trim().max(20).optional(),

    source: z
      .enum([
        "website_form",
        "landing_page",
        "meta_lead_ad",
        "google_lead_form",
        "whatsapp",
        "phone_call",
        "walk_in",
        "referral",
        "influencer",
        "broker",
        "csv_import",
        "manual_entry",
        "portal",
        "other",
      ])
      .default("website_form"),
    source_detail: z.string().trim().max(200).optional(),
    project_id: z.string().uuid().optional(),

    utm_source: z.string().trim().max(200).optional(),
    utm_medium: z.string().trim().max(200).optional(),
    utm_campaign: z.string().trim().max(300).optional(),
    utm_content: z.string().trim().max(300).optional(),
    utm_term: z.string().trim().max(300).optional(),
    utm_id: z.string().trim().max(200).optional(),

    // Click identifiers. Capture-or-lose-forever — there is no way to recover
    // these after the request that carried them.
    gclid: z.string().trim().max(500).optional(),
    gbraid: z.string().trim().max(500).optional(),
    wbraid: z.string().trim().max(500).optional(),
    fbclid: z.string().trim().max(500).optional(),
    fbp: z.string().trim().max(200).optional(),
    fbc: z.string().trim().max(500).optional(),
    ctwa_clid: z.string().trim().max(500).optional(),
    meta_lead_id: z.string().trim().max(100).optional(),
    msclkid: z.string().trim().max(500).optional(),
    li_fat_id: z.string().trim().max(200).optional(),

    /**
     * Browser-generated id, shared with the Meta Pixel's client-side Lead
     * event. Without it the Pixel and this server event are counted as two
     * separate conversions for the same enquiry.
     */
    event_id: z.string().trim().max(120).optional(),

    landing_page: z.string().trim().max(2000).optional(),
    referrer: z.string().trim().max(2000).optional(),
    clicked_at: z.string().datetime().optional(),
    occurred_at: z.string().datetime().optional(),

    consent: z
      .object({
        marketing: z.boolean().optional(),
        ad_user_data: z.boolean().optional(),
        ad_personalization: z.boolean().optional(),
        policy_version: z.string().max(50).optional(),
        collected_via: z.string().max(300).optional(),
      })
      .optional(),

    external_id: z.string().trim().max(200).optional(),
    notes: z.string().trim().max(5000).optional(),
    time_on_page_seconds: z.number().int().nonnegative().max(86_400).optional(),
  })
  .passthrough()
  .refine((data) => Boolean(data.phone || data.email || data.meta_lead_id), {
    message: "At least one of phone, email, or meta_lead_id is required",
    path: ["phone"],
  });

export type LeadIngestInput = z.infer<typeof LeadIngestSchema>;
