import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { UsageType } from "@patchbay/domain";
import { analyzeRepository } from "./analyzer";
import { extractJavaUsages, javaSyntaxCheck, matchesTrackSet, parseJavaManifest } from "./java";

function fixtureDir(name: string): string {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../fixtures/repositories",
    name,
  );
}

const POM = `<?xml version="1.0"?>
<project>
  <groupId>com.acme</groupId>
  <artifactId>stripe-java-legacy</artifactId>
  <version>1.0.0</version>
  <dependencies>
    <dependency>
      <groupId>com.stripe</groupId>
      <artifactId>stripe-java</artifactId>
      <version>24.16.0</version>
    </dependency>
    <dependency>
      <groupId>junit</groupId>
      <artifactId>junit</artifactId>
      <version>\${junit.version}</version>
    </dependency>
  </dependencies>
</project>
`;

const GRADLE = `
plugins { id 'java' }
version = '2.3.0'
dependencies {
    implementation 'com.stripe:stripe-java:24.16.0'
    api 'com.google.code.gson:gson:2.10.1'
    testImplementation 'junit:junit:4.13.2'
}
`;

describe("java manifest parsing", () => {
  it("parses pom.xml dependencies and skips property placeholders", () => {
    const parsed = parseJavaManifest("pom.xml", POM);
    expect(parsed.format).toBe("maven");
    expect(parsed.manifest.name).toBe("stripe-java-legacy");
    expect(parsed.manifest.version).toBe("1.0.0");
    expect(parsed.manifest.dependencies["com.stripe:stripe-java"]).toBe("24.16.0");
    // ${junit.version} placeholder must be skipped, never guessed.
    expect(parsed.manifest.dependencies["junit:junit"]).toBeUndefined();
  });

  it("parses gradle dependency strings", () => {
    const parsed = parseJavaManifest("build.gradle", GRADLE);
    expect(parsed.format).toBe("gradle");
    expect(parsed.manifest.version).toBe("2.3.0");
    expect(parsed.manifest.dependencies["com.stripe:stripe-java"]).toBe("24.16.0");
    // testImplementation scope is intentionally not captured by the dep regex.
    expect(parsed.manifest.dependencies["junit:junit"]).toBeUndefined();
  });
});

describe("java L1 usage extraction (tree-sitter)", () => {
  const track = new Set(["stripe", "gson"]);

  it("records imports, constructor init, and method chains for tracked packages", async () => {
    const source = [
      "import com.stripe.Stripe;",
      "import com.stripe.model.PaymentIntent;",
      "import com.google.gson.Gson;",
      "",
      "public class S {",
      "    Gson gson = new Gson();",
      "    PaymentIntent create() {",
      '        Stripe.apiKey = "sk";',
      "        return PaymentIntent.create(null);",
      "    }",
      "}",
    ].join("\n");
    const usages = await extractJavaUsages(source, "src/S.java", track);

    expect(usages.some((u) => u.usageType === UsageType.IMPORT && u.packageName === "stripe")).toBe(
      true,
    );
    const init = usages.find((u) => u.usageType === UsageType.INITIALIZATION);
    expect(init?.packageName).toBe("gson");
    expect(init?.symbol).toBe("Gson");
    const calls = usages.filter((u) => u.usageType === UsageType.METHOD_CALL);
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(usages.every((u) => u.filePath === "src/S.java")).toBe(true);
  });

  it("ignores untracked imports (java.util, untracked vendors)", async () => {
    const usages = await extractJavaUsages(
      "import java.util.List;\nimport com.other.Lib;\nList<String> l = List.of();\n",
      "src/A.java",
      track,
    );
    expect(usages).toHaveLength(0);
  });

  it("is deterministic across parses", async () => {
    const source =
      'import com.stripe.Stripe;\npublic class X { void m() { Stripe.apiKey = "k"; } }\n';
    const first = await extractJavaUsages(source, "src/X.java", new Set(["stripe"]));
    const second = await extractJavaUsages(source, "src/X.java", new Set(["stripe"]));
    expect(first).toEqual(second);
  });

  it("matchesTrackSet uses dot-segment equality", () => {
    const set = new Set(["stripe"]);
    expect(matchesTrackSet("com.stripe.model.PaymentIntent", set)).toBe(true);
    expect(matchesTrackSet("com.stripelib.Thing", set)).toBe(false);
    expect(matchesTrackSet("java.util.List", set)).toBe(false);
  });
});

describe("javaSyntaxCheck", () => {
  it("accepts valid java and rejects broken java", async () => {
    expect(await javaSyntaxCheck("class A { void m() {} }\n")).toBe(true);
    expect(await javaSyntaxCheck("class A { void m( { }\n")).toBe(false);
  });
});

describe("stripe-java-legacy fixture", () => {
  it("indexes pom.xml plus java usages end to end", async () => {
    const analysis = await analyzeRepository({
      rootDir: fixtureDir("stripe-java-legacy"),
      trackPackages: ["stripe"],
    });

    expect(analysis.javaFiles).toBe(1);
    expect(analysis.errors).toEqual([]);
    expect(analysis.packageManager).toBe("maven");

    const stripeUsage = analysis.usages.filter((u) => u.packageName === "stripe");
    expect(stripeUsage.some((u) => u.usageType === UsageType.IMPORT)).toBe(true);
    expect(
      stripeUsage.some(
        (u) => u.usageType === UsageType.METHOD_CALL && u.symbol.includes("PaymentIntent.create"),
      ),
    ).toBe(true);
    expect(analysis.usages.some((u) => u.packageName === "gson")).toBe(false);

    const pom = analysis.manifests.find((m) => m.path === "pom.xml");
    expect(pom?.dependencies["com.stripe:stripe-java"]).toBe("24.16.0");
    // gson is a real pom dependency but untracked here -> no usages, still inventoried.
    expect(pom?.dependencies["com.google.code.gson:gson"]).toBe("2.10.1");
  });
});
