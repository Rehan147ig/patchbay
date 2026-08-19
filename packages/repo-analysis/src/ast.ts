import ts from "typescript";
import { UsageType } from "@patchbay/domain";
import { classifyRiskTags } from "./risk";
import type { AnalyzedUsage, RelativeModuleResolver } from "./types";

interface Binding {
  packageName: string;
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
): { usages: AnalyzedUsage[]; untrackedUsages: number } {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

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
    });
  }

  /** Prefix-based attribution: OPENAI_API_KEY -> "openai" (first segment). */
  function packageFromEnvName(envName: string): string | null {
    const prefix = envName.toLowerCase().split("_")[0] ?? "";
    return envPrefixes[prefix] ?? null;
  }

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
        if (binding) {
          addUsage(binding.packageName, UsageType.INITIALIZATION, callee.text, node);
        }
      } else {
        const root = rootIdentifier(callee);
        if (root && bindings.has(root.text)) {
          addUsage(
            bindings.get(root.text)!.packageName,
            UsageType.METHOD_CALL,
            callee.getText(sourceFile),
            node,
          );
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
      addUsage(binding.packageName, UsageType.IMPORT, name, importNode);
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
            } else if (resolveRelative) {
              const resolved = resolveRelative(filePath, argument.text);
              if (resolved?.defaultPackage) {
                addBinding(declaration.name.text, resolved.defaultPackage, declaration);
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
