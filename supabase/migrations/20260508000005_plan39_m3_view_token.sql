-- Plan 39 M3 — per-session view_token on stream_sessions.
--
-- Threat model (from Plan 38 security audit):
--   `/api/broadcast/sessions/:id/active` is intentionally unauthenticated so
--   browser sources (OBS, vMix, Streamlabs, Ecamm, XSplit, Restream) can
--   render overlays without juggling cookies. Plan 12 shipped that route
--   treating the URL itself as the shared secret. The audit observed that
--   session ids are UUIDs but they leak through admin log rows, CDN access
--   logs, shared screenshots of the operator's browser, and stream chat if
--   an operator drags a tab URL into view. Any unauthenticated caller who
--   sniffs a session id can then poll `/active` and learn which overlays
--   are on-air in real time — useful reconnaissance for scoreboard/sponsor
--   manipulation attempts even though the payload itself is non-PII.
--
-- Fix:
--   Mint a 32-byte base64url view_token at session-create time and bind it
--   to every `/active` GET via `?t=<token>` or `Authorization: Bearer`.
--   Token mismatch = 401. The route stays publicly reachable (no cookie
--   gate) so OBS-style browser sources still work — operators now paste
--   `sessionId + token` together.
--
-- Backwards compat:
--   Existing historical rows (Plan 12 era) have `view_token IS NULL`. The
--   /active handler treats null as "no gate required" for those — they are
--   historical and their data is already public in admin log rows. Only
--   new sessions (post-migration) require the token. See route.ts comment.
--
-- Rotation:
--   `rotateViewToken(sb, sessionId)` in server/broadcast/sessions.ts mints
--   a fresh token. Requires broadcast.manage. Audit trigger records the
--   update so rotations are traceable.

alter table public.stream_sessions
  add column if not exists view_token text null;

comment on column public.stream_sessions.view_token is
  'Plan 39 M3: per-session shared secret for unauthenticated /active '
  'polling. NULL on pre-migration rows (publicly readable). Non-null '
  'rows require ?t=<token> on GET /api/broadcast/sessions/:id/active.';

create unique index if not exists stream_sessions_view_token_idx
  on public.stream_sessions (view_token)
  where view_token is not null and deleted_at is null;
