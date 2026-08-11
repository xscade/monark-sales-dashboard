"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  actionLabel,
  CRUD_ACTIONS,
  groupedModules,
  grantsToTokens,
  ROLE_DEFAULT_GRANTS,
  ROLE_TYPE_GRANTS,
  ROLE_TYPE_HINTS,
  ROLE_TYPE_LABELS,
  ROLE_TYPES,
  type AccessGrants,
  type CrudAction,
  type RoleType,
  type UserRole,
} from "@/lib/permissions";

interface AccessMatrixProps {
  /** Unique per rendered form; several of these share one page. */
  idPrefix: string;
  /** Role selected when the form rendered. Kept in sync with the role select. */
  role: UserRole;
  roleType: RoleType | null;
  /** Stored grid, or null when the user follows role defaults. */
  grants: AccessGrants | null;
  /** Open on load — used when a user already has custom access to show. */
  defaultOpen?: boolean;
}

const selectClass =
  "mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-zinc-700 dark:bg-zinc-950";

function tokensOf(granted: AccessGrants): Set<string> {
  return new Set(grantsToTokens(granted));
}

/**
 * The Advanced access panel: role type, plus a module × CRUD grid.
 *
 * Two things are deliberately separated here. "Use role defaults" stores
 * nothing, so the user keeps tracking whatever the role means over time.
 * "Customise" freezes an explicit answer. Showing the defaults greyed out in
 * the first mode means an admin can always see what they are choosing between
 * rather than having to remember what "Sales manager" grants.
 */
