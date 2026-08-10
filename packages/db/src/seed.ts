import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createCipheriv } from "node:crypto";
import {
  apiKeys,
  closeDb,
  conversionDestinations,
  conversionEventMappings,
  getDb,
  orgs,
  projects,
  units,
  users,
} from "./index";

/**
 * Development seed.
 *
 * Creates Monark, one project, a small sales team, and BOTH conversion
 * destinations in dry-run with sensible event mappings. Nothing here reaches
 * Meta or Google — destinations start disabled and dry-run, which is the only
 * safe default given there is no way to un-send a conversion.
 */

function encrypt(value: Record<string, unknown>): string {
  const raw = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!raw) throw new Error("CREDENTIALS_ENCRYPTION_KEY not set");
  const key = Buffer.from(raw, "base64");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(value), "utf8")),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
}

async function main() {
  // Seeding runs over the session pooler, same as migrations. The transaction
  // pooler would work here too, but keeping schema-adjacent operations on one
  // connection kind means one fewer thing to get wrong.
  const db = getDb("direct");

  const orgId = randomUUID();
  await db.insert(orgs).values({
    id: orgId,
    name: "Monark",
    slug: "monark",
    timezone: "Asia/Kolkata",
    currency: "INR",
  });

  const projectId = randomUUID();
  await db.insert(projects).values({
    id: projectId,
    orgId,
    name: "Monark Windwave",
    slug: "windwave",
    city: "Visakhapatnam",
    // Drives the conversion value model: expected value = P(booking|stage) x this.
    avgSaleValue: "32000000",
  });

  await db.insert(users).values([
    {
      id: randomUUID(),
      orgId,
      email: "owner@monark.in",
      name: "Owner",
      role: "owner",
      languages: ["en", "te", "hi"],
    },
    {
      id: randomUUID(),
      orgId,
      email: "venkat@monark.in",
      name: "Venkat",
      role: "sales_agent",
      languages: ["te", "en"],
    },
    {
      id: randomUUID(),
      orgId,
      email: "priya@monark.in",
      name: "Priya",
      role: "sales_agent",
      languages: ["hi", "en"],
    },
  ]);

  // A handful of units so shortlisting and holds have something to point at.
  await db.insert(units).values(
    [8, 9, 10, 11, 12].flatMap((floor) =>
      ["A", "B"].map((tower) => ({
        id: randomUUID(),
        orgId,
        projectId,
        tower,
        unitNumber: `${tower}-${floor}01`,
        floor,
        configuration: floor > 10 ? "4bhk" : "3bhk",
        saleableAreaSqft: floor > 10 ? "3200" : "2400",
        allInPrice: floor > 10 ? "38000000" : "28000000",
        status: "available" as const,
      })),
    ),
  );

  // ---------------------------------------------------------------
  // API key. The plaintext is printed ONCE and never stored.
  // ---------------------------------------------------------------
  const prefix = `mk_live_${randomBytes(4).toString("hex")}`;
  const secret = randomBytes(24).toString("hex");
  const fullKey = `${prefix}_${secret}`;
  const signingSecret = randomBytes(32).toString("hex");

  await db.insert(apiKeys).values({
    id: randomUUID(),
    orgId,
    name: "Website",
    keyPrefix: prefix,
    keyHash: createHash("sha256").update(fullKey, "utf8").digest("hex"),
    signingSecretEncrypted: encrypt({ secret: signingSecret }),
    scopes: ["leads:write"],
    projectId,
  });

  // ---------------------------------------------------------------
  // Destinations — disabled and dry-run. Deliberately.
  // ---------------------------------------------------------------
  const metaId = randomUUID();
  await db.insert(conversionDestinations).values({
    id: metaId,
    orgId,
    platform: "meta_capi",
    name: "Meta — Windwave dataset",
    isEnabled: false,
    dryRun: true,
    config: { datasetId: "REPLACE_ME", apiVersion: "v21.0" },
    credentialsEncrypted: encrypt({ accessToken: "REPLACE_ME" }),
    projectId,
  });

  const googleId = randomUUID();
  await db.insert(conversionDestinations).values({
    id: googleId,
    orgId,
    platform: "google_data_manager",
    name: "Google — Windwave conversions",
    isEnabled: false,
    dryRun: true,
    config: {
      operatingAccountId: "REPLACE_ME",
      productDestinationId: "REPLACE_ME",
      accountType: "GOOGLE_ADS",
    },
    credentialsEncrypted: encrypt({ client_email: "REPLACE_ME", private_key: "REPLACE_ME" }),
    projectId,
  });

  /**
   * Event mappings.
   *
   * Note what is and is not enabled. Mid-funnel events are on because they
   * reliably occur inside Google's 90-day click window and carry real quality
   * signal. `booking_confirmed` is on for measurement, but it is NOT the event
   * to optimise campaigns against — see docs/attribution-strategy.md.
   */
  await db.insert(conversionEventMappings).values([
    // Meta
    { id: randomUUID(), orgId, destinationId: metaId, eventType: "lead_created", platformEventName: "Lead", valueStrategy: "modelled" },
    { id: randomUUID(), orgId, destinationId: metaId, eventType: "lead_qualified", platformEventName: "QualifiedLead", valueStrategy: "modelled" },
    { id: randomUUID(), orgId, destinationId: metaId, eventType: "visit_scheduled", platformEventName: "Schedule", valueStrategy: "modelled" },
    { id: randomUUID(), orgId, destinationId: metaId, eventType: "walk_in_completed", platformEventName: "MonarkWalkIn", valueStrategy: "modelled" },
    { id: randomUUID(), orgId, destinationId: metaId, eventType: "site_visit_completed", platformEventName: "MonarkSiteVisit", valueStrategy: "modelled" },
    { id: randomUUID(), orgId, destinationId: metaId, eventType: "token_paid", platformEventName: "AddPaymentInfo", valueStrategy: "modelled" },
    { id: randomUUID(), orgId, destinationId: metaId, eventType: "booking_confirmed", platformEventName: "Purchase", valueStrategy: "actual" },

    // Google
    { id: randomUUID(), orgId, destinationId: googleId, eventType: "lead_created", platformEventName: "Lead", valueStrategy: "modelled" },
    { id: randomUUID(), orgId, destinationId: googleId, eventType: "lead_qualified", platformEventName: "Qualified Lead", valueStrategy: "modelled" },
    { id: randomUUID(), orgId, destinationId: googleId, eventType: "site_visit_completed", platformEventName: "Site Visit", valueStrategy: "modelled" },
    { id: randomUUID(), orgId, destinationId: googleId, eventType: "booking_confirmed", platformEventName: "Booking", valueStrategy: "actual" },
  ]);

  console.log(`
Seed complete.

  Org         Monark            ${orgId}
  Project     Monark Windwave   ${projectId}

  API key (shown once, store it now):
    ${fullKey}

  HMAC signing secret:
    ${signingSecret}

Both conversion destinations are DISABLED and in DRY-RUN. Fill in real
credentials, verify payloads in the delivery log, then enable — there is no way
to retract a conversion once a platform has recorded it.
`);

  await closeDb();
}

main().catch(async (err) => {
  console.error(err);
  await closeDb();
  process.exit(1);
});
