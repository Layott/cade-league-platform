# FC 26 player DB refresh runbook

**Owner:** admin. **Cadence:** monthly (manual trigger). **Plan 21B** may
automate via GitHub Action.

The `public.fc26_players` table is the local catalogue the Plan 23 ref-review
UI uses to resolve OCR'd squad rows. It is populated from periodic Kaggle
dumps of the community-maintained FC 26 player database.

---

## 1. Data source

- **Dataset:** `flynn28/eafc26-player-database`
  → https://www.kaggle.com/datasets/flynn28/eafc26-player-database
- **License posture:** community-curated metadata. Kaggle file metadata is
  CC0 / CC-BY (varies per uploader); underlying attribute values are EA
  Sports' product attributes, used here for personal/research league use
  under the same norms as Futbin / FUTWIZ scrapes. Not redistributed
  publicly.
- **Alternative datasets** (if flynn28 goes stale): search Kaggle for
  "EAFC 26 database" / "FC 26 player database" — any community dump with
  the canonical columns (`id`, `name`, `overall`, `position`, ...) should
  drop in; update `DATASET_URL` constant in
  `KNOWLEDGE/extracted/_fc26_import.py`.

---

## 2. One-time setup

### 2.1 Kaggle API token

1. Visit https://www.kaggle.com/settings/account → **Create New API Token**.
   This downloads `kaggle.json`.
2. Place it at `~/.kaggle/kaggle.json`.
   - On Windows: `C:\Users\<you>\.kaggle\kaggle.json`.
3. `chmod 600 ~/.kaggle/kaggle.json` (on WSL / mac / Linux). Windows:
   right-click → Properties → Security → restrict read to your user.

### 2.2 Kaggle CLI

```bash
pip install kaggle
# On this workstation, use the pinned interpreter:
C:/Users/Sweez/AppData/Local/Python/pythoncore-3.14-64/Scripts/pip.exe install kaggle
```

Verify: `kaggle datasets list | head`.

### 2.3 Database URL

The importer connects via `SUPABASE_DB_URL`. Get the **pooler** connection
string from Supabase → Project Settings → Database → Connection string
(Transaction mode, port 6543). Example:

```
export SUPABASE_DB_URL="postgresql://postgres.<ref>:<pwd>@aws-0-<region>.pooler.supabase.com:6543/postgres"
```

Do **not** commit this. Keep in `apps/web/.env.local` (already gitignored) or
your shell rc.

### 2.4 psycopg2

```bash
pip install psycopg2-binary
```

---

## 3. Monthly refresh procedure

```bash
# 1. Pull the latest dump.
kaggle datasets download -d flynn28/eafc26-player-database \
  -p KNOWLEDGE/extracted/ --unzip

# 2. Rename to the importer's expected filename.
mv KNOWLEDGE/extracted/<downloaded-csv>.csv \
   KNOWLEDGE/extracted/fc26_players_kaggle.csv

# 3. Run the importer. Idempotent: re-runs upsert in place.
python KNOWLEDGE/extracted/_fc26_import.py

# Expected output:
#   [fc26 importer] reading .../fc26_players_kaggle.csv
#   [fc26 importer] target dataset: https://www.kaggle.com/...
#   [fc26 importer] processed N rows in X.Xs (upsert via source_dataset + source_row_id)
```

### 3.1 Verify row count

```bash
npx supabase db query --linked \
  "select count(*) from public.fc26_players where deleted_at is null;"
```

A healthy FC 26 dump is ~18k-22k rows (FUT + Icons + Heroes). If you get
< 1k, something is wrong — re-check the CSV column names vs
`COLUMN_MAP` in the importer.

### 3.2 Sanity query

```bash
npx supabase db query --linked \
  "select name, rating, club, item_type from public.fc26_players
   where deleted_at is null
   order by rating desc limit 10;"
```

Top-10 ratings should look like the current FC 26 meta (Mbappé, Haaland,
Vinicius, etc. — hero/icon items often rank higher than current players).

---

## 4. Troubleshooting

- **Importer says "CSV not found" and exits 0.** The CSV was not unzipped
  into `KNOWLEDGE/extracted/`. Re-run step 3.1 with `--unzip`.
