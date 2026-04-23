import { test, expect } from "bun:test";
import { parseCodeArg } from "../../src/commands/auth.ts";

test("returns bare code unchanged", () => {
  expect(parseCodeArg("AQxyz123")).toBe("AQxyz123");
});

test("trims whitespace", () => {
  expect(parseCodeArg("  AQxyz123  ")).toBe("AQxyz123");
});

test("strips Instagram '#_' fragment tacked onto the redirect URL", () => {
  expect(parseCodeArg("AQxyz123#_")).toBe("AQxyz123");
});

test("strips any '#' fragment", () => {
  expect(parseCodeArg("AQxyz123#anything")).toBe("AQxyz123");
});

test("strips trailing slash", () => {
  expect(parseCodeArg("AQxyz123/")).toBe("AQxyz123");
});

test("strips trailing '/#_' (the real-world Meta quirk)", () => {
  expect(parseCodeArg("AQxyz123/#_")).toBe("AQxyz123");
});

test("extracts code from a full redirect URL", () => {
  const url = "https://localhost:8573/callback?code=AQxyz123&state=abc";
  expect(parseCodeArg(url)).toBe("AQxyz123");
});

test("extracts code from a redirect URL with '#_' trailer", () => {
  const url = "https://localhost:8573/callback?code=AQxyz123&state=abc#_";
  expect(parseCodeArg(url)).toBe("AQxyz123");
});

test("extracts code from a query-string-only paste", () => {
  expect(parseCodeArg("?code=AQxyz123&state=abc")).toBe("AQxyz123");
});

test("falls back to raw when URL has no code param", () => {
  expect(parseCodeArg("https://example.com/somewhere")).toBe("https://example.com/somewhere");
});
