import path from "node:path";
import ts from "typescript";
import type { ModuleExports, RelativeModuleResolver, WorkspacePackage } from "./types";
import { rootIdentifier } from "./ast";

/**
 * Lightweight module-level export tracking used to follow the canonical legacy
 * pattern: `lib/stripe-client.ts` builds a client from a tracked package and
 * exports it (directly or via a factory function); consumers import that
 * binding from a relative path. Deterministic, no full type checking.
 */

/** Resolves a relative specifier to a repo file, or null when no file matches. */
export function resolveRelativeTarget(
  fromFile: string,
  specifier: string,
  files: Set<string>,
): string | null {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier));
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
    `${base}/index.js`,
    `${base}/index.jsx`,
  ];
  return candidates.find((candidate) => files.has(candidate)) ?? null;
}

/** True for specifiers like "./x" or "../lib/y". */
function isRelativeSpecifier(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../");
}

/**
 * Maps function names (in this file) to a tracked package when every return
 * path provably produces that package: the returned expression is a tracked
 * binding or a `new`/factory expression rooted at one.
 */
function functionReturnPackages(
  sourceFile: ts.SourceFile,
  bindings: Map<string, string>,
): Map<string, string> {
  const out = new Map<string, string>();

  function returnPackage(expr: ts.Expression | undefined): string | null {
    if (!expr) return null;
    if (ts.isNewExpression(expr) || ts.isCallExpression(expr)) {
      const root = rootIdentifier(expr.expression);
      return root ? (bindings.get(root.text) ?? null) : null;
    }
    if (ts.isIdentifier(expr)) return bindings.get(expr.text) ?? null;
    return null;
  }

  function returnExpressions(fn: ts.FunctionLikeDeclaration): ts.Expression[] {
    const out: ts.Expression[] = [];
    function visit(node: ts.Node): void {
      if (ts.isReturnStatement(node) && node.expression) out.push(node.expression);
      ts.forEachChild(node, visit);
    }
    visit(fn);
    return out;
  }

  for (const statement of sourceFile.statements) {
    let fn: ts.FunctionLikeDeclaration | undefined;
    let name: ts.Identifier | undefined;

    if (ts.isFunctionDeclaration(statement) && statement.name) {
      fn = statement;
      name = statement.name;
    } else if (ts.isVariableStatement(statement)) {
      const declaration = statement.declarationList.declarations.find(
        (d) => d.initializer !== undefined && ts.isArrowFunction(d.initializer),
      );
      if (declaration && ts.isIdentifier(declaration.name)) {
        name = declaration.name;
        fn = declaration.initializer as ts.FunctionLikeDeclaration;
      }
    }
    if (!fn || !name) continue;

    const returns = returnExpressions(fn);
    const proven = returns.length > 0 && returns.every((expr) => returnPackage(expr) !== null);
    if (proven) {
      const pkg = returnPackage(returns[0]);
      if (pkg) out.set(name.text, pkg);
    }
  }

  return out;
}

/**
 * Collects the tracked exports of a single source file. Requires the file's
 * local bindings (direct package imports + local aliases) to already exist.
 * Barrel re-exports (`export { openai } from "./openai-client"`, `export *`)
 * are resolved through `resolveModule` (may be null in single-file contexts).
 */
