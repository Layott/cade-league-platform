-- Plan 12 follow-up: broadcast is generic (OBS Studio, vMix, Streamlabs, etc.)
-- per its own spec — the initial column name baked a specific vendor into the
-- schema. Rename to a neutral `session_tag`. No data loss: pure rename.

alter table public.stream_sessions
  rename column vmix_session_tag to session_tag;
