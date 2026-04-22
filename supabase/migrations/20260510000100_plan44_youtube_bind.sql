-- Plan 44 — YouTube live-chat picker + Feature-on-stream overlay.
--
-- (1) Adds three nullable columns on `stream_sessions` so an admin can bind
--     the current broadcast session to a specific currently-live YouTube
--     video + its liveChatId. Nullable + NULL-by-default so legacy sessions
--     are unaffected. Cleared on unbind.
-- (2) Extends the `overlay_templates.template_type` CHECK constraint with
--     the new `featured_comment` key. Postgres cannot extend CHECK in place;
--     we drop + recreate the superset (copied verbatim from the most recent
--     prior migration, `20260508000010_plan16_stinger_miss.sql`).
-- (3) Seeds one `overlay_templates` row for the new key. Idempotent.

-- ---- (1) stream_sessions columns ----------------------------------------

alter table public.stream_sessions
  add column if not exists youtube_video_id text null;

alter table public.stream_sessions
  add column if not exists youtube_live_chat_id text null;

alter table public.stream_sessions
  add column if not exists youtube_bound_at timestamptz null;

comment on column public.stream_sessions.youtube_video_id is
  'Plan 44 — bound YouTube video id. NULL when not monitoring a stream.';
comment on column public.stream_sessions.youtube_live_chat_id is
  'Plan 44 — bound YouTube liveChatId for polling chat messages.';
comment on column public.stream_sessions.youtube_bound_at is
  'Plan 44 — timestamp of most recent bind. Cleared on unbind.';

-- ---- (2) CHECK superset rewrite ----------------------------------------

alter table public.overlay_templates
  drop constraint if exists overlay_templates_template_type_check;

alter table public.overlay_templates
  add constraint overlay_templates_template_type_check
  check (template_type in (
    -- Plan 12 originals (7)
    'lower_third','scorebar','standings_widget','player_card',
    'punishment_ticker','intro','outro',
    -- Plan 16 additions (20)
    'stinger_intro','stinger_normal','stinger_replay','stinger_goal','stinger_winner',
    'layout_4pip','layout_2pip','layout_brb_full','layout_brb_basic','layout_timer',
    'layout_animated_bg','layout_casters_chat',
    'h2h_2','h2h_3','h2h_5',
    'leaderboard_animated','score_bug','up_next_bug','match_scores_day',
    'starting_soon_basic','starting_soon_timer','stream_ended',
    'top_scorers','orgs_roster','coach_intros','player_penalties',
    -- Plan 16 amended (1)
    'stinger_miss',
    -- Plan 44 (1)
    'featured_comment'
  ));

-- ---- (3) Seed the featured_comment template row ------------------------

insert into public.overlay_templates (template_key, template_type, name, html_route)
values
  ('featured_comment', 'featured_comment', 'Featured Comment', '/overlay/featured-comment')
on conflict (template_key) do nothing;
