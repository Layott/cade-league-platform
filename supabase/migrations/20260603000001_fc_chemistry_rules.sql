-- 2026-05-03 — Futbin Fut26ChemistryData rule cache.
--
-- Single-row table storing the global chem rule table extracted from any
-- Futbin saved squad page (`Fut26ChemistryData.rareTypeRules` JSON
-- embedded on every `https://www.futbin.com/26/squad/<id>` page). Same
-- ruleset applies to all FC26 cards globally, so one fetch covers the
-- entire game's chem rules.
--
-- Refresh cadence: scrapers (`_scrape_futbin_*.js`) call the shared
-- fetcher (`_lib_chem_rules.js::fetchAndPersistChemRules`) once per run
-- before exiting. Drift detection via `last_scraped_at` + JSONB diff.
--
-- Why a single row keyed on 'fut26' rather than per-rare-type rows:
--   - The whole table is fetched atomically from one page render — partial
--     rows would be misleading.
--   - chem.ts (lib/chemistry.ts) imports a single JSON blob; mirroring
--     that shape in the DB keeps the loader trivial.
--   - Future games (FC27 etc.) get their own row keyed `fut27`.

create table public.fc_chemistry_rules (
  game_key            text primary key,
  rare_type_rules     jsonb not null,
  hero_club_id        bigint,
  icon_club_id        bigint,
  last_scraped_at     timestamptz not null default now(),
  source_url          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.fc_chemistry_rules is
  'Cached Futbin Fut26ChemistryData.rareTypeRules. Single row per game-key (e.g. ''fut26''). Refreshed by Futbin scraper runs.';

select public.attach_audit('public.fc_chemistry_rules');
