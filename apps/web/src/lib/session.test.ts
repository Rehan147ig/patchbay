import { afterEach, describe, expect, it } from "vitest";
import { createSessionCookie, getSecret, isSessionCurrent, readSessionCookie } from "./session";

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

describe("session version rotation", () => {
  const original = process.env.DEV_AUTH_SECRET;

  afterEach(() => {
    if (original === undefined) delete process.env.DEV_AUTH_SECRET;
    else process.env.DEV_AUTH_SECRET = original;
  });

  it("round-trips the session version issued at", async () => {
    process.env.DEV_AUTH_SECRET = "rotation-test-secret";
    const cookie = await createSessionCookie("u-1", "a@b.dev", 3);
    const session = await readSessionCookie(cookie.value);
    expect(session?.sub).toBe("u-1");
    expect(session?.ver).toBe(3);
  });

  it("defaults to version 0 when none was passed", async () => {
    process.env.DEV_AUTH_SECRET = "rotation-test-secret";
    const cookie = await createSessionCookie("u-1", "a@b.dev");
    const session = await readSessionCookie(cookie.value);
    expect(session?.ver).toBe(0);
  });

  it("isSessionCurrent accepts only the matching version", () => {
    expect(isSessionCurrent(2, 2)).toBe(true);
    expect(isSessionCurrent(2, 3)).toBe(false);
    expect(isSessionCurrent(0, 0)).toBe(true);
  });
});
