import type { ChangeRecord } from "./types.js";

export function diffStats(changes: ChangeRecord[]) {
  return changes.reduce(
    (total, change) => {
      const parts = diffParts(change.before, change.after);
      for (const part of parts) {
        if (part.kind === "removed") total.removed += part.text.length;
        if (part.kind === "added") total.added += part.text.length;
      }
      return total;
    },
    { added: 0, removed: 0 },
  );
}

export function diffParts(before: string, after: string): Array<{ kind: "same" | "removed" | "added"; text: string }> {
  const beforeTokens = tokenize(before);
  const afterTokens = tokenize(after);
  const rows = beforeTokens.length + 1;
  const cols = afterTokens.length + 1;
  const dp = Array.from({ length: rows }, () => Array<number>(cols).fill(0));

  for (let i = beforeTokens.length - 1; i >= 0; i--) {
    for (let j = afterTokens.length - 1; j >= 0; j--) {
      setCell(
        dp,
        i,
        j,
        tokenAt(beforeTokens, i) === tokenAt(afterTokens, j)
          ? cell(dp, i + 1, j + 1) + 1
          : Math.max(cell(dp, i + 1, j), cell(dp, i, j + 1)),
      );
    }
  }

  const parts: Array<{ kind: "same" | "removed" | "added"; text: string }> = [];
  let i = 0;
  let j = 0;

  while (i < beforeTokens.length && j < afterTokens.length) {
    if (tokenAt(beforeTokens, i) === tokenAt(afterTokens, j)) {
      pushPart(parts, "same", tokenAt(beforeTokens, i));
      i++;
      j++;
    } else if (cell(dp, i + 1, j) >= cell(dp, i, j + 1)) {
      pushPart(parts, "removed", tokenAt(beforeTokens, i));
      i++;
    } else {
      pushPart(parts, "added", tokenAt(afterTokens, j));
      j++;
    }
  }

  while (i < beforeTokens.length) pushPart(parts, "removed", tokenAt(beforeTokens, i++));
  while (j < afterTokens.length) pushPart(parts, "added", tokenAt(afterTokens, j++));

  return parts;
}

function tokenize(value: string): string[] {
  return value.match(/\s+|[^\s]+/g) ?? [];
}

function tokenAt(tokens: string[], index: number): string {
  return tokens[index] ?? "";
}

function cell(grid: number[][], row: number, col: number): number {
  return grid[row]?.[col] ?? 0;
}

function setCell(grid: number[][], row: number, col: number, value: number) {
  const target = grid[row];
  if (target) target[col] = value;
}

function pushPart(
  parts: Array<{ kind: "same" | "removed" | "added"; text: string }>,
  kind: "same" | "removed" | "added",
  text: string,
) {
  const previous = parts.at(-1);
  if (previous?.kind === kind) {
    previous.text += text;
  } else {
    parts.push({ kind, text });
  }
}
