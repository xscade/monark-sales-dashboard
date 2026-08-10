import { getDb } from "@monark/db";
import { sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { Card, DataTable, EmptyState, SubmitButton, Td, Th } from "@/components/ui";
import { formatRelative } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Toggle a destination's enabled / dry-run state.
 *
 * Enabling a destination is the single most consequential switch in the
 * product: a conversion cannot be retracted once a platform records it, and a
 * week of malformed events degrades Smart Bidding for longer than it takes to
 * notice. Hence the confirmation copy and the deliberate ordering — verify
 * payloads in dry run first, then enable.
 */
async function updateDestination(formData: FormData) {
  "use server";
  const user = await requirePermission("settings:write");
  const id = String(formData.get("id"));
  const field = String(formData.get("field"));
  const value = String(formData.get("value")) === "true";

  if (field !== "is_enabled" && field !== "dry_run") throw new Error("Unknown field");

  const db = getDb();
  await db.execute(
    field === "is_enabled"
      ? sql`UPDATE conversion_destinations SET is_enabled = ${value}, updated_at = now()
            WHERE id = ${id} AND org_id = ${user.orgId}`
      : sql`UPDATE conversion_destinations SET dry_run = ${value}, updated_at = now()
            WHERE id = ${id} AND org_id = ${user.orgId}`,
  );

  await db.execute(sql`
    INSERT INTO audit_logs (id, org_id, actor_user_id, actor_type, action, entity_type, entity_id, after)
    VALUES (gen_random_uuid(), ${user.orgId}, ${user.id}, 'user',
            ${`destination.${field}_changed`}, 'conversion_destination', ${id},
            ${JSON.stringify({ [field]: value })}::jsonb)
  `);

  revalidatePath("/settings");
  revalidatePath("/conversions");
}

export default async function SettingsPage() {
  const user = await requirePermission("settings:write");
  const db = getDb();

  const [keysRes, destRes, projectsRes] = await Promise.all([
    db.execute(sql`
      SELECT id, name, key_prefix AS "keyPrefix", scopes, last_used_at AS "lastUsedAt",
             revoked_at AS "revokedAt", created_at AS "createdAt"
      FROM api_keys WHERE org_id = ${user.orgId} ORDER BY created_at DESC
    `),
    db.execute(sql`
      SELECT id, platform::text AS platform, name, is_enabled AS "isEnabled",
             dry_run AS "dryRun", config
      FROM conversion_destinations WHERE org_id = ${user.orgId} ORDER BY platform
    `),
    db.execute(sql`
      SELECT id, name, city, rera_number AS "reraNumber", avg_sale_value AS "avgSaleValue"
      FROM projects WHERE org_id = ${user.orgId} ORDER BY name
    `),
  ]);

  const keys = keysRes.rows as any[];
  const destinations = destRes.rows as any[];
  const projects = projectsRes.rows as any[];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="mt-0.5 text-sm text-zinc-500">Integrations, API access and projects</p>
      </div>

      <Card
        title="Conversion destinations"
        subtitle="Verify payloads in dry run before enabling — a sent conversion cannot be retracted"
      >
        {destinations.length === 0 ? (
          <EmptyState title="No destinations" hint="Run pnpm db:seed to create them." />
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {destinations.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div>
                  <p className="text-sm font-medium">{d.name}</p>
                  <p className="text-xs text-zinc-500">{d.platform}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <form action={updateDestination}>
                    <input type="hidden" name="id" value={d.id} />
                    <input type="hidden" name="field" value="dry_run" />
                    <input type="hidden" name="value" value={String(!d.dryRun)} />
                    <SubmitButton variant="secondary">
                      {d.dryRun ? "Dry run — go live" : "Live — switch to dry run"}
                    </SubmitButton>
                  </form>
                  <form action={updateDestination}>
                    <input type="hidden" name="id" value={d.id} />
                    <input type="hidden" name="field" value="is_enabled" />
                    <input type="hidden" name="value" value={String(!d.isEnabled)} />
                    <SubmitButton variant={d.isEnabled ? "danger" : "primary"}>
                      {d.isEnabled ? "Disable" : "Enable"}
                    </SubmitButton>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="API keys" subtitle="Used by the website and any agency posting to /v1/leads">
        {keys.length === 0 ? (
          <EmptyState title="No API keys" hint="Created by the seed script; the secret is shown once." />
        ) : (
          <DataTable>
            <thead className="border-b border-zinc-100 dark:border-zinc-800">
              <tr>
                <Th>Name</Th>
                <Th>Prefix</Th>
                <Th>Scopes</Th>
                <Th>Last used</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {keys.map((k) => (
                <tr key={k.id}>
                  <Td className="font-medium">{k.name}</Td>
                  {/* Only the prefix is ever stored — the secret is hashed. */}
                  <Td className="tabular text-xs text-zinc-500">{k.keyPrefix}…</Td>
                  <Td className="text-xs text-zinc-500">{(k.scopes ?? []).join(", ")}</Td>
                  <Td className="text-xs text-zinc-500">{formatRelative(k.lastUsedAt)}</Td>
                  <Td>
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs ${
                        k.revokedAt
                          ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
                          : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                      }`}
                    >
                      {k.revokedAt ? "Revoked" : "Active"}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Card>

      <Card title="Projects">
        {projects.length === 0 ? (
          <EmptyState title="No projects" />
        ) : (
          <DataTable>
            <thead className="border-b border-zinc-100 dark:border-zinc-800">
              <tr>
                <Th>Project</Th>
                <Th>City</Th>
                <Th>RERA</Th>
                <Th className="text-right">Avg sale value</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {projects.map((p) => (
                <tr key={p.id}>
                  <Td className="font-medium">{p.name}</Td>
                  <Td className="text-zinc-500">{p.city ?? "—"}</Td>
                  <Td className="tabular text-xs text-zinc-500">{p.reraNumber ?? "—"}</Td>
                  {/* Feeds the conversion value model: expected value =
                      P(booking | stage) × this. */}
                  <Td className="tabular text-right">
                    {p.avgSaleValue ? `₹${Number(p.avgSaleValue).toLocaleString("en-IN")}` : "—"}
                  </Td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Card>
    </div>
  );
}
