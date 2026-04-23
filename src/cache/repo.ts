import type { SqliteDb } from "./db.ts";
import type { Media, InsightMetric } from "../ig/schemas.ts";

export interface AccountRow {
  ig_user_id: string;
  username: string;
  page_id: string | null;
  connected_at: number;
}

export interface MediaRow {
  id: string;
  account_id: string;
  media_type: string | null;
  media_product_type: string | null;
  caption: string | null;
  permalink: string | null;
  thumbnail_url: string | null;
  timestamp: number | null;
  raw_json: string;
  fetched_at: number;
}

export interface InsightRow {
  id: number;
  media_id: string;
  metric: string;
  value: number | null;
  value_json: string | null;
  period: string | null;
  fetched_at: number;
}

export interface SyncStateRow {
  account_id: string;
  last_cursor: string | null;
  last_synced_at: number;
}

export class AccountRepo {
  private readonly upsertStmt;
  private readonly getStmt;
  private readonly listStmt;
  constructor(private readonly db: SqliteDb) {
    this.upsertStmt = db.prepare(
      `INSERT INTO accounts(ig_user_id, username, page_id, connected_at)
       VALUES (@ig_user_id, @username, @page_id, @connected_at)
       ON CONFLICT(ig_user_id) DO UPDATE SET username = excluded.username, page_id = excluded.page_id`,
    );
    this.getStmt = db.prepare(`SELECT * FROM accounts WHERE ig_user_id = ?`);
    this.listStmt = db.prepare(`SELECT * FROM accounts ORDER BY connected_at DESC`);
  }
  upsert(row: AccountRow): void {
    this.upsertStmt.run(row);
  }
  get(id: string): AccountRow | undefined {
    return this.getStmt.get(id) as AccountRow | undefined;
  }
  list(): AccountRow[] {
    return this.listStmt.all() as AccountRow[];
  }
}

export class MediaRepo {
  private readonly upsertStmt;
  private readonly getStmt;
  private readonly listByAccount;
  private readonly listByType;
  constructor(private readonly db: SqliteDb) {
    this.upsertStmt = db.prepare(
      `INSERT INTO media(id, account_id, media_type, media_product_type, caption, permalink, thumbnail_url, timestamp, raw_json, fetched_at)
       VALUES (@id, @account_id, @media_type, @media_product_type, @caption, @permalink, @thumbnail_url, @timestamp, @raw_json, @fetched_at)
       ON CONFLICT(id) DO UPDATE SET
         media_type = excluded.media_type,
         media_product_type = excluded.media_product_type,
         caption = excluded.caption,
         permalink = excluded.permalink,
         thumbnail_url = excluded.thumbnail_url,
         timestamp = excluded.timestamp,
         raw_json = excluded.raw_json,
         fetched_at = excluded.fetched_at`,
    );
    this.getStmt = db.prepare(`SELECT * FROM media WHERE id = ?`);
    this.listByAccount = db.prepare(
      `SELECT * FROM media WHERE account_id = ? ORDER BY timestamp DESC LIMIT ?`,
    );
    this.listByType = db.prepare(
      `SELECT * FROM media WHERE account_id = ? AND media_product_type = ? ORDER BY timestamp DESC LIMIT ?`,
    );
  }
  upsertFromApi(accountId: string, media: Media, fetchedAt: number): void {
    this.upsertStmt.run({
      id: media.id,
      account_id: accountId,
      media_type: media.media_type ?? null,
      media_product_type: media.media_product_type ?? null,
      caption: media.caption ?? null,
      permalink: media.permalink ?? null,
      thumbnail_url: media.thumbnail_url ?? null,
      timestamp: media.timestamp ? Math.floor(new Date(media.timestamp).getTime() / 1000) : null,
      raw_json: JSON.stringify(media),
      fetched_at: fetchedAt,
    });
  }
  get(id: string): MediaRow | undefined {
    return this.getStmt.get(id) as MediaRow | undefined;
  }
  listForAccount(accountId: string, limit = 100, productType?: string): MediaRow[] {
    if (productType) return this.listByType.all(accountId, productType, limit) as MediaRow[];
    return this.listByAccount.all(accountId, limit) as MediaRow[];
  }
}

export class InsightsRepo {
  private readonly insertStmt;
  private readonly listStmt;
  constructor(private readonly db: SqliteDb) {
    this.insertStmt = db.prepare(
      `INSERT OR IGNORE INTO insights(media_id, metric, value, value_json, period, fetched_at)
       VALUES (@media_id, @metric, @value, @value_json, @period, @fetched_at)`,
    );
    this.listStmt = db.prepare(
      `SELECT * FROM insights WHERE media_id = ? ORDER BY fetched_at DESC`,
    );
  }
  saveAll(mediaId: string, metrics: InsightMetric[], fetchedAt: number): void {
    const tx = this.db.transaction((items: InsightMetric[]) => {
      for (const m of items) {
        const first = m.values?.[0]?.value;
        const isNumber = typeof first === "number";
        this.insertStmt.run({
          media_id: mediaId,
          metric: m.name,
          value: isNumber ? (first as number) : null,
          value_json: isNumber ? null : JSON.stringify(first ?? null),
          period: m.period ?? null,
          fetched_at: fetchedAt,
        });
      }
    });
    tx(metrics);
  }
  listForMedia(mediaId: string): InsightRow[] {
    return this.listStmt.all(mediaId) as InsightRow[];
  }
}

export class SyncStateRepo {
  private readonly upsertStmt;
  private readonly getStmt;
  constructor(private readonly db: SqliteDb) {
    this.upsertStmt = db.prepare(
      `INSERT INTO sync_state(account_id, last_cursor, last_synced_at)
       VALUES (@account_id, @last_cursor, @last_synced_at)
       ON CONFLICT(account_id) DO UPDATE SET last_cursor = excluded.last_cursor, last_synced_at = excluded.last_synced_at`,
    );
    this.getStmt = db.prepare(`SELECT * FROM sync_state WHERE account_id = ?`);
  }
  upsert(row: SyncStateRow): void {
    this.upsertStmt.run(row);
  }
  get(accountId: string): SyncStateRow | undefined {
    return this.getStmt.get(accountId) as SyncStateRow | undefined;
  }
}
