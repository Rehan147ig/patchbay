import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzeRepository } from "./analyzer";
import { analyzeSource } from "./ast";
import type { AnalyzedUsage } from "./types";

const TRACKED = ["stripe", "openai", "twilio", "auth0"];
const ENV_PREFIXES = Object.fromEntries(TRACKED.map((pkg) => [pkg, pkg]));

const TESTDATA = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../testdata/sample-repo",
);

const BARREL_REPO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../testdata/barrel-repo",
);

const WORKSPACE_REPO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../testdata/workspace-repo",
);

const PAYMENTS_WORKSPACE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../testdata/payments-workspace",
);

const INSTANCE_FIELD_REPO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../testdata/instance-field-repo",
);

function fixtureDir(name: string): string {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../fixtures/repositories",
    name,
  );
}

function find(
  usages: AnalyzedUsage[],
  filePath: string,
  usageType: AnalyzedUsage["usageType"],
  symbol: string,
): AnalyzedUsage | undefined {
  return usages.find(
    (u) => u.filePath === filePath && u.usageType === usageType && u.symbol === symbol,
  );
}

describe("analyzeRepository - openai fixture", () => {
  it("indexes imports, initialization, method calls and env references", async () => {
    const analysis = await analyzeRepository({
      rootDir: fixtureDir("openai-node-legacy"),
      trackPackages: TRACKED,
    });

    const client = find(analysis.usages, "src/lib/openai-client.ts", "IMPORT", "OpenAI");
    expect(client?.line).toBe(1);

    const init = find(analysis.usages, "src/lib/openai-client.ts", "INITIALIZATION", "OpenAI");
    expect(init?.line).toBe(8);

    const call = find(
      analysis.usages,
      "src/chat/chat-service.ts",
      "METHOD_CALL",
      "openai.createChatCompletion",
    );
    expect(call?.line).toBe(31);
    expect(call?.excerpt).toContain("createChatCompletion");
    expect(call?.riskTags).toEqual([]);

    const embedding = find(
      analysis.usages,
      "src/embeddings/embedding-service.ts",
      "METHOD_CALL",
      "openai.createEmbedding",
    );
    expect(embedding).toBeDefined();

    const envRef = find(
      analysis.usages,
      "src/lib/openai-client.ts",
      "ENVIRONMENT_REFERENCE",
      "OPENAI_API_KEY",
    );
    expect(envRef).toBeDefined();
    expect(envRef?.riskTags).toEqual([]);
  });

  it("reports manifest, lockfile and snapshot facts", async () => {
    const analysis = await analyzeRepository({
      rootDir: fixtureDir("openai-node-legacy"),
      trackPackages: TRACKED,
    });

    expect(analysis.packageManager).toBe("pnpm");
    expect(analysis.lockfileVersions.openai).toBe("3.3.0");
    expect(analysis.packageCount).toBe(7);
    expect(analysis.typescriptFiles).toBe(7);
    expect(analysis.filesScanned).toBe(8);
    expect(analysis.commitSha).toMatch(/^snap-[0-9a-f]{12}$/);
    expect(analysis.errors).toEqual([]);
    expect(analysis.manifests[0]?.name).toBe("@acme/ai-assistant-service");
  });

  it("produces a stable snapshot hash for identical content", async () => {
    const first = await analyzeRepository({
      rootDir: fixtureDir("openai-node-legacy"),
      trackPackages: TRACKED,
    });
    const second = await analyzeRepository({
      rootDir: fixtureDir("openai-node-legacy"),
      trackPackages: TRACKED,
    });
    expect(second.commitSha).toBe(first.commitSha);
    expect(second.usages).toEqual(first.usages);
  });
});

describe("analyzeRepository - stripe fixture", () => {
  it("indexes the payment and webhook paths with risk tags", async () => {
    const analysis = await analyzeRepository({
      rootDir: fixtureDir("stripe-node-legacy"),
      trackPackages: TRACKED,
    });

    const init = find(analysis.usages, "src/lib/stripe-client.ts", "INITIALIZATION", "Stripe");
    expect(init?.line).toBe(9);

    const customer = find(
      analysis.usages,
      "src/payments/customers.ts",
      "METHOD_CALL",
      "stripe.customers.create",
    );
    expect(customer?.line).toBe(24);
    expect(customer?.riskTags).toEqual(["PAYMENT"]);

    const checkout = find(
      analysis.usages,
      "src/payments/checkout.ts",
      "METHOD_CALL",
      "stripe.checkout.sessions.create",
    );
    expect(checkout?.riskTags).toEqual(["PAYMENT"]);

    const webhook = find(
      analysis.usages,
      "src/webhooks/payment-intent.ts",
      "METHOD_CALL",
      "stripe.webhooks.constructEvent",
    );
    expect(webhook?.riskTags).toEqual(["WEBHOOK"]);

    expect(analysis.lockfileVersions.stripe).toBe("16.12.0");
  });
});

