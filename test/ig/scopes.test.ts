import { test, expect } from "bun:test";
import { normalizeScopes } from "../../src/ig/endpoints.ts";
import {
  parseScopeFlag,
  SCOPE_BASIC,
  SCOPE_COMMENTS,
  SCOPE_MESSAGES,
} from "../../src/ig/oauth.ts";
import { CliError } from "../../src/lib/exit-codes.ts";

test("parseScopeFlag: undefined returns basic only", () => {
  expect(parseScopeFlag(undefined)).toEqual([SCOPE_BASIC]);
});

test("parseScopeFlag: empty string returns basic only", () => {
  expect(parseScopeFlag("")).toEqual([SCOPE_BASIC]);
});

test("parseScopeFlag: 'comments' adds manage_comments", () => {
  expect(parseScopeFlag("comments")).toEqual([SCOPE_BASIC, SCOPE_COMMENTS]);
});

test("parseScopeFlag: 'comments,messages' adds both", () => {
  const s = parseScopeFlag("comments,messages");
  expect(s).toContain(SCOPE_BASIC);
  expect(s).toContain(SCOPE_COMMENTS);
  expect(s).toContain(SCOPE_MESSAGES);
});

test("parseScopeFlag: deduplicates", () => {
  const s = parseScopeFlag("comments,comments");
  expect(s.filter((x) => x === SCOPE_COMMENTS)).toHaveLength(1);
});

test("parseScopeFlag: accepts raw scope names", () => {
  const s = parseScopeFlag("instagram_business_manage_comments");
  expect(s).toContain(SCOPE_COMMENTS);
});

test("parseScopeFlag: rejects unknown aliases", () => {
  expect(() => parseScopeFlag("nonsense")).toThrow(CliError);
});

test("normalizeScopes: comma string → array", () => {
  expect(normalizeScopes("a,b,c")).toEqual(["a", "b", "c"]);
});

test("normalizeScopes: trims whitespace", () => {
  expect(normalizeScopes(" a , b ,c")).toEqual(["a", "b", "c"]);
});

test("normalizeScopes: array passes through", () => {
  expect(normalizeScopes(["a", "b"])).toEqual(["a", "b"]);
});

test("normalizeScopes: undefined → undefined", () => {
  expect(normalizeScopes(undefined)).toBeUndefined();
});

test("normalizeScopes: empty → undefined", () => {
  expect(normalizeScopes("")).toBeUndefined();
});
