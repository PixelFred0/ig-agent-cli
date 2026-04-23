import envPaths from "env-paths";
import { mkdirSync, existsSync, readFileSync, writeFileSync, chmodSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { CliError, ExitCode } from "../lib/exit-codes.ts";
import { logger } from "../lib/logger.ts";

export const AccountSchema = z.object({
  ig_user_id: z.string(),
  username: z.string(),
  user_access_token: z.string(),
  token_expires_at: z.number().optional(),
  meta_app_id: z.string().optional(),
  meta_app_secret: z.string().optional(),
  granted_scopes: z.array(z.string()).optional(),
});

export const ConfigSchema = z.object({
  version: z.literal(1).default(1),
  active_account_id: z.string().optional(),
  accounts: z.array(AccountSchema).default([]),
});

export type Config = z.infer<typeof ConfigSchema>;
export type Account = z.infer<typeof AccountSchema>;

const paths = envPaths("ig-agent", { suffix: "" });

export function configDir(): string {
  return paths.config;
}

export function configPath(override?: string): string {
  return override ?? join(paths.config, "config.json");
}

export function dataDir(): string {
  return paths.data;
}

export function ensureConfigDir(override?: string): string {
  const dir = override ? dirname(override) : paths.config;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export function readConfig(override?: string): Config {
  const p = configPath(override);
  if (!existsSync(p)) return ConfigSchema.parse({});
  const raw = readFileSync(p, "utf8");
  const json = JSON.parse(raw) as Record<string, unknown> & {
    accounts?: Array<Record<string, unknown>>;
    user_access_token?: string;
    token_expires_at?: number;
    meta_app_id?: string;
    meta_app_secret?: string;
  };

  if (Array.isArray(json.accounts) && json.accounts.some((a) => "page_access_token" in a)) {
    throw new CliError(
      "Config is from a pre-release build that used the Facebook Login flow. Run `ig-agent auth logout --all` followed by `ig-agent auth login` to re-authenticate with Instagram Login.",
      ExitCode.UserError,
    );
  }

  const migrated = migrateSingleAccountShape(json);
  return ConfigSchema.parse(migrated);
}

function migrateSingleAccountShape(json: Record<string, unknown> & {
  accounts?: Array<Record<string, unknown>>;
  user_access_token?: string;
  token_expires_at?: number;
  meta_app_id?: string;
  meta_app_secret?: string;
}): Record<string, unknown> {
  if (!json.user_access_token || !Array.isArray(json.accounts) || json.accounts.length === 0) {
    return json;
  }
  const firstAccount = json.accounts[0]!;
  if (firstAccount && "user_access_token" in firstAccount) return json;

  const migratedAccounts = json.accounts.map((a, idx) => ({
    ...a,
    user_access_token: idx === 0 ? json.user_access_token : json.user_access_token,
    token_expires_at: json.token_expires_at,
    meta_app_id: json.meta_app_id,
    meta_app_secret: json.meta_app_secret,
  }));

  const activeId =
    typeof json.active_account_id === "string"
      ? json.active_account_id
      : ((migratedAccounts[0] as Record<string, unknown>).ig_user_id as string);

  const { user_access_token, token_expires_at, meta_app_id, meta_app_secret, ...rest } = json;
  void user_access_token; void token_expires_at; void meta_app_id; void meta_app_secret;
  return { ...rest, active_account_id: activeId, accounts: migratedAccounts };
}

export function writeConfig(cfg: Config, override?: string): void {
  ensureConfigDir(override);
  const p = configPath(override);
  const json = JSON.stringify(cfg, null, 2);
  writeFileSync(p, json, { mode: 0o600 });
  try {
    chmodSync(p, 0o600);
  } catch {
    // Windows or FS without POSIX perms — best effort.
  }
}

export function clearConfig(override?: string): void {
  const p = configPath(override);
  if (existsSync(p)) unlinkSync(p);
}

export function findAccount(cfg: Config, nameOrId?: string): Account | undefined {
  if (nameOrId) {
    return cfg.accounts.find((a) => a.ig_user_id === nameOrId || a.username === nameOrId);
  }
  if (cfg.active_account_id) {
    const active = cfg.accounts.find((a) => a.ig_user_id === cfg.active_account_id);
    if (active) return active;
  }
  return cfg.accounts[0];
}

export function upsertAccount(cfg: Config, account: Account): Config {
  const idx = cfg.accounts.findIndex((a) => a.ig_user_id === account.ig_user_id);
  const accounts = idx >= 0
    ? cfg.accounts.map((a, i) => (i === idx ? account : a))
    : [...cfg.accounts, account];
  const active_account_id = cfg.active_account_id ?? account.ig_user_id;
  return { ...cfg, accounts, active_account_id };
}

export function removeAccount(cfg: Config, nameOrId: string): Config {
  const target = cfg.accounts.find((a) => a.ig_user_id === nameOrId || a.username === nameOrId);
  if (!target) throw new CliError(`No account matching "${nameOrId}".`, ExitCode.UserError);
  const accounts = cfg.accounts.filter((a) => a.ig_user_id !== target.ig_user_id);
  let active_account_id = cfg.active_account_id;
  if (active_account_id === target.ig_user_id) {
    active_account_id = accounts[0]?.ig_user_id;
  }
  return { ...cfg, accounts, active_account_id };
}

export function setActiveAccount(cfg: Config, nameOrId: string): Config {
  const target = cfg.accounts.find((a) => a.ig_user_id === nameOrId || a.username === nameOrId);
  if (!target) throw new CliError(`No account matching "${nameOrId}".`, ExitCode.UserError);
  return { ...cfg, active_account_id: target.ig_user_id };
}

export interface ResolvedAuth {
  token: string;
  igUserId?: string;
  source: "env" | "config";
}

export function resolveAuth(cfg: Config, account?: string): ResolvedAuth {
  const envToken = process.env.IG_ACCESS_TOKEN;
  if (envToken) {
    return {
      token: envToken,
      igUserId: process.env.IG_USER_ID,
      source: "env",
    };
  }
  if (cfg.accounts.length === 0) {
    throw new CliError("Not authenticated. Run `ig-agent auth login` first.", ExitCode.AuthExpired);
  }
  const target = findAccount(cfg, account);
  if (!target) {
    throw new CliError(
      account
        ? `No account matching "${account}". Run \`ig-agent account list\` to see connected accounts.`
        : "No active account. Run `ig-agent account switch <username>` to pick one.",
      ExitCode.UserError,
    );
  }
  warnIfExpiring(target.token_expires_at, target.username);
  return {
    token: target.user_access_token,
    igUserId: target.ig_user_id,
    source: "config",
  };
}

export function tokenExpiryState(
  expiresAt: number | undefined,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): { status: "unknown" | "fresh" | "expiring-soon" | "expiring-urgent" | "expired"; daysLeft: number | null } {
  if (!expiresAt) return { status: "unknown", daysLeft: null };
  const secondsLeft = expiresAt - nowSeconds;
  const daysLeft = Math.floor(secondsLeft / 86400);
  if (secondsLeft <= 0) return { status: "expired", daysLeft };
  if (daysLeft <= 7) return { status: "expiring-urgent", daysLeft };
  if (daysLeft <= 14) return { status: "expiring-soon", daysLeft };
  return { status: "fresh", daysLeft };
}

function warnIfExpiring(expiresAt: number | undefined, username: string): void {
  const { status, daysLeft } = tokenExpiryState(expiresAt);
  if (status === "fresh" || status === "unknown") return;
  if (status === "expired") {
    logger.warn(`Access token for @${username} has expired. Run \`ig-agent auth login\` to re-authenticate.`);
    return;
  }
  const suffix = daysLeft === 1 ? "1 day" : `${daysLeft} days`;
  const prefix = status === "expiring-urgent" ? "⚠️  Access token for" : "Access token for";
  logger.warn(`${prefix} @${username} expires in ${suffix}. Run \`ig-agent auth refresh\` to extend it another 60 days.`);
}
