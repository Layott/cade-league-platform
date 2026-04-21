# CADE League Platform

In-house platform powering CADE Esports leagues. Phase 1A in progress (Division 1 Elite 2025-2026).

See `CLAUDE.md` for contribution guidance and `docs/superpowers/specs/` for design docs.

## Dev setup

1. Install Node 20 (`nvm use`) and Docker Desktop.
2. `npm install` at repo root.
3. `npx supabase start` to bring up the local DB (requires Docker).
4. `cd apps/web && npm run dev` to serve the app.

## Scripts (root)

- `npm run dev` — start Next.js dev server
- `npm run test` — run unit tests (Vitest)
- `npm run e2e` — run Playwright end-to-end tests
- `npm run lint` — lint the monorepo
- `npm run build` — production build

## Broadcast (generic overlay bridge — Plan 12)

`/admin/broadcast` is the stream operator's control surface. The overlays
are plain transparent HTML pages, so any tool that supports a browser
source works: **OBS Studio, vMix, Streamlabs, Ecamm, XSplit, Restream**,
etc. Workflow:

1. **Pre-flight (one-time):** confirm Supabase Realtime is enabled in the
   project (Dashboard → Project Settings → API → Realtime). The broadcast
   tool and the overlay-serving origin must reach the Supabase WebSocket
   endpoint.
2. **Start a session.** Navigate to `/admin/broadcast`, pick the match
   day from the dropdown, optionally add a session tag, click
   **Start stream session**. You'll land on `/admin/broadcast/<sessionId>`.
3. **Point your browser sources** at each overlay URL you need:
   - Scorebar — `https://<host>/overlay/scorebar?session=<sessionId>`
   - Lower Third — `https://<host>/overlay/lower-third?session=<sessionId>`
   - Standings Widget — `https://<host>/overlay/standings-widget?session=<sessionId>`
   - Player Card — `https://<host>/overlay/player-card?session=<sessionId>`
   - Punishment Ticker — `https://<host>/overlay/punishment-ticker?session=<sessionId>`
   - Intro — `https://<host>/overlay/intro?session=<sessionId>`
   - Outro — `https://<host>/overlay/outro?session=<sessionId>`
   Append `&debug=1` (with `NEXT_PUBLIC_OVERLAY_DEBUG=1` set) for a
   connection HUD during setup.
4. **Trigger overlays** from the admin page's Trigger grid. Each card
   has a JSON payload editor pre-filled with a schema-valid starter. The
   overlay animates in ~1 second after trigger.
5. **Clear** from the Active Overlays panel when you want the graphic
   off-screen.
6. **End the session** when the broadcast is done. Any still-active
   overlays are auto-cleared.

Notes:

- Overlay URLs are the shared secret for Phase 2 prep — do not share
  publicly. A short-lived HMAC token is planned for Phase 2 proper.
- Overlay pages set `.overlay-mode` on `<html>` + `<body>` to force a
  transparent background; the broadcast tool composites directly onto
  video output.
- Cache-Control on the hydration endpoint is `no-store` so redeploys
  never pin stale overlay state in the browser source.
- Permissions: `broadcast.manage` (session start/end + admin UI),
  `broadcast.trigger` (fire an overlay event). Admin inherits both via
  the `*` wildcard; `production` role seeds with `broadcast.trigger`
  only.
