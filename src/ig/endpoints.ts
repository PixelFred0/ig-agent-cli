import { z } from "zod";
import { IG_GRAPH_BASE, IG_OAUTH_BASE, type IgClient } from "./client.ts";
import {
  CommentsResponseSchema,
  IgUserSchema,
  InsightsResponseSchema,
  MediaListSchema,
  MediaSchema,
  TokenExchangeSchema,
  type Comment,
  type IgUser,
  type InsightMetric,
  type Media,
} from "./schemas.ts";

const MEDIA_FIELDS =
  "id,caption,media_type,media_product_type,media_url,permalink,thumbnail_url,timestamp,username,comments_count,like_count";

const IG_USER_FIELDS = "id,username,followers_count,media_count,biography,profile_picture_url";

export const REEL_METRICS = [
  "reach",
  "views",
  "likes",
  "comments",
  "shares",
  "saved",
  "total_interactions",
  "ig_reels_video_view_total_time",
  "ig_reels_avg_watch_time",
] as const;

export const POST_METRICS = ["reach", "likes", "comments", "shares", "saved", "total_interactions"] as const;

export const STORY_METRICS = ["reach", "replies", "navigation", "shares", "total_interactions"] as const;

export async function getIgMe(c: IgClient): Promise<IgUser> {
  return c.get("/me", { fields: IG_USER_FIELDS }, IgUserSchema);
}

export async function getIgUser(c: IgClient, igUserId: string): Promise<IgUser> {
  return c.get(`/${igUserId}`, { fields: IG_USER_FIELDS }, IgUserSchema);
}

export interface ListMediaArgs {
  igUserId: string;
  limit?: number;
  after?: string;
  since?: string;
  until?: string;
}

export async function listMedia(c: IgClient, args: ListMediaArgs) {
  return c.get(
    `/${args.igUserId}/media`,
    {
      fields: MEDIA_FIELDS,
      limit: args.limit ?? 25,
      after: args.after,
      since: args.since ? Math.floor(new Date(args.since).getTime() / 1000) : undefined,
      until: args.until ? Math.floor(new Date(args.until).getTime() / 1000) : undefined,
    },
    MediaListSchema,
  );
}

export async function getMedia(c: IgClient, mediaId: string): Promise<Media> {
  return c.get(`/${mediaId}`, { fields: MEDIA_FIELDS }, MediaSchema);
}

export function metricsForMedia(media: Pick<Media, "media_product_type" | "media_type">): readonly string[] {
  if (media.media_product_type === "REELS") return REEL_METRICS;
  if (media.media_product_type === "STORY") return STORY_METRICS;
  return POST_METRICS;
}

export async function getMediaInsights(
  c: IgClient,
  mediaId: string,
  metrics: readonly string[],
): Promise<InsightMetric[]> {
  const res = await c.get(
    `/${mediaId}/insights`,
    { metric: metrics.join(",") },
    InsightsResponseSchema,
  );
  return res.data;
}

export async function getUserInsights(
  c: IgClient,
  igUserId: string,
  metrics: readonly string[],
  period: "day" | "week" | "days_28",
  metricType?: "total_value",
): Promise<InsightMetric[]> {
  const res = await c.get(
    `/${igUserId}/insights`,
    { metric: metrics.join(","), period, metric_type: metricType },
    InsightsResponseSchema,
  );
  return res.data;
}

const COMMENT_FIELDS_BASE = "id,text,username,timestamp,like_count,hidden";
const COMMENT_FIELDS_WITH_REPLIES = `${COMMENT_FIELDS_BASE},replies{${COMMENT_FIELDS_BASE}}`;

export interface ListCommentsArgs {
  mediaId: string;
  limit?: number;
  after?: string;
  includeReplies?: boolean;
}

export async function listMediaComments(c: IgClient, args: ListCommentsArgs): Promise<{ data: Comment[]; paging?: { cursors?: { after?: string; before?: string }; next?: string; previous?: string } }> {
  return c.get(
    `/${args.mediaId}/comments`,
    {
      fields: args.includeReplies ? COMMENT_FIELDS_WITH_REPLIES : COMMENT_FIELDS_BASE,
      limit: args.limit ?? 25,
      after: args.after,
    },
    CommentsResponseSchema,
  );
}

const ShortLivedTokenSchema = z.object({
  access_token: z.string(),
  user_id: z.union([z.string(), z.number()]).transform((v) => String(v)),
  permissions: z.union([z.string(), z.array(z.string())]).optional(),
});

export function normalizeScopes(permissions: string | string[] | undefined): string[] | undefined {
  if (permissions === undefined) return undefined;
  const arr = Array.isArray(permissions) ? permissions : permissions.split(",");
  const cleaned = arr.map((s) => s.trim()).filter(Boolean);
  return cleaned.length > 0 ? cleaned : undefined;
}

export interface CodeExchangeOpts {
  appId: string;
  appSecret: string;
  redirectUri: string;
  code: string;
  fetchFn?: typeof fetch;
}

export async function exchangeCodeForToken(opts: CodeExchangeOpts) {
  const body = new URLSearchParams({
    client_id: opts.appId,
    client_secret: opts.appSecret,
    grant_type: "authorization_code",
    redirect_uri: opts.redirectUri,
    code: opts.code,
  });
  const f = opts.fetchFn ?? globalThis.fetch;
  const res = await f(`${IG_OAUTH_BASE}/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`Code exchange failed: HTTP ${res.status}`);
  const json: unknown = await res.json();
  return ShortLivedTokenSchema.parse(json);
}

export interface LongLivedExchangeOpts {
  appSecret: string;
  shortLivedToken: string;
  fetchFn?: typeof fetch;
}

export async function exchangeForLongLivedToken(opts: LongLivedExchangeOpts) {
  const url = new URL(`${IG_GRAPH_BASE}/access_token`);
  url.searchParams.set("grant_type", "ig_exchange_token");
  url.searchParams.set("client_secret", opts.appSecret);
  url.searchParams.set("access_token", opts.shortLivedToken);
  const f = opts.fetchFn ?? globalThis.fetch;
  const res = await f(url);
  if (!res.ok) throw new Error(`Long-lived exchange failed: HTTP ${res.status}`);
  const json: unknown = await res.json();
  return TokenExchangeSchema.parse(json);
}

export interface RefreshTokenOpts {
  longLivedToken: string;
  fetchFn?: typeof fetch;
}

export async function refreshLongLivedToken(opts: RefreshTokenOpts) {
  const url = new URL(`${IG_GRAPH_BASE}/refresh_access_token`);
  url.searchParams.set("grant_type", "ig_refresh_token");
  url.searchParams.set("access_token", opts.longLivedToken);
  const f = opts.fetchFn ?? globalThis.fetch;
  const res = await f(url);
  if (!res.ok) throw new Error(`Token refresh failed: HTTP ${res.status}`);
  const json: unknown = await res.json();
  return TokenExchangeSchema.parse(json);
}
