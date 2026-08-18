import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  contentHashOf,
  evidenceObjectExists,
  objectKeyForHash,
  objectKeyForPayload,
  readRawEvidence,
  storeRawEvidence,
} from "./object-store";

let storeDir: string;

beforeEach(async () => {
  storeDir = await mkdtemp(join(tmpdir(), "patchbay-evidence-"));
  process.env.EVIDENCE_STORE_DIR = storeDir;
});

afterEach(async () => {
  await rm(storeDir, { recursive: true, force: true });
  delete process.env.EVIDENCE_STORE_DIR;
});

describe("content-addressed evidence object store", () => {
  it("stores a payload under its content hash with a sharded key", async () => {
    const payload = JSON.stringify({ version: "4.8.1", manifest: {} });
    const hash = contentHashOf(payload);

    const result = await storeRawEvidence(payload);

    expect(result.contentHash).toBe(hash);
    expect(result.key).toBe(`sha256/${hash.slice(0, 2)}/${hash}.json`);
    expect(result.written).toBe(true);
    const stored = await readFile(join(storeDir, result.key), "utf8");
    expect(stored).toBe(payload);
  });

  it("deduplicates identical payloads without rewriting", async () => {
    const payload = "same-content";
    const first = await storeRawEvidence(payload);
    const second = await storeRawEvidence(payload);

    expect(second.key).toBe(first.key);
    expect(second.written).toBe(false);
    expect(evidenceObjectExists(first.key)).toBe(true);
  });

  it("reads back an object and verifies its hash", async () => {
    const payload = "verifiable-content";
    const { key } = await storeRawEvidence(payload);

    expect(await readRawEvidence(key)).toBe(payload);
  });

  it("rejects reads when the stored content no longer matches its key", async () => {
    const { key } = await storeRawEvidence("original");
    await writeFile(join(storeDir, key), "tampered");

    await expect(readRawEvidence(key)).rejects.toThrow(/failed hash verification/);
  });

  it("derives keys deterministically from payloads", () => {
    const payload = "deterministic";
    expect(objectKeyForPayload(payload)).toBe(objectKeyForHash(contentHashOf(payload)));
    expect(objectKeyForPayload(payload)).toBe(objectKeyForPayload(payload));
  });

  it("rejects malformed hashes", () => {
    expect(() => objectKeyForHash("not-a-hash")).toThrow(/invalid content hash/);
  });
});
