import Link from "next/link";
import { Card, DataTable, EmptyState, Td, Th } from "@/components/ui";
import { getAdminApiData } from "@/lib/admin-queries";
import { formatRelative } from "@/lib/format";
import { ApiKeyCreateForm } from "./api-key-form";
import { RevokeKeyForm } from "./revoke-key-form";
import { SettingsFlash } from "../settings-flash";

export const dynamic = "force-dynamic";

export default async function ApiSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const messages = await searchParams;
  const { keys, activeProjects } = await getAdminApiData();

  return (
    <div className="space-y-5">
      <div>
        <Link href="/settings" className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
          ← Settings
        </Link>
        <h2 className="mt-2 text-xl font-semibold">API access</h2>
        <p className="mt-0.5 text-sm text-zinc-500">
          Secure inbound lead ingestion at <code>/v1/leads</code>
        </p>
      </div>

      <SettingsFlash notice={messages.notice} error={messages.error} />

      <Card
        title="Create API key"
        subtitle="Choose bearer-only browser access or mandatory HMAC signing for a server integration."
      >
        <ApiKeyCreateForm projects={activeProjects} />
      </Card>

      <Card title="Existing keys" subtitle="Revocation is immediate and cannot be undone">
        {keys.length === 0 ? (
          <EmptyState title="No API keys" hint="Create a scoped key above." />
        ) : (
          <DataTable>
            <thead className="border-b border-zinc-100 dark:border-zinc-800">
              <tr>
                <Th>Name</Th>
                <Th>Prefix</Th>
                <Th>Project scope</Th>
                <Th>Policy</Th>
                <Th>Rate limit</Th>
                <Th>Last used</Th>
                <Th>Status</Th>
                <Th className="text-right">Action</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {keys.map((key) => (
                <tr key={key.id}>
                  <Td className="font-medium">
                    <p>{key.name}</p>
                    <p className="mt-0.5 text-[11px] font-normal text-zinc-400">
                      {(key.scopes ?? []).join(", ")}
                    </p>
                  </Td>
                  <Td className="font-mono text-xs text-zinc-500">{key.keyPrefix}…</Td>
                  <Td className="text-xs text-zinc-500">{key.projectName ?? "All projects"}</Td>
                  <Td>
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs ${
                        key.signatureRequired
                          ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
                          : "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300"
                      }`}
                    >
                      {key.signatureRequired ? "Server · signed" : "Browser · bearer"}
                    </span>
                  </Td>
                  <Td className="tabular text-xs text-zinc-500">
                    {key.rateLimitPerMinute}/min
                  </Td>
                  <Td className="text-xs text-zinc-500">{formatRelative(key.lastUsedAt)}</Td>
                  <Td>
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs ${
                        key.revokedAt
                          ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
                          : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                      }`}
                    >
                      {key.revokedAt ? "Revoked" : "Active"}
                    </span>
                  </Td>
                  <Td className="text-right">
                    {key.revokedAt ? (
                      <span className="text-xs text-zinc-400">—</span>
                    ) : (
                      <div className="flex justify-end">
                        <RevokeKeyForm id={key.id} name={key.name} />
                      </div>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Card>

      <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-xs leading-5 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
        Send every key as <code>Authorization: Bearer &lt;key&gt;</code>. Server-policy keys must also
        sign the exact request body with the one-time HMAC secret; unsigned requests are rejected.
        Send <code>X-Monark-Signature: t=&lt;unix&gt;,v1=&lt;hex&gt;</code>, where the hex value is
        HMAC-SHA256 of <code>t + &quot;.&quot; + rawBody</code>. Browser keys cannot keep secrets
        confidential, so use strict project scope and rate limits.
      </div>
    </div>
  );
}
