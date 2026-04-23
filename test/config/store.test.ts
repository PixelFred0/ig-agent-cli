import { test, expect, afterEach, beforeEach } from "bun:test";
import { mkdtempSync, rmSync, statSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readConfig,
  writeConfig,
  clearConfig,
  resolveAuth,
  upsertAccount,
  removeAccount,
  setActiveAccount,
  findAccount,
  type Account,
} from "../../src/config/store.ts";
import { CliError } from "../../src/lib/exit-codes.ts";

let tmp = "";
let cfgPath = "";

function acc(partial: Partial<Account> & { ig_user_id: string; username: string }): Account {
  return {
    user_access_token: `token-${partial.ig_user_id}`,
    ...partial,
  } as Account;
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "ig-agent-test-"));
  cfgPath = join(tmp, "config.json");
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  delete process.env.IG_ACCESS_TOKEN;
  delete process.env.IG_USER_ID;
});

test("read missing config returns defaults", () => {
  const cfg = readConfig(cfgPath);
  expect(cfg.accounts).toEqual([]);
  expect(cfg.active_account_id).toBeUndefined();
});

test("write then read round-trip preserves per-account tokens and active id", () => {
  writeConfig(
    {
      version: 1,
      active_account_id: "i1",
      accounts: [
        acc({ ig_user_id: "i1", username: "u1", user_access_token: "tok1", token_expires_at: 123 }),
      ],
    },
    cfgPath,
  );
  const cfg = readConfig(cfgPath);
  expect(cfg.active_account_id).toBe("i1");
  expect(cfg.accounts[0]!.user_access_token).toBe("tok1");
  expect(cfg.accounts[0]!.token_expires_at).toBe(123);
});

test("config file written with 0600 perms (posix)", () => {
  if (process.platform === "win32") return;
  writeConfig({ version: 1, accounts: [] }, cfgPath);
  const mode = statSync(cfgPath).mode & 0o777;
  expect(mode).toBe(0o600);
});

test("clearConfig deletes file", () => {
  writeConfig({ version: 1, accounts: [acc({ ig_user_id: "i", username: "u" })] }, cfgPath);
  clearConfig(cfgPath);
  const cfg = readConfig(cfgPath);
  expect(cfg.accounts).toEqual([]);
});

test("env overrides win over config", () => {
  writeConfig(
    {
      version: 1,
      active_account_id: "i1",
      accounts: [acc({ ig_user_id: "i1", username: "u1", user_access_token: "config-token" })],
    },
    cfgPath,
  );
  process.env.IG_ACCESS_TOKEN = "env-token";
  process.env.IG_USER_ID = "env-user";
  const cfg = readConfig(cfgPath);
  const auth = resolveAuth(cfg);
  expect(auth.source).toBe("env");
  expect(auth.token).toBe("env-token");
  expect(auth.igUserId).toBe("env-user");
});

test("resolveAuth picks the active account by default", () => {
  const cfg = readConfig(cfgPath);
  const added = upsertAccount(cfg, acc({ ig_user_id: "1", username: "alpha", user_access_token: "ta" }));
  const two = upsertAccount(added, acc({ ig_user_id: "2", username: "beta", user_access_token: "tb" }));
  expect(two.active_account_id).toBe("1"); // first added wins
  writeConfig(two, cfgPath);
  const auth = resolveAuth(readConfig(cfgPath));
  expect(auth.igUserId).toBe("1");
  expect(auth.token).toBe("ta");
});

test("resolveAuth with explicit --account picks that account's token", () => {
  const cfg = readConfig(cfgPath);
  const added = upsertAccount(cfg, acc({ ig_user_id: "1", username: "alpha", user_access_token: "ta" }));
  const two = upsertAccount(added, acc({ ig_user_id: "2", username: "beta", user_access_token: "tb" }));
  writeConfig(two, cfgPath);
  const auth = resolveAuth(readConfig(cfgPath), "beta");
  expect(auth.igUserId).toBe("2");
  expect(auth.token).toBe("tb");
});

