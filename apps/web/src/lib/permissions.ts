/**
 * The access model: modules, CRUD actions, and how the two become permissions.
 *
 * There are two ways a person can be granted access. A *role* is a shorthand —
 * "sales agent" implies a well-understood bundle. A *grant* is the explicit
 * per-module answer an admin ticks in Settings → Users. Roles produce grants
 * (see ROLE_DEFAULT_GRANTS), custom grants replace them wholesale, and
 * everything downstream reads the resulting permission set. One shape, one
 * derivation, so there is never a second opinion about what someone may do.
 *
 * Deliberately kept free of database and Next.js imports: `auth.ts` needs this
 * file, and this file must stay importable from a plain unit test.
 */

export const CRUD_ACTIONS = ["read", "create", "update", "delete"] as const;
export type CrudAction = (typeof CRUD_ACTIONS)[number];

export const USER_ROLES = [
  "owner",
  "admin",
  "marketing",
  "sales_manager",
  "sales_agent",
  "receptionist",
  "read_only",
] as const;
export type UserRole = (typeof USER_ROLES)[number];

/**
 * Specialist overlay on top of the base role.
 *
 * Only `accountant` for now; the dropdown is built from this list, so adding a
 * second one later is a single entry plus its preset.
 */
export const ROLE_TYPES = ["accountant"] as const;
export type RoleType = (typeof ROLE_TYPES)[number];

export const ROLE_TYPE_LABELS: Record<RoleType, string> = {
  accountant: "Accountant",
};

export const ROLE_TYPE_HINTS: Record<RoleType, string> = {
  accountant:
    "Opens the Accounts verification queue: every booking amount is confirmed or flagged as no match against the bank.",
};

export type ModuleKey =
  | "leads"
  | "customers"
  | "tasks"
  | "visits"
  | "inventory"
  | "bookings"
  | "accounts"
  | "campaigns"
  | "conversions"
  | "reports"
  | "settings";

export type Permission =
  | `${ModuleKey}:${"read" | "create" | "update" | "delete" | "write"}`
  | "leads:assign"
  | "accounts:verify";

export interface AccessModule {
  key: ModuleKey;
  /** Namespace the permission keys are built from. Matches `key` today; kept
   *  separate so a module can be renamed in the UI without rewriting grants. */
  namespace: ModuleKey;
  label: string;
  hint: string;
  /** Sidebar section this module lives under, so the grid reads like the nav. */
  group: string;
  /** Navigation entries this module unlocks. */
  pages: { href: string; label: string }[];
  /** Only the actions the module genuinely supports. A module with nothing
   *  deletable does not get a decorative Delete checkbox. */
  actions: CrudAction[];
  /** Wording where "create/update/delete" is not what the business calls it. */
  actionLabels?: Partial<Record<CrudAction, string>>;
  /** Permissions this action grants beyond the derived namespace keys. */
  extra?: Partial<Record<CrudAction, Permission[]>>;
}

/**
 * The module registry, ordered and grouped to mirror the sidebar.
 *
 * Every entry maps to exactly one permission namespace. That one-to-one rule is
 * what stops "grant Today" from quietly also granting Follow-ups — pages that
 * share a namespace are listed together in one module instead.
 */
