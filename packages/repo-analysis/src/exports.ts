import path from "node:path";
import ts from "typescript";
import type { ModuleExports, RelativeModuleResolver } from "./types";
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

  function returnsPackage(expr: ts.Expression | undefined): boolean {
    if (!expr) return false;
    if (ts.isNewExpression(expr) || ts.isCallExpression(expr)) {
      const root = rootIdentifier(expr.expression);
      return root !== null && bindings.has(root.text);
    }
    if (ts.isIdentifier(expr)) return bindings.has(expr.text);
    return false;
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
    if (returns.length > 0 && returns.every(returnsPackage)) {
      out.set(name.text, bindings.get(rootIdentifier(returns[0]!)!.text)!);
    }
  }

  return out;
}

/**
 * Collects the tracked exports of a single source file. Requires the file's
 * local bindings (direct package imports + local aliases) to already exist.
 */
export function collectModuleExports(
  sourceFile: ts.SourceFile,
  bindings: Map<string, string>,
): ModuleExports {
  const named = new Map<string, string>();
  let defaultPackage: string | null = null;
  const functionPackages = functionReturnPackages(sourceFile, bindings);

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

    if (
      ts.isExportDeclaration(statement) &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        const local = element.propertyName ?? element.name;
        if (!ts.isIdentifier(local)) continue;
        const pkg = bindings.get(local.text) ?? functionPackages.get(local.text) ?? null;
        if (pkg) named.set(element.name.text, pkg);
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

/** Injectable resolver used by `analyzeSource` for relative imports. */
export function makeRelativeResolver(
  exportsByFile: ReadonlyMap<string, ModuleExports>,
  files: Set<string>,
): RelativeModuleResolver {
  return (fromFile, specifier) => {
    if (!isRelativeSpecifier(specifier)) return null;
    const target = resolveRelativeTarget(fromFile, specifier, files);
    return target ? (exportsByFile.get(target) ?? null) : null;
  };
}