describe("analyzeRepository - twilio fixture", () => {
  it("indexes the legacy factory client and messages.create call", async () => {
    const analysis = await analyzeRepository({
      rootDir: fixtureDir("twilio-node-legacy"),
      trackPackages: TRACKED,
    });

    const init = find(analysis.usages, "src/lib/twilio-client.ts", "INITIALIZATION", "twilio");
    expect(init?.line).toBe(7);
    expect(init?.excerpt).toContain("TWILIO_ACCOUNT_SID");

    const send = find(
      analysis.usages,
      "src/notifications/sms.ts",
      "METHOD_CALL",
      "client.messages.create",
    );
    expect(send?.line).toBe(18);
    expect(send?.riskTags).toEqual([]);

    const fromNumber = find(
      analysis.usages,
      "src/notifications/queue.ts",
      "ENVIRONMENT_REFERENCE",
      "TWILIO_FROM_NUMBER",
    );
    expect(fromNumber).toBeDefined();

    expect(analysis.lockfileVersions.twilio).toBe("3.84.0");
  });
});

describe("analyzeRepository - auth0 fixture", () => {
  it("indexes verifyJwt, client initialization and env references with AUTH tags", async () => {
    const analysis = await analyzeRepository({
      rootDir: fixtureDir("auth0-node-legacy"),
      trackPackages: TRACKED,
    });

    const importUsage = find(analysis.usages, "src/middleware/authn.ts", "IMPORT", "auth0");
    expect(importUsage?.line).toBe(2);

    const init = find(
      analysis.usages,
      "src/middleware/authn.ts",
      "INITIALIZATION",
      "auth0.AuthenticationClient",
    );
    expect(init?.riskTags).toEqual(["AUTH"]);

    const verify = find(
      analysis.usages,
      "src/middleware/authn.ts",
      "METHOD_CALL",
      "auth0.verifyJwt",
    );
    expect(verify?.line).toBe(22);
    expect(verify?.riskTags).toEqual(["AUTH"]);

    const domain = find(
      analysis.usages,
      "src/config/auth.ts",
      "ENVIRONMENT_REFERENCE",
      "AUTH0_DOMAIN",
    );
    expect(domain?.line).toBe(4);
    expect(domain?.riskTags).toEqual(["AUTH"]);

    expect(analysis.lockfileVersions.auth0).toBe("3.3.0");
  });
});

describe("analyzeRepository - barrel-repo fixture", () => {
  it("indexes usages through barrel re-exports and factory exports", async () => {
    const analysis = await analyzeRepository({ rootDir: BARREL_REPO, trackPackages: TRACKED });

    const barrelOpenai = find(
      analysis.usages,
      "src/app.ts",
      "METHOD_CALL",
      "openai.createChatCompletion",
    );
    expect(barrelOpenai).toBeDefined();
    expect(barrelOpenai?.line).toBe(4);

    const factoryConsumer = find(
      analysis.usages,
      "src/app.ts",
      "METHOD_CALL",
      "s.customers.create",
    );
    expect(factoryConsumer).toBeDefined();
    expect(factoryConsumer?.line).toBe(7);

    expect(analysis.errors).toEqual([]);
  });

  it("indexes identifier assignment chains within one file", async () => {
    const analysis = await analyzeRepository({ rootDir: BARREL_REPO, trackPackages: TRACKED });

    const chained = find(analysis.usages, "src/chain.ts", "METHOD_CALL", "b.createChatCompletion");
    expect(chained).toBeDefined();
  });

  it("records nothing when an export cannot be proven and never crashes", async () => {
    const analysis = await analyzeRepository({ rootDir: BARREL_REPO, trackPackages: TRACKED });

    const unrelated = analysis.usages.filter((u) => u.filePath === "src/unrelated-user.ts");
    expect(unrelated).toEqual([]);
    expect(analysis.untrackedUsages).toBe(0);
    expect(analysis.errors).toEqual([]);
  });

  it("fails closed: never resolves imports outside the scanned root", async () => {
    const analysis = await analyzeRepository({ rootDir: BARREL_REPO, trackPackages: TRACKED });

    const crossRepo = analysis.usages.filter((u) => u.filePath === "src/cross-repo.ts");
    expect(crossRepo).toEqual([]);
  });
});

