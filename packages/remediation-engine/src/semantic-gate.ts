import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import * as ts from "typescript";

/**
 * Semantic validation gate.
 *
 * Replaces the `reparseCheck` proxy (`ts.transpileModule`, syntax only) with a
 * real type-checked program. A patch is accepted only when it introduces no
 * *new* semantic errors relative to the pre-patch baseline.
 *
 * Why baseline-relative and not absolute: real repositories carry pre-existing
 * type errors, missing ambient types, and unresolved optional imports. Failing
 * closed on absolute error count would reject every patch on every real repo.
 * The signal we want is "did *we* break something", which is the set difference.
 *
 * Patched content is supplied as an in-memory overlay, so nothing is written to
 * the working tree before the gate has passed.
 */

export interface SemanticError {
  filePath: string;
  line: number;
  code: number;
  message: string;
}

export interface SemanticGateResult {
  /** True when the patch introduced no new semantic errors. */
  ok: boolean;
  /** Errors present after patching that were absent before. */
  newErrors: SemanticError[];
  /** Errors the patch happened to fix. Useful signal, never a gate condition. */
  resolvedErrors: SemanticError[];
  baselineErrorCount: number;
  patchedErrorCount: number;
  /** True when no tsconfig was found and defaults were used. */
  usedFallbackConfig: boolean;
}

const DEFAULT_COMPILER_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  allowJs: true,
  esModuleInterop: true,
  // Deliberately off: these produce style noise, not correctness signal, and a
  // patch should not be blocked because the host repo tolerates unused locals.
  noUnusedLocals: false,
  noUnusedParameters: false,
};

function loadCompilerOptions(projectDir: string): {
  options: ts.CompilerOptions;
  usedFallback: boolean;
} {
  const configPath = ts.findConfigFile(projectDir, ts.sys.fileExists, "tsconfig.json");
  if (!configPath || !existsSync(configPath)) {
    return { options: { ...DEFAULT_COMPILER_OPTIONS }, usedFallback: true };
  }
  const raw = ts.readConfigFile(configPath, ts.sys.readFile);
  if (raw.error) {
    return { options: { ...DEFAULT_COMPILER_OPTIONS }, usedFallback: true };
  }
  const parsed = ts.parseJsonConfigFileContent(raw.config, ts.sys, path.dirname(configPath));
  return {
    options: { ...parsed.options, noEmit: true, skipLibCheck: true },
    usedFallback: false,
  };
}

/**
 * A compiler host that serves `overlay` content for the files it covers and
 * falls through to disk for everything else.
 */
function createOverlayHost(
  options: ts.CompilerOptions,
  overlay: Map<string, string>,
): ts.CompilerHost {
  const host = ts.createCompilerHost(options, true);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  const originalReadFile = host.readFile.bind(host);
  const originalFileExists = host.fileExists.bind(host);

  host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
    const overlaid = overlay.get(path.resolve(fileName));
    if (overlaid !== undefined) {
      return ts.createSourceFile(fileName, overlaid, languageVersion, true);
    }
    return originalGetSourceFile(fileName, languageVersion, onError, shouldCreate);
  };
  host.readFile = (fileName) => {
    const overlaid = overlay.get(path.resolve(fileName));
    return overlaid !== undefined ? overlaid : originalReadFile(fileName);
  };
  host.fileExists = (fileName) =>
    overlay.has(path.resolve(fileName)) || originalFileExists(fileName);

  return host;
}

