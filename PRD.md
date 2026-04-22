# PRD — `ig-agent` CLI

A TypeScript CLI for pulling Instagram content, media metadata, and insights into structured JSON that AI agents (Claude Code, custom agents, automation pipelines) can consume for social media planning, reporting, and content strategy.

**Owner:** Adaptiq UG
**Status:** Draft v0.2
**Target first release:** MVP in ~1–2 weeks of focused work
**Pilot account:** Owner's personal Instagram account (not Adaptiq's)

---

## 0. Prerequisites (one-time, manual, before coding)

These are **hard blockers** for the Instagram Graph API — the CLI cannot work around them.

1. **Convert personal IG account to a Creator account** (free, 1-minute setting in the Instagram app; reversible). Business account works too but Creator fits a personal brand better.
2. **Create a Facebook Page** and link the Instagram account to it. The Page can be empty and not promoted — it's just a structural requirement of Meta's account model.
3. **Create a Meta Developer App** at `developers.facebook.com` under the owner's personal Meta account:
   - App type: *Business*
   - Add products: *Instagram* and *Facebook Login*
   - OAuth redirect URI: `http://localhost:8573/callback` (fixed port used by the CLI)
   - Permissions to request: `instagram_basic`, `instagram_manage_insights`, `pages_show_list`, `pages_read_engagement`, `business_management`
   - For the owner's own account, Standard Access is sufficient — **no App Review needed**.
4. Note: some Reel metrics (`ig_reels_avg_watch_time`, audience demographics) require **≥ 1000 followers**. Basic metrics (reach, plays, likes, comments, shares, saves, total_interactions) work regardless.

## 1. Problem

Marketers and AI agents that plan Instagram content need programmatic, structured access to:

- Recent media (posts, Reels, Stories) with captions, timestamps, permalinks
- Per-media insights: reach, plays, likes, comments, shares, saves, watch time, skip rate
- Account-level insights: follower deltas, reach, demographics
- A way to run all of the above as local commands that an AI agent can shell out to

The Instagram app and Meta Business Suite are GUI-only. The Graph API is powerful but has a steep onboarding curve (app creation, OAuth, long-lived tokens, rate limits, permission scopes). A thin, opinionated CLI removes that friction and gives agents a clean data source.

## 2. Goals

1. Read-only access to media and insights for Instagram Business/Creator accounts the user owns or manages with consent.
2. Stable, typed JSON output suitable for LLM consumption.
3. `npm install -g` installable; runnable on any machine with Node ≥ 20 (no Bun required at runtime).
4. Local SQLite cache so agents can replay historical data without burning API quota.
5. Simple token management (login, refresh, status).

## 3. Non-Goals (v1)

- Publishing / scheduling content (write operations come in v2).
- Scraping public or competitor accounts (legal/ToS risk; revisit via Phyllo or Apify in v2).
- Built-in LLM reasoning — the CLI emits data; a separate agent reasons about it.
- Multi-platform (TikTok, YouTube Shorts, LinkedIn) — separate tool or later unification.

## 4. Users & Use Cases

| User | Use case |
|---|---|
| Claude Code agent | Shell out to `ig-agent insights <id> --json`, feed into planning prompt |
| Solo marketer | `ig-agent export --format csv` for weekly review |
| Adaptiq backoffice automation | Scheduled `ig-agent sync` on a Mac Mini, feeds Notion dashboard |
| Future MCP client | Same core exposed as MCP tools for direct Claude Code tool calls |

## 5. Core Commands (MVP)

All commands accept `--json` (default), `--pretty`, `--account <ig-user-id>`, `--config <path>`, `--quiet`.

| Command | Purpose |
|---|---|
| `ig-agent auth login` | Open browser to Meta OAuth, receive short-lived token, exchange for 60-day long-lived token, store locally |
| `ig-agent auth status` | Show token expiry and connected IG accounts |
| `ig-agent auth refresh` | Refresh long-lived token before expiry |
| `ig-agent auth logout` | Clear stored credentials |
| `ig-agent account list` | List connected IG Business/Creator accounts |
| `ig-agent account insights [--period day\|week\|days_28]` | Account-level metrics (reach, profile views, follower demographics where available) |
| `ig-agent media list [--type REELS\|IMAGE\|VIDEO\|CAROUSEL_ALBUM] [--limit 50] [--since ISODATE] [--until ISODATE]` | Paginated media list |
| `ig-agent media get <id>` | Full metadata for one media item |
| `ig-agent insights <media-id>` | All supported metrics for a single media item (see §7) |
| `ig-agent sync [--full]` | Incremental pull into local SQLite cache |
| `ig-agent export --format json\|csv [--output FILE] [--type REELS]` | Export cached data |

