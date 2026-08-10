import Link from "next/link";
import { Card, EmptyState, SubmitButton } from "@/components/ui";
import { updateDestination } from "@/lib/admin-actions";
import { getSettingsOverview } from "@/lib/admin-queries";
import { SettingsFlash } from "./settings-flash";

export const dynamic = "force-dynamic";

const sections = [
  {
    href: "/settings/users",
    title: "Users",
    description: "Roles, routing capacity and account access",
    countKey: "users" as const,
    countLabel: "active users",
  },
  {
    href: "/settings/projects",
    title: "Projects",
    description: "Project identity, RERA details and value modelling",
    countKey: "projects" as const,
    countLabel: "active projects",
  },
  {
    href: "/settings/api",
    title: "API access",
    description: "Create project-scoped ingestion keys and revoke access",
    countKey: "apiKeys" as const,
    countLabel: "active keys",
  },
  {
    href: "/settings/sources",
    title: "Lead sources",
    description: "Website endpoint, tracking snippet and source health",
    countKey: null,
    countLabel: "capture settings",
  },
  {
    href: "/settings/integrations",
    title: "Meta & Google",
    description: "Credentials, destination configuration and event mappings",
    countKey: null,
    countLabel: "integration settings",
  },
];

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const messages = await searchParams;
  const { counts, destinations } = await getSettingsOverview();

  return (
    <div className="space-y-5">
      <div>
        <p className="mt-0.5 text-sm text-zinc-500">
          Manage organisation access, projects and external data flows
        </p>
      </div>

      <SettingsFlash notice={messages.notice} error={messages.error} />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {sections.map((section) => (
          <Link
            key={section.href}
            href={section.href}
            className="rounded-xl border border-zinc-200 bg-white p-5 transition hover:border-brand-400 hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">{section.title}</h2>
                <p className="mt-1 text-xs leading-5 text-zinc-500">{section.description}</p>
              </div>
              <span aria-hidden="true" className="text-zinc-400">
                →
              </span>
            </div>
            <p className="mt-5 text-xs text-zinc-500">
              <span className="tabular text-base font-semibold text-zinc-900 dark:text-zinc-100">
                {section.countKey ? counts[section.countKey] : "Configure"}
              </span>{" "}
              {section.countLabel}
            </p>
          </Link>
        ))}
      </div>

      <Card
        title="Conversion destinations"
        subtitle="Validate payloads in dry run before going live. Sent conversions cannot be retracted."
      >
        {destinations.length === 0 ? (
          <EmptyState title="No destinations configured" />
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {destinations.map((destination) => (
              <li
                key={destination.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
              >
                <div>
                  <p className="text-sm font-medium">{destination.name}</p>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    {destination.platform.replace(/_/g, " ")} ·{" "}
                    {destination.isEnabled ? "enabled" : "disabled"} ·{" "}
                    {destination.dryRun ? "dry run" : "live delivery"}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <form action={updateDestination}>
                    <input type="hidden" name="id" value={destination.id} />
                    <input type="hidden" name="field" value="dry_run" />
                    <input type="hidden" name="value" value={String(!destination.dryRun)} />
                    {destination.dryRun && (
                      <label className="mb-2 flex max-w-56 items-start gap-2 text-xs text-zinc-500">
                        <input required type="checkbox" name="confirmation" value="confirmed" className="mt-0.5" />
                        I understand live conversions cannot be retracted.
                      </label>
                    )}
                    <SubmitButton variant="secondary">
                      {destination.dryRun ? "Switch to live" : "Switch to dry run"}
                    </SubmitButton>
                  </form>
                  <form action={updateDestination}>
                    <input type="hidden" name="id" value={destination.id} />
                    <input type="hidden" name="field" value="is_enabled" />
                    <input type="hidden" name="value" value={String(!destination.isEnabled)} />
                    {!destination.isEnabled && (
                      <label className="mb-2 flex max-w-56 items-start gap-2 text-xs text-zinc-500">
                        <input required type="checkbox" name="confirmation" value="confirmed" className="mt-0.5" />
                        Config, credentials and mappings are ready.
                      </label>
                    )}
                    <SubmitButton variant={destination.isEnabled ? "danger" : "primary"}>
                      {destination.isEnabled ? "Disable" : "Enable"}
                    </SubmitButton>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p className="text-xs leading-5 text-zinc-500">
        Destination state changes are audited here. Credentials and event mappings are managed in
        Meta & Google integrations and are never returned after replacement.
      </p>
    </div>
  );
}
