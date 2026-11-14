/** Line diff for previews (LCS; fine for source files of a few thousand lines). */

export interface DiffLine {
  kind: "same" | "add" | "remove";
  text: string;
}

export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before === "" ? [] : before.split("\n");
  const b = after === "" ? [] : after.split("\n");
  if (a.length * b.length > 4_000_000) return [...a.map((text) => ({ kind: "remove" as const, text })), ...b.map((text) => ({ kind: "add" as const, text }))];
  const table: Uint32Array[] = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", text: a[i]! });
      i++;
      j++;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) out.push({ kind: "remove", text: a[i++]! });
    else out.push({ kind: "add", text: b[j++]! });
  }
  while (i < a.length) out.push({ kind: "remove", text: a[i++]! });
  while (j < b.length) out.push({ kind: "add", text: b[j++]! });
  return out;
}

/** Diff lines with unchanged runs shortened to `context` lines around changes. */
export function hunks(lines: DiffLine[], context = 3): (DiffLine | { kind: "gap"; count: number })[] {
  const keep = new Set<number>();
  lines.forEach((line, i) => {
    if (line.kind === "same") return;
    for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) keep.add(k);
  });
  const out: (DiffLine | { kind: "gap"; count: number })[] = [];
  let gap = 0;
  lines.forEach((line, i) => {
    if (keep.has(i)) {
      if (gap) out.push({ kind: "gap", count: gap });
      gap = 0;
      out.push(line);
    } else gap++;
  });
  if (gap) out.push({ kind: "gap", count: gap });
  return out;
}

export function diffStats(before: string | undefined, after: string | undefined): { added: number; removed: number } {
  const lines = lineDiff(before ?? "", after ?? "");
  return { added: lines.filter((l) => l.kind === "add").length, removed: lines.filter((l) => l.kind === "remove").length };
}
