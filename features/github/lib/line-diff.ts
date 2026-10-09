export type DiffLine = { kind: "same" | "added" | "removed"; text: string };
// Bound the matrix for large files. Side-by-side originals always remain available.
export function lineDiff(before: string, after: string): DiffLine[] | null {
  const left = before ? before.split("\n") : [], right = after ? after.split("\n") : [];
  if (left.length * right.length > 250000 || left.length + right.length > 4000) return null;
  const rows = Array.from({ length: left.length + 1 }, () => new Uint16Array(right.length + 1));
  for (let i = left.length - 1; i >= 0; i--) for (let j = right.length - 1; j >= 0; j--) rows[i][j] = left[i] === right[j] ? rows[i + 1][j + 1] + 1 : Math.max(rows[i + 1][j], rows[i][j + 1]);
  const result: DiffLine[] = []; let i = 0, j = 0;
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) { result.push({ kind: "same", text: left[i++] }); j++; }
    else if (i < left.length && (j >= right.length || rows[i + 1][j] >= rows[i][j + 1])) result.push({ kind: "removed", text: left[i++] });
    else result.push({ kind: "added", text: right[j++] });
  }
  return result;
}
