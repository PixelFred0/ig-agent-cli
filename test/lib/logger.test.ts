import { test, expect } from "bun:test";
import { redactTokens } from "../../src/lib/logger.ts";

test("redacts Meta EAA tokens", () => {
  const s = `Token is EAAJ${"x".repeat(50)}; continue`;
  expect(redactTokens(s)).toContain("[REDACTED_TOKEN]");
  expect(redactTokens(s)).not.toContain("x".repeat(20));
});

test("redacts access_token and client_secret URL params", () => {
  const s = "https://graph.facebook.com/v21.0/me?access_token=eyJabcdef&client_secret=shh-don-t-tell";
  const out = redactTokens(s);
  expect(out).toContain("access_token=[REDACTED]");
  expect(out).toContain("client_secret=[REDACTED]");
  expect(out).not.toContain("eyJabcdef");
  expect(out).not.toContain("shh-don-t-tell");
});

test("redacts JSON access_token fields", () => {
  const s = `{"access_token":"ABC123notverylong","ok":true}`;
  const out = redactTokens(s);
  expect(out).toContain('"access_token":"[REDACTED]"');
});

test("redacts long bare tokens (80+ chars)", () => {
  const s = `bearer ${"a".repeat(100)} trailing`;
  expect(redactTokens(s)).toContain("[REDACTED]");
});

test("leaves short strings alone", () => {
  expect(redactTokens("hello world")).toBe("hello world");
  expect(redactTokens("error: file not found")).toBe("error: file not found");
});

test("redacts IG Login tokens (IGAA prefix)", () => {
  const s = `Token IGAA${"q".repeat(50)}ok`;
  expect(redactTokens(s)).toContain("[REDACTED_TOKEN]");
  expect(redactTokens(s)).not.toContain("q".repeat(20));
});

test("redacts ig_refresh_token and ig_exchange_token URL params", () => {
  const s =
    "https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=secretvalue";
  const out = redactTokens(s);
  expect(out).toContain("access_token=[REDACTED]");
  expect(out).not.toContain("secretvalue");
});
