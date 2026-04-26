# Plan 52 — S3 Cross-flows + Routing Smoke Verification

**Date:** 2026-04-26 02:35 WAT
**Tester:** Claude (Sonnet via Claude Code)
**Production URL:** https://cade-league.vercel.app
**Latest deploy:** `cade-league-zr2j0vcnu` (`dpl_5pTmBb7kerxpuBjbwYVUPZLSHYc6`, 14m before testing)
**Live event in:** ~6 hours

---

## Summary
- **Tests passing: 8/10**
- **Tests failing: 2/10** — Test 5 (`/` and `/announcements` 500) — both share the same root cause
- **CRITICAL bugs blocking the live event: 1** (Test 5 partial — home + news pages 500)

---

## Test 1 — Routing redirects (unauthenticated + authenticated)

**Result: PASS**

Unauthenticated (curl `-L=false`):
| Path | Status | Location |
| --- | --- | --- |
| `/admin/broadcast` | 307 | `/login?next=%2Fadmin%2Fbroadcast` |
| `/admin/broadcast/v2` | 307 | `/login?next=%2Fadmin%2Fbroadcast%2Fv2` |
| `/admin/broadcast/test-session-id-12345` | 307 | `/login?next=%2Fadmin%2Fbroadcast%2Ftest-session-id-12345` |

Authenticated (browser `fetch` with cookie, `redirect: 'follow'`):
| Path | Final URL | redirected | Status |
| --- | --- | --- | --- |
| `/admin/broadcast` | `/admin/broadcast/v2` | true | 200 |
| `/admin/broadcast/test-session-id-12345` | `/admin/broadcast/v2/test-session-id-12345` | true | 200 |
| `/admin/broadcast/v2` | `/admin/broadcast/v2` | false | 200 |

All redirects work end-to-end. The `next=` query string preservation is correct.

---

## Test 2 — Sessions index (`/admin/broadcast/v2`)

**Result: PASS**

Logged in as `admin@cade.local`. Page renders all expected surfaces:
- Match-day picker (`<select name="matchDayId">`) with 9 match-day options
- Active-session card OR start-session form (per-match-day, conditional on whether one is active)
- Past-sessions DataTable (empty for clean match-days; shows "No prior sessions")
- Top nav + admin sub-nav

When picking a match-day with an active session (e.g. Sat May 30 → `c4b942d6-80be-4dde-8ac8-4db6d182b8b2`), shows the green "ACTIVE SESSION" card with a RESUME SESSION button.
When picking a match-day with no active session (e.g. Sun May 17), shows the "Session tag (optional)" input + "Start stream session" button (form `data-testid="start-session-btn"`).

**Console errors:** none observed on this page.

---

## Test 3 — Start a new session

**Result: PASS**

- Navigated `/admin/broadcast/v2?matchDayId=92dff51c-9703-4794-b74b-456475a90b33` (Sun May 17)
- Filled tag input with `smoke-test-2026-04-26`
- Clicked "Start stream session"
- Page navigated to `/admin/broadcast/v2/6eb9e49e-508d-4ed3-b3b6-0a598ae131ae`
- Header reads "Sun May 17 2026 · CADE Studio, Lagos · Started Sun Apr 26 · 02:32 WAT"
- Browser-source URL stub displayed
- Overlay tiles enter "LOADING PREVIEW…" state and progressively render

**New session ID for cleanup:** `6eb9e49e-508d-4ed3-b3b6-0a598ae131ae`
**(Left intact per task instructions — do not end test session.)**

---

## Test 4 — Match-day selector on session panel

**Result: PASS**

Tested on session `c4b942d6-80be-4dde-8ac8-4db6d182b8b2`:
1. Read `select[name="matchDayId"]` initial value → `839b2f17-...` (Sat May 30)
2. Dispatched `change` to `92dff51c-...` (Sun May 17) via the React-aware native setter
3. Reloaded page
4. Selector now reads `92dff51c-...` (Sun May 17) ✓
5. Restored to original `839b2f17-...` ✓ (DB-confirmed via REST query)

