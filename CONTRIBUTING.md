# Contributing to ig-agent

Thanks for your interest. This CLI stays small and focused — read-only Instagram access for AI agents. PRs that broaden that scope (publishing, DMs, scraping third-party accounts) will be declined regardless of quality.

## Before you file an issue

- **Setup trouble?** Read [SETUP.md](SETUP.md) first. The "Known pitfalls" table near the bottom covers most first-run errors (HTTPS redirect URIs, tester-role invites, the Instagram `#_` code trailer).
- **Auth or token problems?** Run `ig-agent auth status --pretty` and include the output (redact `expires_at` if you want, but no token data is printed). Also include your OS.
- **Security issue?** Please don't open a public issue — see [SECURITY.md](SECURITY.md) for the disclosure contact.

## Dev setup

```sh
git clone https://github.com/<you>/ig-agent
cd ig-agent
bun install
bun run dev --help         # runs the CLI from source
bun test                   # unit/integration tests (Bun test runner)
bun run typecheck          # tsc --noEmit
bun run build              # produces dist/cli.js targeting Node ≥ 20
```

Dev runtime is Bun. The shipped bundle targets Node, so the SQLite cache layer keeps two drivers (`bun:sqlite` in dev, `better-sqlite3` in the published bundle). Don't "simplify" that to one driver — it will break the npm install for Node users. See [CLAUDE.md](CLAUDE.md) for more architecture notes.

## What kinds of changes are welcome

- Bug fixes with a regression test.
- New read-only endpoints (additional `account` / `media` / `insights` shapes Meta exposes).
- Better error messages, especially for Meta's German / localised API errors that trip up agents.
- Docs fixes and clarifications to SETUP.md — Meta changes its console frequently; keeping it current is real work.
- Additional test coverage, especially around auth flows and multi-account edge cases.

## What won't be accepted

- **Any write endpoint**. No POST / DELETE / PUT to Meta, ever — no publishing, no comment replies, no comment hides/deletes, no DMs, no follows, no likes. This applies even when a user has opted into a broader scope like `--scope=comments` via which the stored token *could* theoretically perform moderation. The CLI code must stay read-only regardless of what the token permits.
- **New scopes without a user-facing opt-in.** Any scope beyond `instagram_business_basic` must be gated behind an explicit `--scope=<alias>` flag. Never silently widen the default.
- Telemetry, analytics, or any background network call.
- Hashtag search or other scraping of accounts the user hasn't authorized.
- Bumps that add `graph.facebook.com` or Facebook Login scopes back in. That path is deprecated and not coming back.

## PR checklist

- [ ] `bun run typecheck` is clean.
- [ ] `bun test` is green and you've added tests for new behavior.
- [ ] `bun run build` produces a working bundle.
- [ ] If you changed a CLI flag, output shape, or exit code: update `README.md`, `skills/ig-agent/COMMANDS.md`, and (if setup-related) `SETUP.md` to match.
- [ ] If you changed anything token- / config- / cache-related: re-read `SECURITY.md` and confirm nothing leaks to logs or stdout.
- [ ] Small, focused commits with clear messages. Feel free to squash before merging.

## Exit codes are a contract

Exit codes 0–5 are part of the external contract — agents match on them. Don't add, reuse, or renumber without a version bump and an explicit note in the README.

## License

By submitting a PR you agree it is released under the project's [MIT license](LICENSE).
