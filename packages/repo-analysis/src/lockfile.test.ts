import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectLockfile, packageManagerFor, resolveLockfileVersions } from "./lockfile";

async function tempRepo(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "patchbay-lockfile-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content);
  }
  return dir;
}

describe("lockfile detection", () => {
  it("prefers pnpm-lock.yaml", async () => {
    const dir = await tempRepo({
      "pnpm-lock.yaml": "lockfileVersion: '6.0'\n",
      "package-lock.json": "{}\n",
    });
    expect(await detectLockfile(dir)).toBe("pnpm-lock.yaml");
    expect(packageManagerFor("pnpm-lock.yaml")).toBe("pnpm");
  });

  it("returns unknown without a lockfile", async () => {
    const dir = await tempRepo({ "package.json": "{}\n" });
    expect(await detectLockfile(dir)).toBeNull();
    const result = await resolveLockfileVersions(dir);
    expect(result.packageManager).toBe("unknown");
    expect(result.versions).toEqual({});
  });

  it("parses pnpm package entries including scoped names", async () => {
    const dir = await tempRepo({
      "pnpm-lock.yaml": [
        "lockfileVersion: '6.0'",
        "packages:",
        "  openai@3.3.0:",
        "    resolution: {integrity: sha512-x}",
        "  '@types/node@18.0.0':",
        "    resolution: {integrity: sha512-y}",
        "  stripe@^16.12.0:",
        "    resolution: {integrity: sha512-z}",
        "  qs@6.13.0:",
        "    resolution: {integrity: sha512-w}",
      ].join("\n"),
    });
    const result = await resolveLockfileVersions(dir);
    expect(result.packageManager).toBe("pnpm");
    expect(result.versions).toEqual({
      openai: "3.3.0",
      "@types/node": "18.0.0",
      qs: "6.13.0",
    });
  });
});
