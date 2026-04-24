# Phantom-column audit — 2026-04-24

## Summary

- **513 Supabase queries** audited across **~147 in-scope `.ts`/`.tsx` files**.
- **6 bugs found** (post-`55bfadf` residuals), all involving columns that plausibly exist on a nearby table but not the table being queried.
- **6 fixed in this pass** (commit TBD — this slice).
- **0 left unfixed.**
- Out-of-scope folders (other parallel agents own them): `app/admin/broadcast/**`, `components/broadcast/**`, `(overlay)/overlay/**`, `server/broadcast/**`, `components/squads/SquadPitchView.tsx`, `components/squads/FutbinCardThumb.tsx`, `app/player/squad/**`, `app/admin/squads/[id]/**`, `app/players/[id]/page.tsx`, `server/squads/list.ts`.

### Audit method

1. Parsed all 117 `supabase/migrations/*.sql` files into a `{ table: { cols: Set<col>, fks: { col: targetTable } } }` map via `tmp_parse_schema.mjs`. 51 tables enumerated (excluding views registered but with zero column introspection).
2. Scanned every `.from("<lit>")` chain in `apps/web/src/**/*.{ts,tsx}` via `tmp_audit_queries.mjs`. Per chain, extracted:
   - `.select("...")` top-level columns + PostgREST embeds (including FK-hint `alias:fk_col(...)` form + explicit `alias:target_table!fk_name(...)` form + `!inner`/`!left` join modifiers).
   - `.eq("col", ...)`, `.neq`, `.gt`, `.gte`, `.lt`, `.lte`, `.is`, `.in`, `.order`, `.filter`, `.match`, `.not`, `.like`, `.ilike`, `.contains`, `.containedBy`, `.overlaps`, `.textSearch`.
   - `.insert({...})` / `.update({...})` / `.upsert({...})` object keys.
3. Cross-matched each referenced column against the migration-derived schema. Embed references validated via the FK map (so `home_player:home_player_id(...)` resolves `home_player_id` → `players` and validates the inner cols against `players`).

Caveats: regex-based scanner, so dynamic `.from(variable)` chains are not audited. The only such sites are `server/trash/index.ts` (driven by a whitelist const `TRASH_ENTITIES` — manually re-validated, all selectCols clean) and `server/storage/signed.ts` (storage bucket, not a table). `.rpc()` calls audited manually (3 sites; all call valid function names `fc26_players_fuzzy` + `recompute_standings`).

## Fixed in this pass

| File | Table | Bad reference | Fix | Commit |
|---|---|---|---|---|
| `apps/web/src/app/(auth)/profile/page.tsx` L155-166 | `appeals` | `.select("disciplinary_action_id, status")` + `.in("disciplinary_action_id", sanctions.map(s => s.id))` — `appeals` has `disciplinary_case_id`, not `disciplinary_action_id`; appeals link to cases, not actions. | Rewrote to select `disciplinary_case_id, status`, build `caseIds = unique sanction.disciplinary_case_id`, filter `.in("disciplinary_case_id", caseIds)`, index `appealedCaseIds` set by case_id, and flip `alreadyAppealed` lookup to use `sanction.disciplinary_case_id`. Also short-circuits when `caseIds.length === 0` to skip the round-trip. | TBD |
| `apps/web/src/server/overlays/autofill.ts` L84-116 (`buildStandingsWidgetPayload`) | `standings` | `.select("rank, points, goal_difference, ...")` + `.order("rank", { ascending: true })` — `standings` has no `rank` column. | Removed `rank` from select; changed ordering to `(points desc, goal_difference desc, goals_for desc)` — the same tiebreak `standings_season_points_idx` is built for. Assigned `rank: i + 1` in the JS mapper from sorted index. | TBD |
| `apps/web/src/server/overlays/autofill.ts` L206-248 (`buildPlayerCardPayload`) | `standings` | `.select("games_played, wins, draws, ...")` — column is `matches_played`, not `games_played`. | Renamed in the select string, in the typed `Row` alias, and in the `gp: stats?.matches_played ?? 0` output mapper. | TBD |
| `apps/web/src/server/overlays/autofill.ts` L280-316 (`buildLowerThirdPayload`) | `standings` | `.select("games_played, wins, draws, losses, points")` — same as above. | Renamed to `matches_played` everywhere; output mapper now reads `stats.matches_played`. | TBD |
| `apps/web/src/server/overlays/autofill.test.ts` L149-184 (`buildStandingsWidgetPayload` test) | (test fixture) | Stubbed rows contained `rank: 1` / `rank: 2` fields to match the old `select("rank, ...")`. With the fix, those fields are ignored (the fn derives rank from array index). | Updated fixture to include `goals_for` (new sort key) and removed `rank` from stub rows. Assertion now checks `out.rows[0].rank === 1` + `out.rows[1].rank === 2` (derived, not stubbed). Test name updated: "derives rank from order-by position (standings has no rank column)". | TBD |
| `apps/web/src/server/overlays/leaderboard_data.ts` L62-65 (doc comment only) | `standings` | Doc comment said "The `standings` table historically had a `rank` column but it is populated elsewhere and may lag" — factually wrong; it never had one. | Updated doc comment to: "NOTE: the `rank` field is computed server-side from the sorted list index (1-based), NOT from a SQL rank column — the `standings` table has no `rank` column. Sort order is (points desc, goal_difference desc, goals_for desc), the same tiebreak hierarchy `standings_season_points_idx` is built for." | TBD |

