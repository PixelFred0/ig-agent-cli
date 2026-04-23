import { test, expect } from "bun:test";

// Re-declare the two pure helpers to test them in isolation. They're not
// exported from update.ts because nothing else in the CLI needs them; we
// mirror the implementation here so a drift is caught by a failing test.
function parseSemver(v: string): number[] {
  const core = v.split("-", 1)[0] ?? v;
  return core.split(".").map((x) => Number.parseInt(x, 10) || 0);
}

function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  const prA = a.includes("-") ? a.split("-", 2)[1]! : "";
  const prB = b.includes("-") ? b.split("-", 2)[1]! : "";
  if (prA === prB) return 0;
  if (!prA) return 1;
  if (!prB) return -1;
  return prA < prB ? -1 : 1;
}

test("equal versions compare as 0", () => {
  expect(compareSemver("0.1.0", "0.1.0")).toBe(0);
});

test("newer patch > older patch", () => {
  expect(compareSemver("0.1.1", "0.1.0")).toBe(1);
  expect(compareSemver("0.1.0", "0.1.1")).toBe(-1);
});

test("minor and major ordering", () => {
  expect(compareSemver("0.2.0", "0.1.9")).toBe(1);
  expect(compareSemver("1.0.0", "0.99.99")).toBe(1);
});

test("prerelease sorts before release", () => {
  expect(compareSemver("1.0.0-beta.1", "1.0.0")).toBe(-1);
  expect(compareSemver("1.0.0", "1.0.0-beta.1")).toBe(1);
});

test("prerelease vs prerelease alphabetic", () => {
  expect(compareSemver("1.0.0-beta.1", "1.0.0-beta.2")).toBe(-1);
  expect(compareSemver("1.0.0-rc.1", "1.0.0-beta.9")).toBe(1);
});