### Exit codes (stable contract for agents)

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | User error (bad flags, missing args) |
| 2 | API error (non-retryable) |
| 3 | Rate-limited (agents can retry with backoff) |
| 4 | Auth expired / missing |
| 5 | Network error (retryable) |

## 6. Tech Stack

| Concern | Choice | Rationale |
|---|---|---|
| Language | TypeScript strict | Matches house stack |
| Dev runtime | Bun 1.3+ | Fast iteration, native TS |
| Distribution runtime | Node ≥ 20 | Broad compatibility for `npm i -g` users |
| Build | `bun build --target=node --outdir dist --minify` | Single bundled JS, no transitive install for end users |
| CLI framework | `citty` | Small, typed, Bun-friendly (alternative: `commander`) |
| HTTP | native `fetch` + thin retry wrapper | No extra deps |
| Schema validation | `zod` | Typed Graph API responses, safe output contract |
| Local DB | `better-sqlite3` | Sync, embedded, Node-compatible |
| Config path | `env-paths` → `~/.config/ig-agent/` | XDG-aware |
| Logging | `consola` | Structured, pretty, per-level |
| Testing | `bun test` + mocked fetch | Fast |

## 7. Instagram Graph API Integration

### Meta Developer App setup (one-time, manual)

1. Create Meta Developer App (type: Business) under Adaptiq UG.
2. Add "Instagram" and "Facebook Login" products.
3. Configure OAuth redirect: `http://localhost:<random-port>/callback` (CLI spins up a temporary local server).
4. Request scopes: `instagram_basic`, `instagram_manage_insights`, `pages_show_list`, `business_management`, `pages_read_engagement`.
5. For accounts other than your own, submit for App Review (Advanced Access); for own/test accounts, Standard Access is enough.

### Auth flow in CLI

1. `ig-agent auth login` opens default browser to Meta OAuth dialog.
2. On redirect, CLI receives short-lived user token.
3. CLI exchanges it for a long-lived token (≈60 days) via `/oauth/access_token`.
4. CLI lists the user's Facebook Pages and the linked `instagram_business_account` IDs.
5. Token + account mapping stored at `~/.config/ig-agent/config.json` with mode `0600`.

### Key endpoints used

| Endpoint | Purpose |
|---|---|
| `GET /me/accounts` | List FB Pages |
| `GET /{page-id}?fields=instagram_business_account` | Resolve IG user ID |
| `GET /{ig-user-id}?fields=username,followers_count,media_count` | Account basics |
| `GET /{ig-user-id}/media?fields=...` | Media list (paginated) |
| `GET /{ig-media-id}?fields=id,caption,media_type,media_product_type,media_url,permalink,thumbnail_url,timestamp` | Media detail |
| `GET /{ig-media-id}/insights?metric=...` | Media insights |
| `GET /{ig-user-id}/insights?metric=...&period=...` | Account insights |

### Reel metrics (as of 2026)

Supported via `/{media-id}/insights`: `reach`, `plays` (views), `likes`, `comments`, `shares`, `saved`, `total_interactions`, `ig_reels_video_view_total_time`, `ig_reels_avg_watch_time`, and new metrics such as `skip_rate` (percentage of views skipped within 3s). Exact metric availability depends on media type and account size (some require ≥1000 followers).

### Rate limiting

200 calls/hour per IG account. Client wraps all requests in a token-bucket limiter with per-account state and exponential backoff on HTTP 429 / `error.code = 4` / `code = 17` / `code = 32`. Cache-first reads (`ig-agent sync` populates the cache; other reads prefer cache when fresh).

## 8. Data Model (local SQLite cache)

```
accounts(
  ig_user_id TEXT PRIMARY KEY,
  username TEXT,
  page_id TEXT,
  connected_at INTEGER
)

media(
  id TEXT PRIMARY KEY,
  account_id TEXT REFERENCES accounts(ig_user_id),
  media_type TEXT,          -- IMAGE | VIDEO | CAROUSEL_ALBUM
  media_product_type TEXT,  -- FEED | REELS | STORY
  caption TEXT,
  permalink TEXT,
  thumbnail_url TEXT,
  timestamp INTEGER,
  raw_json TEXT,            -- full API response for forward-compat
  fetched_at INTEGER
)

insights(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  media_id TEXT REFERENCES media(id),
  metric TEXT,
  value REAL,
  period TEXT,
  fetched_at INTEGER,
  UNIQUE(media_id, metric, period, fetched_at)
)

sync_state(
  account_id TEXT PRIMARY KEY,
  last_cursor TEXT,
  last_synced_at INTEGER
)
```

Tokens are **not** stored in SQLite — they live in `config.json` with restricted permissions (or optional keychain/1Password).

## 9. Project Layout

