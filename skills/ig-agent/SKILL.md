---
name: ig-agent
description: Fetches Instagram data (media list, Reel insights, account metrics) through the local `ig-agent` CLI and returns structured JSON. Use when the user asks about their own Instagram posts or Reels, performance metrics (reach, views, likes, saves, watch time), follower counts, ranking Reels by engagement, exporting IG data to CSV/JSON, or drafting content strategy based on their history. Only useful when the `ig-agent` binary is available on PATH.
---

# ig-agent

A read-only wrapper around Meta's Instagram API with Instagram Login (`graph.instagram.com`). Emits structured JSON for agent consumption. Stable exit codes for retry logic.

## First step: check auth

Start any session with `ig-agent auth status --pretty`. The output is JSON:

```json
{ "authenticated": true, "expires_in_days": 58, "accounts": [ ... ] }
```

- If `authenticated` is `false`, stop and tell the user to run `ig-agent auth login` (browser OAuth) or `ig-agent auth login --token <token>` (headless). Do **not** try to complete the OAuth flow yourself — it requires a browser session.
- If the command itself errors with "not found" or similar, the CLI isn't installed. Tell the user: `npm install -g ig-agent`.

## Invocation contract

- **stdout** is machine-readable JSON (compact by default, pretty with `--pretty`). Pipe it, `jq` it, parse it.
- **stderr** carries human log output. Ignore for data extraction.
- **Exit codes** are stable:

  | Code | Meaning | How an agent should react |
  |---|---|---|
  | 0 | Success | Parse stdout |
  | 1 | User error (bad flags) | Surface to user; don't retry |
  | 2 | API error (non-retryable) | Surface; don't retry |
  | 3 | Rate-limited | Sleep 30–120 s, retry; prefer cache |
  | 4 | Auth expired / missing | Tell user to `ig-agent auth login` or `auth refresh` |
  | 5 | Network error | Retry with exponential backoff |

Always check exit codes in shell (`$?`) before parsing stdout.

## Most common commands

```bash
# List recent Reels
ig-agent media list --type REELS --limit 20 --json

# Single media with full metrics
ig-agent insights <media-id> --json

# Account-level metrics for the last 7 days
ig-agent account insights --period week --json

# Pull a cache snapshot locally (one API round-trip batch) and then query offline
ig-agent sync
ig-agent export --format json --type REELS --limit 50
```

## Global flags

Every subcommand accepts:

- `--json` (default) / `--pretty` — output format
- `--account <ig-user-id-or-username>` — target a specific connected account when the user has multiple
- `--config <path>` — alternative config location (rarely needed; default is `~/.config/ig-agent/config.json`)
- `--quiet` — suppress stderr logs

## Cache-first discipline (rate-limit aware)

The Instagram API is capped at **200 req/hr per IG account** (as wired in our token-bucket limiter; Meta's documented global budget is 4800 × impressions per 24 h). The CLI ships with a token-bucket limiter, but you still shouldn't burn quota. Rule:

1. If the user asks for analysis over many posts, run `ig-agent sync` once, then read from `ig-agent export --format json` or re-run insight commands against already-cached media ids. Cached data is authoritative for ranking/summary tasks.
2. If the user asks "what happened in the last hour?", go live (`media list` / `insights`) — the cache isn't fresh enough.
3. On exit code 3 (rate-limited), fall back to the cache and tell the user.

## Where to look next

- For the complete command reference (every flag, every return shape, every metric name), read [COMMANDS.md](COMMANDS.md).
- For worked agent workflows (rank Reels, weekly summary, content-direction brainstorm), read [RECIPES.md](RECIPES.md).

## What this skill is NOT for

- **Publishing, DM-ing, or modifying anything.** The CLI is read-only — no write endpoints exist, even when the user has opted into the `comments` scope via `--scope=comments`. Don't attempt write operations.
- **Scraping other accounts.** `ig-agent` only operates on accounts the user has connected via OAuth.
- **Competitor research.** The Instagram API doesn't expose competitor data.

If the user asks for any of these, tell them explicitly that `ig-agent` doesn't support it and stop.