export const ACCESS_MODULES: AccessModule[] = [
  {
    key: "leads",
    namespace: "leads",
    label: "Leads & pipeline",
    hint: "Enquiries, stages and ownership",
    group: "Sales",
    pages: [
      { href: "/leads", label: "Leads" },
      { href: "/pipeline", label: "Pipeline" },
    ],
    actions: ["read", "create", "update", "delete"],
    actionLabels: { delete: "Disqualify / reassign" },
    // Taking a lead off an agent — by disqualifying it or by handing it to
    // somebody else — is one supervisory right, not two. Riding it on `update`
    // instead would hand every agent who can edit a lead the ability to pull
    // leads off their colleagues.
    extra: { delete: ["leads:assign"] },
  },
  {
    key: "customers",
    namespace: "customers",
    label: "Customers",
    hint: "Booked buyers and the contact book",
    group: "Sales",
    pages: [{ href: "/customers", label: "Customers" }],
    actions: ["read", "create", "update"],
  },
  {
    key: "tasks",
    namespace: "tasks",
    label: "Tasks & follow-ups",
    hint: "The daily work queue",
    group: "Sales",
    pages: [
      { href: "/today", label: "Today" },
      { href: "/follow-ups", label: "Follow-ups" },
      { href: "/tasks", label: "Tasks" },
    ],
    actions: ["read", "create", "update", "delete"],
  },
  {
    key: "visits",
    namespace: "visits",
    label: "Walk-ins & site visits",
    hint: "Front-desk check-in and site tours",
    group: "Field operations",
    pages: [
      { href: "/walk-ins", label: "Walk-ins" },
      { href: "/site-visits", label: "Site visits" },
    ],
    actions: ["read", "create", "update"],
  },
  {
    key: "inventory",
    namespace: "inventory",
    label: "Inventory",
    hint: "Units, pricing and availability",
    group: "Commercial",
    pages: [{ href: "/inventory", label: "Inventory" }],
    actions: ["read", "create", "update", "delete"],
  },
  {
    key: "bookings",
    namespace: "bookings",
    label: "Bookings & payments",
    hint: "The money register: tokens, milestones and receipts",
    group: "Commercial",
    pages: [{ href: "/bookings", label: "Bookings & payments" }],
    actions: ["read", "create", "update", "delete"],
    actionLabels: { delete: "Cancel" },
  },
  {
    key: "accounts",
    namespace: "accounts",
    label: "Accounts verification",
    hint: "Confirm booking amounts against the bank, or flag a no match",
    group: "Commercial",
    pages: [{ href: "/accounts", label: "Accounts" }],
    actions: ["read", "update"],
    actionLabels: { update: "Verify" },
    extra: { update: ["accounts:verify"] },
  },
  {
    key: "campaigns",
    namespace: "campaigns",
    label: "Campaign intelligence",
    hint: "Ad spend and campaign outcomes",
    group: "Intelligence",
    pages: [{ href: "/campaigns", label: "Campaign intelligence" }],
    actions: ["read", "update"],
  },
  {
    key: "conversions",
    namespace: "conversions",
    label: "Conversion sync",
    hint: "Offline events sent to Meta and Google",
    group: "Intelligence",
    pages: [{ href: "/conversions", label: "Conversion sync" }],
    actions: ["read", "update"],
  },
  {
    key: "reports",
    namespace: "reports",
    label: "Reports",
    hint: "Funnel, revenue and validated transactions",
    group: "Intelligence",
    pages: [{ href: "/reports", label: "Reports" }],
    actions: ["read"],
  },
  {
    key: "settings",
    namespace: "settings",
    label: "Settings",
    hint: "Users, projects, API keys and integrations",
    group: "Workspace",
    pages: [{ href: "/settings", label: "Settings" }],
    actions: ["update"],
    actionLabels: { update: "Manage" },
  },
];

export const MODULE_BY_KEY = new Map(ACCESS_MODULES.map((module) => [module.key, module]));

/** Grants keyed by module. A module absent from the map has no access at all. */
export type AccessGrants = Partial<Record<ModuleKey, CrudAction[]>>;

function grants(entries: [ModuleKey, CrudAction[]][]): AccessGrants {
  return Object.fromEntries(entries) as AccessGrants;
}

const FULL_ACCESS: AccessGrants = grants(
  ACCESS_MODULES.map((module) => [module.key, [...module.actions]]),
);

const READ_EVERYWHERE: [ModuleKey, CrudAction[]][] = [
  ["leads", ["read"]],
  ["customers", ["read"]],
  ["tasks", ["read"]],
  ["visits", ["read"]],
  ["inventory", ["read"]],
  ["bookings", ["read"]],
];

/**
 * What each role means, expressed in the same grid an admin edits.
 *
 * These reproduce the role table this app shipped with — `permissions.test.ts`
 * pins them, so a careless edit here shows up as a failing test rather than as
 * a sales agent who can suddenly rotate API keys.
 */
export const ROLE_DEFAULT_GRANTS: Record<UserRole, AccessGrants> = {
  owner: FULL_ACCESS,
  admin: FULL_ACCESS,
  marketing: grants([
    ...READ_EVERYWHERE,
    ["campaigns", ["read", "update"]],
    ["conversions", ["read", "update"]],
    ["reports", ["read"]],
  ]),
  sales_manager: grants([
    ["leads", ["read", "create", "update", "delete"]],
    ["customers", ["read", "create", "update"]],
    ["tasks", ["read", "create", "update", "delete"]],
    ["visits", ["read", "create", "update"]],
    ["inventory", ["read", "create", "update", "delete"]],
    ["bookings", ["read", "create", "update", "delete"]],
    ["campaigns", ["read"]],
    ["reports", ["read"]],
  ]),
  sales_agent: grants([
    ["leads", ["read", "create", "update"]],
    ["customers", ["read", "create", "update"]],
    ["tasks", ["read", "create", "update", "delete"]],
    ["visits", ["read", "create", "update"]],
    ["inventory", ["read"]],
    ["bookings", ["read"]],
  ]),
  receptionist: grants([
    ["leads", ["read", "create", "update"]],
    ["customers", ["read", "create", "update"]],
    ["tasks", ["read", "create", "update", "delete"]],
    ["visits", ["read", "create", "update"]],
    ["inventory", ["read"]],
    ["bookings", ["read"]],
  ]),
  read_only: grants([...READ_EVERYWHERE, ["reports", ["read"]]]),
};

/**
 * What choosing a role type pre-fills in the grid.
 *
 * An accountant needs to see the register they are reconciling and the reports
 * that separate validated money from unvalidated — and nothing else. They get
 * no write access to bookings on purpose: the person confirming that cash
 * arrived must not also be able to edit the amount they are confirming.
 */
