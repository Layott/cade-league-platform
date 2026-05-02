# Futbin scraper toolkit (`KNOWLEDGE/extracted/`)

Catalogue of every active scraper script + helper. Read alongside
`SCRAPER_SCHEDULE.md` at the repo root (Windows Task Scheduler setup).

## Active scrapers

| Script | Purpose | Schedule |
|---|---|---|
| `_scrape_futbin_headful.js` | Full sequential walk of `/26/players?page=N`. Visible Chromium, manual CF gate. | Manual one-off + monthly belt-and-braces full sweep (first Sunday 02:00). Driver of `scrape-futbin-full.bat`. |
| `_scrape_futbin_new.js` | Delta scraper. Walks `/latest?page=N` and stops as soon as ≥80% of a page overlaps last run's seen-set. | Windows Task Scheduler nightly via `scrape-futbin-delta.bat`. Recommended slots: Wed 12:00 + Wed 20:00 + Thu 01:00 + Fri 20:00 (WAT). |
| `_scrape_futbin_parallel.js` | 4-worker page-range walker (`--from N --to M --workers K`). Each worker has its own Chromium profile. | **Manual run only.** Not on Task Scheduler — requires per-worker CF solve. Use when delta gets a long tail and you want a refresh fast. |
| `_scrape_futbin_filters.js` | Filter-band walker (rating bands × promo-version filters). Catches the ~12k cards absent from the default `/26/players` view (silvers, bronzes, niche promos). | Manual one-off after big promo drops. |
| `_scrape_futbin_range.js` | Targeted page range walker (single profile, sequential). | Manual debugging when a specific page-range is suspect. |
| `_scrape_futbin_reverse.js` | Reverse-order walker (last page → first). Useful when the catalogue tail is suspected stale. | Manual one-off. |
| `_scrape_futbin_auto.js` | Auto-resolving CF + range walker. Less reliable than headful; kept as fallback. | Rarely used. |

All scrapers share the same Supabase write path via `_lib_diff_upsert.js`
(diff-aware upsert — unchanged rows are no-ops). All scrapers IS pushing
to the live DB; verify a run hit the network with:

```sql
-- run via `npx supabase db query --linked`
SELECT max(updated_at) FROM fc26_players WHERE source_dataset='futbin.com';
-- Should be within minutes of the run end.
```

## Helper scripts

| Script | What it does |
|---|---|
| `_lib_diff_upsert.js` | Shared diff-aware upsert. Used by `_scrape_futbin_new.js` + `_scrape_futbin_parallel.js`. |
| `_classify_variant.js` | Maps Futbin variant string → `item_type` enum (normal / icon / hero / toty / tots / rttf / special). |
| `_find_futbin_nation_id.js` | Find Nigeria's Futbin-internal nation ID. Reads DB rows where `nation='Nigeria'` AND `futbin_nation_id` is set, prints the modal. Use to re-confirm `NG_FUTBIN_NATION_ID` after a Futbin schema change. Currently 133. |
| `_dump_nation_id_mapping.js` | Diagnostic. Dumps every distinct `futbin_nation_id` we have alongside the modal `nation` text — drives the curated `FUTBIN_NATION_MAP` in `_backfill_nationality.js`. |
| `_backfill_nationality.js` | Backfill `nation_iso` (and optional `nation` text) for all `source_dataset='futbin.com'` rows that lack an ISO code. Maps `futbin_nation_id` → ISO via curated table; fallback to nation-text → ISO; logs unresolved rows to `_unresolved_nationalities.csv`. **Idempotent**. Run with `--dry-run` first; bare run or `--apply` writes. |
| `_backfill_nation_from_kaggle.js` | Earlier attempt: fuzzy-match futbin row → Kaggle row by name+rating to fill `nation` text. Superseded by the futbin_nation_id-based path. Kept for reference. |
| `_backfill_nation_by_slug.js` | Propagates `nation` text across all variants of the same slug + applies a famous-name fallback map. Run AFTER `_backfill_nationality.js` to fill any remaining holes for icons / heroes whose Futbin row has no nation_id. |
| `_backfill_card_bg.js` | Card-background URL backfill. |
| `_audit_futbin_completeness.js` | Coverage stats — % populated for every key field. |

## Schedule overview (where do scrapers actually run?)

- **Windows Task Scheduler** runs `_scrape_futbin_new.js` (delta) on the user's PC. See `SCRAPER_SCHEDULE.md` at repo root for setup.
- **Headful + parallel + filters** are manual-only. They require an operator at the keyboard to solve Cloudflare challenges.
- **No server-side scraper runs.** There is NO Vercel cron / GitHub Actions cron driving Futbin scrapes — everything runs on the admin's PC.
- All scrapers write directly to the cloud Supabase project (`vqzhczyugpaooegmolgk`) via `SUPABASE_SERVICE_ROLE_KEY` from `apps/web/.env.local`. There is no staging / dry-run mode for the actual DB writes (only the backfill scripts have `--dry-run`).

## Verifying a run actually pushed

After any scraper run:

```sql
-- Most recent updated futbin row should be within a few minutes of run end
SELECT max(updated_at) FROM fc26_players WHERE source_dataset='futbin.com';

-- Total rows should be 22k+ (24k with Kaggle/fut.gg dormants).
SELECT count(*), source_dataset FROM fc26_players WHERE deleted_at IS NULL GROUP BY source_dataset;

-- Coverage on critical fields
SELECT
  count(*) FILTER (WHERE attributes->>'card_image_url' IS NOT NULL) AS with_image,
  count(*) FILTER (WHERE attributes->>'card_bg_url' IS NOT NULL)    AS with_bg,
  count(*) FILTER (WHERE attributes->>'futbin_nation_id' IS NOT NULL) AS with_nation_id,
  count(*) FILTER (WHERE nation_iso IS NOT NULL)                   AS with_nation_iso,
  count(*) AS total
FROM fc26_players WHERE source_dataset='futbin.com' AND deleted_at IS NULL;
```

If `with_nation_iso` is well below `with_nation_id`, run the backfill
again: `node KNOWLEDGE/extracted/_backfill_nationality.js --apply`.

## Maintenance: extending the nation map

The `FUTBIN_NATION_MAP` in `_backfill_nationality.js` covers 157 IDs as
of 2026-05-01 — every ID that appears in our 22.8k Futbin rows. If a
new scrape introduces a previously-unseen ID, the backfill will:

1. Skip that row (leave `nation_iso=NULL`).
2. Dump it to `_unresolved_nationalities.csv`.

To resolve:

1. `node _dump_nation_id_mapping.js` — see what nation name the new ID
   clusters with (Kaggle-matched rows).
2. Add the ID to `FUTBIN_NATION_MAP` with the right ISO 3166-1 alpha-2
   code (or FIFA-specific 3-char like `WAL` / `SCO` / `NIR` / `ENG`).
3. Re-run `_backfill_nationality.js --apply`.

## Files NOT to commit

- `*_state.json` — per-scrape resume state. Local-only.
- `.futbin_chromium_profile*` directories — Chromium user data.
- `_futbin_*.json` — debug dumps.
- `_unresolved_nationalities.csv` — local triage artifact.

`.gitignore` at the repo root covers these.
