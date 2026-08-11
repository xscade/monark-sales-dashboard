import Link from "next/link";
import { AccessMatrix } from "@/components/access-matrix";
import { Card, EmptyState, SubmitButton } from "@/components/ui";
import { inviteUser, setUserActive, updateUser } from "@/lib/admin-actions";
import { getAdminUsers } from "@/lib/admin-queries";
import { USER_ROLES } from "@/lib/admin-validation";
import { formatRelative } from "@/lib/format";
import { ROLE_TYPE_LABELS, roleLabel, type RoleType, type UserRole } from "@/lib/permissions";
import { SettingsFlash } from "../settings-flash";

export const dynamic = "force-dynamic";

const fieldClass =
  "mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-zinc-700 dark:bg-zinc-950";

export default async function UsersSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const messages = await searchParams;
  const { currentUserId, rows } = await getAdminUsers();

  return (
    <div className="space-y-5">
      <div>
        <Link href="/settings" className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
          ← Settings
        </Link>
        <h2 className="mt-2 text-xl font-semibold">Users</h2>
        <p className="mt-0.5 text-sm text-zinc-500">
          Manage CRM permissions, routing languages and lead capacity
        </p>
      </div>

      <SettingsFlash notice={messages.notice} error={messages.error} />

      <Card title="Invite user" subtitle="Creates CRM access and sends a Supabase password invitation when needed">
        <form action={inviteUser} className="space-y-4 p-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300 lg:col-span-2">Email<input required type="email" name="email" maxLength={254} placeholder="agent@company.com" className={fieldClass} /></label>
            <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300 lg:col-span-2">Name<input required name="name" maxLength={120} placeholder="Agent name" className={fieldClass} /></label>
            <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Role<select name="role" defaultValue="sales_agent" className={fieldClass}>{USER_ROLES.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}</select></label>
            <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Capacity<input required type="number" name="leadCapacity" min={1} max={10000} defaultValue={150} className={fieldClass} /></label>
            <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300 lg:col-span-2">Phone<input name="phone" maxLength={32} className={fieldClass} /></label>
            <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300 lg:col-span-2">Languages<input name="languages" defaultValue="en" placeholder="en, hi, te" className={fieldClass} /></label>
          </div>
          <AccessMatrix idPrefix="invite" role="sales_agent" roleType={null} grants={null} />
          <div className="flex justify-end"><SubmitButton>Create access & invite</SubmitButton></div>
        </form>
      </Card>

      {rows.length === 0 ? (
        <Card>
          <EmptyState title="No CRM users found" />
        </Card>
      ) : (
        <div className="space-y-4">
          {rows.map((user) => {
            const isCurrentUser = user.id === currentUserId;
            return (
              <Card key={user.id}>
                <div className="p-5">
                  <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-sm font-semibold">{user.name}</h2>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                            user.isActive
                              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                              : "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
                          }`}
                        >
                          {user.isActive ? "Active" : "Inactive"}
                        </span>
                        {isCurrentUser && (
                          <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                            Current session
                          </span>
                        )}
                        {user.roleType && (
                          <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[11px] font-medium text-sky-700 dark:bg-sky-950 dark:text-sky-300">
                            {ROLE_TYPE_LABELS[user.roleType as RoleType]}
                          </span>
                        )}
                        {user.permissions && (
                          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                            Custom access
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-zinc-500">{user.email}</p>
                      <p className="mt-0.5 text-[11px] text-zinc-400">
                        Last seen {formatRelative(user.lastSeenAt)}
                      </p>
                    </div>

                    {isCurrentUser ? (
                      <span className="text-xs text-zinc-400">Self-deactivation is blocked</span>
                    ) : (
                      <form action={setUserActive}>
                        <input type="hidden" name="id" value={user.id} />
                        <input type="hidden" name="isActive" value={String(!user.isActive)} />
                        <SubmitButton variant={user.isActive ? "danger" : "secondary"}>
                          {user.isActive ? "Deactivate" : "Reactivate"}
                        </SubmitButton>
                      </form>
                    )}
                  </div>

                  <form action={updateUser} className="space-y-4">
                    <input type="hidden" name="id" value={user.id} />
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                      <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300 lg:col-span-2">
                        Display name
                        <input
                          required
                          name="name"
                          maxLength={120}
                          defaultValue={user.name}
                          className={fieldClass}
                        />
                      </label>
                      <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
                        Phone
                        <input
                          name="phone"
                          maxLength={32}
                          defaultValue={user.phone ?? ""}
                          className={fieldClass}
                        />
                      </label>
                      <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
                        Role
                        {isCurrentUser && <input type="hidden" name="role" value={user.role} />}
                        <select
                          name="role"
                          defaultValue={user.role}
                          disabled={isCurrentUser}
                          className={fieldClass}
                        >
                          {USER_ROLES.map((role) => (
                            <option key={role} value={role}>
                              {roleLabel(role)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
                        Lead capacity
                        <input
                          required
                          type="number"
                          name="leadCapacity"
                          min={1}
                          max={10_000}
                          defaultValue={user.leadCapacity}
                          className={fieldClass}
                        />
                      </label>
                    </div>
                    <label className="block max-w-md text-xs font-medium text-zinc-600 dark:text-zinc-300">
                      Routing languages
                      <input
                        name="languages"
                        maxLength={200}
                        defaultValue={user.languages.join(", ")}
                        placeholder="en, hi, te"
                        className={fieldClass}
                      />
                      <span className="mt-1 block font-normal text-zinc-400">
                        Comma-separated language codes
                      </span>
                    </label>

                    <AccessMatrix
                      idPrefix={user.id}
                      role={user.role as UserRole}
                      roleType={user.roleType as RoleType | null}
                      grants={user.permissions}
                      defaultOpen={Boolean(user.permissions || user.roleType)}
                    />

                    <div className="flex justify-end">
                      <SubmitButton>Save user</SubmitButton>
                    </div>
                  </form>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
