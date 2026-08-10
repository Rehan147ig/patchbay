import { describe, expect, it } from "vitest";
import { EnvSecretStore, getSecretStore } from "./secrets";

describe("EnvSecretStore", () => {
  it("reads values from the injected source", async () => {
    const store = new EnvSecretStore({ source: { GITHUB_APP_WEBHOOK_SECRET: "whsec_abc" } });
    expect(await store.get("GITHUB_APP_WEBHOOK_SECRET")).toBe("whsec_abc");
  });

  it("returns null for unset or blank values", async () => {
    const store = new EnvSecretStore({ source: { EMPTY: "", GONE: undefined } });
    expect(await store.get("EMPTY")).toBeNull();
    expect(await store.get("GONE")).toBeNull();
    expect(await store.get("NEVER_SET")).toBeNull();
  });

  it("getRequired throws a value-free error for missing secrets", async () => {
    const store = new EnvSecretStore({ source: {} });
    await expect(store.getRequired("GITHUB_APP_PRIVATE_KEY")).rejects.toThrow(
      'Required secret "GITHUB_APP_PRIVATE_KEY" is not set',
    );
  });

  it("getRequired resolves existing values", async () => {
    const store = new EnvSecretStore({ source: { DEV_AUTH_SECRET: "local-dev-secret-12345678" } });
    expect(await store.getRequired("DEV_AUTH_SECRET")).toBe("local-dev-secret-12345678");
  });

  it("getSecretStore returns a stable singleton", async () => {
    const store = getSecretStore();
    expect(getSecretStore()).toBe(store);
    const value = await store.get("REDIS_URL");
    expect(value === null || typeof value === "string").toBe(true);
  });
});