export function AccessMatrix({ idPrefix, role, roleType, grants, defaultOpen }: AccessMatrixProps) {
  const container = useRef<HTMLDivElement>(null);
  const [currentRole, setCurrentRole] = useState<UserRole>(role);
  const [mode, setMode] = useState<"role" | "custom">(grants ? "custom" : "role");
  const [selectedRoleType, setSelectedRoleType] = useState<RoleType | "">(roleType ?? "");
  const [selected, setSelected] = useState<Set<string>>(() =>
    tokensOf(grants ?? ROLE_DEFAULT_GRANTS[role]),
  );

  // The role lives in a sibling field of the same form. Following it keeps the
  // greyed-out preview honest instead of showing the role the page loaded with.
  useEffect(() => {
    const form = container.current?.closest("form");
    const field = form?.querySelector<HTMLSelectElement>('select[name="role"]');
    if (!field) return;
    const sync = () => setCurrentRole(field.value as UserRole);
    field.addEventListener("change", sync);
    return () => field.removeEventListener("change", sync);
  }, []);

  const roleDefaults = useMemo(
    () => tokensOf(ROLE_DEFAULT_GRANTS[currentRole] ?? {}),
    [currentRole],
  );
  const roleTypeLocked = useMemo(
    () => (selectedRoleType ? tokensOf(ROLE_TYPE_GRANTS[selectedRoleType]) : new Set<string>()),
    [selectedRoleType],
  );

  // Owners are never restricted — the gate ignores their grid, so offering one
  // would be a control that silently does nothing.
  const ownerAll = currentRole === "owner";
  const editable = mode === "custom" && !ownerAll;
  const shown = editable ? selected : roleDefaults;

  function toggle(token: string, checked: boolean) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (checked) next.add(token);
      else next.delete(token);
      return next;
    });
  }

  function chooseMode(next: "role" | "custom") {
    // Switching into custom mode starts from what the role already grants, so
    // the admin edits a working set rather than a blank grid.
    if (next === "custom" && mode === "role") setSelected(new Set(roleDefaults));
    setMode(next);
  }

  return (
    <div ref={container} className="rounded-lg border border-zinc-200 dark:border-zinc-800">
      <input type="hidden" name="accessMode" value={ownerAll ? "role" : mode} />

      <details open={defaultOpen} className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-xs font-semibold text-zinc-700 dark:text-zinc-200">
          <span className="flex items-center gap-2">
            <span aria-hidden="true" className="text-zinc-400 transition group-open:rotate-90">
              ›
            </span>
            Advanced
            <span className="font-normal text-zinc-500">
              {ownerAll
                ? "Owners always hold full access"
                : mode === "custom"
                  ? `Custom · ${selected.size} permission${selected.size === 1 ? "" : "s"}`
                  : "Role defaults"}
              {selectedRoleType ? ` · ${ROLE_TYPE_LABELS[selectedRoleType]}` : ""}
            </span>
          </span>
        </summary>

        <div className="space-y-4 border-t border-zinc-100 px-4 py-4 dark:border-zinc-800">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
              Role type
              <select
                name="roleType"
                value={selectedRoleType}
                onChange={(event) => setSelectedRoleType(event.target.value as RoleType | "")}
                className={selectClass}
              >
                <option value="">None — sales org only</option>
                {ROLE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {ROLE_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
              <span className="mt-1 block font-normal leading-relaxed text-zinc-500">
                {selectedRoleType
                  ? ROLE_TYPE_HINTS[selectedRoleType]
                  : "A specialist back-office workflow, layered on top of the base role."}
              </span>
            </label>

            <fieldset className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
              <legend className="mb-1">Page access</legend>
              <div className="space-y-1.5">
                {(
                  [
                    ["role", "Follow role defaults", "Tracks the role as it changes."],
                    ["custom", "Customise per module", "Freezes exactly what is ticked below."],
                  ] as const
                ).map(([value, label, hint]) => (
                  <label key={value} className="flex items-start gap-2 font-normal">
                    <input
                      type="radio"
                      name={`${idPrefix}-access-mode`}
                      checked={(ownerAll ? "role" : mode) === value}
                      disabled={ownerAll}
                      onChange={() => chooseMode(value)}
                      className="mt-0.5"
                    />
                    <span>
                      <span className="font-medium">{label}</span>
                      <span className="block text-zinc-500">{hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-left">
              <thead>
                <tr className="border-b border-zinc-100 dark:border-zinc-800">
                  <th className="py-2 pr-3 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                    Module
                  </th>
                  {CRUD_ACTIONS.map((action) => (
                    <th
                      key={action}
                      className="w-20 py-2 text-center text-[11px] font-medium uppercase tracking-wide text-zinc-500"
                    >
                      {action}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groupedModules().map((group) => (
                  <Fragment key={group.group}>
                    <tr>
                      <td
                        colSpan={CRUD_ACTIONS.length + 1}
                        className="pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-400"
                      >
                        {group.group}
                      </td>
                    </tr>
                    {group.modules.map((module) => (
                      <tr
                        key={module.key}
                        className="border-b border-zinc-50 last:border-0 dark:border-zinc-800/60"
                      >
                        <td className="py-2 pr-3 align-top">
                          <p className="text-sm font-medium">{module.label}</p>
                          <p className="text-[11px] text-zinc-500">
                            {module.pages.map((page) => page.label).join(" · ")}
                          </p>
                        </td>
                        {CRUD_ACTIONS.map((action) => {
                          const supported = module.actions.includes(action as CrudAction);
                          const token = `${module.key}:${action}`;
                          const locked = roleTypeLocked.has(token);
                          const checked = ownerAll || locked || shown.has(token);
                          return (
                            <td key={action} className="py-2 text-center align-middle">
                              {supported ? (
                                <label
                                  className="inline-flex flex-col items-center gap-0.5"
                                  title={
                                    locked
                                      ? `Granted by the ${ROLE_TYPE_LABELS[selectedRoleType as RoleType]} role type`
                                      : actionLabel(module, action as CrudAction)
                                  }
                                >
                                  <input
                                    type="checkbox"
                                    name="access"
                                    value={token}
                                    checked={checked}
                                    disabled={!editable || locked}
                                    onChange={(event) => toggle(token, event.target.checked)}
                                    className="size-4 accent-brand-600"
                                  />
                                  {module.actionLabels?.[action as CrudAction] && (
                                    <span className="text-[10px] leading-none text-zinc-500">
                                      {module.actionLabels[action as CrudAction]}
                                    </span>
                                  )}
                                </label>
                              ) : (
                                <span aria-hidden="true" className="text-zinc-300 dark:text-zinc-700">
                                  —
                                </span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-[11px] leading-relaxed text-zinc-500">
            Overview is always available so nobody signs in to a dead screen. Create, update and
            delete each imply write access to the module; delete is the narrower right that guards
            genuinely destructive actions such as deleting a unit or cancelling a booking.
          </p>
        </div>
      </details>
    </div>
  );
}
