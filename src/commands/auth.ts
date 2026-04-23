import { defineCommand } from "citty";
import { readFileSync } from "node:fs";
import {
  clearConfig,
  configPath,
  readConfig,
  removeAccount,
  tokenExpiryState,
  writeConfig,
} from "../config/store.ts";
import { parseScopeFlag, runCodeExchange, runLogin, runRefresh, runTokenLogin } from "../ig/oauth.ts";
import { printJson } from "../output/json.ts";
import { CliError, ExitCode } from "../lib/exit-codes.ts";

const globalArgs = {
  json: { type: "boolean", description: "Emit JSON (default)", default: true },
  pretty: { type: "boolean", description: "Pretty-print JSON" },
  config: { type: "string", description: "Path to config.json" },
  quiet: { type: "boolean", description: "Suppress non-data log output" },
} as const;

const loginCmd = defineCommand({
  meta: {
    name: "login",
    description:
      "Authenticate and add an account. First account added becomes active. Later logins update the account in place without changing which is active.",
  },
  args: {
    ...globalArgs,
    token: {
      type: "string",
      description:
        "Access token (headless). Warning: visible in shell history / `ps`. Prefer --token-file or META_ACCESS_TOKEN env var.",
    },
    "token-file": {
      type: "string",
      description: "Read access token from a file (single line). Safer than --token on shared machines.",
    },
    "token-stdin": {
      type: "boolean",
      description: "Read access token from stdin. Pair with `cat token.txt | ig-agent auth login --token-stdin`.",
    },
    "expires-in": {
      type: "string",
      description: "Token lifetime in seconds. Defaults to unknown. Long-lived user tokens ~ 5184000 (60 d).",
    },
    "app-id": {
      type: "string",
      description: "Meta app id (or set META_APP_ID). Required for browser OAuth; optional with --token.",
    },
    "app-secret": {
      type: "string",
      description: "Meta app secret (or set META_APP_SECRET). Required for browser OAuth. Not needed for `auth refresh`.",
    },
    scope: {
      type: "string",
      description:
        "Extra scopes to request beyond the read-only default, comma-separated. Aliases: comments, messages. The CLI never calls write endpoints even when these are granted — see SECURITY.md.",
    },
  },
  async run({ args }) {
    const token = resolveToken({
      flag: args.token as string | undefined,
      file: args["token-file"] as string | undefined,
      stdin: Boolean(args["token-stdin"]),
    });
    const appId = (args["app-id"] as string | undefined) ?? process.env.META_APP_ID;
    const appSecret = (args["app-secret"] as string | undefined) ?? process.env.META_APP_SECRET;
    const scopes = parseScopeFlag(args.scope as string | undefined);

    if (token) {
      const expiresIn = parseOptionalInt(args["expires-in"] as string | undefined);
      const result = await runTokenLogin({
        token,
        appId,
        appSecret,
        expiresInSeconds: expiresIn,
        assumedScopes: args.scope ? scopes : undefined,
        configPath: args.config as string | undefined,
      });
      printJson(
        {
          ok: true,
          mode: "token",
          username: result.username,
          ig_user_id: result.account.ig_user_id,
          expires_in_days: result.expiresInDays,
          is_active: result.isNewActive,
          can_refresh: Boolean(appId && appSecret),
        },
        Boolean(args.pretty),
      );
      return;
    }

    if (!appId || !appSecret) {
      throw new CliError(
        "Missing credentials. Either supply --token / META_ACCESS_TOKEN for headless login, or set --app-id/--app-secret (META_APP_ID/META_APP_SECRET) to run the browser OAuth flow.",
        ExitCode.UserError,
      );
    }

    const result = await runLogin({ appId, appSecret, scopes, configPath: args.config as string | undefined });
    printJson(
      {
        ok: true,
        mode: "oauth",
        username: result.username,
        ig_user_id: result.account.ig_user_id,
        expires_in_days: result.expiresInDays,
        is_active: result.isNewActive,
      },
      Boolean(args.pretty),
    );
  },
});

