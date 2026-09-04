import ts from "typescript";
import { UsageType } from "@patchbay/domain";
import { classifyRiskTags } from "./risk";
import { FACADE_MODEL_CALLS, facadeProviderOf } from "./facades";
import type { AnalyzedUsage, FacadeAttribution, RelativeModuleResolver } from "./types";

interface Binding {
  packageName: string;
  /** Canonical vendor slug when bound through a provider facade. */
  underlyingVendor?: string;
}

const CONFIG_NAME_PATTERN = /(config|settings|options|credentials)/i;
const MAX_EXCERPT_LENGTH = 200;

/**
 * Walks a dotted expression chain to its left-most identifier, e.g.
 * `process.env.OPENAI_API_KEY` -> `process`, `auth0.verifyJwt` -> `auth0`,
 * `this.stripe.charges.create` -> `stripe` (instance-field chains root at the
 * field name; bare `this` without a property yields null).
 */
export function rootIdentifier(expression: ts.Expression): ts.Identifier | null {
  let current: ts.Expression = expression;
  for (;;) {
    if (ts.isIdentifier(current)) return current;
    if (ts.isPropertyAccessExpression(current)) {
      if (current.expression.kind === ts.SyntaxKind.ThisKeyword) {
        return ts.isIdentifier(current.name) ? current.name : null;
      }
      current = current.expression;
      continue;
    }
    if (ts.isElementAccessExpression(current)) {
      current = current.expression;
      continue;
    }
    return null;
  }
}

/**
 * Indexes usages of tracked npm packages in a single TypeScript source file.
 * Deterministic: same file, same options -> same usage records.
 *
 * Detected usage types:
 * - IMPORT: import/require of a tracked package (one record per local binding)
 * - INITIALIZATION: `new Pkg(...)` or factory call `pkg(...)` on a tracked binding
 * - METHOD_CALL: property call chains rooted at a tracked binding
 * - CONFIG: const/let named config*, settings*, options* or credentials* with an object literal
 * - ENVIRONMENT_REFERENCE: process.env.X accesses
 *
 * CONFIG/ENVIRONMENT_REFERENCE usages are attributed to a tracked package via
 * `envPrefixes` (e.g. `AUTH0_DOMAIN` -> prefix `auth0` -> package `auth0`).
 * Untracked usages are dropped; the count is reported as `untrackedUsages`.
 */