export const ROLE_TYPE_GRANTS: Record<RoleType, AccessGrants> = {
  accountant: grants([
    ["accounts", ["read", "update"]],
    ["bookings", ["read"]],
    ["customers", ["read"]],
    ["reports", ["read"]],
  ]),
};


function permissionsForAction(module: AccessModule, action: CrudAction): Permission[] {
  const ns = module.namespace;
  const derived: Permission[] =
    action === "read"
      ? [`${ns}:read`]
      : // create, update and delete each imply the coarse `:write` umbrella that
        // most of this app still gates on, while also emitting their own key so
        // genuinely destructive routes can demand the narrow one.
        [`${ns}:${action}`, `${ns}:write`];
  return [...derived, ...(module.extra?.[action] ?? [])];
}

/** Expand a grid of module grants into the flat permission set the app checks. */
export function permissionsFromGrants(granted: AccessGrants): Set<Permission> {
  const result = new Set<Permission>();
  for (const [key, actions] of Object.entries(granted)) {
    const module = MODULE_BY_KEY.get(key as ModuleKey);
    if (!module) continue;
    for (const action of actions ?? []) {
      if (!module.actions.includes(action)) continue;
      for (const permission of permissionsForAction(module, action)) {
        result.add(permission);
      }
    }
  }
  return result;
}

/**
 * The grants actually in force for a user.
 *
 * Owners are never filtered. Locking the last owner out of Settings would leave
 * an organisation with no way to grant anyone access back, and no support
 * channel exists to undo it — so the override simply does not apply to them.
 *
 * Otherwise a stored grid wins outright. `null` means "never customised"; an
 * empty object is a real, deliberate answer and must not fall back to the role.
 *
 * A role type is then layered on top rather than merged into storage, so its
 * preset stays a live definition: widening what an accountant may do later
 * reaches every accountant, instead of only the ones invited afterwards.
 */
export function effectiveGrants(
  role: UserRole,
  stored: AccessGrants | null | undefined,
  roleType: RoleType | null = null,
): AccessGrants {
  if (role === "owner") return FULL_ACCESS;
  const base = stored ?? ROLE_DEFAULT_GRANTS[role] ?? {};
  if (!roleType) return base;
  return mergeGrants(base, ROLE_TYPE_GRANTS[roleType]);
}

/** Union two grids, preserving registry action order. */
export function mergeGrants(a: AccessGrants, b: AccessGrants): AccessGrants {
  const merged: AccessGrants = {};
  for (const module of ACCESS_MODULES) {
    const actions = new Set([...(a[module.key] ?? []), ...(b[module.key] ?? [])]);
    const ordered = module.actions.filter((action) => actions.has(action));
    if (ordered.length) merged[module.key] = ordered;
  }
  return merged;
}

/** Drop unknown modules and unsupported actions, and put both back in registry
 *  order so stored grids stay comparable and readable in an audit log. */
export function normalizeGrants(input: unknown): AccessGrants {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const source = input as Record<string, unknown>;
  const result: AccessGrants = {};
  for (const module of ACCESS_MODULES) {
    const raw = source[module.key];
    if (!Array.isArray(raw)) continue;
    const actions = module.actions.filter((action) => raw.includes(action));
    if (actions.length) result[module.key] = actions;
  }
  return result;
}

/**
 * Read a grid back from checkbox values of the form `bookings:read`.
 *
 * Checkboxes rather than a JSON blob because the matrix then submits correctly
 * with no client JavaScript at all, which is exactly the wrong screen to make
 * dependent on a hydrated bundle.
 */
export function grantsFromTokens(tokens: readonly string[]): AccessGrants {
  const collected: Record<string, string[]> = {};
  for (const token of tokens) {
    const [key, action] = String(token).split(":");
    if (!key || !action) continue;
    (collected[key] ??= []).push(action);
  }
  return normalizeGrants(collected);
}

export function grantsToTokens(granted: AccessGrants): string[] {
  return ACCESS_MODULES.flatMap((module) =>
    (granted[module.key] ?? []).map((action) => `${module.key}:${action}`),
  );
}

export function hasPermission(
  role: UserRole,
  stored: AccessGrants | null | undefined,
  roleType: RoleType | null,
  permission: Permission,
): boolean {
  return permissionsFromGrants(effectiveGrants(role, stored, roleType)).has(permission);
}

export function roleLabel(role: string): string {
  return role.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function actionLabel(module: AccessModule, action: CrudAction): string {
  return (
    module.actionLabels?.[action] ??
    action.charAt(0).toUpperCase() + action.slice(1)
  );
}

/** Modules grouped for rendering, in sidebar order. */
export function groupedModules(): { group: string; modules: AccessModule[] }[] {
  const groups: { group: string; modules: AccessModule[] }[] = [];
  for (const module of ACCESS_MODULES) {
    const existing = groups.find((entry) => entry.group === module.group);
    if (existing) existing.modules.push(module);
    else groups.push({ group: module.group, modules: [module] });
  }
  return groups;
}