describe("analyzeRepository - workspace-repo fixture", () => {
  it("resolves package-name imports through pnpm-workspace.yaml entries", async () => {
    const analysis = await analyzeRepository({ rootDir: WORKSPACE_REPO, trackPackages: TRACKED });

    const consumer = find(
      analysis.usages,
      "apps/consumer/src/app.ts",
      "METHOD_CALL",
      "stripe.customers.create",
    );
    expect(consumer).toBeDefined();
    expect(consumer?.riskTags).toEqual([]);

    const unmatched = analysis.usages.filter((u) => u.filePath === "apps/consumer/src/other.ts");
    expect(unmatched).toEqual([]);
    expect(analysis.manifests.map((m) => m.name)).toContain("@acme/shared");
    expect(analysis.errors).toEqual([]);
  });
});

describe("analyzeRepository - payments-workspace fixture", () => {
  it("indexes stripe usage in apps/api/src/charge.ts via workspace package", async () => {
    const analysis = await analyzeRepository({
      rootDir: PAYMENTS_WORKSPACE,
      trackPackages: ["stripe"],
    });

    const charge = find(
      analysis.usages,
      "apps/api/src/charge.ts",
      "METHOD_CALL",
      "stripe.charges.create",
    );
    expect(charge).toBeDefined();
    expect(charge?.riskTags).toEqual(["PAYMENT"]);
  });

  it("resolves exports-field subpaths and skips unresolvable packages", async () => {
    const analysis = await analyzeRepository({
      rootDir: PAYMENTS_WORKSPACE,
      trackPackages: ["stripe"],
    });

    const refund = find(
      analysis.usages,
      "apps/api/src/refund.ts",
      "METHOD_CALL",
      "stripe.refunds.create",
    );
    expect(refund).toBeDefined();

    const unknown = analysis.usages.filter((u) => u.filePath === "apps/api/src/unknown.ts");
    expect(unknown).toEqual([]);
    expect(analysis.errors).toEqual([]);
  });
});

describe("analyzeRepository - instance-field-repo fixture", () => {
  it("indexes this.field chains on tracked instance fields", async () => {
    const analysis = await analyzeRepository({
      rootDir: INSTANCE_FIELD_REPO,
      trackPackages: TRACKED,
    });

    const call = find(
      analysis.usages,
      "src/payments-service.ts",
      "METHOD_CALL",
      "this.stripe.charges.create",
    );
    expect(call).toBeDefined();
    expect(call?.riskTags).toEqual(["PAYMENT"]);

    const customer = find(
      analysis.usages,
      "src/payments-service.ts",
      "METHOD_CALL",
      "this.stripe.customers.create",
    );
    expect(customer).toBeDefined();
    expect(customer?.riskTags).toEqual([]);
  });

  it("indexes this.client = stripe constructor assignment aliases", async () => {
    const analysis = await analyzeRepository({
      rootDir: INSTANCE_FIELD_REPO,
      trackPackages: TRACKED,
    });

    const call = find(
      analysis.usages,
      "src/customer-service.ts",
      "METHOD_CALL",
      "this.client.customers.create",
    );
    expect(call).toBeDefined();
  });

  it("records nothing for unprovable instance fields and never crashes", async () => {
    const analysis = await analyzeRepository({
      rootDir: INSTANCE_FIELD_REPO,
      trackPackages: TRACKED,
    });

    const unproven = analysis.usages.filter(
      (u) => u.filePath === "src/unproven.ts" && u.usageType === "METHOD_CALL",
    );
    expect(unproven).toEqual([]);
    expect(analysis.errors).toEqual([]);
  });
});

describe("analyzeRepository - exclusions and attribution", () => {
  it("never scans node_modules or dist, and attributes env refs via prefixes", async () => {
    const analysis = await analyzeRepository({ rootDir: TESTDATA, trackPackages: TRACKED });

    expect(analysis.filesScanned).toBe(2);
    expect(analysis.typescriptFiles).toBe(1);
    expect(analysis.usages.some((u) => u.filePath.includes("node_modules"))).toBe(false);
    expect(analysis.usages.some((u) => u.filePath.includes("dist"))).toBe(false);

    const init = find(analysis.usages, "src/app.ts", "INITIALIZATION", "Stripe");
    expect(init).toBeDefined();
    const call = find(analysis.usages, "src/app.ts", "METHOD_CALL", "stripe.paymentIntents.create");
    expect(call?.riskTags).toEqual(["PAYMENT"]);
    const envRef = find(
      analysis.usages,
      "src/app.ts",
      "ENVIRONMENT_REFERENCE",
      "STRIPE_SECRET_KEY",
    );
    expect(envRef).toBeDefined();
  });
});

