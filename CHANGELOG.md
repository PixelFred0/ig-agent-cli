# Changelog

All notable user-visible changes are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). This project uses [semantic versioning](https://semver.org/) — the CLI surface (commands, flags, JSON shapes, exit codes 0–5) is the versioned contract.

## [Unreleased]

Nothing yet.

## [0.1.0] — unreleased

First public release.

### Added

- **Instagram API with Instagram Login** support (`graph.instagram.com`) — no Facebook Page required, no `pages_*` scopes. Single scope: `instagram_business_basic`.
- `auth login` — browser OAuth flow (local server mode) or `--token` / `--token-file` / `--token-stdin` headless input.
- `auth exchange` — manual OAuth-code exchange for when the browser redirect can't reach the local server (Meta's HTTPS-only redirect requirement). Handles the `#_` trailer Meta appends to IG redirect URLs.
- `auth status` — per-account token expiry, active-account marker, `config_path` in output.
- `auth refresh [--account <x>] [--all]` — extends long-lived tokens via `refresh_access_token`. No app secret required.
- `auth logout [--account <x>] [--all]` — remove one account (default: active) or wipe the config file.
- `account list` — all connected accounts with `active: true/false` marker.
- `account get` — profile fields (id, username, followers_count, media_count, biography, profile_picture_url).
- `account insights --period day|week|days_28` — account-level metrics.
- `account switch <username_or_id>` — set the active account.
- `account remove <username_or_id>` — remove a stored account.
- `media list` — paginated media pull with `--type`, `--limit`, `--since`, `--until`, `--after`.
- `media get <id>` — single media metadata including `comments_count` and `like_count` (reliable totals from Meta even when `/comments` or `/insights` edges are filtered for historical posts).
- `media comments <id>` — read comments on a media item. Requires the `instagram_business_manage_comments` scope, opted into via `ig-agent auth login --scope=comments`. The CLI never calls any write endpoint even when this scope is granted.
- `insights <media-id>` — per-media metrics with automatic fallback when Reel-specific metrics aren't available.
- `sync [--full]` — incremental cache pull into local SQLite (bun:sqlite in dev, better-sqlite3 in the published bundle).
- `export --format json|csv` — offline query against the cache.
- `cache stats` / `cache clear` — cache inspection and teardown.
- `update --check` / `update` — self-update via npm; user-confirmed, no background traffic.
- **Multi-account support**: each account carries its own 60-day token and expiry. First account added becomes active; read commands default to the active account and accept `--account <x>` to target another.
- **Per-account token expiry warnings**: stderr nudge at ≤14 days (`expiring-soon`), louder at ≤7 days (`expiring-urgent`), firm error at expiry. JSON on stdout is never affected.
- **Opt-in scope widening** via `auth login --scope=<alias>` (aliases: `comments`, `messages`). Stored as `granted_scopes` per account; commands that need a broader scope refuse clearly when it's missing.
- Agent skill at `skills/ig-agent/` (SKILL.md + COMMANDS.md + RECIPES.md) so Claude Code picks up the CLI automatically when a user asks about their Instagram data.
- Docs: `README.md`, `SETUP.md` (full step-by-step with Meta console pitfalls), `SECURITY.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `.github/ISSUE_TEMPLATE/`, `.github/PULL_REQUEST_TEMPLATE.md`.

### Security

- Tokens stored at platform-appropriate config paths (macOS `~/Library/Preferences/ig-agent/`, Linux `~/.config/ig-agent/`, Windows `%APPDATA%\ig-agent\`), mode `0600`.
- Log redaction covers `EAA…` / `IGAA…` / `IGQ…` token prefixes, `access_token=` / `client_secret=` / `ig_exchange_token=` / `ig_refresh_token=` URL params, JSON `"access_token": "…"` fields, and any ≥80-character base64-ish string.
- No background network traffic. Every call is a direct consequence of a user command.

[Unreleased]: https://github.com/PixelFred0/ig-agent-cli/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/PixelFred0/ig-agent-cli/releases/tag/v0.1.0
