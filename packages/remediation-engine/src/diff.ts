import { createHash } from "node:crypto";

/**
 * Line-based LCS unified diff between two file contents. Deterministic and
 * bounded: emits hunks with 3 lines of context, standard `-`/`+`/` ` markers
 * and `@@ -a,b +c,d @@` headers.
 */

interface DiffLine {
  kind: "ctx" | "del" | "add";
  text: string;
  oldLine: number;
  newLine: number;
}

export function unifiedDiff(original: string, patched: string, filePath: string): string {
  const before = original.split(/\r?\n/);
  const after = patched.split(/\r?\n/);

  const matrix = buildMatrix(before, after);
  const lcs = longestCommonSubsequence(matrix, before, after);

  const changes: DiffLine[] = [];
  let i = 0;
  let j = 0;
  let oldLine = 0;
  let newLine = 0;

  for (const [lcsI, lcsJ] of lcs) {
    while (i < lcsI) {
      changes.push({ kind: "del", text: before[i]!, oldLine: oldLine + 1, newLine: 0 });
      i += 1;
      oldLine += 1;
    }
    while (j < lcsJ) {
      changes.push({ kind: "add", text: after[j]!, oldLine: 0, newLine: newLine + 1 });
      j += 1;
      newLine += 1;
    }
    changes.push({ kind: "ctx", text: before[i]!, oldLine: oldLine + 1, newLine: newLine + 1 });
    i += 1;
    j += 1;
    oldLine += 1;
    newLine += 1;
  }
  while (i < before.length) {
    changes.push({ kind: "del", text: before[i]!, oldLine: oldLine + 1, newLine: 0 });
    i += 1;
    oldLine += 1;
  }
  while (j < after.length) {
    changes.push({ kind: "add", text: after[j]!, oldLine: 0, newLine: newLine + 1 });
    j += 1;
    newLine += 1;
  }

  const lines = [`--- a/${filePath}`, `+++ b/${filePath}`];
  let hunk: DiffLine[] = [];
  let hunkOldStart = 0;
  let hunkNewStart = 0;

  const flush = (): void => {
    if (hunk.length === 0) return;
    const oldCount = hunk.filter((line) => line.kind !== "add").length;
    const newCount = hunk.filter((line) => line.kind !== "del").length;
    lines.push(`@@ -${hunkOldStart},${oldCount} +${hunkNewStart},${newCount} @@`);
    for (const line of hunk) {
      const marker = line.kind === "del" ? "-" : line.kind === "add" ? "+" : " ";
      lines.push(`${marker}${line.text}`);
    }
    hunk = [];
  };

  let pendingContext: DiffLine[] = [];
  for (const change of changes) {
    if (change.kind === "ctx") {
      pendingContext.push(change);
      if (pendingContext.length > 3) pendingContext.shift();
      continue;
    }

    if (hunk.length === 0) {
      hunk = [...pendingContext];
      hunkOldStart = hunk[0]!.oldLine;
      hunkNewStart = hunk[0]!.newLine;
    }
    hunk.push(change);
    pendingContext = [];
  }

  if (pendingContext.length > 0 && hunk.length > 0) {
    hunk.push(...pendingContext);
  }
  flush();

  if (lines.length === 2) {
    return `--- a/${filePath}\n+++ b/${filePath}\n@@ -0,0 +0,0 @@\n(no changes)\n`;
  }

  return lines.join("\n");
}

interface MatrixCell {
  length: number;
  previous: [number, number] | null;
  add: boolean;
  remove: boolean;
}

function buildMatrix(a: string[], b: string[]): MatrixCell[][] {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix: MatrixCell[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({ length: 0, previous: null, add: false, remove: false })),
  );

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      if (a[i - 1] === b[j - 1]) {
        matrix[i]![j] = {
          length: matrix[i - 1]![j - 1]!.length + 1,
          previous: [i - 1, j - 1],
          add: false,
          remove: false,
        };
      } else if (matrix[i - 1]![j]!.length >= matrix[i]![j - 1]!.length) {
        matrix[i]![j] = {
          length: matrix[i - 1]![j]!.length,
          previous: [i - 1, j],
          add: false,
          remove: true,
        };
      } else {
        matrix[i]![j] = {
          length: matrix[i]![j - 1]!.length,
          previous: [i, j - 1],
          add: true,
          remove: false,
        };
      }
    }
  }
  return matrix;
}

function longestCommonSubsequence(
  matrix: MatrixCell[][],
  a: string[],
  b: string[],
): Array<[number, number]> {
  const result: Array<[number, number]> = [];
  let cell: MatrixCell | undefined = matrix[a.length]![b.length]!;
  let i = a.length;
  let j = b.length;
  while (cell?.previous) {
    if (!cell.add && !cell.remove) {
      result.unshift([i - 1, j - 1]);
    }
    const [pi, pj] = cell.previous;
    i = pi;
    j = pj;
    cell = matrix[i]![j]!;
  }
  return result;
}

export function sha256Hex(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}
