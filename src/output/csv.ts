import { writeFileSync } from "node:fs";

function escape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  if (rows.length === 0) return (columns ?? []).join(",") + "\n";
  const cols = columns ?? uniqueKeys(rows);
  const header = cols.join(",");
  const body = rows.map((row) => cols.map((c) => escape(row[c])).join(",")).join("\n");
  return header + "\n" + body + "\n";
}

function uniqueKeys(rows: Record<string, unknown>[]): string[] {
  const set = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) set.add(k);
  return [...set];
}

export function writeCsv(
  rows: Record<string, unknown>[],
  destination: string | undefined,
  columns?: string[],
): void {
  const csv = toCsv(rows, columns);
  if (destination) writeFileSync(destination, csv);
  else process.stdout.write(csv);
}
