import { defineCommand } from "citty";
import { findAccount, readConfig, resolveAuth } from "../config/store.ts";
import { IgClient } from "../ig/client.ts";
import { getMedia, listMedia, listMediaComments } from "../ig/endpoints.ts";
import { SCOPE_COMMENTS } from "../ig/oauth.ts";
import { printJson } from "../output/json.ts";
import { CliError, ExitCode } from "../lib/exit-codes.ts";
import type { Media } from "../ig/schemas.ts";

const globalArgs = {
  json: { type: "boolean", default: true },
  pretty: { type: "boolean" },
  config: { type: "string" },
  account: { type: "string" },
  quiet: { type: "boolean" },
} as const;

const listCmd = defineCommand({
  meta: { name: "list", description: "List recent media (paginated)." },
  args: {
    ...globalArgs,
    type: { type: "string", description: "REELS | IMAGE | VIDEO | CAROUSEL_ALBUM" },
    limit: { type: "string", description: "Max items", default: "25" },
    since: { type: "string", description: "ISO date lower bound" },
    until: { type: "string", description: "ISO date upper bound" },
    after: { type: "string", description: "Paging cursor" },
  },
  async run({ args }) {
    const cfg = readConfig(args.config as string | undefined);
    const auth = resolveAuth(cfg, args.account as string | undefined);
    if (!auth.igUserId) throw new CliError("No IG user id available. Run `ig-agent auth login`.", ExitCode.AuthExpired);
    const limit = clampInt(args.limit as string, 1, 100, 25);
    const client = new IgClient({ token: auth.token, accountKey: auth.igUserId });
    const res = await listMedia(client, {
      igUserId: auth.igUserId,
      limit,
      since: args.since as string | undefined,
      until: args.until as string | undefined,
      after: args.after as string | undefined,
    });
    let items = res.data;
    const typeFilter = (args.type as string | undefined)?.toUpperCase();
    if (typeFilter) items = items.filter((m) => matchType(m, typeFilter));
    printJson(
      {
        ig_user_id: auth.igUserId,
        count: items.length,
        next_cursor: res.paging?.cursors?.after ?? null,
        data: items,
      },
      Boolean(args.pretty),
    );
  },
});

const getCmd = defineCommand({
  meta: { name: "get", description: "Fetch a single media item." },
  args: { ...globalArgs, id: { type: "positional", required: true } },
  async run({ args }) {
    const cfg = readConfig(args.config as string | undefined);
    const auth = resolveAuth(cfg, args.account as string | undefined);
    const client = new IgClient({ token: auth.token, accountKey: auth.igUserId ?? "global" });
    const media = await getMedia(client, args.id as string);
    printJson(media, Boolean(args.pretty));
  },
});

const commentsCmd = defineCommand({
  meta: {
    name: "comments",
    description:
      "List comments on a media item. Requires the instagram_business_manage_comments scope — run `ig-agent auth login --scope=comments` (or re-auth with that flag) to grant it. The CLI never calls any comment write endpoints.",
  },
  args: {
    ...globalArgs,
    id: { type: "positional", required: true, description: "Media id" },
    limit: { type: "string", description: "Max top-level comments per page", default: "25" },
    after: { type: "string", description: "Paging cursor" },
    replies: { type: "boolean", description: "Include threaded replies under each top-level comment." },
  },
  async run({ args }) {
    const cfg = readConfig(args.config as string | undefined);
    const auth = resolveAuth(cfg, args.account as string | undefined);
    if (!auth.igUserId) throw new CliError("No IG user id available.", ExitCode.AuthExpired);
    assertCommentsScopeOrThrow(cfg, args.account as string | undefined);
    const limit = clampInt(args.limit as string, 1, 50, 25);
    const client = new IgClient({ token: auth.token, accountKey: auth.igUserId });
    const res = await listMediaComments(client, {
      mediaId: args.id as string,
      limit,
      after: args.after as string | undefined,
      includeReplies: Boolean(args.replies),
    });
    printJson(
      {
        media_id: args.id,
        count: res.data.length,
        next_cursor: res.paging?.cursors?.after ?? null,
        data: res.data,
      },
      Boolean(args.pretty),
    );
  },
});

function assertCommentsScopeOrThrow(cfg: ReturnType<typeof readConfig>, accountArg: string | undefined): void {
  if (process.env.IG_ACCESS_TOKEN) return;
  const target = findAccount(cfg, accountArg);
  if (!target) return;
  if (target.granted_scopes === undefined) {
    // Token granted before scope-tracking was added, or obtained via --token flag without --scope.
    // Let the API call proceed and surface Meta's error if the token is missing the scope.
    return;
  }
  if (!target.granted_scopes.includes(SCOPE_COMMENTS)) {
    throw new CliError(
      `Account @${target.username} was authorised without the "${SCOPE_COMMENTS}" scope. Re-authenticate with \`ig-agent auth login --scope=comments\` (or \`auth exchange\` with the same flag) to enable reading comments.`,
      ExitCode.UserError,
    );
  }
}

export const mediaCmd = defineCommand({
  meta: { name: "media", description: "Media commands." },
  subCommands: { list: listCmd, get: getCmd, comments: commentsCmd },
});

function matchType(m: Media, filter: string): boolean {
  if (filter === "REELS") return m.media_product_type === "REELS";
  return m.media_type === filter || m.media_product_type === filter;
}

function clampInt(raw: string | undefined, min: number, max: number, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}