```
ig-agent/
├── package.json
├── tsconfig.json
├── bunfig.toml
├── README.md
├── src/
│   ├── cli.ts                 # entry point, shebang, command wiring
│   ├── commands/
│   │   ├── auth.ts
│   │   ├── account.ts
│   │   ├── media.ts
│   │   ├── insights.ts
│   │   ├── sync.ts
│   │   └── export.ts
│   ├── ig/
│   │   ├── client.ts          # fetch wrapper with auth, retry, rate limit
│   │   ├── oauth.ts           # local callback server + token exchange
│   │   ├── endpoints.ts       # typed functions per endpoint
│   │   └── schemas.ts         # zod schemas for Graph API responses
│   ├── cache/
│   │   ├── db.ts              # better-sqlite3 init + migrations
│   │   └── repo.ts            # typed repository
│   ├── config/
│   │   └── store.ts           # read/write ~/.config/ig-agent/config.json
│   ├── output/
│   │   ├── json.ts
│   │   └── csv.ts
│   └── lib/
│       ├── logger.ts
│       ├── rate-limit.ts
│       └── exit-codes.ts
├── dist/                       # bundled output, gitignored
└── test/
```

## 10. Packaging & Distribution

`package.json` essentials:

```jsonc
{
  "name": "@adaptiq/ig-agent",
  "version": "0.1.0",
  "type": "module",
  "bin": { "ig-agent": "dist/cli.js" },
  "files": ["dist", "README.md", "LICENSE"],
  "engines": { "node": ">=20" },
  "scripts": {
    "dev": "bun run src/cli.ts",
    "build": "bun build src/cli.ts --target=node --outdir dist --minify --banner '#!/usr/bin/env node'",
    "prepublishOnly": "bun run build",
    "test": "bun test"
  }
}
```

Install path for end users: `npm install -g @adaptiq/ig-agent` → `ig-agent` on PATH.

## 11. Security & DSGVO

- Tokens stored at `~/.config/ig-agent/config.json`, `chmod 0600`. Never logged, redacted in errors.
- Env override: `IG_ACCESS_TOKEN`, `IG_USER_ID` for CI / ops use.
- v1 only operates on accounts the user has explicitly connected via OAuth → no PII exposure beyond what Meta already grants.
- Data cached locally stays on the user's machine; no phone-home.
- *(Future option: integrate 1Password Connect for token storage, consistent with Adaptiq's secrets pattern. Not in v1.)*

## 12. AI Agent Integration Pattern

Agents call `ig-agent <subcommand> --json`, parse stdout. Stable exit codes allow retry logic. The core is structured as a library with a thin CLI wrapper, so an MCP server mode could be added later without refactoring — but it is explicitly **out of scope for v1**.

**Example agent prompt snippet:**
> Use `ig-agent media list --type REELS --limit 20 --json` to fetch recent Reels, then `ig-agent insights <id> --json` for each. Rank by `total_interactions / reach` and propose three content directions.

## 13. Milestones

| # | Scope | Est. |
|---|---|---|
| M1 | Project skeleton, `auth login/status/refresh/logout`, local OAuth callback server, config store | 2 d |
| M2 | Graph API client with rate limiter, `account list`, `media list`, `media get` | 2 d |
| M3 | `insights` for media + account, full zod schemas, typed JSON output | 2 d |
| M4 | SQLite cache, `sync`, `export` (json + csv) | 2 d |
| M5 | Packaging, `bun build` pipeline, README, `npm publish` dry-run, install test on clean machine | 1 d |
| M6 | (Post-v1) Publishing commands, Phyllo/Apify adapter for competitor data, optional 1Password Connect token storage | — |

## 14. Resolved Decisions

1. **Pilot account:** Owner's own personal Instagram account (converted to Creator type — see §0).
2. **Token storage in v1:** Plain `config.json` at `~/.config/ig-agent/` with `chmod 0600`. 1Password Connect deferred to post-v1.
3. **MCP server mode:** Out of scope for v1. CLI only. Core will still be library-first so it can be added later without refactor.
4. **Meta Developer App:** Registered under owner's personal Meta account for the pilot. Can be transferred to Adaptiq UG later.
5. **Package name:** TBD — check npm registry for `ig-agent` availability, fallback `@adaptiq/ig-agent` or `insta-agent`.

## 15. Success Criteria

- A fresh machine with Node 20 can run `npm i -g @adaptiq/ig-agent && ig-agent auth login && ig-agent insights <some-reel-id>` and get structured JSON in under 60 seconds.
- Claude Code, given only the README, can compose a working social-media-planning workflow using the CLI as a tool.
- Running `ig-agent sync` daily keeps the local cache fresh within the 200 req/h budget for up to 3 accounts with 50 Reels each.