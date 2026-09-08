import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  assertSafeSnapshotPath,
  buildSnapshotManifest,
  manifestHashMap,
  verifySnapshotCheckout,
  withSnapshotCheckout,
  SnapshotPathError,
  SnapshotVerificationError,
} from "./snapshot";

function makeTree(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "patchbay-snapshot-test-"));
  for (const [filePath, content] of Object.entries(files)) {
    const full = path.join(dir, filePath);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content, "utf8");
  }
  return dir;
}

describe("snapshot manifest", () => {
  it("builds a stable manifest with sha256 per file and a manifest hash", () => {
    const dir = makeTree({
      "src/a.ts": "export const a = 1;\n",
      "src/b.ts": "export const b = 2;\n",
    });
    try {
      const first = buildSnapshotManifest(dir);
      const second = buildSnapshotManifest(dir);
      expect(first.manifestHash).toBe(second.manifestHash);
      expect(first.files.map((file) => file.path)).toEqual(["src/a.ts", "src/b.ts"]);
      expect(first.files[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(manifestHashMap(first).get("src/a.ts")).toBe(first.files[0]?.sha256);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uses the same contract for fixture-style directories (no special path)", () => {
    const dir = makeTree({ "index.ts": "console.log(1);\n" });
    try {
      const manifest = buildSnapshotManifest(dir);
      expect(manifest.files).toHaveLength(1);
      expect(manifest.files[0]?.path).toBe("index.ts");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects absolute paths, traversal, and backslashes", () => {
    expect(() => assertSafeSnapshotPath("/etc/passwd")).toThrow(SnapshotPathError);
    expect(() => assertSafeSnapshotPath("../escape.ts")).toThrow(SnapshotPathError);
    expect(() => assertSafeSnapshotPath("src/../escape.ts")).toThrow(SnapshotPathError);
    expect(() => assertSafeSnapshotPath("src\\win.ts")).toThrow(SnapshotPathError);
    expect(() => assertSafeSnapshotPath("")).toThrow(SnapshotPathError);
    expect(assertSafeSnapshotPath("src/ok.ts")).toBe("src/ok.ts");
  });

  it("rejects symlinks escaping the checkout", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "patchbay-snapshot-symlink-"));
    try {
      writeFileSync(path.join(dir, "real.ts"), "export const x = 1;\n");
      // Windows CI lacks symlink privilege (EPERM): prove the guard on the
      // path validator itself, and prove the manifest guard where allowed.
      expect(() => assertSafeSnapshotPath("../escape.ts")).toThrow(SnapshotPathError);
      try {
        symlinkSync(path.join(tmpdir(), "patchbay-outside-secret.txt"), path.join(dir, "evil-link"));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EPERM") return;
        throw error;
      }
      expect(() => buildSnapshotManifest(dir)).toThrow(SnapshotPathError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails closed on wrong commit SHA, tree hash, or manifest drift", () => {
    const dir = makeTree({ "src/a.ts": "export const a = 1;\n" });
    try {
      const manifest = buildSnapshotManifest(dir);
      const identity = {
        commitSha: "a".repeat(40),
        treeHash: "t".repeat(16),
        manifestHash: manifest.manifestHash,
      };
      expect(() =>
        verifySnapshotCheckout(identity, {
          commitSha: "b".repeat(40),
          treeHash: identity.treeHash,
          manifest,
        }),
      ).toThrow(SnapshotVerificationError);
      expect(() =>
        verifySnapshotCheckout(identity, {
          commitSha: identity.commitSha,
          treeHash: "x".repeat(16),
          manifest,
        }),
      ).toThrow(SnapshotVerificationError);
      writeFileSync(path.join(dir, "src/a.ts"), "CHANGED\n");
      const drifted = buildSnapshotManifest(dir);
      expect(() =>
        verifySnapshotCheckout(identity, {
          commitSha: identity.commitSha,
          treeHash: identity.treeHash,
          manifest: drifted,
        }),
      ).toThrow(SnapshotVerificationError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("cleans up the checkout after success and after failure", async () => {
    const dir = makeTree({ "src/a.ts": "x\n" });
    await withSnapshotCheckout(dir, async (root) => {
      expect(root).toBe(dir);
    });
    expect(() => buildSnapshotManifest(dir)).toThrow();

    const dir2 = makeTree({ "src/a.ts": "x\n" });
    await expect(
      withSnapshotCheckout(dir2, async () => {
        throw new Error("work failed");
      }),
    ).rejects.toThrow("work failed");
    expect(() => buildSnapshotManifest(dir2)).toThrow();
  });
});
