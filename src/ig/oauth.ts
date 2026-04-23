import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import open from "open";
import { IG_DIALOG_URL, IgClient } from "./client.ts";
import {
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  getIgMe,
  normalizeScopes,
  refreshLongLivedToken,
} from "./endpoints.ts";
import {
  writeConfig,
  readConfig,
  upsertAccount,
  findAccount,
  type Account,
} from "../config/store.ts";
import { CliError, ExitCode } from "../lib/exit-codes.ts";

export const OAUTH_PORT = 8573;
export const OAUTH_REDIRECT_URI = `http://localhost:${OAUTH_PORT}/callback`;

export const SCOPE_BASIC = "instagram_business_basic";
export const SCOPE_COMMENTS = "instagram_business_manage_comments";
export const SCOPE_MESSAGES = "instagram_business_manage_messages";

const SCOPE_ALIASES: Record<string, string> = {
  comments: SCOPE_COMMENTS,
  messages: SCOPE_MESSAGES,
};

export function parseScopeFlag(raw: string | undefined): string[] {
  const scopes = new Set<string>([SCOPE_BASIC]);
  if (!raw) return [...scopes];
  for (const token of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    const resolved = SCOPE_ALIASES[token] ?? (token.startsWith("instagram_") ? token : undefined);
    if (!resolved) {
      throw new CliError(
        `Unknown scope alias "${token}". Valid aliases: ${Object.keys(SCOPE_ALIASES).join(", ")}.`,
        ExitCode.UserError,
      );
    }
    scopes.add(resolved);
  }
  return [...scopes];
}

export interface LoginOpts {
  appId: string;
  appSecret: string;
  scopes?: string[];
  configPath?: string;
  timeoutMs?: number;
}

function dialogUrl(appId: string, state: string, scopes: string[]): string {
  const url = new URL(IG_DIALOG_URL);
  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", OAUTH_REDIRECT_URI);
  url.searchParams.set("state", state);
  url.searchParams.set("scope", scopes.join(","));
  url.searchParams.set("response_type", "code");
  return url.toString();
}

async function fetchAccountFromToken(
  userToken: string,
  expiresAt: number | undefined,
  appId: string | undefined,
  appSecret: string | undefined,
  grantedScopes: string[] | undefined,
): Promise<Account> {
  const client = new IgClient({ token: userToken });
  const me = await getIgMe(client);
  return {
    ig_user_id: me.id,
    username: me.username,
    user_access_token: userToken,
    token_expires_at: expiresAt,
    meta_app_id: appId,
    meta_app_secret: appSecret,
    granted_scopes: grantedScopes,
  };
}

export interface TokenLoginOpts {
  token: string;
  appId?: string;
  appSecret?: string;
  expiresInSeconds?: number;
  assumedScopes?: string[];
  configPath?: string;
}

export async function runTokenLogin(
  opts: TokenLoginOpts,
): Promise<{ username: string; account: Account; expiresInDays: number | null; isNewActive: boolean }> {
  const expiresIn = opts.expiresInSeconds;
  const freshExpiresAt = expiresIn ? Math.floor(Date.now() / 1000) + expiresIn : undefined;
  const before = readConfig(opts.configPath);
  const fresh = await fetchAccountFromToken(
    opts.token,
    freshExpiresAt,
    opts.appId,
    opts.appSecret,
    opts.assumedScopes,
  );
  const existing = before.accounts.find((a) => a.ig_user_id === fresh.ig_user_id);
  const account: Account = existing
    ? {
        ...existing,
        user_access_token: fresh.user_access_token,
        username: fresh.username,
        token_expires_at: freshExpiresAt ?? existing.token_expires_at,
        meta_app_id: fresh.meta_app_id ?? existing.meta_app_id,
        meta_app_secret: fresh.meta_app_secret ?? existing.meta_app_secret,
        granted_scopes: fresh.granted_scopes ?? existing.granted_scopes,
      }
    : fresh;
  const wasFirstOrReactivated = before.accounts.length === 0 || before.active_account_id === account.ig_user_id;
  const after = upsertAccount(before, account);
  writeConfig(after, opts.configPath);
  const effectiveExpiresIn = account.token_expires_at
    ? account.token_expires_at - Math.floor(Date.now() / 1000)
    : undefined;
  return {
    username: account.username,
    account,
    expiresInDays: effectiveExpiresIn ? Math.round(effectiveExpiresIn / 86400) : null,
    isNewActive: after.active_account_id === account.ig_user_id && (wasFirstOrReactivated || before.accounts.length === 0),
  };
}

