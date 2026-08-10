import { describe, expect, it } from "vitest";
import {
  createDestinationSchema,
  destinationReadinessIssue,
  destinationSchema,
  mappingSchema,
  replaceGoogleCredentialSchema,
} from "./integration-validation";

const ID = "550e8400-e29b-41d4-a716-446655440000";

describe("integration validation", () => {
  it("creates only supported destinations with safe project parsing", () => {
    expect(createDestinationSchema.parse({
      name: " Meta — Website ", platform: "meta_capi", projectId: "",
    })).toEqual({ name: "Meta — Website", platform: "meta_capi", projectId: null });
    expect(createDestinationSchema.safeParse({
      name: "Internal", platform: "internal_analytics", projectId: "",
    }).success).toBe(false);
  });

  it("validates and redacts Meta configuration fields", () => {
    expect(destinationSchema.parse({
      id: ID, platform: "meta_capi", name: " Meta ", projectId: "",
      datasetId: "123", apiVersion: "v21.0", testEventCode: "",
    })).toMatchObject({ name: "Meta", projectId: null, testEventCode: null });
  });

  it("requires digits-only Google accounts", () => {
    expect(destinationSchema.safeParse({
      id: ID, platform: "google_data_manager", name: "Google", projectId: "",
      operatingAccountId: "123-456", loginAccountId: "", productDestinationId: "actions/1",
      accountType: "GOOGLE_ADS",
    }).success).toBe(false);
  });

  it("parses service account JSON without accepting incomplete credentials", () => {
    const result = replaceGoogleCredentialSchema.parse({
      id: ID, platform: "google_data_manager",
      serviceAccountJson: JSON.stringify({ client_email: "svc@example.com", private_key: "secret" }),
    });
    expect(result.serviceAccountJson).toEqual({ client_email: "svc@example.com", private_key: "secret" });
    expect(replaceGoogleCredentialSchema.safeParse({
      id: ID, platform: "google_data_manager", serviceAccountJson: "{}",
    }).success).toBe(false);
  });

  it("requires a value when the fixed strategy is selected", () => {
    const base = {
      destinationId: ID, eventType: "lead_created", platformEventName: "Lead",
      platformDestinationId: "", valueStrategy: "fixed", fixedValue: "", isEnabled: "true",
    };
    expect(mappingSchema.safeParse(base).success).toBe(false);
    expect(mappingSchema.parse({ ...base, fixedValue: "1500" }).fixedValue).toBe(1500);
  });

  it("requires complete credentials, config and routing before delivery", () => {
    const base = {
      platform: "meta_capi" as const,
      config: { datasetId: "123", apiVersion: "v21.0" },
      hasCredentials: true,
      hasEnabledMapping: true,
    };
    expect(destinationReadinessIssue(base)).toBeNull();
    expect(destinationReadinessIssue({ ...base, hasCredentials: false })).toMatch(/credentials/i);
    expect(destinationReadinessIssue({ ...base, hasEnabledMapping: false })).toMatch(/mapping/i);
    expect(destinationReadinessIssue({ ...base, config: { datasetId: "", apiVersion: "v21.0" } })).toMatch(/config/i);
  });
});
