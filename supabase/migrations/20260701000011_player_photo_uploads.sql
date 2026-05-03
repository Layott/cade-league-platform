-- Plan 53 — Player photo overrides (Task 1, migration 2/4).
--
-- `player_photo_uploads` tracks raw uploaded photos and their
-- processing state. Each successful upload mints a new pose_index
-- for the player (>= 100 to stay distinct from manifest poses 01..09).
--
-- `upload_mode` distinguishes:
--   * 'single' — Mode A: browser auto-strips bg + canvas-crops the
--     card variant from a single uploaded image. Headshot + card
--     coverage only.
--   * 'multi'  — Mode B: full multi-file or ZIP upload from the
--     local `_process.py` output. Full 6-variant coverage
--     (headshot/card/fullbody × _nobg).
--
-- `storage_paths` is a JSON dict keyed by variant kind. Empty `{}`
-- while pending; populated once processing finishes. `variants_json`
-- mirrors the resolver shape ({headshot: '/path', card: '/path', ...}).

create table public.player_photo_uploads (
  id              uuid primary key default gen_random_uuid(),
  player_id       uuid not null references public.players(id) on delete cascade,
  pose_index      int  null,
  status          text not null default 'pending'
                  check (status in ('pending','uploading','processing','ready','failed')),
  upload_mode     text not null check (upload_mode in ('single','multi')),
  storage_paths   jsonb not null default '{}'::jsonb,
  variants_json   jsonb null,
  uploaded_by     uuid not null references public.users(id),
  uploaded_at     timestamptz not null default now(),
  processed_at    timestamptz null,
  error_message   text null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz null
);

create index player_photo_uploads_player_status
  on public.player_photo_uploads (player_id, status, deleted_at);

select public.attach_audit('public.player_photo_uploads');
