-- Plan 21 — FC 26 Kaggle player database ingest table.
--
-- Catalogue of every FC 26 FUT item from a periodic Kaggle dump. The Plan 23
-- ref-review UI calls server/fcdb/lookup.ts to resolve OCR-transcribed squad
-- rows against this table. No PII; no RLS. Soft-delete + audit-trigger per
-- CLAUDE.md non-negotiables §3 + §6.

create extension if not exists pg_trgm;

create table public.fc26_players (
  id                    uuid primary key default gen_random_uuid(),
  source_dataset        text not null,
  source_row_id         text not null,
  name                  text not null,
  short_name            text,
  slug                  text not null,
  rating                int  not null check (rating between 1 and 99),
  position              text not null,
  alt_positions         text[],
  club                  text,
  league                text,
  nation                text,
  nation_iso            text,
  age                   int,
  height_cm             int,
  weight_kg             int,
  preferred_foot        text check (preferred_foot in ('Left','Right')),
  weak_foot             int  check (weak_foot   between 1 and 5),
  skill_moves           int  check (skill_moves between 1 and 5),
  body_type             text,
  work_rate_atk         text check (work_rate_atk in ('Low','Medium','High')),
  work_rate_def         text check (work_rate_def in ('Low','Medium','High')),
  attributes            jsonb not null,
  item_type             text  not null default 'normal',
  value_coins_estimate  bigint,
  imported_at           timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz
);

-- Lookup indexes — partial on deleted_at to keep the active set tight.
create index fc26_players_slug_idx
  on public.fc26_players (slug)
  where deleted_at is null;

create index fc26_players_rating_idx
  on public.fc26_players (rating)
  where deleted_at is null;

-- Trigram fallback for fuzzy name search when slug exact match misses.
create index fc26_players_name_trgm
  on public.fc26_players using gin (name gin_trgm_ops);

-- Idempotent re-import: every Kaggle row carries a stable id that maps 1:1 to
-- (source_dataset, source_row_id). The importer ON CONFLICTs on this index.
create unique index fc26_players_source_unique
  on public.fc26_players (source_dataset, source_row_id)
  where deleted_at is null;

-- Standard generic-trigger audit attachment (CLAUDE.md non-negotiable §3).
select public.attach_audit('public.fc26_players');
