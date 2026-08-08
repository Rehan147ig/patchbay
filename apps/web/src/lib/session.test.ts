import { afterEach, describe, expect, it } from "vitest";
import { getSecret, readSessionCookie } from "./session";

describe("session secret", () => {
  const original = process.env.DEV_AUTH_SECRET;

  afterEach(() => {
    if (original === undefined) delete process.env.DEV_AUTH_SECRET;
    else process.env.DEV_AUTH_SECRET = original;
  });

  it("refuses to sign with the known default secret", () => {
    process.env.DEV_AUTH_SECRET = "local-dev-secret-change-me";
    expect(() => getSecret()).toThrow(/DEV_AUTH_SECRET/);
  });

  it("refuses to sign when the secret is unset", () => {
    delete process.env.DEV_AUTH_SECRET;
    expect(() => getSecret()).toThrow(/DEV_AUTH_SECRET/);
  });

  it("fails closed on read when the secret is missing", async () => {
    delete process.env.DEV_AUTH_SECRET;
    await expect(readSessionCookie("anything.anything")).resolves.toBeNull();
  });
});
