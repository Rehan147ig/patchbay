import { describe, expect, it } from "vitest";
import { auth0Connector } from "./auth0";
import { genericOpenapiConnector } from "./generic-openapi";
import { stripeConnector } from "./stripe";
import { twilioConnector } from "./twilio";
import { getConnector } from "../registry";

describe("Vendor Connectors", () => {
  it("registers all vendor connectors", () => {
    expect(getConnector("openai")).toBeDefined();
    expect(getConnector("stripe")).toBeDefined();
    expect(getConnector("auth0")).toBeDefined();
    expect(getConnector("twilio")).toBeDefined();
    expect(getConnector("generic-openapi")).toBeDefined();
  });

  it("normalizes stripe change payload and produces patch suggestions", () => {
    const payload = { sdk: "stripe" };
    expect(stripeConnector.supports(payload)).toBe(true);

    const normalizations = stripeConnector.normalizeChange({
      rawPayload: payload,
      sourceType: "SDK_RELEASE",
    });
    expect(normalizations).toHaveLength(1);
    expect(normalizations[0]?.changeType).toBe("PARAMETER_REQUIRED");

    const patches = stripeConnector.buildPatchSuggestions(normalizations);
    expect(patches).toHaveLength(1);
  });

  it("normalizes auth0 payload without auto patch suggestions (requires human review)", () => {
    const payload = { sdk: "auth0" };
    expect(auth0Connector.supports(payload)).toBe(true);

    const normalizations = auth0Connector.normalizeChange({
      rawPayload: payload,
      sourceType: "SDK_RELEASE",
    });
    expect(normalizations[0]?.changeType).toBe("AUTH_CHANGE");

    const patches = auth0Connector.buildPatchSuggestions(normalizations);
    expect(patches).toHaveLength(0); // Auth changes produce plan-only / require human review
  });

  it("detects twilio deprecation and produces a patch suggestion", () => {
    const payload = { vendor: "twilio", product: "messaging" };
    expect(twilioConnector.supports(payload)).toBe(true);

    const normalizations = twilioConnector.normalizeChange({
      rawPayload: payload,
      sourceType: "DEPRECATION",
    });
    expect(normalizations[0]?.changeType).toBe("METHOD_RENAMED");
    expect(normalizations[0]?.affectedSymbols).toContain("client.messages.create");

    const patches = twilioConnector.buildPatchSuggestions(normalizations);
    expect(patches).toHaveLength(1);
    expect(patches[0]?.replacement).toBe("client.messages.createV2");
  });

  it("normalizes generic openapi diffs as plan-only", () => {
    const payload = { sourceType: "OPENAPI_DIFF", vendor: "generic-openapi" };
    expect(genericOpenapiConnector.supports(payload)).toBe(true);

    const normalizations = genericOpenapiConnector.normalizeChange({
      rawPayload: payload,
      sourceType: "OPENAPI_DIFF",
    });
    expect(normalizations.length).toBeGreaterThan(0);

    const patches = genericOpenapiConnector.buildPatchSuggestions(normalizations);
    expect(patches).toHaveLength(0);
  });
});
