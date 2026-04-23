# ig-agent — command reference

Every command accepts the global flags documented in `SKILL.md`. Below: invocation, flags unique to the command, and the **exact shape** of the JSON emitted to stdout on exit 0.

## Contents
- [auth login](#auth-login)
- [auth status](#auth-status)
- [auth refresh](#auth-refresh)
- [auth logout](#auth-logout)
- [account list](#account-list)
- [account insights](#account-insights)
- [media list](#media-list)
- [media get](#media-get)
- [insights](#insights)
- [sync](#sync)
- [export](#export)

---

## `auth login`

Two modes: **browser OAuth** (needs `--app-id` + `--app-secret`) and **headless token** (`--token <token>`). Never invoke the browser path yourself — it spawns a local server and waits for the user. Use `--token` when the user has already obtained an access token.

Flags: `--token`, `--expires-in <seconds>`, `--app-id`, `--app-secret`.

Output (token mode):
```json
{
  "ok": true,
  "mode": "token",
  "username": "string",
  "accounts": [{ "ig_user_id": "string", "username": "string" }],
  "expires_in_days": 60 | null,
  "can_refresh": true | false
}
```

## `auth status`

Cheap, safe to run at the start of any session.

```json
{
  "authenticated": true,
  "active_account_id": "17841...",
  "accounts": [
    {
      "ig_user_id": "17841...",
      "username": "alpha",
      "active": true,
      "expires_at": 1766000000,
      "expires_in_days": 58,
      "expiry_status": "fresh" | "expiring-soon" | "expiring-urgent" | "expired" | "unknown",
      "granted_scopes": ["instagram_business_basic", "instagram_business_manage_comments"] | null
    }
  ],
  "config_path": "/Users/<you>/Library/Preferences/ig-agent/config.json"
}
```

- Each account carries its own token, expiry, and `granted_scopes`. The active account is the default target for read commands.
- `granted_scopes: null` means the account was added via `auth login --token <t>` without `--scope=...` — the CLI doesn't know what the token permits and will pass-through API calls, letting Meta's error surface if a scope is missing.
- `expiry_status` — `fresh` (>14d left), `expiring-soon` (≤14d), `expiring-urgent` (≤7d), `expired`, or `unknown`. On `expiring-urgent` an agent should surface a nudge to the user to run `ig-agent auth refresh`. On `expired` the next API call will exit code 4; re-auth via `ig-agent auth login` is required.
- `config_path` — resolved platform-appropriate path where tokens are stored (macOS `~/Library/Preferences/ig-agent/`, Linux `~/.config/ig-agent/`, Windows `%APPDATA%\ig-agent\`).

Any command that actually hits the API (`account`, `media`, `insights`, `sync`) also prints a stderr warning if its target account's token expires within 14 days. The JSON on stdout is never affected.

## `auth refresh`

Calls `graph.instagram.com/refresh_access_token` with the stored long-lived token — no app id / app secret required. The long-lived token must be at least 24 h old for Meta to refresh it.

Flags: `--account <name-or-id>` (default: active), `--all` (refresh every account).

```json
{
  "ok": true,
  "refreshed": [
    { "username": "alpha", "expires_in_days": 60 }
  ]
}
```

## `auth logout`

Removes stored credentials. Defaults to the active account; use `--account <name>` to pick one, or `--all` to wipe everything and delete the config file.

```json
{
  "ok": true,
  "removed": "alpha" | "all",
  "remaining": 1,
  "active_account_id": "17841..." | null
}
```

If removing the active account leaves other accounts behind, one of them becomes the new active automatically.

---

## `account list`

Lists connected IG Business/Creator accounts from the local config (no API call). Each Instagram Login token corresponds to one account, so multiple entries mean multiple connected accounts.

```json
{
  "active_account_id": "17841...",
  "accounts": [
    { "ig_user_id": "17841...", "username": "alpha", "active": true },
    { "ig_user_id": "17842...", "username": "beta", "active": false }
  ]
}
```

### `account switch <username_or_id>`

Sets the active account. No API call.

```json
{ "ok": true, "active_account_id": "17842...", "username": "beta" }
```

### `account remove <username_or_id>`

Removes one stored account. If it was active, another account becomes active automatically. If it was the last account, the config file is deleted.

```json
{ "ok": true, "removed": "beta", "remaining": 1, "active_account_id": "17841..." }
```

## `account get`

Fetches the active IG account's profile fields via `/{ig_user_id}` on `graph.instagram.com`. One API call.

```json
{
  "id": "17841...",
  "username": "...",
  "followers_count": 1234,
  "media_count": 56,
  "biography": "bio text" | null,
  "profile_picture_url": "https://..." | null
}
```

## `account insights`

Flags: `--period day|week|days_28` (default `day`).

Calls `/me` for basic info and `/me/insights` for account-level metrics. Some metrics require ≥1000 followers; missing metrics return an empty `metrics` array rather than failing.

```json
{
  "ig_user_id": "17841...",
  "username": "...",
  "followers_count": 1234,
  "media_count": 56,
  "period": "week",
  "metrics": [
    { "name": "reach", "period": "week", "values": [{ "value": 12345 }] },
    { "name": "profile_views", "period": "week", "values": [{ "value": 678 }] }
  ]
}
```

---

## `media list`

Flags: `--type REELS|IMAGE|VIDEO|CAROUSEL_ALBUM`, `--limit 1..100` (default 25), `--since <ISO-date>`, `--until <ISO-date>`, `--after <cursor>`.

Pagination: when there are more results, `next_cursor` is non-null — call again with `--after <cursor>`.

```json
{
  "ig_user_id": "17841...",
  "count": 20,
  "next_cursor": "QVFIUl..." | null,
  "data": [
    {
      "id": "1785...",
      "caption": "string",
      "media_type": "VIDEO" | "IMAGE" | "CAROUSEL_ALBUM",
      "media_product_type": "REELS" | "FEED" | "STORY",
      "media_url": "https://...",
      "permalink": "https://www.instagram.com/reel/.../",
      "thumbnail_url": "https://...",
      "timestamp": "2026-01-14T08:23:00+0000",
      "username": "...",
      "comments_count": 2,
      "like_count": 18
    }
  ]
}
```

`comments_count` and `like_count` are Meta-maintained totals on the media object. These reflect the true counts on Instagram even when the `/comments` or `/insights` edges are filtered for historical reasons (see `media comments` for details).

`--type REELS` filters on `media_product_type`; the other values filter on `media_type`.

## `media get <id>`

Returns a single media object with the same shape as entries in `media list.data`.

## `media comments <id>`

List comments on a media item. **Requires the `instagram_business_manage_comments` scope** — which Meta only grants bundled with moderation capability. The CLI itself never calls any write endpoint; see the README for the nuance.

Flags: `--replies` (include threaded replies under each top-level comment), `--limit 1..50` (default 25), `--after <cursor>`.

```json
{
  "media_id": "1785...",
  "count": 12,
  "next_cursor": "QVFIUl..." | null,
  "data": [
    {
      "id": "17895...",
      "text": "Love this!",
      "username": "someone",
      "timestamp": "2026-01-14T08:30:00+0000",
      "like_count": 3,
      "hidden": false,
      "replies": {
        "data": [
          { "id": "17899...", "text": "thanks!", "username": "owner", "timestamp": "...", "like_count": 0 }
        ]
      }
    }
  ]
}
```

If the account was authorised without `instagram_business_manage_comments`, the CLI refuses with exit code 1 and a message pointing at `ig-agent auth login --scope=comments`. If the account was authorised via `auth login --token <t>` without `--scope=comments`, `granted_scopes` is unknown, the CLI attempts the call, and surfaces Meta's error if the token lacks the scope.

### Known Meta-side filter: historical comments

The `/comments` edge silently filters comments made on posts from **before** the IG account was converted to a Business or Creator account — even though `comments_count` on the media object still reflects the true total. If you run `media get <id>` and see `comments_count: 5` but `media comments <id>` returns `count: 0`, that's this filter, not a bug in the CLI. The check is reliable: `media comments` returning an empty `data: []` while the media's `comments_count` is `> 0` is the signal. Tell the user the comments exist on Instagram but aren't retrievable via the API for pre-conversion posts.

## `insights <media-id>`

Flags: `--metrics <comma-separated>` to override the default metric set.

The default metric set depends on media type (Instagram Login API names):
- `REELS`: `reach, views, likes, comments, shares, saved, total_interactions, ig_reels_video_view_total_time, ig_reels_avg_watch_time`
- `FEED` (IMAGE / VIDEO / CAROUSEL): `reach, likes, comments, shares, saved, total_interactions`
- `STORY`: `reach, replies, navigation, shares, total_interactions`

Notes on metric naming (Instagram API with Instagram Login):
- `plays` was deprecated in April 2025 — use `views` (for Reels) instead.
- The old Story metrics `taps_forward`, `taps_back`, `exits` are no longer individual metrics; they're now breakdowns of `navigation`.

If any `ig_reels_*` metric is unavailable (account <1000 followers, old media), the CLI automatically retries without them. Shape:

```json
{
  "media": {
    "id": "1785...",
    "media_type": "VIDEO",
    "media_product_type": "REELS",
    "permalink": "https://www.instagram.com/reel/.../",
    "timestamp": "2026-01-14T08:23:00+0000"
  },
  "metrics": [
    { "name": "reach", "period": "lifetime", "values": [{ "value": 8412 }] },
    { "name": "views", "period": "lifetime", "values": [{ "value": 10203 }] }
  ]
}
```

## `sync`

Flags: `--full` (ignore last cursor, full re-pull), `--limit 1..100` (items per page, default 50), `--max-pages 1..50` (default 10), `--db-path <path>`.

Incrementally pulls media + insights for the active account into the local SQLite cache. Respects the rate limiter. Safe to run on a cron; a second back-to-back invocation is a no-op within a second or two.

```json
{
  "ok": true,
  "ig_user_id": "17841...",
  "media_fetched": 50,
  "insights_fetched": 300,
  "last_cursor": "QVFIUl..." | null
}
```

## `export`

Flags: `--format json|csv`, `--output <path>` (omit for stdout), `--type REELS|IMAGE|VIDEO|CAROUSEL_ALBUM`, `--limit 1..10000` (default 500), `--db-path <path>`.

Reads from the local cache populated by `sync`. No API call. Useful for bulk analysis.

- `--format json`: array of media objects with insight metrics flattened as top-level keys (`reach`, `likes`, `views`, etc. — whatever is in the cache for that media).
- `--format csv`: same flattened rows, RFC-4180 CSV.

If `--output` is set, stdout gets a short confirmation object; otherwise the raw data streams to stdout.

```json
{ "ok": true, "rows": 50, "path": "reels.csv" }
```

---

## Environment overrides (headless / CI)

Skip the config file entirely by exporting:

- `IG_ACCESS_TOKEN` — access token to use for all API calls
- `IG_USER_ID` — IG user id to target
- `META_APP_ID` / `META_APP_SECRET` — used by `auth login` and `auth refresh`
- `META_ACCESS_TOKEN` — alternative input to `auth login --token`

When `IG_ACCESS_TOKEN` is set, the CLI never reads or writes `config.json`. This is the right mode for one-shot agent invocations in CI or ephemeral containers.
