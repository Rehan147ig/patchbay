import path from "node:path";
import { describe, expect, it } from "vitest";
import { reparseCheck } from "./engine";
import { readProjectFile, runSemanticGate } from "./semantic-gate";

const AWS_FIXTURE = path.resolve(
  import.meta.dirname,
  "../../../fixtures/repositories/aws-sdk-node-legacy",
);
const AWS_CLIENTS = "src/aws-clients.ts";

/**
 * Reproduces exactly what the aws-sdk connector + engine produce today: a
 * line-level rename of the three service constructors, with no import added and
 * no call-shape change. This is the output that currently ships at confidence
 * 90 under capability level DRAFT_PR.
 */
function currentEngineOutput(original: string): string {
  return original
    .split("AWS.S3")
    .join("S3Client")
    .split("AWS.SQS")
    .join("SQSClient")
    .split("AWS.DynamoDB")
    .join("DynamoDBClient");
}

describe("semantic gate", () => {
  it("accepts the unmodified fixture (baseline is self-consistent)", () => {
    const original = readProjectFile(AWS_FIXTURE, AWS_CLIENTS);
    const result = runSemanticGate({
      projectDir: AWS_FIXTURE,
      patchedFiles: new Map([[AWS_CLIENTS, original]]),
    });
    expect(result.newErrors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("rejects the current aws-sdk patch for undefined client names", () => {
    const original = readProjectFile(AWS_FIXTURE, AWS_CLIENTS);
    const patched = currentEngineOutput(original);
    expect(patched).not.toBe(original);

    const result = runSemanticGate({
      projectDir: AWS_FIXTURE,
      patchedFiles: new Map([[AWS_CLIENTS, patched]]),
    });

    expect(result.ok).toBe(false);
    // TS2304: Cannot find name 'S3Client'.
    const codes = new Set(result.newErrors.map((error) => error.code));
    expect(codes.has(2304)).toBe(true);
    const names = result.newErrors.map((error) => error.message).join(" | ");
    expect(names).toContain("S3Client");
  });

  it("is strictly stronger than the reparseCheck it replaces", () => {
    const original = readProjectFile(AWS_FIXTURE, AWS_CLIENTS);
    const patched = currentEngineOutput(original);

    // The old gate sees valid syntax and lets the broken patch through.
    expect(reparseCheck(AWS_CLIENTS, patched)).toBe(true);
    // The new gate does not.
    expect(
      runSemanticGate({
        projectDir: AWS_FIXTURE,
        patchedFiles: new Map([[AWS_CLIENTS, patched]]),
      }).ok,
    ).toBe(false);
  });

  it("accepts a rename that also brings its import", () => {
    const original = readProjectFile(AWS_FIXTURE, AWS_CLIENTS);
    // What a correct rule would emit: rename plus a declaration for the new
    // name. Using a local declaration keeps the fixture dependency-free while
    // exercising the same code path an added import would.
    const patched =
      `declare const S3Client: new (config: unknown) => unknown;\n` +
      `declare const SQSClient: new (config: unknown) => unknown;\n` +
      `declare const DynamoDBClient: new (config: unknown) => unknown;\n` +
      currentEngineOutput(original);

    const result = runSemanticGate({
      projectDir: AWS_FIXTURE,
      patchedFiles: new Map([[AWS_CLIENTS, patched]]),
    });

    expect(result.newErrors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("does not count pre-existing errors as new when lines shift", () => {
    const original = readProjectFile(AWS_FIXTURE, AWS_CLIENTS);
    // Prepend blank lines only. Every diagnostic shifts down; none are new.
    const patched = `\n\n\n${original}`;
    const result = runSemanticGate({
      projectDir: AWS_FIXTURE,
      patchedFiles: new Map([[AWS_CLIENTS, patched]]),
    });
    expect(result.newErrors).toEqual([]);
    expect(result.ok).toBe(true);
  });
});
