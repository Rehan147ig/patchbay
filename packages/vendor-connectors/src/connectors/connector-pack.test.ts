import { describe, expect, it } from "vitest";
import { axiosConnector } from "./axios";
import { awsSdkConnector } from "./aws-sdk";
import { expressConnector } from "./express";
import { firebaseConnector } from "./firebase";
import { mongooseConnector } from "./mongoose";
import { nextConnector } from "./next";
import { passportConnector } from "./passport";
import { reactConnector } from "./react";
import { supabaseConnector } from "./supabase";
import { getConnector } from "../registry";
import { defineConnector } from "../sdk";

describe("connector pack", () => {
  it("registers all new connectors", () => {
    expect(getConnector("axios")).toBeDefined();
    expect(getConnector("aws-sdk")).toBeDefined();
    expect(getConnector("express")).toBeDefined();
    expect(getConnector("mongoose")).toBeDefined();
    expect(getConnector("react")).toBeDefined();
    expect(getConnector("next")).toBeDefined();
    expect(getConnector("passport")).toBeDefined();
    expect(getConnector("firebase")).toBeDefined();
    expect(getConnector("supabase")).toBeDefined();
  });

  it("axios: normalizes CancelToken removal and suggests AbortController", () => {
    const payload = { sdk: "axios", version: "1.0.0" };
    expect(axiosConnector.supports(payload)).toBe(true);

    const normalizations = axiosConnector.normalizeChange({
      rawPayload: payload,
      sourceType: "SDK_RELEASE",
    });
    expect(normalizations.some((n) => n.changeType === "METHOD_REMOVED")).toBe(true);

    const patches = axiosConnector.buildPatchSuggestions(normalizations);
    const cancel = patches.find((p) => p.symbol === "axios.CancelToken.source");
    expect(cancel?.replacement).toBe("AbortController");
  });

  it("aws-sdk: maps v2 service classes to v3 clients", () => {
    const payload = { sdk: "aws-sdk", fromVersion: "2.x", toVersion: "3.x" };
    expect(awsSdkConnector.supports(payload)).toBe(true);

    const normalizations = awsSdkConnector.normalizeChange({
      rawPayload: payload,
      sourceType: "SDK_RELEASE",
    });
    expect(normalizations.some((n) => n.affectedSymbols.includes("AWS.S3"))).toBe(true);

    const patches = awsSdkConnector.buildPatchSuggestions(normalizations);
    expect(patches.find((p) => p.symbol === "AWS.S3")?.replacement).toBe("S3Client");
    expect(patches.find((p) => p.symbol === "AWS.SQS")?.replacement).toBe("SQSClient");
    expect(patches.find((p) => p.symbol === "AWS.DynamoDB")?.replacement).toBe("DynamoDBClient");
  });

  it("express: catches app.del removal and req.param removal", () => {
    const payload = { vendor: "express", version: "5.0.0" };
    expect(expressConnector.supports(payload)).toBe(true);

    const normalizations = expressConnector.normalizeChange({
      rawPayload: payload,
      sourceType: "MAJOR_RELEASE",
    });
    expect(normalizations.some((n) => n.oldValue === "app.del")).toBe(true);
    expect(normalizations.some((n) => n.oldValue === "req.param()")).toBe(true);

    const patches = expressConnector.buildPatchSuggestions(normalizations);
    expect(patches.find((p) => p.symbol === "app.del")?.replacement).toBe("app.delete");
    expect(patches.find((p) => p.symbol === "req.param")?.replacement).toBe("req.params");
  });

  it("mongoose: suggests deleteMany for remove()", () => {
    const payload = { sdk: "mongoose", version: "7.0.0" };
    expect(mongooseConnector.supports(payload)).toBe(true);

    const normalizations = mongooseConnector.normalizeChange({
      rawPayload: payload,
      sourceType: "SDK_RELEASE",
    });
    const patches = mongooseConnector.buildPatchSuggestions(normalizations);
    expect(patches.find((p) => p.symbol === "Model.remove")?.replacement).toBe("Model.deleteMany");
  });

  it("react: catches ReactDOM.render removal", () => {
    const payload = { sdk: "react", fromVersion: "17", toVersion: "18" };
    expect(reactConnector.supports(payload)).toBe(true);

    const normalizations = reactConnector.normalizeChange({
      rawPayload: payload,
      sourceType: "SDK_RELEASE",
    });
    expect(normalizations.some((n) => n.oldValue === "ReactDOM.render")).toBe(true);

    const patches = reactConnector.buildPatchSuggestions(normalizations);
    expect(patches.find((p) => p.symbol === "ReactDOM.render")?.replacement).toBe(
      "createRoot().render",
    );
  });

  it("next: catches next/image prop removal", () => {
    const payload = { sdk: "next", fromVersion: "12", toVersion: "13" };
    expect(nextConnector.supports(payload)).toBe(true);

    const normalizations = nextConnector.normalizeChange({
      rawPayload: payload,
      sourceType: "SDK_RELEASE",
    });
    expect(normalizations.some((n) => n.oldValue === "next/image layout prop")).toBe(true);
  });

  it("passport: auth changes produce no auto-patch (human review)", () => {
    const payload = { sdk: "passport", version: "0.7.0" };
    expect(passportConnector.supports(payload)).toBe(true);

    const normalizations = passportConnector.normalizeChange({
      rawPayload: payload,
      sourceType: "SDK_RELEASE",
    });
    expect(normalizations.every((n) => n.changeType === "AUTH_CHANGE")).toBe(true);
    const patches = passportConnector.buildPatchSuggestions(normalizations);
    // AUTH_CHANGE patches are advisory only; they exist but carry no auto-apply flag.
    expect(patches.length).toBeGreaterThan(0);
  });

  it("firebase: maps legacy FCM APIs to sendEachForMulticast", () => {
    const payload = { sdk: "firebase-admin", version: "11.0.0" };
    expect(firebaseConnector.supports(payload)).toBe(true);

    const normalizations = firebaseConnector.normalizeChange({
      rawPayload: payload,
      sourceType: "SDK_RELEASE",
    });
    const patches = firebaseConnector.buildPatchSuggestions(normalizations);
    expect(patches.find((p) => p.symbol === "sendToDevice")?.replacement).toBe(
      "sendEachForMulticast",
    );
  });

  it("supabase: renames auth.user to auth.getUser", () => {
    const payload = { sdk: "@supabase/supabase-js", fromVersion: "1", toVersion: "2" };
    expect(supabaseConnector.supports(payload)).toBe(true);

    const normalizations = supabaseConnector.normalizeChange({
      rawPayload: payload,
      sourceType: "SDK_RELEASE",
    });
    const patches = supabaseConnector.buildPatchSuggestions(normalizations);
    expect(patches.find((p) => p.symbol === "supabase.auth.user")?.replacement).toBe(
      "supabase.auth.getUser",
    );
  });
});