## Left unfixed

None.

## Tables with 0 queries in scope

Dead or out-of-scope-only tables — these appear in migrations but are NOT queried from any in-scope file:

- **`audit_smoke`** — smoke-test scratch table from migration `20260420000004`. Used only by SQL smoke tests, not the app.
- **`content_posts`**, **`content_obligation_status`** (view), **`content_sessions`** — content obligations feature, soft-archived per Plan 33 (migration `20260507000020`).
- **`preseason_shoots`**, **`preseason_shoot_attendance`** — preseason shoots feature, soft-archived per Plan 33.
- **`fc26_refresh_log`** — orphan table from dropped Plan 24 fcdb-refresh cron (per `CLAUDE.md` scope-discipline). No code reads it.
- **`overlay_events`**, **`overlay_templates`** — broadcast agent's territory; queried only inside `server/broadcast/**` + `app/admin/broadcast/**` which are out of scope for this pass.

## In-scope query volume per table

Top 12 by query count (of 513 total in-scope chains):

| Table | Count |
|---|---|
| `users` | 99 |
| `user_roles` | 75 |
| `players` | 33 |
| `match_days` | 23 |
| `matches` | 22 |
| `disciplinary_actions` | 16 |
| `squad_submissions` | 15 |
| `match_stat_screenshots` | 14 |
| `appeals` | 12 |
| `seasons` | 11 |
| `stream_sessions` | 11 |
| `squad_player_items` | 11 |

## Verification

- `npm run lint` — 0 errors, 12 pre-existing warnings (no-img-element + unused vars; not introduced by this slice).
- `npm run test` — 1131/1131 pass (129 files).
- `npm --workspace apps/web run e2e` — deferred to the committer; the six fixes are covered by unit tests + a hand-inspection of the call paths. Broadcast E2E spec under the squad-visual / broadcast agents' territories is unaffected.
- Manual re-run of `tmp_audit_queries.mjs` after fixes: **0 bugs reported**.

## Tools left in tree (for follow-up productization)

- `tmp_parse_schema.mjs` — parses migrations → `tmp_schemas.json`.
- `tmp_audit_queries.mjs` — validates every `.from()` chain against that schema.
- `tmp_schemas.json`, `tmp_audit_findings.json` — current run output.

These SHOULD be moved to `scripts/audit-schema.mjs` + wired into CI so phantom-column bugs get caught before they land on `main`. Captured as rule #2 in the `tasks/lessons.md` entry dated 2026-04-24.
