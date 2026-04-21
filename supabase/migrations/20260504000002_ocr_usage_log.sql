-- Plan 14 — append-only OCR usage log.
--
-- Mirrors the caution_ledger / audit_events append-only trigger pattern. Every
-- parse() dispatch writes exactly one row: success or failure, with token
-- counts + cost cents so we can budget-cap and retro-audit spend. After
-- insert, UPDATE and DELETE both raise to keep the ledger immutable.
create table public.ocr_usage_log (
  id                  uuid primary key default gen_random_uuid(),
  called_at           timestamptz not null default now(),
  engine              text not null check (engine in
                        ('claude-opus-4-7','tesseract','manual','disabled')),
  input_tokens        int,
  output_tokens       int,
  cost_usd_cents      int not null default 0 check (cost_usd_cents >= 0),
  match_id_ref        uuid references public.matches (id),
  screenshot_id_ref   uuid references public.match_stat_screenshots (id),
  success_bool        boolean not null default false,
  error_message       text,
  created_at          timestamptz not null default now()
);

create index ocr_usage_log_called_at_idx
  on public.ocr_usage_log (called_at desc);

create index ocr_usage_log_engine_idx
  on public.ocr_usage_log (engine, called_at desc);

-- Append-only: block UPDATE + DELETE. Insert-and-forget.
create or replace function public.ocr_usage_log_block_mutations()
returns trigger
language plpgsql
as $$
begin
  raise exception 'ocr_usage_log is append-only';
end;
$$;

drop trigger if exists ocr_usage_log_no_update on public.ocr_usage_log;
create trigger ocr_usage_log_no_update
  before update on public.ocr_usage_log
  for each row execute function public.ocr_usage_log_block_mutations();

drop trigger if exists ocr_usage_log_no_delete on public.ocr_usage_log;
create trigger ocr_usage_log_no_delete
  before delete on public.ocr_usage_log
  for each row execute function public.ocr_usage_log_block_mutations();

-- NOTE: we intentionally do NOT call public.attach_audit here.
-- Append-only already is the audit — double-logging wastes rows.