- **Importer says "SUPABASE_DB_URL is not set" and exits 1.** Export the
  pooler URL (see §2.3).
- **`permission denied for schema public` on upsert.** You're using the
  direct connection string (port 5432) with an anon role. Switch to the
  pooler string and check you pasted the `postgres` user (not `anon`).
- **psycopg2 ImportError.** `pip install psycopg2-binary`.
- **Lookup returns 0 matches for a name that clearly should hit.** Check the
  slug: `npx supabase db query --linked "select slug from public.fc26_players
  where name ilike '%<name>%' limit 5;"`. If the slug differs from what
  `slugify()` produces in TS, reconcile the two (importer's Python
  `slugify` vs `apps/web/src/server/fcdb/slug.ts`).

---

## 5. Rollback

If a bad dump corrupts the table, soft-delete the whole dataset snapshot:

```sql
update public.fc26_players
set deleted_at = now()
where source_dataset = 'https://www.kaggle.com/datasets/flynn28/eafc26-player-database'
  and imported_at >= '<YYYY-MM-DD>';
```

Then re-import from the prior Kaggle version (Kaggle keeps version history
on each dataset page). The admin `/trash` UI will also list the rows for
inspection.

---

## 6. Nightly auto-refresh (Plan 24, shipped 2026-04-22)

A Vercel cron hits `/api/cron/fcdb-refresh` nightly at **03:00 WAT**
(`0 2 * * *` UTC). The route tries three sources in order and stops at the
first that returns rows:

1. **Kaggle CLI** — dev-only. Needs `kaggle` CLI on PATH plus
   `KAGGLE_API_TOKEN` (or `KAGGLE_KEY` + `KAGGLE_USERNAME`). Skipped fast
   on Vercel serverless (no CLI installable).
2. **futdb.co API** — needs `FUTDB_API_KEY` (free tier, 100 req/day).
   Fetches 3 pages of 100 cards nightly = 300 cards refreshed per run.
   Rate-limited to 1 req/sec.
3. **sofifa.com HTML scrape** — last resort. No key; rate-limited 1 req/s.
   Fragile to markup drift; monitor `fc26_refresh_log` for `source='sofifa'`
   rows with `rows_upserted = 0` and update the regex in
   `apps/web/src/server/fcdb/sources/sofifa.ts` when that happens.

### 6.1 Required env vars

Add to Vercel Project Settings -> Environment Variables (Production):

| Var                | Required? | Notes                                                   |
| ------------------ | --------- | ------------------------------------------------------- |
| `CRON_SECRET`      | yes       | Shared with other crons. Any 32+ byte random string.    |
| `FUTDB_API_KEY`    | yes       | Free tier at https://futdb.co/settings/tokens.          |
| `KAGGLE_API_TOKEN` | no        | Dev / self-hosted runners only; ignored on Vercel.      |
| `KAGGLE_KEY`       | no        | Alternative Kaggle env; same semantics as above.        |
| `KAGGLE_USERNAME`  | no        | Required alongside `KAGGLE_KEY` per Kaggle CLI rules.   |

### 6.2 Manual trigger

```bash
curl -s -X POST \
  -H "X-Cron-Secret: $(grep '^CRON_SECRET=' apps/web/.env.local | cut -d= -f2-)" \
  http://localhost:3030/api/cron/fcdb-refresh
```

Expected JSON on success:
```json
{ "ok": true, "source": "futdb", "upserted": 300, "failed": 0, "duration_ms": 3500 }
```

When every source is skipped / failing (typical on a fresh clone with no
env vars set), the response is still 200 with:
```json
{ "ok": true, "source": "none", "upserted": 0, "failed": 0,
  "error": "kaggle: ...; futdb: FUTDB_API_KEY not set; sofifa: ..." }
```

### 6.3 Observability

Every run writes one row to `public.fc26_refresh_log` (append-only). To
inspect recent runs:

```bash
npx supabase db query --linked \
  "select ran_at, source, rows_upserted, rows_failed, duration_ms, error
   from public.fc26_refresh_log
   order by ran_at desc limit 10;"
```

---

## 7. Out of scope

- Real-time price updates (would need websocket infra).
- Non-player items (managers, stadiums) — not needed for ref review.