DB row state after restoration: `stream_sessions.match_day_id = '839b2f17-0f83-4ac5-af89-af36c1d89c68'` ✓

The MatchDaySelector client component (`apps/web/src/app/admin/broadcast/v2/[sessionId]/MatchDaySelector.tsx`) auto-fires `setSessionMatchDayAction` on `onChange` (no separate Save button). Server action correctly:
- Gates with `broadcast.manage` perm
- Validates target match_day exists + not soft-deleted
- Catches DB unique-violation (`23505`) for `stream_sessions_one_active_per_day` and surfaces friendlier "Another session is already active on that match day — end it first."
- Calls `revalidatePath` so the header re-renders.

---

## Test 5 — Public pages (logged in)

**Result: FAIL — 2 routes 500ing**

| Route | Status | Notes |
| --- | --- | --- |
| `/` | **500** | **Internal Server Error** — see root cause below |
| `/standings` | 200 | 13 zero-rows; `bodyBg = rgb(7, 8, 11)`. PASS. |
| `/fixtures` | 200 | **Empty state "Schedule drop pending"** — see secondary issue |
| `/players` | 200 | 13 players visible (Adefola, Anife, Baji Jnr, Dadaboi, Faruk, Guru, KayKay, Killer Freak, KingNonex, Mitch, Mr Oga, Tactical, Wolevation). PASS. |
| `/announcements` | **500** | **Internal Server Error** — same root cause as `/` |
| `/welcome` | 200 | Anonymous landing renders fine. |

### CRITICAL ROOT CAUSE — `/` + `/announcements` 500

Vercel runtime log (verified by streaming `vercel logs cade-league-zr2j0vcnu...`):

```
Error: require() of ES Module /var/task/node_modules/@exodus/bytes/encoding-lite.js
from /var/task/node_modules/html-encoding-sniffer/lib/html-encoding-sniffer.js not supported.
{ code: 'ERR_REQUIRE_ESM', page: '/' }
{ code: 'ERR_REQUIRE_ESM', page: '/announcements' }
```

**Trace path:** Both `apps/web/src/app/page.tsx` and `apps/web/src/app/announcements/page.tsx` ultimately call `renderMarkdownToSafeHtml()` from `apps/web/src/server/announcements/render.ts`, which imports `isomorphic-dompurify` → `jsdom` → `html-encoding-sniffer` → `@exodus/bytes/encoding-lite.js`. The Vercel Node 22 runtime treats `encoding-lite.js` as ESM and the chained `require()` chain throws.

**Affected user-facing surfaces:**
- Home page (authenticated only — anonymous gets 307 → /welcome which works)
- Public News page (anyone)

**Impact:** Anyone landing on `/` after login sees a 500. This is a top-of-funnel UX failure for the live event.

### Secondary issue — `/fixtures` shows empty state despite 78 fixtures

The 9 retained match-days all have `published_at = NULL`. The fixtures page filters `not.published_at.is.null` (Plan 27 requirement — only LOC-published days surface publicly). After the Plan 52 wipe, no match-day has been re-published, so `/fixtures` shows the "Schedule drop pending" empty state.

**Verified via REST:**
```
all 9 active match_days have published_at = null
matches active rows: 78 (78 still exist in DB)
```

**Severity:** P1 user-facing (the schedule looks empty for 6 hours pre-stream). LOC needs to either run "Publish match-day" against the live day(s) before the stream, OR the wipe script needs to re-set `published_at = now()` for the 9 retained match-days.

---

## Test 6 — Tournament admin pages

**Result: PASS**

