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
