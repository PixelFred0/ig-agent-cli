import { test, expect } from "bun:test";
import { formatJson } from "../../src/output/json.ts";
import { toCsv } from "../../src/output/csv.ts";

test("formatJson compact has no extra whitespace", () => {
  expect(formatJson({ a: 1, b: [2, 3] }, false)).toBe('{"a":1,"b":[2,3]}');
});

test("formatJson pretty uses 2-space indent", () => {
  const s = formatJson({ a: 1 }, true);
  expect(s).toContain("\n  ");
});

test("CSV quoting handles commas quotes newlines", () => {
  const csv = toCsv(
    [{ a: 'he said "hi"', b: "x,y", c: "line1\nline2" }],
    ["a", "b", "c"],
  );
  const lines = csv.trim().split("\n");
  expect(lines[0]).toBe("a,b,c");
  expect(lines[1]).toContain('"he said ""hi"""');
  expect(lines[1]).toContain('"x,y"');
});

test("CSV empty rows emits just header", () => {
  const csv = toCsv([], ["a", "b"]);
  expect(csv).toBe("a,b\n");
});