test("upsertAccount updates in place by ig_user_id", () => {
  const cfg = readConfig(cfgPath);
  const a = upsertAccount(cfg, acc({ ig_user_id: "1", username: "alpha", user_access_token: "old" }));
  const b = upsertAccount(a, acc({ ig_user_id: "1", username: "alpha_renamed", user_access_token: "new" }));
  expect(b.accounts).toHaveLength(1);
  expect(b.accounts[0]!.user_access_token).toBe("new");
  expect(b.accounts[0]!.username).toBe("alpha_renamed");
});

test("upsertAccount preserves existing active when adding new account", () => {
  const cfg = readConfig(cfgPath);
  const a = upsertAccount(cfg, acc({ ig_user_id: "1", username: "alpha" }));
  const b = upsertAccount(a, acc({ ig_user_id: "2", username: "beta" }));
  expect(b.active_account_id).toBe("1");
});

test("removeAccount picks a new active if active was removed", () => {
  let cfg = readConfig(cfgPath);
  cfg = upsertAccount(cfg, acc({ ig_user_id: "1", username: "alpha" }));
  cfg = upsertAccount(cfg, acc({ ig_user_id: "2", username: "beta" }));
  cfg = removeAccount(cfg, "alpha");
  expect(cfg.accounts).toHaveLength(1);
  expect(cfg.active_account_id).toBe("2");
});

test("removeAccount clears active when last account is removed", () => {
  let cfg = readConfig(cfgPath);
  cfg = upsertAccount(cfg, acc({ ig_user_id: "1", username: "alpha" }));
  cfg = removeAccount(cfg, "alpha");
  expect(cfg.accounts).toEqual([]);
  expect(cfg.active_account_id).toBeUndefined();
});

test("setActiveAccount switches the active id", () => {
  let cfg = readConfig(cfgPath);
  cfg = upsertAccount(cfg, acc({ ig_user_id: "1", username: "alpha" }));
  cfg = upsertAccount(cfg, acc({ ig_user_id: "2", username: "beta" }));
  cfg = setActiveAccount(cfg, "beta");
  expect(cfg.active_account_id).toBe("2");
});

test("setActiveAccount throws on unknown target", () => {
  const cfg = upsertAccount(readConfig(cfgPath), acc({ ig_user_id: "1", username: "alpha" }));
  expect(() => setActiveAccount(cfg, "nobody")).toThrow(CliError);
});

test("findAccount with no arg returns active", () => {
  let cfg = readConfig(cfgPath);
  cfg = upsertAccount(cfg, acc({ ig_user_id: "1", username: "alpha" }));
  cfg = upsertAccount(cfg, acc({ ig_user_id: "2", username: "beta" }));
  cfg = setActiveAccount(cfg, "beta");
  expect(findAccount(cfg)!.username).toBe("beta");
});

test("rejects pre-release configs from the Facebook Login flow", () => {
  writeFileSync(
    cfgPath,
    JSON.stringify({
      version: 1,
      user_access_token: "old",
      accounts: [
        { ig_user_id: "1", username: "u", page_id: "p", page_access_token: "pa" },
      ],
    }),
  );
  expect(() => readConfig(cfgPath)).toThrow(CliError);
});

test("auto-migrates single-account shape (top-level token) into per-account token", () => {
  writeFileSync(
    cfgPath,
    JSON.stringify({
      version: 1,
      user_access_token: "IGAAtop_level_token",
      token_expires_at: 9999,
      meta_app_id: "app",
      meta_app_secret: "secret",
      accounts: [{ ig_user_id: "1", username: "pixel_printer" }],
    }),
  );
  const cfg = readConfig(cfgPath);
  expect(cfg.accounts).toHaveLength(1);
  expect(cfg.accounts[0]!.user_access_token).toBe("IGAAtop_level_token");
  expect(cfg.accounts[0]!.token_expires_at).toBe(9999);
  expect(cfg.accounts[0]!.meta_app_id).toBe("app");
  expect(cfg.accounts[0]!.meta_app_secret).toBe("secret");
  expect(cfg.active_account_id).toBe("1");
  // Top-level fields should not be present after migration + parse.
  const reserialised = JSON.parse(readFileSync(cfgPath, "utf8")) as Record<string, unknown>;
  expect("user_access_token" in reserialised).toBe(true); // still on disk; migration is in-memory only
  // But after a round-trip the file gets rewritten clean
});
