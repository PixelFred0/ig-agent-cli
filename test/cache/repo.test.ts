import { test, expect } from "bun:test";
import { openDb } from "../../src/cache/db.ts";
import {
  AccountRepo,
  InsightsRepo,
  MediaRepo,
  SyncStateRepo,
} from "../../src/cache/repo.ts";

function freshDb() {
  return openDb({ memory: true });
}

test("accounts upsert + get + list", () => {
  const db = freshDb();
  const repo = new AccountRepo(db);
  repo.upsert({ ig_user_id: "1", username: "a", page_id: "p1", connected_at: 100 });
  repo.upsert({ ig_user_id: "1", username: "a2", page_id: "p1", connected_at: 200 });
  repo.upsert({ ig_user_id: "2", username: "b", page_id: null, connected_at: 150 });
  expect(repo.get("1")?.username).toBe("a2");
  expect(repo.list()).toHaveLength(2);
});

test("media upsert round-trip with timestamp parsing", () => {
  const db = freshDb();
  new AccountRepo(db).upsert({ ig_user_id: "1", username: "a", page_id: null, connected_at: 0 });
  const media = new MediaRepo(db);
  media.upsertFromApi(
    "1",
    {
      id: "m1",
      caption: "hi",
      media_type: "VIDEO",
      media_product_type: "REELS",
      permalink: "https://x",
      timestamp: "2025-01-01T00:00:00+0000",
    },
    1000,
  );
  const row = media.get("m1");
  expect(row?.media_product_type).toBe("REELS");
  expect(row?.timestamp).toBe(Math.floor(new Date("2025-01-01T00:00:00+0000").getTime() / 1000));
  expect(JSON.parse(row!.raw_json).caption).toBe("hi");
});

test("insights saveAll stores numeric values", () => {
  const db = freshDb();
  new AccountRepo(db).upsert({ ig_user_id: "1", username: "a", page_id: null, connected_at: 0 });
  new MediaRepo(db).upsertFromApi("1", { id: "m1" }, 0);
  const insights = new InsightsRepo(db);
  insights.saveAll(
    "m1",
    [
      { name: "reach", values: [{ value: 100 }] },
      { name: "likes", values: [{ value: 42 }] },
    ],
    1000,
  );
  const rows = insights.listForMedia("m1");
  expect(rows).toHaveLength(2);
  expect(rows.find((r) => r.metric === "reach")?.value).toBe(100);
});

test("sync_state upsert", () => {
  const db = freshDb();
  new AccountRepo(db).upsert({ ig_user_id: "1", username: "a", page_id: null, connected_at: 0 });
  const repo = new SyncStateRepo(db);
  repo.upsert({ account_id: "1", last_cursor: "c1", last_synced_at: 100 });
  repo.upsert({ account_id: "1", last_cursor: "c2", last_synced_at: 200 });
  expect(repo.get("1")?.last_cursor).toBe("c2");
});
