-- Plan 37 — match_clock: server-config row per session. Stores
-- mode + seconds_remaining + set_at; client computes display via
-- max(0, seconds_remaining - (now - set_at)) for countdown.
-- One row per session (PK = stream_session_id).

create table public.match_clock (
  stream_session_id   uuid primary key references public.stream_sessions(id),
  mode                text not null default 'stopped',
  seconds_remaining   int not null default 0,
  set_at              timestamptz not null default now(),
  set_by              uuid references public.users(id),
  label               text,
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  constraint match_clock_mode_chk
    check (mode in ('countdown','countup','paused','stopped')),
  constraint match_clock_label_chk
    check (label is null or char_length(label) between 1 and 40),
  constraint match_clock_seconds_chk
    check (seconds_remaining between 0 and 359999)  -- 99h59m59s sanity cap
);

-- Audit trigger
select public.attach_audit('public.match_clock');

-- RLS: read for authenticated; writes via service role (API gate
-- 'match_clock.manage').
alter table public.match_clock enable row level security;

create policy match_clock_read_authn on public.match_clock
  for select to authenticated
  using (deleted_at is null);
