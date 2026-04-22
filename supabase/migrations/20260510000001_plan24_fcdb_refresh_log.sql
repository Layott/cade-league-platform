-- Plan 24 — append-only log for nightly fc26 price refresh runs.
--
-- Every invocation of /api/cron/fcdb-refresh writes exactly one row here:
-- which source fired (kaggle / futdb / sofifa / none), how many rows the
-- upsert touched, and the wall-clock duration. On all-sources-failed the
-- route still inserts a row with error text so we can tell "cron ran +
-- broke" from "cron didn't fire at all". Mirrors the append-only pattern
-- used by ocr_usage_log + caution_ledger_entries + audit_events (CLAUDE.md
-- non-negotiable §5).
create table public.fc26_refresh_log (
  id              uuid primary key default gen_random_uuid(),
  ran_at          timestamptz not null default now(),
  source          text not null check (source in ('kaggle','futdb','sofifa','none')),
  rows_upserted   int  not null default 0 check (rows_upserted >= 0),
  rows_failed     int  not null default 0 check (rows_failed   >= 0),
  duration_ms     int  not null default 0 check (duration_ms   >= 0),
  error           text
);

create index fc26_refresh_log_ran_at_idx
  on public.fc26_refresh_log (ran_at desc);

-- Append-only: block UPDATE + DELETE. Insert-and-forget, like ocr_usage_log.
create or replace function public.fc26_refresh_log_block_mutations()
returns trigger
language plpgsql
as $$
begin
  raise exception 'fc26_refresh_log is append-only';
end;
$$;

drop trigger if exists fc26_refresh_log_no_update on public.fc26_refresh_log;
create trigger fc26_refresh_log_no_update
  before update on public.fc26_refresh_log
  for each row execute function public.fc26_refresh_log_block_mutations();

drop trigger if exists fc26_refresh_log_no_delete on public.fc26_refresh_log;
create trigger fc26_refresh_log_no_delete
  before delete on public.fc26_refresh_log
  for each row execute function public.fc26_refresh_log_block_mutations();

-- Standard generic-trigger audit attachment (CLAUDE.md non-negotiable §3).
-- Pairs with the block-mutations trigger above: audit_events still records
-- the INSERT event, but no one can mutate the log row after the fact.
select public.attach_audit('public.fc26_refresh_log');
