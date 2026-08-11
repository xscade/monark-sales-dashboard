import { z } from "zod";
import {
  grantsFromTokens,
  ROLE_TYPES,
  USER_ROLES,
  type AccessGrants,
} from "./permissions";

export { USER_ROLES } from "./permissions";
export type { UserRole } from "./permissions";

const optionalText = (max: number) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z.string().trim().max(max).nullable(),
  );

const optionalUuid = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  z.string().uuid().nullable(),
);

/** Normalize a human-entered project name into a stable URL/API slug. */
export function normalizeProjectSlug(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

/** Parse comma-separated BCP-47-ish language tags, preserving no duplicates. */
export function parseLanguageList(value: string): string[] {
  return [
    ...new Set(
      value
        .split(",")
        .map((language) => language.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

/**
 * The Advanced access grid.
 *
 * `accessMode` decides whether the grid is consulted at all. "role" stores
 * null, meaning "follow this role's defaults, including whatever they become
 * later" — which is what an admin who never opened Advanced expects. "custom"
 * freezes an explicit answer that no future change to the role table can widen.
 */
const accessModeSchema = z.enum(["role", "custom"]).default("role");

const accessTokensSchema = z.preprocess(
  (value) => (Array.isArray(value) ? value : value == null || value === "" ? [] : [value]),
  z.array(z.string().max(80)).max(200),
);

const roleTypeSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  z.enum(ROLE_TYPES).nullable().default(null),
);

const accessFields = {
  accessMode: accessModeSchema,
  access: accessTokensSchema,
  roleType: roleTypeSchema,
};

function languageIssues(
  value: { languages: string[] },
  context: z.RefinementCtx,
): void {
  for (const language of value.languages) {
    if (!/^[a-z]{2,3}(?:-[a-z]{2})?$/.test(language)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["languages"],
        message: `Invalid language tag: ${language}`,
      });
    }
  }
  if (value.languages.length > 10) {
    context.addIssue({
      code: z.ZodIssueCode.too_big,
      maximum: 10,
      inclusive: true,
      type: "array",
      path: ["languages"],
      message: "Choose at most 10 languages",
    });
  }
}

/** Collapse the submitted grid into what actually gets stored. */
function withResolvedAccess<T extends { accessMode: "role" | "custom"; access: string[] }>(
  value: T,
): Omit<T, "accessMode" | "access"> & { permissions: AccessGrants | null } {
  const { accessMode, access, ...rest } = value;
  return {
    ...rest,
    permissions: accessMode === "custom" ? grantsFromTokens(access) : null,
  };
}

export const updateUserSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1, "Name is required").max(120),
    phone: optionalText(32),
    role: z.enum(USER_ROLES),
    languages: z.string().max(200).transform(parseLanguageList),
    leadCapacity: z.coerce.number().int().min(1).max(10_000),
    ...accessFields,
  })
  .superRefine(languageIssues)
  .transform(withResolvedAccess);

export const inviteUserSchema = z
  .object({
    email: z.string().trim().toLowerCase().email("Enter a valid email").max(254),
    name: z.string().trim().min(1, "Name is required").max(120),
    phone: optionalText(32),
    role: z.enum(USER_ROLES),
    languages: z.string().max(200).transform(parseLanguageList),
    leadCapacity: z.coerce.number().int().min(1).max(10_000),
    ...accessFields,
  })
  .superRefine(languageIssues)
  .transform(withResolvedAccess);

export const setUserActiveSchema = z.object({
  id: z.string().uuid(),
  isActive: z.enum(["true", "false"]).transform((value) => value === "true"),
});

const projectFields = z
  .object({
    name: z.string().trim().min(1, "Project name is required").max(160),
    slug: z.string().trim().max(80),
    city: optionalText(120),
    reraNumber: optionalText(100),
    avgSaleValue: z.preprocess(
      (value) => (typeof value === "string" && value.trim() === "" ? null : value),
      z
        .string()
        .trim()
        .regex(/^\d+(?:\.\d{1,2})?$/, "Use a positive amount with at most two decimals")
        .refine((value) => Number(value) > 0 && Number(value) <= 1_000_000_000_000, {
          message: "Average sale value is outside the supported range",
        })
        .nullable(),
    ),
  })
  .transform((value) => ({
    ...value,
    slug: normalizeProjectSlug(value.slug || value.name),
  }))
  .refine((value) => value.slug.length > 0, {
    path: ["slug"],
    message: "Slug must contain a letter or number",
  });

export const createProjectSchema = projectFields;
export const updateProjectSchema = z
  .object({ id: z.string().uuid() })
  .and(projectFields);

export const setProjectActiveSchema = z.object({
  id: z.string().uuid(),
  isActive: z.enum(["true", "false"]).transform((value) => value === "true"),
});

export const API_KEY_POLICIES = ["browser", "server"] as const;

export const createApiKeySchema = z.object({
  name: z.string().trim().min(1, "Key name is required").max(120),
  projectId: optionalUuid,
  keyPolicy: z.enum(API_KEY_POLICIES).default("browser"),
  rateLimitPerMinute: z.coerce.number().int().min(1).max(10_000),
});

export const revokeApiKeySchema = z.object({ id: z.string().uuid() });

export const updateDestinationSchema = z.object({
  id: z.string().uuid(),
  field: z.enum(["is_enabled", "dry_run"]),
  value: z.enum(["true", "false"]).transform((value) => value === "true"),
  confirmation: z.literal("confirmed").optional(),
});

export type CreateApiKeyState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | {
      status: "success";
      message: string;
      apiKey: string;
      signingSecret: string;
      keyPrefix: string;
      keyPolicy: "browser" | "server";
      signatureRequired: boolean;
    };

export function firstValidationError(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid input";
}
