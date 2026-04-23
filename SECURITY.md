# Security

## Reporting a vulnerability

Please email the maintainer privately rather than opening a public issue. Include reproduction steps and the affected version. We aim to acknowledge within 72 hours.

## Token handling

`ig-agent` operates on Meta access tokens that your account has authorized. The CLI takes the following measures:

- **Storage**: tokens are written only to a platform-appropriate config file with mode `0600` (owner read/write only). Resolved via `env-paths` — macOS: `~/Library/Preferences/ig-agent/config.json`; Linux: `~/.config/ig-agent/config.json`; Windows: `%APPDATA%\ig-agent\config.json`. Run `ig-agent auth status` to see the resolved path. Tokens are never written to the SQLite cache or the repo working directory.
- **Transmission**: all Instagram API calls (`graph.instagram.com`) go over HTTPS with the token in the `Authorization: Bearer` header. Tokens never appear in URL query strings for data calls. (Meta's own OAuth token-exchange and refresh endpoints take `client_secret` / `access_token` as URL parameters — that's defined by Meta's API, not by us.)
- **Logging**: the error handler redacts common token patterns (`EAA...`, `IGAA...`, `IGQ...`, `access_token=...`, `ig_exchange_token=...`, `ig_refresh_token=...`, `"access_token":"..."`, and any ≥80-character base64-ish string) before anything reaches stderr.
- **Cache file**: `~/.local/share/ig-agent/cache.db` is also chmod `0600` on POSIX systems. It contains media metadata and insight metrics — never tokens — but is still restricted to the owner.

## Recommended practices

### Never pass tokens on the command line in shared environments

`ig-agent auth login --token <token>` stores the token in your shell history (`~/.zsh_history`, `~/.bash_history`) and makes it visible via `ps auxww` to other users on the system. Instead, use one of:

```sh
# Read from a file (0600 recommended)
ig-agent auth login --token-file ~/.secrets/ig-token

# Read from stdin — no trace anywhere
cat ~/.secrets/ig-token | ig-agent auth login --token-stdin

# Via env var (use with a secret manager; avoid committing .env files)
META_ACCESS_TOKEN=eaa... ig-agent auth login
```

### Rotate tokens if they leak

If you accidentally commit a token, paste it in chat, or suspect any exposure:

1. Go to Meta Developer Console → your app → *App Settings* → *Advanced* → invalidate sessions, OR
2. Regenerate via Graph API Explorer / your app's OAuth flow.
3. Run `ig-agent auth logout && ig-agent auth login ...` to replace the stored token.

### GitHub secret scanning

If you fork this repo or vendor the code, enable **GitHub secret scanning** on your copy (Settings → Code security → Secret scanning). It automatically flags accidentally committed Meta tokens.

### Data retention

Meta's Platform Terms require you to delete Platform data when no longer needed. Use:

```sh
ig-agent cache stats --pretty        # see what's there
ig-agent cache clear --confirm       # wipe the local cache
ig-agent auth logout                 # clear stored tokens
```

Consider running `cache clear` periodically (e.g., after a reporting cycle) if you don't need the historical cache.

## Optional scopes

The CLI requests the narrowest possible Meta scope by default:

- **Default** (`instagram_business_basic`) — read-only access to your profile fields, media list, media metadata, and insights. No write capability whatsoever on the token.

Some features require broader scopes that Meta only offers bundled with write capability. In those cases, the CLI opts in **only when you explicitly request it** via `ig-agent auth login --scope=<alias>`, and the CLI itself still never calls any write endpoints:

- **`--scope=comments`** requests `instagram_business_manage_comments` in addition to the default. This unlocks `ig-agent media comments <id>` — read-only reporting of comments on your posts. But Meta's scope bundles "read comments" together with "reply to / hide / delete comments", so the token that's granted this scope technically has comment-moderation capability. The CLI never exercises that capability, and the repo's `CONTRIBUTING.md` forbids PRs that add any write endpoint. If you are worried about what a stored token *could* do if it leaked, stay on the default scope.
- **`--scope=messages`** is recognised as an alias for `instagram_business_manage_messages` for future use; no command uses it today, so don't grant it.

Granted scopes are recorded per-account under `granted_scopes` in the config file and shown in `ig-agent auth status --pretty`. To narrow a previously-broadened account, run `ig-agent auth logout --account <name>` and re-authenticate with a fresh, narrower `--scope` (or none).

### What the CLI does NOT do

- No background network traffic. Every network call is a direct consequence of a command you ran:
  - `auth login` → `www.instagram.com/oauth/authorize` (browser) + `api.instagram.com/oauth/access_token` (code exchange) + `graph.instagram.com/access_token` (long-lived upgrade)
  - `auth refresh` → `graph.instagram.com/refresh_access_token`
  - Any read command (`media`, `insights`, `sync`, `account`) → `graph.instagram.com`
  - `update` / `update --check` → `registry.npmjs.org` (user-initiated only; see below)
- No analytics, telemetry, or tracking. No third-party services.
- Your app secret is stored only in `config.json` (if you provided it during `auth login`, for the one-time code→token exchange) and never logged or sent anywhere other than Meta's own OAuth endpoint. `auth refresh` does not need the app secret.
- Read-only Instagram access in the **CLI code itself**. No command calls any POST/DELETE endpoint. This remains true even when you've opted into broader scopes via `--scope=comments` — see "Optional scopes" above for the token-capability nuance.

### About `ig-agent update`

This is the only network call made for a non-Graph-API purpose. It hits `https://registry.npmjs.org/ig-agent` to read the latest published version, compares it to the running version, and — only if you confirm at the prompt (or pass `--yes`) — runs `npm install -g ig-agent@<version>` to upgrade. The registry call sends no identifying information beyond what any `npm` command already sends; the registry endpoint is the public, unauthenticated metadata API. If you want to avoid the call entirely, simply don't run `ig-agent update` — nothing else in the CLI contacts npm.
