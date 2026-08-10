import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ORG_SCOPE_EXEMPT_MODELS, ORG_SCOPED_MODELS, withOrgContext } from "./org-scope";

const SCHEMA_PATH = path.resolve(__dirname, "../prisma/schema.prisma");
const schema = readFileSync(SCHEMA_PATH, "utf8");

function schemaModels(): Array<{ name: string; body: string }> {
  const blocks: Array<{ name: string; body: string }> = [];
  const pattern = /^model\s+(\w+)\s*\{([^}]*)\}/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(schema)) !== null) {
    blocks.push({ name: match[1]!, body: match[2]! });
  }
  return blocks;
}

const modelsWithOrganizationId = schemaModels()
  .filter((model) => /\borganizationId\b/.test(model.body))
  .map((model) => model.name);

describe("org-scope drift guard", () => {
  it("covers every schema model with an organizationId column", () => {
    const uncovered = modelsWithOrganizationId.filter(
      (name) =>
        !(ORG_SCOPED_MODELS as readonly string[]).includes(name) &&
        !(ORG_SCOPE_EXEMPT_MODELS as readonly string[]).includes(name),
    );
    expect(uncovered, "models with organizationId missing from ORG_SCOPED_MODELS").toEqual([]);
  });

  it("does not list models that lack an organizationId column", () => {
    const stale = ORG_SCOPED_MODELS.filter(
      (name) =>
        !schemaModels().some((model) => model.name === name) ||
        !modelsWithOrganizationId.includes(name),
    );
    expect(stale, "ORG_SCOPED_MODELS entries without organizationId in schema").toEqual([]);
  });

  it("exempts exactly the models that must not be auto-scoped", () => {
    const expected = modelsWithOrganizationId.filter(
      (name) => !(ORG_SCOPED_MODELS as readonly string[]).includes(name),
    );
    expect([...ORG_SCOPE_EXEMPT_MODELS].sort()).toEqual(expected.sort());
  });
});

describe("withOrgContext", () => {
  function fakeClient(): {
    called: Array<{ model: string; op: string; args: Record<string, unknown> }>;
    client: Record<string, unknown>;
  } {
    const called: Array<{ model: string; op: string; args: Record<string, unknown> }> = [];
    const delegate = new Proxy(
      {},
      {
        get: (_, opProp) => (opProp === "then" ? undefined : () => undefined),
      },
    );
    const client = new Proxy(
      {},
      {
        get: (_, modelProp) => {
          if (typeof modelProp !== "string") return undefined;
          return new Proxy(delegate, {
            get: (delegateTarget, opProp) => {
              if (typeof opProp !== "string") return undefined;
              return (...args: unknown[]) => {
                called.push({
                  model: modelProp,
                  op: opProp,
                  args: args[0] as Record<string, unknown>,
                });
                return Promise.resolve({});
              };
            },
          });
        },
      },
    );
    return { called, client };
  }

  it("injects organizationId into scoped operations", async () => {
    const { called, client } = fakeClient();
    const scoped = withOrgContext(client as never, "org-1");
    await (
      scoped as never as {
        auditEvent: { findMany: (args: unknown) => Promise<unknown> };
      }
    ).auditEvent.findMany({ where: { status: "ACTIVE" }, take: 5 });

    expect(called).toHaveLength(1);
    const call = called[0]!;
    expect(call.model).toBe("auditEvent");
    expect(call.op).toBe("findMany");
    expect(call.args.where).toEqual({ AND: [{ organizationId: "org-1" }, { status: "ACTIVE" }] });
    expect(call.args.take).toBe(5);
  });

  it("injects organizationId even when no where is given", async () => {
    const { called, client } = fakeClient();
    const scoped = withOrgContext(client as never, "org-2");
    await (
      scoped as never as { repository: { count: (args: unknown) => Promise<unknown> } }
    ).repository.count({});

    expect(called[0]!.args.where).toEqual({ organizationId: "org-2" });
  });

  it("scopes update and delete as well as reads", async () => {
    const { called, client } = fakeClient();
    const scoped = withOrgContext(client as never, "org-3");
    const delegate = scoped as never as {
      vendorChangeEvent: {
        update: (args: unknown) => Promise<unknown>;
        deleteMany: (args: unknown) => Promise<unknown>;
      };
    };
    await delegate.vendorChangeEvent.update({ where: { id: "e-1" }, data: { status: "CLOSED" } });
    await delegate.vendorChangeEvent.deleteMany({});

    expect(called).toHaveLength(2);
    expect(called[0]!.args.where).toEqual({ AND: [{ organizationId: "org-3" }, { id: "e-1" }] });
    expect(called[1]!.args.where).toEqual({ organizationId: "org-3" });
  });

  it("leaves unscoped models and create untouched", async () => {
    const { called, client } = fakeClient();
    const scoped = withOrgContext(client as never, "org-4");
    const delegate = scoped as never as {
      organization: { findMany: (args: unknown) => Promise<unknown> };
      auditEvent: { create: (args: unknown) => Promise<unknown> };
    };
    await delegate.organization.findMany({ where: { name: "root" } });
    await delegate.auditEvent.create({ data: { organizationId: "org-9" } });

    expect(called).toHaveLength(2);
    expect(called[0]!.args.where).toEqual({ name: "root" });
    expect(called[1]!.args).toEqual({ data: { organizationId: "org-9" } });
  });
});
