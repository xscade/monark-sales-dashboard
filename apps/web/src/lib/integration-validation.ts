import { CONVERSION_EVENTS } from "@monark/core";
import { z } from "zod";

const optional = (max: number) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z.string().trim().max(max).nullable(),
  );
const projectId = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  z.string().uuid().nullable(),
);

const base = {
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(160),
  projectId,
};

export const createDestinationSchema = z.object({
  name: z.string().trim().min(1, "Destination name is required").max(160),
  projectId,
  platform: z.enum(["meta_capi", "google_data_manager"]),
});

export const metaDestinationSchema = z.object({
  ...base,
  platform: z.literal("meta_capi"),
  datasetId: z.string().trim().min(1).max(200),
  apiVersion: z.string().trim().regex(/^v\d+(?:\.\d+)?$/).default("v21.0"),
  testEventCode: optional(200),
});

export const googleDestinationSchema = z.object({
  ...base,
  platform: z.literal("google_data_manager"),
  operatingAccountId: z.string().trim().regex(/^\d{6,20}$/, "Use digits only"),
  loginAccountId: optional(20).refine((value) => !value || /^\d+$/.test(value), "Use digits only"),
  productDestinationId: z.string().trim().min(1).max(300),
  accountType: z.enum(["GOOGLE_ADS", "GOOGLE_ANALYTICS_PROPERTY", "FLOODLIGHT_CONFIG"]),
});

export const destinationSchema = z.discriminatedUnion("platform", [
  metaDestinationSchema,
  googleDestinationSchema,
]);

export const replaceMetaCredentialSchema = z.object({
  id: z.string().uuid(),
  platform: z.literal("meta_capi"),
  accessToken: z.string().trim().min(20).max(4096),
});

export const replaceGoogleCredentialSchema = z.object({
  id: z.string().uuid(),
  platform: z.literal("google_data_manager"),
  serviceAccountJson: z.string().min(1).max(30_000).transform((raw, context) => {
    try {
      const value = JSON.parse(raw) as Record<string, unknown>;
      if (
        typeof value.client_email !== "string" ||
        !value.client_email.trim() ||
        typeof value.private_key !== "string" ||
        !value.private_key.trim()
      ) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "JSON needs client_email and private_key" });
        return z.NEVER;
      }
      return {
        client_email: value.client_email,
        private_key: value.private_key,
        ...(typeof value.impersonatedUser === "string"
          ? { impersonatedUser: value.impersonatedUser }
          : {}),
      };
    } catch {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Service-account JSON is invalid" });
      return z.NEVER;
    }
  }),
});

export const mappingSchema = z
  .object({
    destinationId: z.string().uuid(),
    eventType: z.enum(CONVERSION_EVENTS),
    platformEventName: z.string().trim().min(1).max(200),
    platformDestinationId: optional(300),
    valueStrategy: z.enum(["none", "fixed", "modelled", "actual"]),
    fixedValue: z.preprocess(
      (value) => (typeof value === "string" && value.trim() === "" ? null : value),
      z.coerce.number().nonnegative().max(1_000_000_000_000).nullable(),
    ),
    isEnabled: z.enum(["true", "false"]).transform((value) => value === "true"),
  })
  .refine((value) => value.valueStrategy !== "fixed" || value.fixedValue !== null, {
    path: ["fixedValue"],
    message: "Fixed value is required",
  });

export const mappingIdSchema = z.object({
  id: z.string().uuid(),
  destinationId: z.string().uuid(),
});

export const destinationIdSchema = z.object({ id: z.string().uuid() });

export function destinationReadinessIssue(input: {
  platform: "meta_capi" | "google_data_manager" | "internal_analytics";
  config: unknown;
  hasCredentials: boolean;
  hasEnabledMapping: boolean;
}): string | null {
  const config = input.config && typeof input.config === "object"
    ? input.config as Record<string, unknown>
    : {};
  const configIsComplete = input.platform === "meta_capi"
    ? typeof config.datasetId === "string" && Boolean(config.datasetId.trim()) &&
      typeof config.apiVersion === "string" && /^v\d+(?:\.\d+)?$/.test(config.apiVersion)
    : input.platform === "google_data_manager"
      ? typeof config.operatingAccountId === "string" && /^\d{6,20}$/.test(config.operatingAccountId) &&
        typeof config.productDestinationId === "string" && Boolean(config.productDestinationId.trim()) &&
        ["GOOGLE_ADS", "GOOGLE_ANALYTICS_PROPERTY", "FLOODLIGHT_CONFIG"].includes(String(config.accountType))
      : false;

  if (!configIsComplete || !input.hasCredentials) {
    return "Complete the destination config and encrypted credentials before enabling delivery";
  }
  if (!input.hasEnabledMapping) {
    return "Add and enable at least one event mapping before enabling delivery";
  }
  return null;
}