describe("analyzeSource - unit level", () => {
  const PREFIXES = ENV_PREFIXES;

  it("detects require() bindings and commonjs factory calls", () => {
    const source = `const stripe = require("stripe");\nconst client = stripe(process.env.STRIPE_SECRET_KEY);\nclient.customers.create({});\n`;
    const result = analyzeSource(source, "src/x.ts", new Set(TRACKED), PREFIXES);
    expect(result.usages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ usageType: "IMPORT", symbol: "stripe", line: 1 }),
        expect.objectContaining({ usageType: "INITIALIZATION", symbol: "stripe", line: 2 }),
        expect.objectContaining({
          usageType: "METHOD_CALL",
          symbol: "client.customers.create",
          line: 3,
        }),
      ]),
    );
  });

  it("attributes CONFIG objects via name prefixes", () => {
    const source = `const auth0Config = { domain: "x", clientId: "y" };\nconst otherConfig = { a: 1, b: 2 };\n`;
    const result = analyzeSource(source, "src/config/auth.ts", new Set(TRACKED), PREFIXES);
    expect(result.usages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          usageType: "CONFIG",
          symbol: "auth0Config",
          packageName: "auth0",
        }),
      ]),
    );
    expect(result.untrackedUsages).toBe(1);
  });

  it("dedupes identical usages and reports untracked env refs", () => {
    const source = `process.env.NODE_ENV\nprocess.env.NODE_ENV;\n`;
    const result = analyzeSource(source, "src/x.ts", new Set(TRACKED), PREFIXES);
    expect(result.usages).toEqual([]);
    expect(result.untrackedUsages).toBe(2);
  });

  it("keeps require('openai') bound", () => {
    const source = `const openai = require('openai');\nopenai.createChatCompletion({});\n`;
    const result = analyzeSource(source, "src/x.ts", new Set(TRACKED), PREFIXES);
    expect(result.usages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ usageType: "IMPORT", symbol: "openai" }),
        expect.objectContaining({
          usageType: "METHOD_CALL",
          symbol: "openai.createChatCompletion",
        }),
      ]),
    );
  });

  it("binds require() when a ternary's branches are the same tracked package", () => {
    const source = `const stripe = require(cond ? "stripe" : "stripe");\nstripe.customers.create({});\n`;
    const result = analyzeSource(source, "src/x.ts", new Set(TRACKED), PREFIXES);
    expect(result.usages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ usageType: "IMPORT", symbol: "stripe" }),
        expect.objectContaining({ usageType: "METHOD_CALL", symbol: "stripe.customers.create" }),
      ]),
    );
  });

  it("fails closed: require(variable) indexes zero usages", () => {
    const source = `const name = "stripe";\nconst pkg = require(name);\npkg.customers.create({});\n`;
    const result = analyzeSource(source, "src/x.ts", new Set(TRACKED), PREFIXES);
    expect(result.usages).toEqual([]);
  });

  it("fails closed: require() ternary with a non-literal branch", () => {
    const source = `const pkg = require(cond ? "stripe" : other);\npkg.customers.create({});\n`;
    const result = analyzeSource(source, "src/x.ts", new Set(TRACKED), PREFIXES);
    expect(result.usages).toEqual([]);
  });

  it("fails closed: require() ternary with two different tracked packages", () => {
    const source = `const pkg = require(cond ? "stripe" : "openai");\npkg.customers.create({});\n`;
    const result = analyzeSource(source, "src/x.ts", new Set(TRACKED), PREFIXES);
    expect(result.usages).toEqual([]);
  });

  it("fails closed: Nest @Injectable() decorator metadata is not indexed", () => {
    const source = [
      'import Stripe from "stripe";',
      "@Injectable()",
      "export class PaymentsService {",
      '  private readonly stripe = new Stripe("sk-test");',
      "  run(): void {",
      "    this.stripe.customers.create({});",
      "  }",
      "}",
    ].join("\n");
    const result = analyzeSource(source, "src/x.ts", new Set(TRACKED), PREFIXES);
    expect(
      result.usages.some(
        (u) => u.symbol.includes("Injectable") || u.symbol.includes("Injectable()"),
      ),
    ).toBe(false);
    expect(
      result.usages.some(
        (u) => u.usageType === "METHOD_CALL" && u.symbol === "this.stripe.customers.create",
      ),
    ).toBe(true);
  });

  it("fails closed: export default withAuth(Page) HOC is not unwrapped", () => {
    const source = `const client = new OpenAI(\"k\");\nexport default withAuth(() => client);\n`;
    const result = analyzeSource(source, "src/x.ts", new Set(TRACKED), PREFIXES);
    expect(result.usages.some((u) => u.symbol.includes("withAuth"))).toBe(false);
    expect(result.usages.map((u) => u.usageType).filter((t) => t !== "INITIALIZATION")).toEqual([]);
  });
});
