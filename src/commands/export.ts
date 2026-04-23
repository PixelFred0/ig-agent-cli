import { defineCommand } from "citty";
import { readConfig, resolveAuth } from "../config/store.ts";
import { openDb } from "../cache/db.ts";
import { InsightsRepo, MediaRepo } from "../cache/repo.ts";
import { printJson } from "../output/json.ts";
import { writeCsv } from "../output/csv.ts";
import { writeFileSync } from "node:fs";
import { CliError, ExitCode } from "../lib/exit-codes.ts";

export const exportCmd = defineCommand({
  meta: { name: "export", description: "Export cached media + insights as JSON or CSV." },
  args: {
    json: { type: "boolean", default: true },
    pretty: { type: "boolean" },
    config: { type: "string" },
    account: { type: "string" },
    quiet: { type: "boolean" },
    format: { type: "string", description: "json | csv", default: "json" },
    output: { type: "string", description: "Write to file (default: stdout)" },
    type: { type: "string", description: "Filter: REELS | IMAGE | VIDEO | CAROUSEL_ALBUM" },
    limit: { type: "string", description: "Max rows", default: "500" },
    "db-path": { type: "string" },
  },
  run({ args }) {
    const cfg = readConfig(args.config as string | undefined);
    const auth = resolveAuth(cfg, args.account as string | undefined);
    if (!auth.igUserId) throw new CliError("No IG user id available.", ExitCode.AuthExpired);
    const db = openDb({ path: args["db-path"] as string | undefined });
    const mediaRepo = new MediaRepo(db);
    const insightsRepo = new InsightsRepo(db);
    const limit = clampInt(args.limit as string, 1, 10_000, 500);
    const type = (args.type as string | undefined)?.toUpperCase();
    const productFilter = type === "REELS" || type === "STORY" || type === "FEED" ? type : undefined;
    const rows = mediaRepo.listForAccount(auth.igUserId, limit, productFilter).filter((row) => {
      if (!type || productFilter) return true;
      return row.media_type === type;
    });

    const enriched = rows.map((r) => {
      const insights = insightsRepo.listForMedia(r.id);
      const metricMap: Record<string, number | null> = {};
      for (const i of insights) metricMap[i.metric] = i.value;
      return {
        id: r.id,
        account_id: r.account_id,
        media_type: r.media_type,
        media_product_type: r.media_product_type,
        caption: r.caption,
        permalink: r.permalink,
        timestamp: r.timestamp,
        ...metricMap,
      };
    });

    const format = (args.format as string).toLowerCase();
    const dest = args.output as string | undefined;
    if (format === "csv") {
      writeCsv(enriched, dest);
      if (dest) printJson({ ok: true, rows: enriched.length, path: dest }, Boolean(args.pretty));
    } else if (format === "json") {
      const text = JSON.stringify(enriched, null, args.pretty ? 2 : 0);
      if (dest) {
        writeFileSync(dest, text + "\n");
        printJson({ ok: true, rows: enriched.length, path: dest }, Boolean(args.pretty));
      } else {
        process.stdout.write(text + "\n");
      }
    } else {
      throw new CliError(`Unknown --format "${format}" (expected json | csv)`, ExitCode.UserError);
    }
  },
});

function clampInt(raw: string | undefined, min: number, max: number, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}
