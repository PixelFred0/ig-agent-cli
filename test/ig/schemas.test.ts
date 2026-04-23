import { test, expect } from "bun:test";
import {
  IgUserSchema,
  InsightsResponseSchema,
  MediaListSchema,
  MediaSchema,
} from "../../src/ig/schemas.ts";

test("parses IG user with all optional fields present", () => {
  const parsed = IgUserSchema.parse({
    id: "100",
    username: "tester",
    followers_count: 42,
    media_count: 7,
    biography: "bio",
    profile_picture_url: "https://cdn.example/p.jpg",
  });
  expect(parsed.id).toBe("100");
  expect(parsed.followers_count).toBe(42);
});

test("parses minimal IG user (id + username only)", () => {
  const parsed = IgUserSchema.parse({ id: "1", username: "u" });
  expect(parsed.username).toBe("u");
  expect(parsed.followers_count).toBeUndefined();
});

test("parses media list with cursor", () => {
  const parsed = MediaListSchema.parse({
    data: [{ id: "1", media_type: "VIDEO", media_product_type: "REELS" }],
    paging: { cursors: { after: "abc" } },
  });
  expect(parsed.data[0]!.media_type).toBe("VIDEO");
  expect(parsed.paging?.cursors?.after).toBe("abc");
});

test("rejects unknown media_product_type", () => {
  expect(() => MediaSchema.parse({ id: "1", media_product_type: "WAT" })).toThrow();
});

test("parses insights response", () => {
  const parsed = InsightsResponseSchema.parse({
    data: [
      { name: "reach", period: "lifetime", values: [{ value: 123 }] },
      { name: "likes", values: [{ value: 5 }] },
    ],
  });
  expect(parsed.data[0]!.values?.[0]?.value).toBe(123);
});
