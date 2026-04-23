import { defineCommand } from "citty";
import {
  readConfig,
  removeAccount,
  resolveAuth,
  setActiveAccount,
  writeConfig,
  clearConfig,
} from "../config/store.ts";
import { IgClient } from "../ig/client.ts";
import { getIgUser, getUserInsights } from "../ig/endpoints.ts";
import { printJson } from "../output/json.ts";
import { CliError, ExitCode } from "../lib/exit-codes.ts";

const globalArgs = {
  json: { type: "boolean", default: true },
  pretty: { type: "boolean" },
  config: { type: "string" },
  account: { type: "string", description: "IG user id or username" },
  quiet: { type: "boolean" },
} as const;

const listCmd = defineCommand({
  meta: { name: "list", description: "List connected IG Business/Creator accounts. The active account is marked." },
  args: globalArgs,
  run({ args }) {
    const cfg = readConfig(args.config as string | undefined);
    printJson(
      {
        active_account_id: cfg.active_account_id ?? null,
        accounts: cfg.accounts.map((a) => ({
          ig_user_id: a.ig_user_id,
          username: a.username,
          active: a.ig_user_id === cfg.active_account_id,
        })),
      },
      Boolean(args.pretty),
    );
  },
});

const switchCmd = defineCommand({
  meta: { name: "switch", description: "Set the active account (used by commands when --account is not passed)." },
  args: {
    ...globalArgs,
    target: { type: "positional", required: true, description: "ig_user_id or username to activate." },
  },
  run({ args }) {
    const path = args.config as string | undefined;
    const cfg = readConfig(path);
    const next = setActiveAccount(cfg, args.target as string);
    writeConfig(next, path);
    const active = next.accounts.find((a) => a.ig_user_id === next.active_account_id)!;
    printJson(
      { ok: true, active_account_id: active.ig_user_id, username: active.username },
      Boolean(args.pretty),
    );
  },
});

const removeCmd = defineCommand({
  meta: { name: "remove", description: "Remove one stored account. If it was active, another account becomes active." },
  args: {
    ...globalArgs,
    target: { type: "positional", required: true, description: "ig_user_id or username to remove." },
  },
  run({ args }) {
    const path = args.config as string | undefined;
    const cfg = readConfig(path);
    const next = removeAccount(cfg, args.target as string);
    if (next.accounts.length === 0) {
      clearConfig(path);
    } else {
      writeConfig(next, path);
    }
    printJson(
      {
        ok: true,
        removed: args.target,
        remaining: next.accounts.length,
        active_account_id: next.active_account_id ?? null,
      },
      Boolean(args.pretty),
    );
  },
});

const ACCOUNT_METRICS = ["reach", "profile_views", "accounts_engaged"] as const;

const insightsCmd = defineCommand({
  meta: { name: "insights", description: "Account-level metrics." },
  args: {
    ...globalArgs,
    period: {
      type: "string",
      description: "day | week | days_28",
      default: "day",
    },
  },
  async run({ args }) {
    const cfg = readConfig(args.config as string | undefined);
    const auth = resolveAuth(cfg, args.account as string | undefined);
    if (!auth.igUserId) throw new Error("No IG user id available. Run `ig-agent auth login` or set --account.");
    const period = (args.period as string) as "day" | "week" | "days_28";
    const client = new IgClient({ token: auth.token, accountKey: auth.igUserId });
    const [user, metrics] = await Promise.all([
      getIgUser(client, auth.igUserId),
      getUserInsights(client, auth.igUserId, ACCOUNT_METRICS, period, "total_value").catch(() => []),
    ]);
    printJson(
      {
        ig_user_id: user.id,
        username: user.username,
        followers_count: user.followers_count ?? null,
        media_count: user.media_count ?? null,
        period,
        metrics,
      },
      Boolean(args.pretty),
    );
  },
});

const getCmd = defineCommand({
  meta: { name: "get", description: "Fetch the active IG account's profile fields." },
  args: globalArgs,
  async run({ args }) {
    const cfg = readConfig(args.config as string | undefined);
    const auth = resolveAuth(cfg, args.account as string | undefined);
    if (!auth.igUserId) throw new CliError("No IG user id available. Run `ig-agent auth login` first.", ExitCode.AuthExpired);
    const client = new IgClient({ token: auth.token, accountKey: auth.igUserId });
    const user = await getIgUser(client, auth.igUserId);
    printJson(
      {
        id: user.id,
        username: user.username,
        followers_count: user.followers_count ?? null,
        media_count: user.media_count ?? null,
        biography: user.biography ?? null,
        profile_picture_url: user.profile_picture_url ?? null,
      },
      Boolean(args.pretty),
    );
  },
});

export const accountCmd = defineCommand({
  meta: { name: "account", description: "Account commands." },
  subCommands: { list: listCmd, get: getCmd, insights: insightsCmd, switch: switchCmd, remove: removeCmd },
});
