import { defineCommand } from "citty";
import { readConfig, resolveAuth } from "../config/store.ts";
import { IgClient } from "../ig/client.ts";
import { getIgUser, getMediaInsights, listMedia, metricsForMedia } from "../ig/endpoints.ts";
import { openDb } from "../cache/db.ts";
import { AccountRepo, InsightsRepo, MediaRepo, SyncStateRepo } from "../cache/repo.ts";
import { printJson } from "../output/json.ts";
import { CliError, ExitCode } from "../lib/exit-codes.ts";

export const syncCmd = defineCommand({
  meta: { name: "sync", description: "Incremental pull of media + insights into the local cache." },
  args: {
    json: { type: "boolean", default: true },
    pretty: { type: "boolean" },
    config: { type: "string" },
    account: { type: "string" },
    quiet: { type: "boolean" },
    full: { type: "boolean", description: "Force a full re-pull, ignoring last cursor." },
    "db-path": { type: "string", description: "Override cache database path" },
    limit: { type: "string", description: "Max media per page", default: "50" },
    "max-pages": { type: "string", description: "Max pages to fetch in one run", default: "10" },
  },
  async run({ args }) {
    const cfg = readConfig(args.config as string | undefined);
    const auth = resolveAuth(cfg, args.account as string | undefined);
    if (!auth.igUserId) throw new CliError("No IG user id available.", ExitCode.AuthExpired);
    const db = openDb({ path: args["db-path"] as string | undefined });
    const accounts = new AccountRepo(db);
    const mediaRepo = new MediaRepo(db);
    const insightsRepo = new InsightsRepo(db);
    const syncState = new SyncStateRepo(db);

    const client = new IgClient({ token: auth.token, accountKey: auth.igUserId });
    const ig = await getIgUser(client, auth.igUserId);
    const now = Math.floor(Date.now() / 1000);
    accounts.upsert({
      ig_user_id: ig.id,
      username: ig.username,
      page_id: null,
      connected_at: now,
    });

    const state = syncState.get(ig.id);
    const full = Boolean(args.full);
    const limit = clampInt(args.limit as string, 1, 100, 50);
    const maxPages = clampInt(args["max-pages"] as string, 1, 50, 10);

    let cursor: string | undefined = full ? undefined : state?.last_cursor ?? undefined;
    let fetched = 0;
    let insightsFetched = 0;
    let page = 0;

    while (page < maxPages) {
      const res = await listMedia(client, { igUserId: ig.id, limit, after: cursor });
      if (res.data.length === 0) break;
      for (const m of res.data) mediaRepo.upsertFromApi(ig.id, m, now);
      fetched += res.data.length;

      for (const m of res.data) {
        try {
          const insights = await getMediaInsights(client, m.id, metricsForMedia(m));
          insightsRepo.saveAll(m.id, insights, now);
          insightsFetched += insights.length;
        } catch {
          // Insights may be unavailable for older media or demographics-gated on small accounts. Skip silently.
        }
      }

      cursor = res.paging?.cursors?.after;
      if (!cursor || !res.paging?.next) break;
      page++;
    }

    syncState.upsert({
      account_id: ig.id,
      last_cursor: cursor ?? null,
      last_synced_at: now,
    });

    printJson(
      {
        ok: true,
        ig_user_id: ig.id,
        media_fetched: fetched,
        insights_fetched: insightsFetched,
        last_cursor: cursor ?? null,
      },
      Boolean(args.pretty),
    );
  },
});

function clampInt(raw: string | undefined, min: number, max: number, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}
