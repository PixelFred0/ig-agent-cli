# Setup guide

`ig-agent` uses Meta's **Instagram API with Instagram Login** (`graph.instagram.com`) — no Facebook Page required. But Meta's developer console is genuinely rough for first-time users. This guide walks through every step that tripped us up while setting up a real account, so you don't have to repeat the detective work.

If you just want the short version, use the Quickstart in [README.md](README.md). This file is for when something doesn't work.

## Part 1 — Instagram account prep

1. **Switch your Instagram account to Creator or Business** (Instagram mobile app → Settings → Account type and tools → Switch to professional account). Personal accounts cannot authenticate against the API.
2. You do **not** need a Facebook Page. The legacy "Instagram Graph API via Facebook Login" path required one; the path this CLI uses does not.

## Part 2 — Meta Developer App

1. Go to [developers.facebook.com/apps](https://developers.facebook.com/apps) → **Create app**.
2. At the **Use case** screen, pick **"Manage messaging & content on Instagram"** (the Instagram icon).
   - Ignore the description's mention of "publish posts / DMs / comments" — a use case is just a bundle of *available* scopes. The CLI only requests `instagram_business_basic` (read-only).
   - Do not pick **"Other"** — Meta shows a warning that it uses the old experience and will be removed.
3. App type: **Business**. Name it whatever you want, enter your email, create.

## Part 3 — Add the Instagram product

1. In the app dashboard left sidebar, click **+ Add product** (or "Add Products to App") and add **Instagram**.
2. In the Instagram product page, find **"API setup with Instagram business login"** (not "with Facebook Login" — that's the legacy path).
3. Two App ID / App Secret pairs exist on this page. Use the **Instagram** ones, not the general app-level ones under Settings → Basic. The general ones are for Facebook Login; they won't work here.

## Part 4 — Instagram Tester role

This is the step Meta hides. Without it, the "Add Instagram account" button in the Instagram product page will black-screen or silently fail.

1. Dashboard left sidebar → **App Roles → Roles** (different page from Settings → Roles).
2. Scroll to the **Instagram Testers** section.
3. Click **Add Instagram Testers** → enter your **Instagram username** (the `@handle`, not your real name — Meta only searches handles).
4. Leave the dev console. On your phone, Instagram app → profile → ☰ menu → **Settings and privacy → Apps and websites → Tester invites → Accept**. (Desktop: instagram.com → Settings → Apps and Websites → Tester Invites.)
5. Back in the dev console, the tester should flip from Pending to Active.

### Can't find your IG username?

- Instagram app → your profile → the text next to the back arrow at the top is your username.
- Or visit instagram.com on desktop — your profile URL is `instagram.com/<username>`.

## Part 5 — Business Login redirect URI

Inside the Instagram product → **Setup Instagram Business Login** panel.

1. Add a redirect URI. Meta currently rejects plain `http://` URLs for Business Login even for localhost, because it pings the URL from its own servers to validate reachability.
2. What works: register **`https://localhost:8573/callback`**.
   - Yes, this URL won't actually serve HTTPS — our local server speaks HTTP. That's fine; the workaround is below.
3. If Meta still errors, try `https://127.0.0.1:8573/callback`. Some accounts get one or the other.
4. **Deauthorize callback URL** / **Data deletion request URL** (if the form shows them): reuse the same URL. Meta only checks that they're present for Standard Access.
5. Save.

## Part 6 — Complete the OAuth flow

Meta gives you an **embed URL** (a prebuilt `https://www.instagram.com/oauth/authorize?...` link) on the Business Login page. You'll use it once to get an authorization code.

```sh
cd /path/to/ig-agent
export META_APP_ID=<Instagram App ID>
export META_APP_SECRET=<Instagram App Secret>
```

1. **Click the embed URL** in your browser. Approve the permissions on the Instagram auth page.
2. The browser will redirect to `https://localhost:8573/callback?code=XXX&state=YYY#_` and show an **SSL error page** ("This site can't provide a secure connection" / `ERR_SSL_PROTOCOL_ERROR`). **Leave the tab open.**
3. Copy the `code=XXX` value from the address bar. Two options for the `--code` argument:
   - The whole URL: `"https://localhost:8573/callback?code=XXX&state=YYY#_"`
   - Just the code: `"XXX"`
   The CLI handles both and automatically strips the Instagram `#_` trailer and any trailing slashes.
4. Exchange:
   ```sh
   bun run dev auth exchange \
     --redirect-uri https://localhost:8573/callback \
     --code "<whole URL or just the code>"
   ```
5. You should see something like:
   ```json
   {"ok":true,"mode":"exchange","username":"your_handle","accounts":[{"ig_user_id":"...","username":"..."}],"expires_in_days":60}
   ```

**The code is single-use and expires in ~1 hour.** If the exchange errors (HTTP 400), click the embed URL again to get a fresh code and retry — don't reuse an old one.

**The `--redirect-uri` must exactly match the URL you registered**, including scheme, host, port, and path.

### Enabling comments (optional)

If you want to read comments on your media (`ig-agent media comments <id>`), you need the `instagram_business_manage_comments` scope in addition to the default. Meta bundles this scope with moderation capability — your token will technically be able to hide/delete/reply to comments, even though the CLI never calls those endpoints.

For the browser OAuth flow (once Meta accepts `http://localhost` again):
```sh
ig-agent auth login --scope=comments
```

For the manual `auth exchange` flow (today): edit the Meta Business Login settings to request `instagram_business_basic,instagram_business_manage_comments` in the embed URL's `scope` parameter before clicking it. After the exchange, `ig-agent auth status --pretty` should show `granted_scopes: ["instagram_business_basic", "instagram_business_manage_comments"]`.

Alternatively, if your token was already granted the broader scope (e.g. you ticked it in the Meta console), re-annotate the stored account so the CLI knows:
```sh
ig-agent auth login --token <long-lived-token> --scope=comments
```

See [SECURITY.md](SECURITY.md#optional-scopes) for the full consent/capability story.

## Part 7 — Verify

```sh
bun run dev auth status --pretty     # authenticated: true, 60-day expiry
bun run dev account get               # IG user JSON: id, username, followers_count, media_count
bun run dev media list --limit 5      # empty data[] is success for a new account
```

Long-lived tokens can be refreshed (extending another 60 days) without the app secret:

```sh
bun run dev auth refresh
```

## Part 8 — App Review (spoiler: you don't need it)

Meta's dashboard will prompt you to go through **App Review** before using the app "publicly". If you're **only using `ig-agent` with your own Instagram account** (as a tester), you do **not** need App Review. Standard Access for `instagram_business_basic` works out of the box for tester accounts.

- **Standard Access** (the default): works for you + anyone you add as an Instagram Tester. No review needed.
- **Advanced Access**: required only if you want end-users to be able to log in to a production product. Needs Meta's App Review.

There is usually no "Save" button on the permissions tab — Standard Access is the default; you don't need to change anything. The "Request Advanced Access" button on each permission row is the only thing you could click, and you shouldn't click it for a personal-use setup.

## Known pitfalls

| Symptom | Cause | Fix |
|---|---|---|
| "Error saving redirect URLs" | Meta's validator pings the URL and `http://localhost` is unreachable from Meta's servers | Register `https://localhost:8573/callback` instead. Ignore the fact that our server doesn't speak HTTPS — the workflow below handles that. |
| Black screen when clicking "Add Instagram account" | Tester invite not yet accepted on the IG app, or third-party cookie blocker | Accept the tester invite on your phone first. If still failing, try a different browser / incognito after logging in to instagram.com. |
| `auth exchange` returns HTTP 400 | Code is stale (>1 hour old), already used, or had `#_` / trailing slash left in | Click the embed URL again for a fresh code. Our parser now strips `#_` automatically; if you're on an older revision of the CLI, remove it manually. |
| Tester name not found in the Roles search | Meta only searches IG **usernames** (`@handle`), not display names | Open the IG app → profile → top of screen shows the handle. |
| `Missing --app-id/--app-secret` | `META_APP_ID` / `META_APP_SECRET` env vars not set in the same shell | Export them in the same terminal session, or pass `--app-id`/`--app-secret` flags explicitly. |

## Future improvements worth considering

- A wrapper helper service or CLI subcommand that proxies OAuth through a lightweight public HTTPS endpoint would eliminate the SSL-error-page step. Right now that's out of scope — it would require a hosted component, which conflicts with the "no backend, no telemetry" guarantee in [SECURITY.md](SECURITY.md).
- If Meta ever re-enables `http://localhost` for Instagram Business Login redirects, Part 5's HTTPS workaround becomes unnecessary and `auth login` (the built-in local-server flow) just works. The CLI already supports that path; it's dormant until Meta loosens the rule.
