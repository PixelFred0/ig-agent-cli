<!-- Thanks for contributing! Please fill this in so reviewers have the context they need. -->

### What this PR does

<!-- A 1–3 sentence summary. If it closes an issue, `Closes #NN`. -->

### Why

<!-- The motivation. If there's a Meta API behavior or docs page involved, link it. -->

### Scope

<!-- Any user-visible changes? Commands/flags/output shapes/exit codes? -->

### Checklist

- [ ] `bun run typecheck` clean
- [ ] `bun test` green (and new behavior has tests)
- [ ] `bun run build` produces a working bundle
- [ ] If CLI surface changed: `README.md` + `skills/ig-agent/COMMANDS.md` updated to match
- [ ] If setup/auth flow changed: `SETUP.md` updated
- [ ] If anything touches tokens / config / cache: re-read `SECURITY.md` and confirm nothing leaks
- [ ] Kept read-only — no new write endpoints, no new scopes beyond `instagram_business_basic`