| Route | Status | Detail |
| --- | --- | --- |
| `/admin/tournament` | 200 → 307 → `/admin/tournament/standings` | Tabbed nav: Standings, Fixtures, Results Entry, Walkovers, Adjustments, Tiebreaker Config, H2H Lookup, Win-Prob Preview |
| `/admin/tournament/standings` | 200 | 13 zero-rows; "Download Leaderboard XLSX/DOCX/Metrics Workbook" buttons |
| `/admin/tournament/walkovers` | 200 | 80 select options across 2 selects (78 fixture options + defaults) |
| `/admin/tournament/h2h-lookup` | 200 | 13 player chips visible (ADEFOLA..WOLEVATION) |
| `/admin/tournament/win-prob-preview` | 200 | Player A select (13 opts, default ADEFOLA) + Player B select (13 opts, default ANIFE) |

---

## Test 7 — Disputes/appeals/announcements pages

**Result: PASS**

| Route | Status | Empty state shown? |
| --- | --- | --- |
| `/admin/disputes` | 200 | yes ✓ |
| `/admin/appeals` | 200 | yes ✓ |
| `/admin/announcements` | 200 | "The studio is quiet — Nothing drafted or published" ✓ |
| `/player/disputes` | 200 | yes ✓ |
| `/player/appeals` | 200 | yes ✓ |

All admin variants render with the league nav + DataTable headers + empty-state copy. Player variants render the player chrome with empty state.

---

## Test 8 — Player ↔ org linkage display

**Result: PASS**

`/admin/players` lists all 13 players with org column populated correctly:

| Player | Org |
| --- | --- |
| Adefola | CADE Esports ✓ |
| Anife | Afropanda Esports |
| Baji Jnr | GameEvo Esports ✓ |
| Dadaboi | Outlaws |
| Faruk | OAS Esports |
| Guru | Yakabu Global |
| KayKay | Lumo Labs |
| Killer Freak | GameEvo Esports |
| KingNonex | Solar Flare |
| Mitch | Phoenix Esports |
| **Mr Oga** | **— (NULL)** ✓ (unaffiliated by design) |
| Tactical | Funquest Esports |
| Wolevation | Breaking Gaming Barriers |

All assertions from the task description match the live state.

---

## Test 9 — Org pages

**Result: PASS**

`/admin/orgs` lists 11 orgs (Afropanda Esports, Breaking Gaming Barriers, CADE Esports, Funquest Esports, GameEvo Esports, Lumo Labs, OAS Esports, Outlaws, Phoenix Esports, Solar Flare, Yakabu Global). All show `ACTIVE` status. GameEvo Esports correctly shows 2 linked players (Baji Jnr + Killer Freak).

Drilled into `/admin/orgs/689a3602-0cf8-41e3-b21e-9f6171256f87` (CADE Esports):
- Header: "CADE Esports · ACTIVE" + "SUSPEND ORG" button
- INFO card with name + balance (0 coins) + created (2026-04-26 01:27 WAT)
- PLAYERS section (1) showing ADEFOLA with coach/team-manager dropdowns + "UNLINK"
- "LINK A PLAYER" form with unlinked-player select + LINK PLAYER button
- CONTRACTS (0) section with "+ NEW CONTRACT" button

No console errors.

---

## Test 10 — No white/black page-level backgrounds

**Result: PASS**

Iframe-probed `getComputedStyle(body).backgroundColor` for each route:

| Route | bodyBg | htmlBg |
| --- | --- | --- |
| `/welcome` | `rgb(7, 8, 11)` | `rgb(7, 8, 11)` |
| `/standings` | `rgb(7, 8, 11)` | `rgb(7, 8, 11)` |
| `/fixtures` | `rgb(7, 8, 11)` | `rgb(7, 8, 11)` |
| `/players` | `rgb(7, 8, 11)` | `rgb(7, 8, 11)` |
| `/admin` | `rgb(7, 8, 11)` | `rgb(7, 8, 11)` |
| `/admin/broadcast/v2` | `rgb(7, 8, 11)` | `rgb(7, 8, 11)` |
| `/admin/tournament/standings` | `rgb(7, 8, 11)` | `rgb(7, 8, 11)` |

