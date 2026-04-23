# ig-agent — agent workflow recipes

Worked patterns for common requests. Each recipe is a sequence of shell commands an agent can run, followed by the analysis it should perform on the output.

## Contents
- [Rank the top N Reels by engagement rate](#rank-the-top-n-reels-by-engagement-rate)
- [Weekly performance summary](#weekly-performance-summary)
- [Content-direction brainstorm from history](#content-direction-brainstorm-from-history)
- [Monitor a single Reel over time](#monitor-a-single-reel-over-time)
- [Identify underperforming formats](#identify-underperforming-formats)
- [Cache refresh on a Mac Mini / cron](#cache-refresh-on-a-mac-mini--cron)

---

## Rank the top N Reels by engagement rate

**Goal:** "Show my top 10 Reels from the last 30 days by engagement rate."

```bash
# 1. Ensure cache is fresh (costs one paginated batch, well under rate limit)
ig-agent sync

# 2. Pull cached Reels as JSON — no more API calls from here
ig-agent export --format json --type REELS --limit 200 > /tmp/reels.json
```

Parse `/tmp/reels.json`. Each row has media metadata plus the insight metrics flattened in. Compute `engagement_rate = total_interactions / reach` for each (skip rows where `reach` is null / zero). Sort descending, slice top 10, report `permalink`, `timestamp`, `reach`, `total_interactions`, and the computed rate.

**Why sync + export instead of live loops:** A 30-day Reels analysis of ~60 posts would be 60+ `insights` calls live. One `sync` pulls everything in a single batch under the rate limit and makes the analysis instant.

## Weekly performance summary

**Goal:** "How did I do last week?"

```bash
ig-agent account insights --period week --json > /tmp/account.json
ig-agent media list --type REELS --since 2026-04-15 --until 2026-04-22 --json > /tmp/week-reels.json
```

Read both files. From `account.json` report reach, profile views. From `week-reels.json.data`, for each Reel call:

```bash
for id in $(jq -r '.data[].id' /tmp/week-reels.json); do
  ig-agent insights "$id" --json
done > /tmp/week-insights.ndjson
```

Aggregate: total views, average reach, best-performing Reel (permalink + caption), worst. Surface as a short written summary — don't dump raw JSON on the user.

**Rate-limit check:** This recipe does 1 + 1 + N calls, where N is the number of Reels that week. If N > 30, run `sync` instead and read from the cache.

## Content-direction brainstorm from history

**Goal:** "Look at my last 50 Reels and suggest three content directions I should double down on."

```bash
ig-agent sync
ig-agent export --format json --type REELS --limit 50 > /tmp/recent.json
```

Parse and group. For each Reel, the row has `caption` + metrics. Cluster captions by topic (manual heuristic — look for recurring keywords, hashtags, named entities). For each cluster, report the average reach / engagement rate and a representative Reel permalink.

Then reason: the three highest-performing clusters become the content directions. Include concrete examples (permalinks) so the user can click through.

## Monitor a single Reel over time

**Goal:** "Re-check this Reel's numbers every day."

```bash
ig-agent insights <media-id> --json
```

Append the output to a timestamped NDJSON file on each run. Over time the user can see the insight trajectory — most Reels collect ~80% of their views in the first 48 h and then level off, so the shape matters more than the headline number.

## Identify underperforming formats

**Goal:** "Which media type (REELS vs FEED image vs carousel) is dragging my reach down?"

```bash
ig-agent sync
ig-agent export --format csv --output /tmp/all.csv
```

Group the CSV rows by `media_product_type` and `media_type`. Compute average `reach` per group. Report with counts — single outliers in small groups shouldn't drive conclusions.

## Cache refresh on a Mac Mini / cron

**Goal:** Keep the local cache current without burning quota.

```cron
# /etc/crontab or user crontab — once every 6 h
0 */6 * * *  /usr/local/bin/ig-agent sync --quiet
```

Incremental `sync` is cheap (only new media + their insights). Daily analysis jobs can then run `ig-agent export` with no fresh API traffic.

---

## Handling failures

| Exit code | What to do |
|---|---|
| 3 (rate-limited) | Sleep 60 s, retry once. If still 3, switch to `export` on the cache and tell the user the data is from the last sync. |
| 4 (auth) | Stop. Ask the user to run `ig-agent auth refresh` (if `can_refresh: true` in `auth status`) or `ig-agent auth login`. |
| 5 (network) | Retry up to 3× with exponential backoff (5s, 20s, 60s). |
| 1 or 2 | Surface the stderr message verbatim to the user. These are not retryable. |

Don't keep retrying indefinitely — after 3 consecutive failures on the same command, stop and report.
