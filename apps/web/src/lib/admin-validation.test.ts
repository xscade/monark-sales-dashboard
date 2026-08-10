import { describe, expect, it } from "vitest";
import {
  createApiKeySchema,
  createProjectSchema,
  inviteUserSchema,
  normalizeProjectSlug,
  parseLanguageList,
  setUserActiveSchema,
  updateDestinationSchema,
  updateProjectSchema,
  updateUserSchema,
} from "./admin-validation";

const ID = "550e8400-e29b-41d4-a716-446655440000";

describe("admin validation", () => {
  it("normalizes project slugs deterministically", () => {
    expect(normalizeProjectSlug("  Monárk — Wind Wave  ")).toBe("monark-wind-wave");
    expect(normalizeProjectSlug("---")).toBe("");
  });

  it("normalizes and deduplicates language tags", () => {
    expect(parseLanguageList(" EN, te, en, hi ")).toEqual(["en", "te", "hi"]);
  });

  it("parses a user update and rejects unsupported roles", () => {
    expect(
      updateUserSchema.parse({
        id: ID,
        name: "  Sales Team  ",
        phone: "",
        role: "sales_agent",
        languages: "EN, te, en",
        leadCapacity: "250",
      }),
    ).toEqual({
      id: ID,
      name: "Sales Team",
      phone: null,
      role: "sales_agent",
      languages: ["en", "te"],
      leadCapacity: 250,
    });

    expect(
      updateUserSchema.safeParse({
        id: ID,
        name: "Sales Team",
        phone: "",
        role: "super_admin",
        languages: "en",
        leadCapacity: "250",
      }).success,
    ).toBe(false);
  });

  it("normalizes a CRM invitation", () => {
    expect(inviteUserSchema.parse({
      email: " Sales@Example.COM ", name: " New Agent ", phone: "", role: "sales_agent",
      languages: "EN, te", leadCapacity: "150",
    })).toEqual({
      email: "sales@example.com", name: "New Agent", phone: null, role: "sales_agent",
      languages: ["en", "te"], leadCapacity: 150,
    });
  });

  it("coerces boolean status fields only from explicit values", () => {
    expect(setUserActiveSchema.parse({ id: ID, isActive: "false" }).isActive).toBe(false);
    expect(setUserActiveSchema.safeParse({ id: ID, isActive: "0" }).success).toBe(false);
  });

  it("derives a project slug and normalizes nullable fields", () => {
    expect(
      createProjectSchema.parse({
        name: "Monark Heights",
        slug: "",
        city: "",
        reraNumber: "  TS-RERA-1 ",
        avgSaleValue: "32000000",
      }),
    ).toEqual({
      name: "Monark Heights",
      slug: "monark-heights",
      city: null,
      reraNumber: "TS-RERA-1",
      avgSaleValue: "32000000",
    });

    expect(
      createProjectSchema.safeParse({
        name: "Monark Heights",
        slug: "",
        city: "",
        reraNumber: "",
        avgSaleValue: "-1",
      }).success,
    ).toBe(false);
  });

  it("keeps the project id when validating an update", () => {
    expect(
      updateProjectSchema.parse({
        id: ID,
        name: "Wind Wave",
        slug: "Wind Wave",
        city: "Hyderabad",
        reraNumber: "",
        avgSaleValue: "",
      }),
    ).toMatchObject({ id: ID, slug: "wind-wave", avgSaleValue: null });
  });

  it("validates project scope and limits for API keys", () => {
    expect(
      createApiKeySchema.parse({
        name: " Website ",
        projectId: "",
        rateLimitPerMinute: "120",
      }),
    ).toEqual({
      name: "Website",
      projectId: null,
      keyPolicy: "browser",
      rateLimitPerMinute: 120,
    });
    expect(
      createApiKeySchema.parse({
        name: "CRM webhook",
        projectId: ID,
        keyPolicy: "server",
        rateLimitPerMinute: "60",
      }).keyPolicy,
    ).toBe("server");
    expect(
      createApiKeySchema.safeParse({
        name: "Unknown client",
        projectId: ID,
        keyPolicy: "mobile",
        rateLimitPerMinute: "60",
      }).success,
    ).toBe(false);
    expect(
      createApiKeySchema.safeParse({
        name: "Website",
        projectId: ID,
        rateLimitPerMinute: "10001",
      }).success,
    ).toBe(false);
  });

  it("allows only the two destination state fields", () => {
    expect(
      updateDestinationSchema.parse({ id: ID, field: "dry_run", value: "true" }),
    ).toEqual({ id: ID, field: "dry_run", value: true });
    expect(
      updateDestinationSchema.safeParse({ id: ID, field: "credentials", value: "true" }).success,
    ).toBe(false);
    expect(
      updateDestinationSchema.parse({
        id: ID, field: "is_enabled", value: "true", confirmation: "confirmed",
      }).confirmation,
    ).toBe("confirmed");
  });
});
