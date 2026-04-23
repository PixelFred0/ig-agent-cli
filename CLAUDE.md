# ig-agent

## What this repo is

`ig-agent` is a read-only Instagram CLI (Instagram API with Instagram Login, `graph.instagram.com`) that emits structured JSON for AI agents. It authenticates against Meta, pulls media / insights / account data, caches into local SQLite, and exits with stable codes so agents can retry. It does **not** use the legacy Facebook Login path — no Facebook Pages are involved. It also ships an agent skill at `skills/ig-agent/` that teaches Claude how to use the CLI.

For the full user-facing story (commands, flags, quickstart), see `README.md`.

## Runtime — read before changing the cache or build

- **Dev runtime is Bun.** Shipped bundle targets **Node ≥ 20** (see `package.json` `engines` and the `build` script).
- **The cache layer deliberately uses two drivers.** `src/cache/` auto-selects `bun:sqlite` under Bun and `better-sqlite3` on Node. Both are required and both must keep working. **Do not "simplify" this to one driver.** The dependency on `better-sqlite3` is not a mistake — it's what keeps the npm install working for end users.

## Non-negotiable contracts

These are the product, not internal choices. Changing any of them needs a version bump and a note in `README.md`.

- **stdout is clean JSON** when `--json` (the default). Diagnostics go to **stderr**. Never `console.log` into a command's stdout path — use the logger in `src/lib/`.
- **Exit codes 0–5 are a stable external contract** (see the table in `README.md`). Don't renumber, reuse, or add new codes silently — agents are matching on these.
- **Read-only.** No Instagram API write endpoints, ever — no posting, liking, comments, DMs, follows. The only requested scope is `instagram_business_basic` (read-only media + insights); don't add `instagram_business_content_publish`, `instagram_business_manage_messages`, or `instagram_business_manage_comments`.
- **No telemetry, no analytics, no background network.** The only network calls are direct consequences of user commands: `graph.instagram.com`, `api.instagram.com` / `www.instagram.com` for OAuth, and `registry.npmjs.org` from `ig-agent update`. See `SECURITY.md` — those guarantees are public.

## Tokens and secrets

- Tokens live **only** in the platform-appropriate config dir (resolved via `env-paths`), `chmod 0600`. Never in the cache DB, never in the repo, never in logs. macOS: `~/Library/Preferences/ig-agent/config.json`. Linux: `~/.config/ig-agent/config.json`. Windows: `%APPDATA%\ig-agent\config.json`. Run `ig-agent auth status` to see the resolved path (`config_path` field).
- Env overrides: `IG_ACCESS_TOKEN`, `IG_USER_ID`, `META_ACCESS_TOKEN`, `META_APP_ID`, `META_APP_SECRET`.
- Log redaction lives in `src/lib/` — it scrubs `EAA…`/`IGAA…`/`IGQ…`, `access_token=…`, `ig_exchange_token=…`, `ig_refresh_token=…`, `"access_token":"…"`, and long base64-ish strings before anything reaches stderr. **Any new logging must route through the existing logger/redactor.**
- `.claude/settings.json` denies reads and writes to `~/.config/ig-agent/**` and `~/.local/share/ig-agent/**` — don't work around this.
- Before editing anything token-, config-, or cache-related, read `SECURITY.md`.

## Bun rules that apply here

This is a CLI, so most of the generic Bun guidance (Bun.serve, HTML imports, WebSockets, HMR) is irrelevant. What does apply:

- `bun <file>` instead of `node <file>` / `ts-node <file>`.
- `bun test` instead of `jest` / `vitest`.
- `bun install` / `bunx` / `bun run <script>` — not npm / pnpm / yarn.
- Bun auto-loads `.env` — don't add `dotenv`.
- In **dev-only tooling** (scripts, tests), prefer `Bun.file` / `Bun.$` over `node:fs` / `execa`.
- In **shipped code paths** (anything that ends up in `dist/cli.js`), prefer cross-runtime APIs so the Node bundle keeps working. The `better-sqlite3` / `bun:sqlite` split described above is the canonical example.

## Build, test, typecheck

```sh
bun install
bun run dev <command>   # run the CLI from source
bun test
bun run typecheck       # tsc --noEmit
bun run build           # produces dist/cli.js targeting Node
```

CI (`.github/workflows/`) runs typecheck + tests + a Node-bundle smoke test on every push / PR. Keep both green before requesting review.

## Layout (abbreviated — full tree in `README.md`)

```
src/
├── cli.ts       # citty entry, command wiring, exit-code mapping
├── commands/    # one file per top-level subcommand
├── ig/          # graph.instagram.com client, zod schemas, IG-Login OAuth
├── cache/       # SQLite adapter (bun:sqlite | better-sqlite3) + repos
├── config/      # ~/.config/ig-agent/config.json store + env overrides
├── output/      # JSON + CSV formatters
└── lib/         # logger (with redaction), token-bucket limiter, exit codes
test/            # mirrors src/, run with `bun test`
skills/ig-agent/ # agent skill shipped alongside the CLI
```

## Where to look before changing things

- Touching tokens / config / cache → **`SECURITY.md`** first.
- Touching error paths, exit codes, or command return shapes → **`README.md`** exit-codes table and the command table — those are the contract.
- Changing CLI flags, subcommands, or output shapes → also update **`skills/ig-agent/`** so the agent skill stays in sync with the CLI it teaches.