export async function runLogin(opts: LoginOpts): Promise<{ username: string; account: Account; expiresInDays: number; isNewActive: boolean }> {
  const scopes = opts.scopes ?? [SCOPE_BASIC];
  const state = randomBytes(16).toString("hex");
  const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000;

  const code = await new Promise<string>((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (!req.url) return;
      const url = new URL(req.url, `http://localhost:${OAUTH_PORT}`);
      if (url.pathname !== "/callback") {
        res.writeHead(404);
        res.end();
        return;
      }
      const reqState = url.searchParams.get("state");
      const reqCode = url.searchParams.get("code");
      const reqError = url.searchParams.get("error_description") ?? url.searchParams.get("error");
      if (reqError) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(`<h1>Login failed</h1><p>${escapeHtml(reqError)}</p>`);
        server.close();
        reject(new Error(`OAuth error: ${reqError}`));
        return;
      }
      if (reqState !== state) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end("<h1>State mismatch</h1>");
        server.close();
        reject(new Error("OAuth state mismatch — possible CSRF."));
        return;
      }
      if (!reqCode) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end("<h1>Missing code</h1>");
        server.close();
        reject(new Error("OAuth callback missing code."));
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(
        `<!doctype html><html><head><title>ig-agent</title></head><body style="font-family:system-ui;padding:2rem;"><h1>Login complete</h1><p>You can close this tab and return to the terminal.</p></body></html>`,
      );
      server.close();
      resolve(reqCode);
    });
    server.on("error", reject);
    server.listen(OAUTH_PORT, "127.0.0.1", () => {
      const u = dialogUrl(opts.appId, state, scopes);
      void open(u).catch(() => {
        process.stderr.write(`Open this URL manually:\n${u}\n`);
      });
    });
    const timer = setTimeout(() => {
      server.close();
      reject(new Error(`OAuth timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);
    server.on("close", () => clearTimeout(timer));
  });

  return await finishOAuth(code, OAUTH_REDIRECT_URI, opts.appId, opts.appSecret, opts.configPath);
}

export interface CodeExchangeLoginOpts {
  appId: string;
  appSecret: string;
  redirectUri: string;
  code: string;
  configPath?: string;
}

export async function runCodeExchange(
  opts: CodeExchangeLoginOpts,
): Promise<{ username: string; account: Account; expiresInDays: number; isNewActive: boolean }> {
  return await finishOAuth(opts.code, opts.redirectUri, opts.appId, opts.appSecret, opts.configPath);
}

async function finishOAuth(
  code: string,
  redirectUri: string,
  appId: string,
  appSecret: string,
  configPath: string | undefined,
): Promise<{ username: string; account: Account; expiresInDays: number; isNewActive: boolean }> {
  const shortLived = await exchangeCodeForToken({ appId, appSecret, redirectUri, code });
  const grantedScopes = normalizeScopes(shortLived.permissions);
  const longLived = await exchangeForLongLivedToken({
    appSecret,
    shortLivedToken: shortLived.access_token,
  });
  const expiresIn = longLived.expires_in ?? 60 * 24 * 60 * 60;
  const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;
  const account = await fetchAccountFromToken(
    longLived.access_token,
    expiresAt,
    appId,
    appSecret,
    grantedScopes,
  );
  const before = readConfig(configPath);
  const willBeActive = !before.active_account_id;
  const after = upsertAccount(before, account);
  writeConfig(after, configPath);
  return {
    username: account.username,
    account,
    expiresInDays: Math.round(expiresIn / 86400),
    isNewActive: willBeActive,
  };
}

export interface RunRefreshOpts {
  configPath?: string;
  account?: string;
  all?: boolean;
}

export async function runRefresh(
  opts: RunRefreshOpts,
): Promise<{ refreshed: Array<{ username: string; expiresInDays: number }> }> {
  const cfg = readConfig(opts.configPath);
  if (cfg.accounts.length === 0) {
    throw new CliError("No stored credentials to refresh. Run `ig-agent auth login`.", ExitCode.UserError);
  }
  const targets = opts.all
    ? cfg.accounts
    : [findAccount(cfg, opts.account)].filter((a): a is Account => Boolean(a));
  if (targets.length === 0) {
    throw new CliError(
      opts.account ? `No account matching "${opts.account}".` : "No active account. Use --account or --all.",
      ExitCode.UserError,
    );
  }

  let working = cfg;
  const refreshed: Array<{ username: string; expiresInDays: number }> = [];
  for (const acct of targets) {
    const exchanged = await refreshLongLivedToken({ longLivedToken: acct.user_access_token });
    const expiresIn = exchanged.expires_in ?? 60 * 24 * 60 * 60;
    const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;
    const updated: Account = {
      ...acct,
      user_access_token: exchanged.access_token,
      token_expires_at: expiresAt,
    };
    working = upsertAccount(working, updated);
    refreshed.push({ username: acct.username, expiresInDays: Math.round(expiresIn / 86400) });
  }
  writeConfig(working, opts.configPath);
  return { refreshed };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}
