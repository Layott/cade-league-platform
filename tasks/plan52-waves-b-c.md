# Plan 52 — Wave B (destructive wipe) + Wave C (orgs linkage)

**Will execute only after user OKs each wave.**

## Wave B-1 — wipe match data (item #2)

KEEP: `match_days`, `matches` (fixtures), `players`, `organizations`, `seasons`, `season_participants`, `users`, `user_roles`, `squad_*`.

WIPE (soft-delete via `deleted_at = now()` where the column exists; TRUNCATE for compute-only tables):

```sql
-- Soft-delete match results so triggers can recompute
UPDATE match_results SET deleted_at = now() WHERE deleted_at IS NULL;

-- Soft-delete sanctions / disciplinary
UPDATE disciplinary_actions SET deleted_at = now() WHERE deleted_at IS NULL;
UPDATE disciplinary_cases SET deleted_at = now() WHERE deleted_at IS NULL;

-- Truncate computed tables (rebuilt by triggers from match_results)
TRUNCATE standings RESTART IDENTITY CASCADE;
TRUNCATE leaderboard_snapshots RESTART IDENTITY CASCADE;
TRUNCATE player_match_stats RESTART IDENTITY CASCADE;
TRUNCATE disciplinary_precedents RESTART IDENTITY CASCADE;

-- OCR + screenshots (not strictly "match data" but linked)
UPDATE match_stat_screenshots SET deleted_at = now() WHERE deleted_at IS NULL;

-- Attendance
UPDATE attendance_marks SET deleted_at = now() WHERE deleted_at IS NULL;

-- Seed an empty standings row per active player so the leaderboard renders 13 zero-rows
INSERT INTO standings (season_id, player_id, matches_played, wins, draws, losses,
                       goals_for, goals_against, goal_difference, points)
SELECT sp.season_id, sp.player_id, 0, 0, 0, 0, 0, 0, 0, 0
FROM season_participants sp
WHERE sp.deleted_at IS NULL
ON CONFLICT (season_id, player_id) DO NOTHING;
```

## Wave B-2 — wipe disputes/appeals/announcements (item #7)

```sql
UPDATE disputes SET deleted_at = now() WHERE deleted_at IS NULL;
UPDATE appeals SET deleted_at = now() WHERE deleted_at IS NULL;
UPDATE announcements SET deleted_at = now() WHERE deleted_at IS NULL;

-- Notifications related to the above (notifications has source_table or kind)
UPDATE notifications SET deleted_at = now()
WHERE deleted_at IS NULL
  AND kind IN ('announcement', 'dispute_filed', 'dispute_replied', 'appeal_filed', 'appeal_outcome');
```

## Wave C — orgs ↔ players linkage (item #3)

Pre-step: check existing orgs in DB. If <11, seed missing.

```sql
-- Seed orgs (idempotent on name match — adjust if name conflicts)
INSERT INTO organizations (name, status)
VALUES
  ('CADE Esports', 'active'),
  ('GameEvo Esports', 'active'),
  ('Breaking Gaming Barriers', 'active'),
  ('Phoenix Esports', 'active'),
  ('Outlaws', 'active'),
  ('Lumo Labs', 'active'),
  ('Funquest Esports', 'active'),
  ('Solar Flare', 'active'),
  ('Yakabu Global', 'active'),
  ('Afropanda Esports', 'active'),
  ('OAS Esports', 'active')
ON CONFLICT (name) DO NOTHING;

-- Bulk link via gamer_tag match (case-insensitive)
WITH org_map(player_tag, org_name) AS (VALUES
  ('ADEFOLA', 'CADE Esports'),
  ('BAJI JNR', 'GameEvo Esports'),
  ('KILLER FREAK', 'GameEvo Esports'),
  ('WOLEVATION', 'Breaking Gaming Barriers'),
  ('MITCH', 'Phoenix Esports'),
  ('DADABOI', 'Outlaws'),
  ('KAYKAY', 'Lumo Labs'),
  ('TACTICAL', 'Funquest Esports'),
  ('KINGNONEX', 'Solar Flare'),
  ('GURU', 'Yakabu Global'),
  ('ANIFE', 'Afropanda Esports'),
  ('FARUK', 'OAS Esports')
)
UPDATE players p
SET organization_id = o.id
FROM org_map m
JOIN organizations o ON upper(o.name) = upper(m.org_name)
WHERE upper(p.gamer_tag) = upper(m.player_tag)
  AND p.deleted_at IS NULL
  AND o.deleted_at IS NULL;

-- Mr Oga stays NULL (unaffiliated)
```

## Verification after wipe

```sql
-- Should be 0
SELECT count(*) FROM match_results WHERE deleted_at IS NULL;
SELECT count(*) FROM disciplinary_actions WHERE deleted_at IS NULL;
SELECT count(*) FROM disputes WHERE deleted_at IS NULL;
SELECT count(*) FROM appeals WHERE deleted_at IS NULL;
SELECT count(*) FROM announcements WHERE deleted_at IS NULL;

-- Should still be populated
SELECT count(*) FROM matches WHERE deleted_at IS NULL;       -- 78 (round-robin)
SELECT count(*) FROM match_days WHERE deleted_at IS NULL;     -- whatever current is
SELECT count(*) FROM players WHERE deleted_at IS NULL;        -- 13
SELECT count(*) FROM organizations WHERE deleted_at IS NULL;  -- 11

-- Linkage check (Mr Oga = NULL, all others = org id)
SELECT p.gamer_tag, o.name AS org
FROM players p
LEFT JOIN organizations o ON o.id = p.organization_id
WHERE p.deleted_at IS NULL
ORDER BY p.gamer_tag;
```
