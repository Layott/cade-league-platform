-- Plan 37 — overlay_presets: producer-saved payload library per template_key.
-- Generic table; payload validated by Zod at the API layer at write + load.
-- Audit trigger attached. RLS denies anon writes; admin gating done in API
-- via requirePermAsync('overlay_presets.manage') with the service role.

create table public.overlay_presets (
  id            uuid primary key default gen_random_uuid(),
  template_key  text not null,
  label         text not null,
  payload       jsonb not null,
  is_default    boolean not null default false,
  created_by    uuid not null references public.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  constraint overlay_presets_label_chk
    check (char_length(label) between 1 and 80),
  constraint overlay_presets_template_key_chk
    check (template_key in (
      'scorebar','lower_third','standings_widget','player_card',
      'punishment_ticker','intro','outro',
      'stinger_intro','stinger_normal','stinger_replay','stinger_goal',
      'stinger_winner',
      'layout_4pip','layout_2pip','layout_brb_full','layout_brb_basic',
      'layout_timer','layout_animated_bg','layout_casters_chat',
      'h2h_2','h2h_3','h2h_5',
      'leaderboard_animated','score_bug','up_next_bug','match_scores_day',
      'starting_soon_basic','starting_soon_timer','stream_ended',
      'top_scorers','orgs_roster','coach_intros','player_penalties'
    ))
);

create unique index overlay_presets_default_per_template_idx
  on public.overlay_presets (template_key)
  where is_default and deleted_at is null;

create index overlay_presets_template_idx
  on public.overlay_presets (template_key)
  where deleted_at is null;

create index overlay_presets_created_by_idx
  on public.overlay_presets (created_by)
  where deleted_at is null;

-- Audit trigger
select public.attach_audit('public.overlay_presets');

-- RLS: read-only for authenticated; writes require service role (API layer
-- pre-checks 'overlay_presets.manage').
alter table public.overlay_presets enable row level security;

create policy overlay_presets_read_authn on public.overlay_presets
  for select to authenticated
  using (deleted_at is null);

-- No insert/update/delete policy for authenticated → defaults to deny.
-- Service role bypasses RLS, which is what the admin actions use.