function parseOptionalInt(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

function resolveToken(opts: { flag?: string; file?: string; stdin: boolean }): string | undefined {
  const sources = [opts.flag, opts.file, opts.stdin ? "stdin" : undefined].filter(Boolean);
  if (sources.length > 1) {
    throw new CliError("Use only one of --token, --token-file, --token-stdin.", ExitCode.UserError);
  }
  if (opts.file) {
    const contents = readFileSync(opts.file, "utf8").trim();
    if (!contents) throw new CliError(`Empty token file: ${opts.file}`, ExitCode.UserError);
    return contents;
  }
  if (opts.stdin) {
    const buf = readFileSync(0, "utf8").trim();
    if (!buf) throw new CliError("--token-stdin: no token received on stdin.", ExitCode.UserError);
    return buf;
  }
  if (opts.flag) return opts.flag;
  return process.env.META_ACCESS_TOKEN;
}

const statusCmd = defineCommand({
  meta: { name: "status", description: "Show connected accounts, active account, and per-account token expiry." },
  args: globalArgs,
  run({ args }) {
    const cfg = readConfig(args.config as string | undefined);
    const now = Math.floor(Date.now() / 1000);
    const accounts = cfg.accounts.map((a) => {
      const { status, daysLeft } = tokenExpiryState(a.token_expires_at, now);
      return {
        ig_user_id: a.ig_user_id,
        username: a.username,
        active: a.ig_user_id === cfg.active_account_id,
        expires_at: a.token_expires_at ?? null,
        expires_in_days: daysLeft,
        expiry_status: status,
        granted_scopes: a.granted_scopes ?? null,
      };
    });
    printJson(
      {
        authenticated: cfg.accounts.length > 0,
        active_account_id: cfg.active_account_id ?? null,
        accounts,
        config_path: configPath(args.config as string | undefined),
      },
      Boolean(args.pretty),
    );
  },
});

const refreshCmd = defineCommand({
  meta: {
    name: "refresh",
    description: "Refresh a long-lived token. Defaults to the active account; use --account or --all to widen.",
  },
  args: {
    ...globalArgs,
    account: { type: "string", description: "ig_user_id or username to refresh (defaults to active)." },
    all: { type: "boolean", description: "Refresh every stored account." },
  },
  async run({ args }) {
    const res = await runRefresh({
      configPath: args.config as string | undefined,
      account: args.account as string | undefined,
      all: Boolean(args.all),
    });
    printJson(
      {
        ok: true,
        refreshed: res.refreshed.map((r) => ({ username: r.username, expires_in_days: r.expiresInDays })),
      },
      Boolean(args.pretty),
    );
  },
});

const exchangeCmd = defineCommand({
  meta: {
    name: "exchange",
    description:
      "Exchange an OAuth authorization code for a long-lived token (manual/headless flow — use when the browser redirect cannot reach the local server). Adds the account to the config; first account added becomes active.",
  },
  args: {
    ...globalArgs,
    code: {
      type: "string",
      description:
        "The authorization code from the redirect URL. Copy the `code=...` value from your browser's address bar after approving the dialog.",
      required: true,
    },
    "redirect-uri": {
      type: "string",
      description: "The same redirect URI registered in the Instagram Business Login settings.",
      required: true,
    },
    "app-id": { type: "string", description: "Instagram App ID (or META_APP_ID)." },
    "app-secret": { type: "string", description: "Instagram App Secret (or META_APP_SECRET)." },
  },
  async run({ args }) {
    const appId = (args["app-id"] as string | undefined) ?? process.env.META_APP_ID;
    const appSecret = (args["app-secret"] as string | undefined) ?? process.env.META_APP_SECRET;
    if (!appId || !appSecret) {
      throw new CliError(
        "Missing --app-id/--app-secret (or META_APP_ID/META_APP_SECRET).",
        ExitCode.UserError,
      );
    }
    const code = parseCodeArg(args.code as string);
    const result = await runCodeExchange({
      appId,
      appSecret,
      redirectUri: args["redirect-uri"] as string,
      code,
      configPath: args.config as string | undefined,
    });
    printJson(
      {
        ok: true,
        mode: "exchange",
        username: result.username,
        ig_user_id: result.account.ig_user_id,
        expires_in_days: result.expiresInDays,
        is_active: result.isNewActive,
      },
      Boolean(args.pretty),
    );
  },
});

export function parseCodeArg(raw: string): string {
  let s = raw.trim();
  const hashIdx = s.indexOf("#");
  if (hashIdx >= 0) s = s.slice(0, hashIdx);
  if (s.includes("://") || s.startsWith("?") || s.includes("?code=")) {
    try {
      const url = new URL(s.startsWith("?") ? `https://x${s}` : s);
      const code = url.searchParams.get("code");
      if (code) return code.replace(/\/+$/, "");
    } catch {
      // fall through
    }
  }
  return s.replace(/\/+$/, "");
}

const logoutCmd = defineCommand({
  meta: {
    name: "logout",
    description:
      "Remove stored credentials for the active account. Use --account to target a specific one, or --all to wipe everything.",
  },
  args: {
    ...globalArgs,
    account: { type: "string", description: "ig_user_id or username to remove (defaults to active)." },
    all: { type: "boolean", description: "Remove every stored account and delete the config file." },
  },
  run({ args }) {
    const path = args.config as string | undefined;
    if (args.all) {
      clearConfig(path);
      printJson({ ok: true, removed: "all" }, Boolean(args.pretty));
      return;
    }
    const cfg = readConfig(path);
    if (cfg.accounts.length === 0) {
      printJson({ ok: true, removed: null, remaining: 0 }, Boolean(args.pretty));
      return;
    }
    const target = (args.account as string | undefined) ?? cfg.active_account_id;
    if (!target) {
      throw new CliError(
        "No account targeted. Use --account <name> or --all.",
        ExitCode.UserError,
      );
    }
    const next = removeAccount(cfg, target);
    if (next.accounts.length === 0) {
      clearConfig(path);
    } else {
      writeConfig(next, path);
    }
    printJson(
      {
        ok: true,
        removed: target,
        remaining: next.accounts.length,
        active_account_id: next.active_account_id ?? null,
      },
      Boolean(args.pretty),
    );
  },
});

export const authCmd = defineCommand({
  meta: { name: "auth", description: "Authentication commands." },
  subCommands: {
    login: loginCmd,
    exchange: exchangeCmd,
    status: statusCmd,
    refresh: refreshCmd,
    logout: logoutCmd,
  },
});
