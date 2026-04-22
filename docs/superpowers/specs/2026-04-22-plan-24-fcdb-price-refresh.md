# Plan 24 — fcdb nightly price refresh + card catalogue sync

**Owner:** Spektakula
**Version:** 1.0
**Date:** 2026-04-22
**Status:** Approved
**Depends on:** Plan 21 (fc26_players schema + importer)
**Feeds:** Plan 30 (squad picker reads price_coins)

---

## 1. Goal

Keep `public.fc26_players` catalogue and `price_coins` column fresh without manual Kaggle re-ingests. Nightly cron scrapes an upstream source + upserts into the table.

Source order of preference:
1. **Kaggle refresh** — `kaggle datasets download flynn28/eafc26-player-database -p KNOWLEDGE/extracted/` if a `KAGGLE_API_TOKEN` env var is set. Produces canonical dataset.
2. **futdb.co API** — free JSON API (requires free `FUTDB_API_KEY`), covers ~20k cards with prices. Rate limit: 100 req / day free tier → enough for an incremental refresh.
3. **sofifa.com scrape** — last-resort HTML parse, ~25k cards, no rate limit but fragile.

Only one source runs per night; fallback chain described in §3.

---

## 2. Success criteria

1. A Vercel cron (+ `vercel.json` entry) hits `/api/cron/fcdb-refresh` daily at 03:00 WAT.
2. The route is gated by `X-Cron-Secret` header (same pattern as `/api/cron/squad-deadline-check`).
3. Strategy picks the first available source by env var; falls back on failure.
4. Upserts into `fc26_players` by `(source_dataset, source_row_id)` — existing unique index.
5. Writes a `fc26_refresh_log` row each run: `{ ran_at, source, rows_upserted, rows_failed, duration_ms, error? }` — append-only audit.
6. If ALL sources fail, Sentry-equivalent log (stdout WARN) + Resend email to admins. Never crash the route; always return 200 with diagnostic JSON.

---

## 3. Architecture

### 3.1 Source strategies

`apps/web/src/server/fcdb/sources/kaggle.ts` — spawns `kaggle` CLI via `child_process`. Only active on self-hosted runners (Vercel serverless can't install CLI). For dev only.

`apps/web/src/server/fcdb/sources/futdb.ts` — HTTPS GET `https://futdb.co/api/players?page=N` with `X-AUTH-TOKEN`. Paginate 100/page. ~200 pages. Parse JSON → normalize.

`apps/web/src/server/fcdb/sources/sofifa.ts` — HTTPS GET `https://sofifa.com/api/player?offset=N&limit=60`. Free but fragile; only runs when the other two return 0/fail.

`apps/web/src/server/fcdb/refresh.ts` — orchestrator. Tries sources in order; first one with rows > 0 wins. Returns `{ source, rows_upserted, rows_failed }`.

### 3.2 Migration

`supabase/migrations/20260510000001_plan24_fcdb_refresh_log.sql`:
- `create table public.fc26_refresh_log (id uuid default gen_random_uuid() primary key, ran_at timestamptz not null default now(), source text not null, rows_upserted integer not null default 0, rows_failed integer not null default 0, duration_ms integer not null default 0, error text null);`
- `create index on fc26_refresh_log (ran_at desc);`
- Audit trigger attached (append-only log behavior).

### 3.3 Cron route

`apps/web/src/app/api/cron/fcdb-refresh/route.ts` — POST handler:
- Verify `X-Cron-Secret` against env `CRON_SECRET`.
- Call `refresh(sb)` from `server/fcdb/refresh.ts`.
- Insert log row + return `{ ok: true, source, upserted, failed }`.

### 3.4 vercel.json entry

```json
{
  "crons": [{
    "path": "/api/cron/fcdb-refresh",
    "schedule": "0 2 * * *"  // 02:00 UTC = 03:00 WAT
  }]
}
```

Append to existing `vercel.json` if it has a crons block; otherwise create.

### 3.5 Normalization contract

Every source maps to the canonical `fc26_players` shape:
```ts
{
  source_dataset: 'kaggle' | 'futdb' | 'sofifa',
  source_row_id: string,
  name: string,
  rating: number,
  position: string,          // primary position, e.g. 'ST'
  positions_alt: string[],   // alternative positions
  club: string | null,
  league: string | null,
  nation: string | null,
  item_type: string | null,  // GOLD / SILVER / ICON / HERO / EVO / ...
  price_coins: number | null,
  card_image_url: string | null,
  attributes: jsonb,         // pace/shooting/passing/...
  updated_at: timestamptz
}
```

---

## 4. Environment variables

- `CRON_SECRET` (shared with other crons)
- `FUTDB_API_KEY` (free tier)
- `KAGGLE_API_TOKEN` (optional; dev-only)

Document in `docs/ops/fc26-data-refresh.md` (already exists per Plan 21).

---

## 5. Tests

### Unit
- `sources/futdb.test.ts` — mock fetch; exercise pagination + normalization.
- `sources/sofifa.test.ts` — mock HTML; assert regex-based parser output shape.
- `refresh.test.ts` — strategy fallback order; empty-source → next; all-fail → returns { rows_upserted: 0 } + log entry.

### E2E (manual smoke)
- Hit `/api/cron/fcdb-refresh` locally with `X-Cron-Secret` set → verify row in `fc26_refresh_log` + at least 100 new/updated `fc26_players` rows.

---

## 6. Rollout + risks

- **futdb.co rate limit** — 100 req/day free. Incremental refresh only touches pages 1–3 nightly (300 cards/night). Full catalogue refresh happens weekly.
- **sofifa.com ToS** — their robots.txt allows scraping of public pages; rate-limit self to 1 req/s.
- **Coin prices change** — on FIFA/EAFC, prices shift hourly. Nightly is a deliberate compromise; real-time would require websocket infrastructure we don't have.
- **Kaggle CLI dev-only** — Vercel serverless can't install Python deps. Kaggle path runs only on self-hosted cron (future).

## 7. Acceptance gate

- Cron fires once manually via curl → 200 + log row written.
- `fc26_players` count > 0 after first run.
- Unit tests green.
- Price field populated for ≥ 80% of rows.