`rgb(7, 8, 11)` matches `--ink-0` (#07080B) — brand-correct dark theme. No pure white or null backgrounds.

(`/` was not probed since it 500s — but the 500 page itself has black bg, so even the failure surface is on-brand. The 500 is the issue, not the bg.)

---

## CRITICAL ISSUES (must fix before live event)

### P0 — `/` + `/announcements` return 500 due to `isomorphic-dompurify` ESM incompatibility

**Symptom:** Authenticated home page and public News page both return 500 in production.

**Root cause:** `isomorphic-dompurify` (used by `renderMarkdownToSafeHtml`) pulls in `jsdom` → `html-encoding-sniffer` → `@exodus/bytes/encoding-lite.js`. Latest `@exodus/bytes` ships only ESM, but `html-encoding-sniffer` does `require()`. Vercel Node 22 runtime rejects with `ERR_REQUIRE_ESM`.

**Fix options (recommended in order):**
1. **Pin `@exodus/bytes` to a CJS-compatible version** by adding a yarn/npm `overrides`/`resolutions` entry. Quick + low-risk.
2. **Replace `isomorphic-dompurify` with `dompurify` + a server-side `jsdom`-or-`linkedom` adapter** that handles the ESM transition properly.
3. **Use `experimental.serverComponentsExternalPackages: ['isomorphic-dompurify']`** in `next.config.ts` to keep it as a dynamic require at runtime (Next 15 sometimes resolves this).
4. **Bypass DOMPurify for the simple homepage preview path** — `firstParagraphHtml` only needs to strip tags from a stripped string; could use a minimal regex sanitizer.

**Recommended fast fix for the live event in 6h:** option 1 (pin via package.json `overrides`) + redeploy.

### P1 — `/fixtures` shows empty state because no match-day has `published_at` set

**Symptom:** Even though 78 matches exist across 9 match-days, `/fixtures` renders "Schedule drop pending" empty state for everyone.

**Root cause:** `apps/web/src/app/fixtures/page.tsx` line 92 filters `.not("published_at", "is", null)` per Plan 27. The plan52-wipe script did not re-publish the retained match-days.

**Fix options:**
1. **Quick:** From `/admin/match-days` admin UI, click "Publish" on the match-day(s) intended for the live event.
2. **Permanent:** Add a `published_at = now()` set to `plan52-wipe-and-link.mjs` for retained match-days, OR re-seed the wipe script's match-days with `published_at` populated.

---

## Other observations

### Two active sessions exist on different match-days
DB query reveals there are TWO active stream_sessions (no `ended_at`):
- `c4b942d6-80be-4dde-8ac8-4db6d182b8b2` on Sat May 30 (`839b2f17-...`)
- `eb064746-02f7-497d-a2d3-369b52009a81` on Sun Apr 26 (`ca3f72e1-...`)

Plus the new session I started for Test 3:
- `6eb9e49e-508d-4ed3-b3b6-0a598ae131ae` on Sun May 17 (`92dff51c-...`)

This is fine architecturally (the partial unique index allows one active per match-day), but if the LOC plans to use one of those, they may want to end the others first to avoid confusion in the broadcast index.

### No console errors on any tested page (apart from /, /announcements 500 SSR errors)
Captured `console error|warn|fail` on every visited page. Only the SSR error from the 500 routes surfaced. All other surfaces were clean.

### Match-day-selector network behavior verified
The selector fires `setSessionMatchDayAction` via `useTransition` on `onChange` (no Save button). DB row updates within ~500ms. `revalidatePath` re-renders the header on next request. Confirmed by direct REST query that `match_day_id` reflects the new value after change + persists across reload.

---

## Verification artifacts
- Vercel logs streamed live during 5 separate test triggers
- DB state verified via REST API to `vqzhczyugpaooegmolgk.supabase.co` (service-role)
- Screenshots captured at every major UI surface
- Test session left at `/admin/broadcast/v2/6eb9e49e-508d-4ed3-b3b6-0a598ae131ae` for cleanup