function collectErrors(
  rootNames: string[],
  options: ts.CompilerOptions,
  overlay: Map<string, string>,
  projectDir: string,
): SemanticError[] {
  const program = ts.createProgram({
    rootNames,
    options,
    host: createOverlayHost(options, overlay),
  });

  const diagnostics = [...program.getSyntacticDiagnostics(), ...program.getSemanticDiagnostics()];

  const resolvedProjectDir = path.resolve(projectDir);
  const errors: SemanticError[] = [];

  for (const diagnostic of diagnostics) {
    if (diagnostic.category !== ts.DiagnosticCategory.Error) continue;
    const file = diagnostic.file;
    if (!file) continue;
    // Ignore anything outside the project (node_modules, lib.d.ts).
    const resolved = path.resolve(file.fileName);
    if (!resolved.startsWith(resolvedProjectDir)) continue;
    if (resolved.includes(`${path.sep}node_modules${path.sep}`)) continue;

    const position =
      diagnostic.start === undefined
        ? { line: 0 }
        : file.getLineAndCharacterOfPosition(diagnostic.start);

    errors.push({
      filePath: path.relative(resolvedProjectDir, resolved),
      line: position.line + 1,
      code: diagnostic.code,
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
    });
  }

  return errors;
}

/**
 * Fingerprint for set-differencing two diagnostic runs.
 *
 * Line number is deliberately excluded: a patch that inserts an import shifts
 * every line below it, and a pre-existing error must not be counted as new just
 * because it moved. File + code + message is stable under line shifts and still
 * distinguishes genuinely different errors.
 */
function fingerprint(error: SemanticError): string {
  return `${error.filePath}::${error.code}::${error.message}`;
}

export interface SemanticGateInput {
  /** Repository root. Used to locate tsconfig.json and scope diagnostics. */
  projectDir: string;
  /** Patched file contents, keyed by path relative to `projectDir`. */
  patchedFiles: Map<string, string>;
  /**
   * Optional explicit root file set. Defaults to the tsconfig's file list, or
   * the patched files themselves when no tsconfig exists.
   */
  rootNames?: string[];
}

export function runSemanticGate(input: SemanticGateInput): SemanticGateResult {
  const { projectDir, patchedFiles } = input;
  const { options, usedFallback } = loadCompilerOptions(projectDir);

  const configPath = ts.findConfigFile(projectDir, ts.sys.fileExists, "tsconfig.json");
  let rootNames = input.rootNames;
  if (!rootNames) {
    if (configPath) {
      const raw = ts.readConfigFile(configPath, ts.sys.readFile);
      const parsed = ts.parseJsonConfigFileContent(
        raw.config ?? {},
        ts.sys,
        path.dirname(configPath),
      );
      rootNames = parsed.fileNames;
    }
    if (!rootNames || rootNames.length === 0) {
      rootNames = [...patchedFiles.keys()].map((relative) => path.resolve(projectDir, relative));
    }
  }

  // Baseline: same program, original contents on disk, no overlay.
  const baselineErrors = collectErrors(rootNames, options, new Map(), projectDir);

  const overlay = new Map<string, string>();
  for (const [relative, content] of patchedFiles) {
    overlay.set(path.resolve(projectDir, relative), content);
  }
  const patchedErrors = collectErrors(rootNames, options, overlay, projectDir);

  const baselineKeys = new Set(baselineErrors.map(fingerprint));
  const patchedKeys = new Set(patchedErrors.map(fingerprint));

  const newErrors = patchedErrors.filter((error) => !baselineKeys.has(fingerprint(error)));
  const resolvedErrors = baselineErrors.filter((error) => !patchedKeys.has(fingerprint(error)));

  return {
    ok: newErrors.length === 0,
    newErrors,
    resolvedErrors,
    baselineErrorCount: baselineErrors.length,
    patchedErrorCount: patchedErrors.length,
    usedFallbackConfig: usedFallback,
  };
}

/** Convenience wrapper matching the shape of the old boolean check. */
export function semanticCheck(projectDir: string, patchedFiles: Map<string, string>): boolean {
  return runSemanticGate({ projectDir, patchedFiles }).ok;
}

/** Reads a file from the project, for callers building a baseline overlay. */
export function readProjectFile(projectDir: string, relativePath: string): string {
  return readFileSync(path.resolve(projectDir, relativePath), "utf8");
}
