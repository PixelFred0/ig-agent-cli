# ig-agent

[![CI](https://github.com/PixelFred0/ig-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/PixelFred0/ig-agent/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
<!-- npm version + download badges will be added here after the first npm publish. -->

A read-only Instagram Graph API CLI that emits structured JSON for AI agents. Uses Meta's **Instagram API with Instagram Login** — no Facebook Page required.

- Recent media (posts, Reels, Stories) with captions, timestamps, permalinks
- Per-media insights: reach, views, likes, comments, shares, saves, watch time
- Account-level insights (reach, profile views, …)
- Incremental local SQLite cache so agents can replay history without burning API quota
- Stable exit codes for retry logic (see below)

## Install

```sh
npm install -g ig-agent
# or
bunx ig-agent --help
```

Requires Node ≥ 20 at runtime.

### Use with Claude Code (agent skill)

This repo ships an agent skill at [skills/ig-agent/](skills/ig-agent/) that teaches Claude how to use the CLI — commands, return shapes, exit-code handling, and cache-first workflows. Install it with [skills.sh](https://skills.sh):

```sh
npx skills add PixelFred0/ig-agent -g      # global — available across all your projects
npx skills add PixelFred0/ig-agent         # project-local, scoped to the current repo
```

After that, any Claude Code session picks the skill up automatically when the user's request involves their Instagram content. First thing the skill does is run `ig-agent auth status` — if that errors, it tells the user to `npm install -g ig-agent` first.

## Prerequisites (one-time, manual)

These are hard blockers on Meta's side — the CLI cannot work around them.

1. Convert your Instagram account to **Creator** or **Business** (1-minute setting in the app; reversible).
2. Create a **Meta Developer App** (type: *Business*) at [developers.facebook.com](https://developers.facebook.com):
   - Add product: **Instagram → API setup with Instagram business login**
   - Connect your IG account to the app
   - OAuth redirect URI: `http://localhost:8573/callback`
   - Requested scope: `instagram_business_basic` (covers read-only media + insights)
3. Standard Access is sufficient for your own account — no App Review needed.
4. Some account-level insights (e.g. `accounts_engaged`) require ≥ 100 followers; Reel watch-time metrics and audience demographics require ≥ 1000 followers.

> **No Facebook Page required.** The CLI talks to `graph.instagram.com` directly via Instagram Login — the legacy Facebook Login path (`graph.facebook.com`, `pages_*` scopes) was deprecated by Meta on January 27, 2025 and is not supported.
>
> Meta's developer console is genuinely fiddly for first-time setup (HTTPS-only redirect URIs, tester role invites, SSL error pages during OAuth). If anything in the Quickstart doesn't work exactly as written, see [SETUP.md](SETUP.md) for the full step-by-step with known pitfalls and workarounds.

## Quickstart

### Option A — manual code exchange (recommended)

Meta's Business Login validator currently rejects plain `http://localhost` redirect URIs — it pings the URL from Meta's servers. The workaround: register `https://localhost:8573/callback`, click Meta's embed URL in your browser, ignore the SSL error page that appears after approval, and paste the `code=` value from the URL bar into:

```sh
export META_APP_ID=<Instagram App ID>
export META_APP_SECRET=<Instagram App Secret>

ig-agent auth exchange \
  --redirect-uri https://localhost:8573/callback \
  --code "<paste the redirect URL or just the code here>"

ig-agent auth status --pretty    # authenticated: true, 60-day expiry
```

Full walk-through with every Meta-console pitfall: [SETUP.md](SETUP.md).

### Option B — headless, token-only

If you already have an Instagram Login long-lived token, skip OAuth entirely:

```sh
ig-agent auth login --token <access-token>                # one-shot, persisted
ig-agent auth login --token <token> --expires-in 5184000  # tell us when it expires
META_ACCESS_TOKEN=<token> ig-agent auth login             # via env var
```

The command calls `/me` against `graph.instagram.com` to resolve the IG account and persists the mapping. No local callback server, no browser. `ig-agent auth refresh` extends the token without needing the app secret.

### Option C — built-in local-server OAuth (dormant)

`ig-agent auth login` (without `--token`) starts a local HTTP server on port 8573 and runs the full OAuth flow end-to-end. This is dormant because Meta rejects `http://localhost` redirect URIs; if Meta ever re-enables them, `META_APP_ID=… META_APP_SECRET=… ig-agent auth login` "just works".

### Fully ephemeral (CI / one-off agents)

Skip the config file altogether — the client reads env vars directly:

```sh
IG_ACCESS_TOKEN=<token> IG_USER_ID=<ig-user-id> ig-agent media list --type REELS --limit 5
```

### Daily use

```sh
ig-agent account list --pretty
ig-agent media list --type REELS --limit 20 --pretty
ig-agent insights <media-id> --pretty

ig-agent sync                  # pull into local SQLite cache
ig-agent export --format csv --output reels.csv --type REELS
```

Without flags, output goes to stdout as compact JSON.

### Staying up to date

```sh
ig-agent update --check        # see if a newer version is on npm
ig-agent update                # prompts, then runs `npm install -g ig-agent@<latest>`
ig-agent update --yes          # non-interactive (CI / scripts)
ig-agent update --dist-tag beta --check   # check the beta channel
```

The only time the CLI contacts npm. User-initiated; see [SECURITY.md](SECURITY.md) for details.

## Commands

| Command | Purpose |
|---|---|
| `ig-agent auth login` | OAuth (local-server mode) or `--token <t>` headless persist. Adds/updates an account; first added becomes active. |
| `ig-agent auth exchange --code <c> --redirect-uri <url>` | Exchange an OAuth code (copied from the SSL-error redirect page) for a long-lived token |
| `ig-agent auth status` | Per-account expiry + which account is active |
| `ig-agent auth refresh [--account <x>] [--all]` | Extend long-lived tokens (active by default) |
| `ig-agent auth logout [--account <x>] [--all]` | Remove one account (active by default) or nuke everything |
| `ig-agent account list` | Connected IG Business/Creator accounts (active marked) |
| `ig-agent account get` | Active account's profile fields (followers, media count, bio, …) |
| `ig-agent account switch <username_or_id>` | Set the active account |
| `ig-agent account remove <username_or_id>` | Remove one stored account |
| `ig-agent account insights [--period day\|week\|days_28]` | Account-level metrics |
| `ig-agent media list [--type REELS\|IMAGE\|VIDEO\|CAROUSEL_ALBUM] [--limit N] [--since ISO] [--until ISO]` | Paginated media list |
| `ig-agent media get <id>` | Full metadata for one media item |
| `ig-agent media comments <id> [--replies]` | Comments on a media item (requires `--scope=comments` at login) |
| `ig-agent insights <media-id>` | All supported metrics for a media item |
| `ig-agent sync [--full]` | Incremental pull into SQLite cache |
| `ig-agent export --format json\|csv [--output FILE] [--type REELS]` | Export cached data |

Global flags: `--json` (default), `--pretty`, `--account <ig-user-id-or-username>`, `--config <path>`, `--quiet`.

### Multi-account

`ig-agent` supports connecting multiple Instagram accounts. The first account you log in to becomes the **active** account; later logins add to the list without changing which is active. Read commands (`media`, `insights`, `sync`, `account get`, `account insights`) target the active account unless you pass `--account <username-or-id>`.

```sh
ig-agent auth login                         # add account #1 (becomes active)
ig-agent auth login --token <token>         # add account #2 (active unchanged)
ig-agent account list --pretty              # see both, with active marker
ig-agent account switch account_two         # change which is active
ig-agent media list --account account_one   # one-off query against the non-active account
ig-agent account remove account_two         # forget just that one
ig-agent auth logout --all                  # wipe everything
```

Each account carries its own 60-day token with its own expiry — run `ig-agent auth refresh --all` to extend them all at once.

### Optional scopes (comments)

The default login requests only `instagram_business_basic` (read-only media + profile + insights). Reading **comments** on a media item requires the additional `instagram_business_manage_comments` scope, which Meta bundles with moderation capability — you can't ask for "read comments" without also being *granted* "hide/delete/reply". The CLI never calls those write endpoints, but you should know what the stored token technically permits before opting in.

```sh
ig-agent auth login --scope=comments                 # browser flow, broader consent
ig-agent auth login --token <t> --scope=comments     # annotate an existing token
ig-agent media comments <media-id> --pretty          # now works
ig-agent media comments <media-id> --replies         # include threaded replies
```

If you try `media comments` on an account that wasn't authorised with this scope, the CLI refuses with a clear error and points at `auth login --scope=comments`. See [SECURITY.md](SECURITY.md#optional-scopes) for what the token can/cannot do once this scope is granted.

## Exit codes (stable contract)

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | User error (bad flags, missing args) |
| 2 | API error (non-retryable) |
| 3 | Rate-limited (retry with backoff) |
| 4 | Auth expired / missing |
| 5 | Network error (retryable) |

Data goes to stdout, diagnostics to stderr — `--json` stdout is always clean for piping.

## Configuration

- Tokens live in a platform-appropriate config directory (via [`env-paths`](https://github.com/sindresorhus/env-paths)), `chmod 0600`, never logged:
  - **macOS**: `~/Library/Preferences/ig-agent/config.json`
  - **Linux**: `~/.config/ig-agent/config.json`
  - **Windows**: `%APPDATA%\ig-agent\config.json`
  - Run `ig-agent auth status` — the JSON output includes `config_path` so you don't have to guess.
- Environment overrides for CI: `IG_ACCESS_TOKEN`, `IG_USER_ID`.
- Cache database at a platform-appropriate data directory (macOS: `~/Library/Application Support/ig-agent/`, Linux: `~/.local/share/ig-agent/`, Windows: `%LOCALAPPDATA%\ig-agent\`).

## Development

```sh
bun install
bun run dev <command>          # run from source
bun test
bunx tsc --noEmit              # typecheck
bun run build                  # produce dist/cli.js
```

Dev runtime is Bun; the shipped bundle targets Node ≥ 20. The SQLite cache auto-selects `bun:sqlite` under Bun and `better-sqlite3` on Node, so the same source runs in both.

### Layout

```
src/
├── cli.ts          # citty entry, command wiring, exit-code mapping
├── commands/       # one file per top-level subcommand
├── ig/             # graph.instagram.com client (fetch + retry + rate limit), zod schemas, OAuth
├── cache/          # better-sqlite3 / bun:sqlite adapter + typed repositories
├── config/         # ~/.config/ig-agent/config.json store + env overrides
├── output/         # JSON + CSV formatters
└── lib/            # logger, token-bucket rate limiter, exit codes
test/               # mirror of src/, run with `bun test`
```

CI runs `bunx tsc --noEmit`, `bun test`, and smoke-tests the Node bundle on every push / PR. PRs should keep the two commands green before review.

## Security

See [SECURITY.md](SECURITY.md) for how tokens are stored, how to pass them without leaking to shell history, and how to wipe cached data.

## Disclaimer

This is an independent open-source project. It is **not affiliated with, endorsed by, or sponsored by Meta Platforms, Inc. or Instagram**. "Instagram" is a trademark of Meta Platforms, Inc.; this tool merely calls the public Instagram API on behalf of accounts you have explicitly authorized. You are responsible for complying with [Meta's Platform Terms](https://developers.facebook.com/terms/) and the [Instagram Platform Policy](https://developers.facebook.com/docs/instagram-platform/policy/) when using this software.

## License

MIT — see [LICENSE](LICENSE).
