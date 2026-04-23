import { defineCommand } from "citty";
import { readConfig, resolveAuth } from "../config/store.ts";
import { IgClient } from "../ig/client.ts";
import { getMedia, getMediaInsights, metricsForMedia } from "../ig/endpoints.ts";
import { printJson } from "../output/json.ts";
import { CliError, ExitCode } from "../lib/exit-codes.ts";
import { IgApiError } from "../ig/client.ts";

export const insightsCmd = defineCommand({
  meta: { name: "insights", description: "Fetch all supported metrics for a single media item." },
  args: {
    json: { type: "boolean", default: true },
    pretty: { type: "boolean" },
    config: { type: "string" },
    account: { type: "string" },
    quiet: { type: "boolean" },
    id: { type: "positional", required: true, description: "Media id" },
    metrics: { type: "string", description: "Override metric list (comma-separated)" },
  },
  async run({ args }) {
    const cfg = readConfig(args.config as string | undefined);
    const auth = resolveAuth(cfg, args.account as string | undefined);
    const client = new IgClient({ token: auth.token, accountKey: auth.igUserId ?? "global" });
    const mediaId = args.id as string;
    const media = await getMedia(client, mediaId);
    const override = args.metrics as string | undefined;
    const metrics = override ? override.split(",").map((m) => m.trim()).filter(Boolean) : metricsForMedia(media);
    let data: Awaited<ReturnType<typeof getMediaInsights>> = [];
    try {
      data = await getMediaInsights(client, mediaId, metrics);
    } catch (e) {
      if (e instanceof IgApiError && e.exitCode === ExitCode.ApiError) {
        // Graph returns 400 with code 100 when a metric isn't available for this media/account — retry with a narrowed set.
        const fallback = metrics.filter((m) => !m.startsWith("ig_reels_"));
        if (fallback.length < metrics.length) data = await getMediaInsights(client, mediaId, fallback);
        else throw e;
      } else throw e;
    }
    if (!media) throw new CliError("Media not found", ExitCode.ApiError);
    printJson(
      {
        media: {
          id: media.id,
          media_type: media.media_type ?? null,
          media_product_type: media.media_product_type ?? null,
          permalink: media.permalink ?? null,
          timestamp: media.timestamp ?? null,
        },
        metrics: data,
      },
      Boolean(args.pretty),
    );
  },
});
