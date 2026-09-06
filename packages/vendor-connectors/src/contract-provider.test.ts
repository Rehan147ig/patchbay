import { describe, expect, it } from "vitest";
import { canonicalJson, sha256Hex } from "./contract-hash";
import {
  inboundEventSchema,
  normalizedChangeSchema,
  normalizedContractSnapshotSchema,
  rawContractSnapshotSchema,
  type ContractProviderAdapter,
  type NormalizedChange,
  type NormalizedContractSnapshot,
  type RawContractSnapshot,
} from "./contract-provider";

/**
 * WP2 interface conformance: a minimal in-memory adapter implementing the
 * full ContractProviderAdapter contract. Proves the interface is
 * implementable without boiling an ocean — real adapters (starting with npm)
 * follow this exact shape in WP4 orchestration.
 */
function createFakePackumentAdapter(): ContractProviderAdapter {
  const parserVersion = "fake-packument/1";
  const parse = (rawText: string): { version: string } => {
    const parsed: unknown = JSON.parse(rawText);
    if (typeof parsed !== "object" || parsed === null || !("version" in parsed)) {
      throw new Error("not a packument");
    }
    return { version: String((parsed as { version: unknown }).version) };
  };

  return {
    slug: "fake:npm",
    contractKinds: ["SDK"],

    async verifyInboundEvent(input) {
      const parsed = inboundEventSchema.parse(input);
      if (parsed.headers["x-test-signature"] !== "valid") {
        throw new Error("inbound event rejected: bad signature");
      }
      const body: unknown = JSON.parse(parsed.rawBody);
      return {
        sourceSlug: this.slug,
        eventId: `evt-${sha256Hex(parsed.rawBody).slice(0, 16)}`,
        eventType: "release",
        payload: body,
      };
    },

    async fetchCurrentSnapshot() {
      const rawText = JSON.stringify({ version: "4.8.1" });
      return rawContractSnapshotSchema.parse({
        contentHash: sha256Hex(rawText),
        rawText,
        observedAt: new Date().toISOString(),
      });
    },

    async normalize(snapshot: RawContractSnapshot): Promise<NormalizedContractSnapshot> {
      const { version } = parse(snapshot.rawText);
      const normalizedJson = { package: "fake", version };
      return normalizedContractSnapshotSchema.parse({
        normalizedHash: sha256Hex(canonicalJson(normalizedJson)),
        normalizedJson,
        parserVersion,
      });
    },

    async diff(
      previous: NormalizedContractSnapshot | null,
      current: NormalizedContractSnapshot,
    ): Promise<NormalizedChange[]> {
      if (previous === null) return [];
      const prev = (previous.normalizedJson ?? {}) as { version?: unknown };
      const curr = (current.normalizedJson ?? {}) as { version?: unknown };
      if (prev.version === curr.version) return [];
      return [
        normalizedChangeSchema.parse({
          identity: `version:${String(prev.version)}->${String(curr.version)}`,
          changeType: "SDK_VERSION_UPGRADE",
          severity: "MEDIUM",
          description: `fake upgraded ${String(prev.version)} -> ${String(curr.version)}`,
          migrationHints: await this.getMigrationHints({
            identity: "x",
            changeType: "SDK_VERSION_UPGRADE",
            severity: "MEDIUM",
            description: "x",
            migrationHints: [],
          }),
        }),
      ];
    },

    async getMigrationHints(change: NormalizedChange) {
      return [
        {
          kind: "version-bump",
          description: `Adopt ${change.identity}`,
          confidence: 0.5,
        },
      ];
    },
  };
}

describe("ContractProviderAdapter conformance (fake packument adapter)", () => {
  it("verifies inbound events and rejects bad signatures", async () => {
    const adapter = createFakePackumentAdapter();
    const verified = await adapter.verifyInboundEvent({
      headers: { "x-test-signature": "valid" },
      rawBody: JSON.stringify({ version: "4.8.1" }),
      sourceSlug: adapter.slug,
    });
    expect(verified.eventId).toMatch(/^evt-[0-9a-f]{16}$/);
    await expect(
      adapter.verifyInboundEvent({
        headers: {},
        rawBody: "{}",
        sourceSlug: adapter.slug,
      }),
    ).rejects.toThrow(/signature/);
  });

  it("runs fetch -> normalize -> diff -> hints as a closed loop", async () => {
    const adapter = createFakePackumentAdapter();
    const snapshot = await adapter.fetchCurrentSnapshot({
      id: "src-1",
      vendorSlug: "fake",
      kind: "SDK",
    });
    const normalized = await adapter.normalize(snapshot);
    expect(await adapter.diff(null, normalized)).toEqual([]);
    const evolved = {
      ...normalized,
      normalizedJson: { package: "fake", version: "4.9.0" },
      normalizedHash: sha256Hex(canonicalJson({ package: "fake", version: "4.9.0" })),
    };
    const changes = await adapter.diff(normalized, evolved);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.identity).toBe("version:4.8.1->4.9.0");
    expect(changes[0]?.migrationHints).toHaveLength(1);
  });

  it("rejects malformed snapshots and changes at the boundary", async () => {
    const adapter = createFakePackumentAdapter();
    await expect(adapter.normalize({} as never)).rejects.toThrow();
    expect(() => normalizedChangeSchema.parse({ identity: "", changeType: "X" })).toThrow();
  });
});