export function collectModuleExports(
  sourceFile: ts.SourceFile,
  bindings: Map<string, string>,
  resolveModule: RelativeModuleResolver | null = null,
): ModuleExports {
  const named = new Map<string, string>();
  let defaultPackage: string | null = null;
  const functionPackages = functionReturnPackages(sourceFile, bindings);
  const filePath = sourceFile.fileName;

  function packageOfExpression(expr: ts.Expression | undefined): string | null {
    if (!expr) return null;
    if (ts.isNewExpression(expr) || ts.isCallExpression(expr)) {
      const root = rootIdentifier(expr.expression);
      return root ? (bindings.get(root.text) ?? functionPackages.get(root.text) ?? null) : null;
    }
    if (ts.isIdentifier(expr)) {
      return bindings.get(expr.text) ?? functionPackages.get(expr.text) ?? null;
    }
    return null;
  }

  /** Exported package for a name re-exported from another module. */
  function reexportPackage(exportedName: string, specifier: ts.Expression): string | null {
    if (!resolveModule || !ts.isStringLiteral(specifier)) return null;
    const target = resolveModule(filePath, specifier.text);
    if (!target) return null;
    if (exportedName === "default") return target.defaultPackage;
    return target.named.get(exportedName) ?? null;
  }

  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement) && hasExportModifier(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        const pkg = packageOfExpression(declaration.initializer);
        if (pkg) named.set(declaration.name.text, pkg);
      }
    }

    if (ts.isFunctionDeclaration(statement) && hasExportModifier(statement) && statement.name) {
      const pkg = functionPackages.get(statement.name.text);
      if (pkg) named.set(statement.name.text, pkg);
    }

    if (ts.isExportDeclaration(statement)) {
      const fromTarget = statement.moduleSpecifier;
      if (statement.exportClause && ts.isNamedExports(statement.exportClause) && fromTarget) {
        for (const element of statement.exportClause.elements) {
          const exportedName = (element.propertyName ?? element.name).text;
          const pkg = reexportPackage(exportedName, fromTarget);
          if (pkg) named.set(element.name.text, pkg);
        }
      } else if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          const local = element.propertyName ?? element.name;
          if (!ts.isIdentifier(local)) continue;
          const pkg = bindings.get(local.text) ?? functionPackages.get(local.text) ?? null;
          if (pkg) named.set(element.name.text, pkg);
        }
      } else if (statement.exportClause && ts.isNamespaceExport(statement.exportClause)) {
        // `export * as lib from "./lib"` — not provable as a single package; skip.
        continue;
      } else if (fromTarget && ts.isStringLiteral(fromTarget)) {
        // `export * from "./x"`: fold in every provable target export.
        const target = resolveModule ? resolveModule(filePath, fromTarget.text) : null;
        if (target) {
          for (const [name, pkg] of target.named) {
            if (!named.has(name)) named.set(name, pkg);
          }
          if (!defaultPackage && target.defaultPackage) defaultPackage = target.defaultPackage;
        }
      }
    }

    if (ts.isExportAssignment(statement)) {
      const pkg = packageOfExpression(statement.expression);
      if (pkg) defaultPackage = pkg;
    }
  }

  return { named, defaultPackage };
}

function hasExportModifier(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  return (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

/**
 * Injectable resolver used by `analyzeSource` for relative imports and
 * workspace-package imports (`@acme/shared`, `@acme/payments/foo`).
 * `workspacePackages` maps package names to their resolved entry files.
 */
export function makeRelativeResolver(
  exportsByFile: ReadonlyMap<string, ModuleExports>,
  files: Set<string>,
  workspacePackages: ReadonlyMap<string, WorkspacePackage> = new Map(),
): RelativeModuleResolver {
  return (fromFile, specifier) => {
    if (isRelativeSpecifier(specifier)) {
      const target = resolveRelativeTarget(fromFile, specifier, files);
      return target ? (exportsByFile.get(target) ?? null) : null;
    }
    const pkg = workspacePackageFor(specifier, workspacePackages);
    if (!pkg) return null;
    const file = workspaceTargetFile(specifier, pkg);
    return file ? (exportsByFile.get(file) ?? null) : null;
  };
}

/** Matches `@acme/payments`, `@acme/payments/foo` and `payments/foo` to a package. */
function workspacePackageFor(
  specifier: string,
  workspacePackages: ReadonlyMap<string, WorkspacePackage>,
): WorkspacePackage | null {
  if (workspacePackages.has(specifier)) return workspacePackages.get(specifier) ?? null;
  const segments = specifier.split("/");
  const name = specifier.startsWith("@")
    ? `${segments[0]}/${segments[1] ?? ""}`
    : (segments[0] ?? "");
  return workspacePackages.get(name) ?? null;
}

/**
 * Entry file for a workspace specifier: an `exports`-field subpath mapping
 * when one matches, otherwise the package's `.` entry.
 */
function workspaceTargetFile(specifier: string, pkg: WorkspacePackage): string | null {
  const segments = specifier.split("/");
  const prefix = specifier.startsWith("@")
    ? `${segments[0]}/${segments[1] ?? ""}`
    : (segments[0] ?? "");
  const subpath = specifier.slice(prefix.length);
  if (!subpath) return pkg.entry;
  return pkg.subpaths.get(`.${subpath}`) ?? pkg.entry;
}
