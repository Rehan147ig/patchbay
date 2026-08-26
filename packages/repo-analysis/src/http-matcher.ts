import ts from "typescript";

/**
 * Literal-only HTTP client canonicalizer for PLAN-level OpenAPI detection.
 * Matches fetch/axios/ky/got call shapes where the URL is a string literal
 * or template literal tail. No inter-procedural constant folding - bail to
 * PLAN when the URL cannot be resolved literally.
 */
export interface CanonicalHttpCallsite {
  client: "fetch" | "axios" | "ky" | "got";
  /** Matched endpoint path, e.g. "/v1/completions" */
  matchedEndpoint: string;
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  filePath: string;
  line: number;
  column: number;
}

const HTTP_CLIENTS = new Set(["fetch", "axios", "ky", "got"]);
const KNOWN_ENDPOINT_PREFIXES = ["/v1/", "/v2/", "/api/"];

function extractEndpoint(url: string): string | null {
  // Strip origin, keep path
  try {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      const parsed = new URL(url);
      return parsed.pathname;
    }
  } catch {
    return null;
  }
  // Already a path
  if (url.startsWith("/")) return url.split("?")[0] ?? url;
  return null;
}

function isKnownEndpoint(path: string): boolean {
  return KNOWN_ENDPOINT_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function urlExpressionToString(expr: ts.Expression): string | null {
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
    return expr.text;
  }
  if (ts.isTemplateExpression(expr)) {
    // Only the tail after the last substitution is literal - reconstruct the static suffix
    // e.g. `${BASE}/v1/completions` -> "/v1/completions" if spans end with that
    const lastSpan = expr.templateSpans[expr.templateSpans.length - 1];
    if (lastSpan) {
      const tail = lastSpan.literal.text;
      // Check if the tail itself is an endpoint
      if (tail.startsWith("/")) return tail.split("?")[0] ?? tail;
    }
    return null;
  }
  return null;
}

function inferMethod(node: ts.CallExpression): CanonicalHttpCallsite["method"] {
  // axios.get/post/put/delete/patch, fetch second arg { method: "POST" }
  const expr = node.expression;
  if (ts.isPropertyAccessExpression(expr)) {
    const name = expr.name.text.toLowerCase();
    if (["get", "post", "put", "delete", "patch"].includes(name)) {
      return name.toUpperCase() as CanonicalHttpCallsite["method"];
    }
  }
  // Check object literal second arg for method property
  for (const arg of node.arguments) {
    if (ts.isObjectLiteralExpression(arg)) {
      for (const prop of arg.properties) {
        if (
          ts.isPropertyAssignment(prop) &&
          ts.isIdentifier(prop.name) &&
          prop.name.text === "method" &&
          ts.isStringLiteral(prop.initializer)
        ) {
          const m = prop.initializer.text.toUpperCase();
          if (["GET", "POST", "PUT", "DELETE", "PATCH"].includes(m)) {
            return m as CanonicalHttpCallsite["method"];
          }
        }
      }
    }
  }
  return "GET";
}

function clientName(node: ts.CallExpression): CanonicalHttpCallsite["client"] | null {
  const expr = node.expression;
  if (ts.isIdentifier(expr) && HTTP_CLIENTS.has(expr.text)) {
    return expr.text as CanonicalHttpCallsite["client"];
  }
  if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression)) {
    const base = expr.expression.text;
    if (HTTP_CLIENTS.has(base)) return base as CanonicalHttpCallsite["client"];
  }
  return null;
}

export function findHttpCallsites(source: string, filePath: string): CanonicalHttpCallsite[] {
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
  const results: CanonicalHttpCallsite[] = [];

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const client = clientName(node);
      if (client && node.arguments.length > 0) {
        const urlExpr = node.arguments[0];
        if (urlExpr && ts.isExpression(urlExpr)) {
          const raw = urlExpressionToString(urlExpr as ts.Expression);
          if (raw) {
            const endpoint = extractEndpoint(raw);
            if (endpoint && isKnownEndpoint(endpoint)) {
              const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
              results.push({
                client,
                matchedEndpoint: endpoint,
                method: inferMethod(node),
                filePath,
                line: line + 1,
                column: character + 1,
              });
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return results;
}