export function analyzeSource(
  source: string,
  filePath: string,
  trackPackages: Set<string>,
  envPrefixes: Record<string, string>,
  resolveRelative: RelativeModuleResolver | null = null,
  parsedSourceFile?: ts.SourceFile,
): { usages: AnalyzedUsage[]; untrackedUsages: number } {
  const sourceFile =
    parsedSourceFile ??
    ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  const bindings = collectBindings(sourceFile, filePath, trackPackages, resolveRelative);
  const recorded = new Map<string, AnalyzedUsage>();
  let untrackedUsages = 0;

  function record(usage: AnalyzedUsage): void {
    const key = `${usage.usageType}|${usage.symbol}|${usage.line}:${usage.column}`;
    if (!recorded.has(key)) recorded.set(key, usage);
  }

  function position(node: ts.Node): { line: number; column: number } {
    const lc = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    return { line: lc.line + 1, column: lc.character + 1 };
  }

  function excerpt(lineNumber: number): string {
    const line = source.split("\n")[lineNumber - 1];
    if (line === undefined) return "";
    const trimmed = line.trim();
    return trimmed.length > MAX_EXCERPT_LENGTH
      ? `${trimmed.slice(0, MAX_EXCERPT_LENGTH - 3)}...`
      : trimmed;
  }

  function addUsage(
    packageName: string,
    usageType: UsageType,
    symbol: string,
    node: ts.Node,
    facade?: FacadeAttribution,
  ): void {
    const { line, column } = position(node);
    record({
      packageName,
      filePath,
      line,
      column,
      symbol,
      usageType,
      excerpt: excerpt(line),
      riskTags: classifyRiskTags(filePath, symbol),
      ...(facade ? { facade } : {}),
    });
  }

  /** Prefix-based attribution: OPENAI_API_KEY -> "openai" (first segment). */
  function packageFromEnvName(envName: string): string | null {
    const prefix = envName.toLowerCase().split("_")[0] ?? "";
    return envPrefixes[prefix] ?? null;
  }

  interface ProviderModel {
    vendorSlug: string;
    providerPackage: string;
    model: string | null;
  }

  /**
   * Intra-file map of variable names to the provider model they hold:
   * `const m = openai('gpt-4o')` or `const c = createOpenAI({...})`.
   * Built in a pre-pass so `model: m` references resolve regardless of order.
   * Fail-open toward detection (a usage inventory, not a type checker).
   */
  const providerVars = new Map<string, ProviderModel>();

  function firstStringArgument(call: ts.CallExpression): string | null {
    const first = call.arguments[0];
    return first && ts.isStringLiteral(first) ? first.text : null;
  }

  function providerBindingOf(name: string): FullBinding | null {
    const binding = bindings.get(name);
    return binding && binding.underlyingVendor ? binding : null;
  }

  /** Resolves an expression to the provider model it evaluates to, if any. */
  function resolveProviderModel(expression: ts.Expression): ProviderModel | null {
    if (ts.isIdentifier(expression)) {
      const bound = providerBindingOf(expression.text);
      if (bound) {
        return {
          vendorSlug: bound.underlyingVendor!,
          providerPackage: bound.packageName,
          model: null,
        };
      }
      return providerVars.get(expression.text) ?? null;
    }
    if (ts.isCallExpression(expression)) {
      const callee = expression.expression;
      if (ts.isIdentifier(callee)) {
        const bound = providerBindingOf(callee.text);
        if (bound) {
          return {
            vendorSlug: bound.underlyingVendor!,
            providerPackage: bound.packageName,
            model: firstStringArgument(expression),
          };
        }
        const factory = providerVars.get(callee.text);
        if (factory) {
          return { ...factory, model: firstStringArgument(expression) ?? factory.model };
        }
      } else {
        const root = rootIdentifier(callee);
        if (root) {
          const bound = providerBindingOf(root.text);
          if (bound) {
            return {
              vendorSlug: bound.underlyingVendor!,
              providerPackage: bound.packageName,
              model: firstStringArgument(expression),
            };
          }
        }
      }
    }
    return null;
  }

  function collectProviderVars(node: ts.Node): void {
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
        const resolved = resolveProviderModel(declaration.initializer);
        if (resolved) providerVars.set(declaration.name.text, resolved);
      }
    }
    ts.forEachChild(node, collectProviderVars);
  }

  /** The `model:` property value of a facade call's options argument, if any. */
  function modelArgumentOf(call: ts.CallExpression): ts.Expression | null {
    const options = call.arguments[0];
    if (!options || !ts.isObjectLiteralExpression(options)) return null;
    for (const property of options.properties) {
      if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.name)) {
        if (property.name.text === "model") return property.initializer;
      }
      if (ts.isShorthandPropertyAssignment(property) && property.name.text === "model") {
        return property.name;
      }
    }
    return null;
  }

  collectProviderVars(sourceFile);

  function packageFromConfigName(configName: string): string | null {
    const lower = configName.toLowerCase();
    for (const [prefix, packageName] of Object.entries(envPrefixes)) {
      if (lower.startsWith(prefix)) return packageName;
    }
    return null;
  }

  function visit(node: ts.Node): void {
    const isVariableStatement = ts.isVariableStatement(node);
    const isStandaloneDeclaration =
      ts.isVariableDeclaration(node) &&
      !(ts.isVariableDeclarationList(node.parent) && ts.isVariableStatement(node.parent.parent));
    if (isVariableStatement || isStandaloneDeclaration) {
      const declarations = isVariableStatement ? node.declarationList.declarations : [node];
      for (const declaration of declarations) {
        const name = ts.isIdentifier(declaration.name) ? declaration.name.text : null;
        const initializer = declaration.initializer;
        if (
          name &&
          CONFIG_NAME_PATTERN.test(name) &&
          initializer &&
          ts.isObjectLiteralExpression(initializer) &&
          initializer.properties.length >= 2
        ) {
          const packageName = packageFromConfigName(name);
          const { line, column } = position(declaration);
          if (packageName) {
            record({
              packageName,
              filePath,
              line,
              column,
              symbol: name,
              usageType: UsageType.CONFIG,
              excerpt: excerpt(line),
              riskTags: classifyRiskTags(filePath, name),
            });
          } else {
            untrackedUsages += 1;
          }
        }
      }
    }

    if (ts.isNewExpression(node)) {
      const root = rootIdentifier(node.expression);
      if (root && bindings.has(root.text)) {
        addUsage(
          bindings.get(root.text)!.packageName,
          UsageType.INITIALIZATION,
          node.expression.getText(sourceFile),
          node,
        );
      }
    }

    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee)) {
        const binding = bindings.get(callee.text);
        const provider = providerBindingOf(callee.text);
        if (provider) {
          // Provider factory/model call: `openai('gpt-4o')` attributes to the
          // underlying vendor with the statically resolvable model in the symbol.
          const model = firstStringArgument(node);
          addUsage(
            provider.underlyingVendor!,
            UsageType.INITIALIZATION,
            model ? `${provider.underlyingVendor}:${model}` : callee.text,
            node,
            { providerPackage: provider.packageName, model },
          );
        } else if (binding) {
          addUsage(binding.packageName, UsageType.INITIALIZATION, callee.text, node);
        } else if ((FACADE_MODEL_CALLS as readonly string[]).includes(callee.text)) {
          // Facade entry call: `generateText({ model: openai('gpt-4o') })`.
          // Works even when `ai` itself is untracked — the model expression
          // carries the provider identity.
          const modelArg = modelArgumentOf(node);
          const resolved = modelArg ? resolveProviderModel(modelArg) : null;
          if (resolved) {
            addUsage(
              resolved.vendorSlug,
              UsageType.METHOD_CALL,
              `${resolved.vendorSlug}:${resolved.model ?? "model"}`,
              node,
              { providerPackage: resolved.providerPackage, model: resolved.model },
            );
          }
        } else if (providerVars.has(callee.text)) {
          // Factory-result call: `customOpenAI('gpt-4-turbo')`.
          const factory = providerVars.get(callee.text)!;
          const model = firstStringArgument(node) ?? factory.model;
          addUsage(
            factory.vendorSlug,
            UsageType.METHOD_CALL,
            `${factory.vendorSlug}:${model ?? "model"}`,
            node,
            { providerPackage: factory.providerPackage, model },
          );
        }
      } else {
        const root = rootIdentifier(callee);
        if (root && bindings.has(root.text)) {
          const provider = providerBindingOf(root.text);
          if (provider) {
            addUsage(
              provider.underlyingVendor!,
              UsageType.METHOD_CALL,
              callee.getText(sourceFile),
              node,
              { providerPackage: provider.packageName, model: firstStringArgument(node) },
            );
          } else {
            addUsage(
              bindings.get(root.text)!.packageName,
              UsageType.METHOD_CALL,
              callee.getText(sourceFile),
              node,
            );
          }
        }
      }
    }

    if (ts.isPropertyAccessExpression(node)) {
      const name = node.name.text;
      if (name !== "env") {
        const root = rootIdentifier(node);
        if (root && root.text === "process") {
          const packageName = packageFromEnvName(name);
          const { line, column } = position(node);
          if (packageName) {
            record({
              packageName,
              filePath,
              line,
              column,
              symbol: name,
              usageType: UsageType.ENVIRONMENT_REFERENCE,
              excerpt: excerpt(line),
              riskTags: classifyRiskTags(filePath, name),
            });
          } else {
            untrackedUsages += 1;
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  for (const [name, binding] of bindings) {
    for (const importNode of binding.importNodes) {
      if (binding.underlyingVendor) {
        addUsage(binding.underlyingVendor, UsageType.IMPORT, name, importNode, {
          providerPackage: binding.packageName,
          model: null,
        });
      } else {
        addUsage(binding.packageName, UsageType.IMPORT, name, importNode);
      }
    }
  }

  visit(sourceFile);

  return {
    usages: [...recorded.values()].sort(
      (a, b) => a.filePath.localeCompare(b.filePath) || a.line - b.line || a.column - b.column,
    ),
    untrackedUsages,
  };
}

interface FullBinding extends Binding {
  importNodes: ts.Node[];
}

/** Node.js builtins that are never third-party packages. */
const NODE_BUILTINS = new Set([
  "assert",
  "buffer",
  "child_process",
  "cluster",
  "crypto",
  "dgram",
  "dns",
  "events",
  "fs",
  "http",
  "https",
  "net",
  "os",
  "path",
  "process",
  "querystring",
  "readline",
  "stream",
  "string_decoder",
  "timers",
  "tls",
  "tty",
  "url",
  "util",
  "v8",
  "vm",
  "worker_threads",
  "zlib",
]);

function normalizePackageName(specifier: string): string | null {
  if (
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.startsWith("node:") ||
    specifier.startsWith("@/") ||
    specifier === "" ||
    specifier === "@"
  ) {
    return null;
  }
  const segments = specifier.split("/");
  const candidate = specifier.startsWith("@") ? `${segments[0]}/${segments[1]}` : segments[0];
  if (!candidate || candidate === "@") return null;
  if (NODE_BUILTINS.has(candidate)) return null;
  return candidate;
}

/**
 * Collects bare third-party import specifiers from a single file, normalized
 * to package names (`@scope/pkg/sub` -> `@scope/pkg`), ONE ENTRY PER IMPORT
 * STATEMENT (a package imported twice yields two entries — callers count
 * occurrences for frequency ranking). Relative imports, workspace-resolvable
 * names are NOT filtered here (the caller knows the workspace map); Node
 * builtins are excluded. Deterministic (source order) and side-free.
 * Powers private-SDK auto-discovery: packages imported but not tracked.
 */
export function collectUntrackedImports(sourceFile: ts.SourceFile): string[] {
  const found: string[] = [];
  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const candidate = normalizePackageName(node.moduleSpecifier.text);
      if (candidate) found.push(candidate);
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "require" &&
      node.arguments.length === 1
    ) {
      const firstArg: ts.Node | undefined = node.arguments[0];
      if (firstArg && ts.isStringLiteral(firstArg)) {
        const candidate = normalizePackageName(firstArg.text);
        if (candidate) found.push(candidate);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return found;
}

/** Top-50 untracked packages ranked by import frequency (DESC), ties alphabetical. */
export const MAX_UNTRACKED_PACKAGES = 50;

export function rankUntrackedCounts(counts: ReadonlyMap<string, number>): string[] {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_UNTRACKED_PACKAGES)
    .map(([pkg]) => pkg);
}

/**
 * Collects local bindings that reference tracked packages:
 * 1. Direct imports/requires of tracked packages.
 * 2. Imports resolved through the module resolver (relative modules and
 *    workspace packages); unproven imports record nothing.
 * 3. Local aliases: `const stripe = new Stripe(...)`, `const client = twilio(...)`,
 *    and identifier chains `const a = openai; const b = a;`.
 */
export function collectBindings(
  sourceFile: ts.SourceFile,
  filePath: string,
  trackPackages: Set<string>,
  resolveRelative: RelativeModuleResolver | null,
): Map<string, FullBinding> {
  const bindings = new Map<string, FullBinding>();

  function packageOf(specifier: string): string | null {
    const segments = specifier.split("/");
    const candidate = specifier.startsWith("@") ? `${segments[0]}/${segments[1]}` : segments[0];
    if (!candidate) return null;
    return trackPackages.has(candidate) ? candidate : null;
  }

  function addBinding(name: string, packageName: string, node: ts.Node): void {
    const existing = bindings.get(name);
    if (existing) {
      if (existing.packageName === packageName) existing.importNodes.push(node);
      return;
    }
    bindings.set(name, { packageName, importNodes: [node] });
  }

  function addFacadeBinding(
    name: string,
    providerPackage: string,
    vendorSlug: string,
    node: ts.Node,
  ): void {
    const existing = bindings.get(name);
    if (existing) {
      if (existing.packageName === providerPackage && existing.underlyingVendor === vendorSlug) {
        existing.importNodes.push(node);
      }
      return;
    }
    bindings.set(name, {
      packageName: providerPackage,
      underlyingVendor: vendorSlug,
      importNodes: [node],
    });
  }

  function addAlias(name: string, packageName: string): void {
    const existing = bindings.get(name);
    if (!existing) bindings.set(name, { packageName, importNodes: [] });
  }

  /** Root identifier of a `new X(...)` / `x(...)` constructor expression. */
  function constructedFrom(initializer: ts.Expression | undefined): string | null {
    if (!initializer) return null;
    if (!ts.isNewExpression(initializer) && !ts.isCallExpression(initializer)) return null;
    const root = rootIdentifier(initializer.expression);
    return root && bindings.has(root.text) ? bindings.get(root.text)!.packageName : null;
  }

  function importNames(node: ts.ImportDeclaration): Array<{ name: string; localName: string }> {
    const clause = node.importClause;
    if (!clause) return [];
    const names: Array<{ name: string; localName: string }> = [];
    if (clause.name) {
      names.push({ name: clause.name.text, localName: clause.name.text });
    }
    if (clause.namedBindings) {
      if (ts.isNamespaceImport(clause.namedBindings)) {
        names.push({
          name: clause.namedBindings.name.text,
          localName: clause.namedBindings.name.text,
        });
      } else {
        for (const specifier of clause.namedBindings.elements) {
          const imported = (specifier.propertyName ?? specifier.name).text;
          names.push({ name: imported, localName: specifier.name.text });
        }
      }
    }
    return names;
  }

  function visitImports(node: ts.Node): void {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const specifier = node.moduleSpecifier.text;
      const directPackage = packageOf(specifier);
      if (directPackage) {
        for (const { localName } of importNames(node)) {
          addBinding(localName, directPackage, node);
        }
        return;
      }

      // Provider facade: `import { openai } from "@ai-sdk/openai"` binds the
      // local name to the provider package, but only when its underlying
      // vendor is tracked — otherwise the name stays unbound (fail-closed).
      const facade = facadeProviderOf(specifier);
      if (facade && trackPackages.has(facade.entry.vendorSlug)) {
        for (const { localName } of importNames(node)) {
          addFacadeBinding(localName, facade.providerPackage, facade.entry.vendorSlug, node);
        }
        return;
      }

      if (resolveRelative) {
        const resolved = resolveRelative(filePath, specifier);
        if (resolved) {
          const clause = node.importClause;
          if (clause?.name && resolved.defaultPackage) {
            addBinding(clause.name.text, resolved.defaultPackage, node);
          }
          if (clause?.namedBindings) {
            if (ts.isNamespaceImport(clause.namedBindings)) {
              const packages = new Set(resolved.named.values());
              if (resolved.named.size === 0 && resolved.defaultPackage) {
                addBinding(clause.namedBindings.name.text, resolved.defaultPackage, node);
              } else if (packages.size === 1 && resolved.named.size >= 1) {
                addBinding(clause.namedBindings.name.text, [...packages][0]!, node);
              }
            } else {
              for (const element of clause.namedBindings.elements) {
                const imported = (element.propertyName ?? element.name).text;
                const pkg = resolved.named.get(imported);
                if (pkg) addBinding(element.name.text, pkg, node);
              }
            }
          }
        }
      }
      return;
    }

    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        const initializer = declaration.initializer;
        if (
          initializer &&
          ts.isCallExpression(initializer) &&
          ts.isIdentifier(initializer.expression) &&
          initializer.expression.text === "require"
        ) {
          const argument = initializer.arguments[0];
          if (argument && ts.isStringLiteral(argument)) {
            const packageName = packageOf(argument.text);
            if (packageName) {
              addBinding(declaration.name.text, packageName, declaration);
            } else {
              const facade = facadeProviderOf(argument.text);
              if (facade && trackPackages.has(facade.entry.vendorSlug)) {
                addFacadeBinding(
                  declaration.name.text,
                  facade.providerPackage,
                  facade.entry.vendorSlug,
                  declaration,
                );
              } else if (resolveRelative) {
                const resolved = resolveRelative(filePath, argument.text);
                if (resolved?.defaultPackage) {
                  addBinding(declaration.name.text, resolved.defaultPackage, declaration);
                }
              }
            }
          } else if (
            argument &&
            ts.isConditionalExpression(argument) &&
            ts.isStringLiteral(argument.whenTrue) &&
            ts.isStringLiteral(argument.whenFalse)
          ) {
            const branches = [argument.whenTrue.text, argument.whenFalse.text];
            const tracked = branches.map((text) => packageOf(text));
            if (tracked[0] && tracked[1] && tracked[0] === tracked[1]) {
              addBinding(declaration.name.text, tracked[0], declaration);
            }
          }
        }
      }
    }

    ts.forEachChild(node, visitImports);
  }

  function visitAliases(node: ts.Node): void {
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        const initializer = declaration.initializer;
        if (!initializer) continue;
        let packageName = constructedFrom(initializer);
        if (!packageName && ts.isIdentifier(initializer)) {
          packageName = bindings.get(initializer.text)?.packageName ?? null;
        }
        if (packageName) addAlias(declaration.name.text, packageName);
      }
    }
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      for (const member of node.members) {
        if (!ts.isPropertyDeclaration(member) || !ts.isIdentifier(member.name)) continue;
        const packageName = constructedFrom(member.initializer);
        if (packageName) addAlias(member.name.text, packageName);
      }
    }
    if (ts.isExpressionStatement(node) && ts.isBinaryExpression(node.expression)) {
      const { left, right, operatorToken } = node.expression;
      if (
        operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isPropertyAccessExpression(left) &&
        left.expression.kind === ts.SyntaxKind.ThisKeyword &&
        ts.isIdentifier(left.name)
      ) {
        let packageName = constructedFrom(right);
        if (!packageName && ts.isIdentifier(right)) {
          packageName = bindings.get(right.text)?.packageName ?? null;
        }
        if (packageName) addAlias(left.name.text, packageName);
      }
    }
    ts.forEachChild(node, visitAliases);
  }

  visitImports(sourceFile);
  visitAliases(sourceFile);
  return bindings;
}
