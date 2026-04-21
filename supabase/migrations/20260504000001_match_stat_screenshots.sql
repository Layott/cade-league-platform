-- Plan 14 — match stat screenshot OCR pipeline
--
-- Stores the uploaded screenshot metadata, the OCR parse result (when present),
-- and the human-review state machine: pending → parsing → parsed → confirmed
-- (or any → failed / rejected). Only a `confirmed` row's parsed_json (after
-- admin correction) is allowed to drive writes into player_match_stats.
-- Recompute is NEVER invoked from this path — standings remain sourced from
-- match_results, per spec §4.7.
create table public.match_stat_screenshots (
  id                  uuid primary key default gen_random_uuid(),
  match_id            uuid not null references public.matches (id) on delete cascade,
  storage_path        text not null,
  uploaded_by         uuid not null references public.users (id),
  uploaded_at         timestamptz not null default now(),
  parse_status        text not null default 'pending'
                      check (parse_status in
                        ('pending','parsing','parsed','failed','confirmed','rejected')),
  parsed_json         jsonb,
  parsed_at           timestamptz,
  parsed_by_engine    text check (parsed_by_engine in
                        ('claude-opus-4-7','tesseract','manual')),
  confirmed_by        uuid references public.users (id),
  confirmed_at        timestamptz,
  rejection_reason    text,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz
);

create index match_stat_screenshots_match_idx
  on public.match_stat_screenshots (match_id)
  where deleted_at is null;

create index match_stat_screenshots_status_idx
  on public.match_stat_screenshots (parse_status, match_id)
  where deleted_at is null;

select public.attach_audit('public.match_stat_screenshots');