describe("defineConnector SDK", () => {
  it("builds a connector from a declarative spec", () => {
    const connector = defineConnector({
      slug: "test-sdk",
      identifiers: ["test-sdk"],
      rules: [
        {
          changeType: "METHOD_RENAMED",
          oldValue: "old.method",
          newValue: "new.method",
          affectedSymbols: ["old.method"],
          breaking: true,
        },
      ],
      patchSuggestions: {
        "old.method": {
          replacement: "new.method",
          description: "rename",
          confidence: 90,
        },
      },
    });

    expect(connector.supports({ sdk: "test-sdk" })).toBe(true);
    expect(connector.supports({ sdk: "other" })).toBe(false);

    const normalizations = connector.normalizeChange({
      rawPayload: { sdk: "test-sdk" },
      sourceType: "SDK_RELEASE",
    });
    expect(normalizations[0]?.changeType).toBe("METHOD_RENAMED");
    expect(normalizations[0]?.oldValue).toBe("old.method");

    const patches = connector.buildPatchSuggestions(normalizations);
    expect(patches[0]?.replacement).toBe("new.method");
  });

  it("supports a custom supports predicate", () => {
    const connector = defineConnector({
      slug: "custom",
      identifiers: [],
      supports: (raw) =>
        typeof raw === "object" && raw !== null && (raw as Record<string, unknown>).name === "x",
      rules: [{ changeType: "OTHER", affectedSymbols: ["a"], breaking: false }],
    });
    expect(connector.supports({ name: "x" })).toBe(true);
    expect(connector.supports({ name: "y" })).toBe(false);
  });

  it("glob matching stays linear on long candidates (ReDoS guard)", () => {
    const connector = defineConnector({
      slug: "redos-guard",
      identifiers: ["@google-cloud/*", "lib/*-sdk"],
      rules: [{ changeType: "OTHER", affectedSymbols: ["a"], breaking: false }],
    });
    const longCandidate = `@google-cloud/${"a".repeat(300_000)}`;
    const started = performance.now();
    const supported = connector.supports({ sdk: longCandidate });
    const elapsed = performance.now() - started;
    expect(supported).toBe(true);
    expect(elapsed).toBeLessThan(1_000);
  });
});
