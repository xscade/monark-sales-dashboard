import Link from "next/link";
import { Card, EmptyState, SubmitButton } from "@/components/ui";
import { createProject, setProjectActive, updateProject } from "@/lib/admin-actions";
import { getAdminProjects } from "@/lib/admin-queries";
import { SettingsFlash } from "../settings-flash";

export const dynamic = "force-dynamic";

const fieldClass =
  "mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-zinc-700 dark:bg-zinc-950";

export default async function ProjectsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const messages = await searchParams;
  const projects = await getAdminProjects();

  return (
    <div className="space-y-5">
      <div>
        <Link href="/settings" className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
          ← Settings
        </Link>
        <h1 className="mt-2 text-xl font-semibold">Projects</h1>
        <p className="mt-0.5 text-sm text-zinc-500">
          Manage project identity and the values used in conversion modelling
        </p>
      </div>

      <SettingsFlash notice={messages.notice} error={messages.error} />

      <Card
        title="Add project"
        subtitle="The slug is used by integrations. Leave it blank to derive it from the name."
      >
        <form action={createProject} className="space-y-4 p-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
              Project name
              <input required name="name" maxLength={160} className={fieldClass} />
            </label>
            <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
              Slug
              <input name="slug" maxLength={80} placeholder="windwave" className={fieldClass} />
            </label>
            <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
              City
              <input name="city" maxLength={120} className={fieldClass} />
            </label>
            <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
              RERA number
              <input name="reraNumber" maxLength={100} className={fieldClass} />
            </label>
            <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
              Average sale value (INR)
              <input
                name="avgSaleValue"
                inputMode="decimal"
                placeholder="32000000"
                className={fieldClass}
              />
            </label>
          </div>
          <div className="flex justify-end">
            <SubmitButton>Create project</SubmitButton>
          </div>
        </form>
      </Card>

      {projects.length === 0 ? (
        <Card>
          <EmptyState title="No projects configured" />
        </Card>
      ) : (
        <div className="space-y-4">
          {projects.map((project) => (
            <Card key={project.id}>
              <div className="p-5">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-sm font-semibold">{project.name}</h2>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                          project.isActive
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                            : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                        }`}
                      >
                        {project.isActive ? "Active" : "Inactive"}
                      </span>
                    </div>
                    <p className="mt-1 font-mono text-xs text-zinc-500">{project.slug}</p>
                  </div>
                  <form action={setProjectActive}>
                    <input type="hidden" name="id" value={project.id} />
                    <input type="hidden" name="isActive" value={String(!project.isActive)} />
                    <SubmitButton variant={project.isActive ? "danger" : "secondary"}>
                      {project.isActive ? "Deactivate" : "Reactivate"}
                    </SubmitButton>
                  </form>
                </div>

                <form action={updateProject} className="space-y-4">
                  <input type="hidden" name="id" value={project.id} />
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                    <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
                      Project name
                      <input
                        required
                        name="name"
                        maxLength={160}
                        defaultValue={project.name}
                        className={fieldClass}
                      />
                    </label>
                    <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
                      Slug
                      <input
                        required
                        name="slug"
                        maxLength={80}
                        defaultValue={project.slug}
                        className={fieldClass}
                      />
                    </label>
                    <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
                      City
                      <input
                        name="city"
                        maxLength={120}
                        defaultValue={project.city ?? ""}
                        className={fieldClass}
                      />
                    </label>
                    <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
                      RERA number
                      <input
                        name="reraNumber"
                        maxLength={100}
                        defaultValue={project.reraNumber ?? ""}
                        className={fieldClass}
                      />
                    </label>
                    <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
                      Average sale value (INR)
                      <input
                        name="avgSaleValue"
                        inputMode="decimal"
                        defaultValue={project.avgSaleValue ?? ""}
                        className={fieldClass}
                      />
                    </label>
                  </div>
                  <div className="flex justify-end">
                    <SubmitButton>Save project</SubmitButton>
                  </div>
                </form>
              </div>
            </Card>
          ))}
        </div>
      )}

      <p className="text-xs leading-5 text-zinc-500">
        Deactivation is reversible and preserves historical leads, API-key scope and conversion
        records. Projects are never hard-deleted from this screen.
      </p>
    </div>
  );
}
