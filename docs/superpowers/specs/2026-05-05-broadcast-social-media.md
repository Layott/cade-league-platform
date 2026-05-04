# Plan 54 — Broadcast Social-Media Asset Generation

> **Status:** SPEC (not yet executed)
> **Author:** Claude (Opus 4.7) under user direction, 2026-05-05 WAT
> **Scope:** Phase 1 (static images via `next/og`) + Phase 2 (animated video via external worker)
> **Owner:** TBD (single dev across phases)

## 1. Goal

Add an admin-triggered system that generates **shareable, platform-sized social-media assets** (Instagram, TikTok, X, IG Story/Reels) auto-populated with live league data. Outputs include static images for feed/X/landscape and animated MP4 reels for IG Story/Reels/TikTok.

User constraint (verbatim, 2026-05-04):
> *"For video make sure it is still instagram reel size format."*

That locks all video output to **1080×1920** portrait, 9:16. Static images are sized per platform.

## 2. Out-of-scope (NOT building)

- Auto-posting to IG/TikTok/X. Approval gate is non-negotiable — wrong stat to 10k+ followers is worse than no post.
- GIF format. MP4 only. Add later if a partner explicitly demands it.
- Remotion + AWS Lambda. Re-authoring 27 overlays as React compositions = 3+ weeks for the same output our portable HTMLs already produce.
- Vercel Sandbox. Right product on paper, pricing immature, revisit in 6 months.
- 4K rendering. Every social platform downsamples to 1080p ceiling.
- Buffer/Hootsuite API integration. Add post-Phase 4 once content rhythm proven manually.
- Comeback-win + derby-preview templates (deferred — match data lacks half-time scores + tier metadata).

## 3. Architectural Decisions

| Decision | Rationale |
|---|---|
| **Static via `next/og`** (Edge runtime) | Built into Next 15, sub-second cold start, supports Agharti+Quedora as `ArrayBuffer`, cacheable via `s-maxage`. Handles ~70% of templates. |
| **Video via external worker** (Fly.io or Render.com) | Vercel Functions hit 250MB code limit + 300s timeout for `@sparticuz/chromium` + `ffmpeg-static`. Fly volume + persistent VM avoids cold start, ~$7/mo for 100 renders/day. |
| **Reuse existing v2 overlay HTMLs as scenes** | Worker loads `KNOWLEDGE/brand-assets/elements/v2/<key>/index.html`, postMessages a one-shot data payload, screencasts via Playwright `recordVideo`, pipes WebM → MP4 via `ffmpeg-static`. Zero scene duplication. |
| **MP4 only at 1080×1920** | Per user constraint. Single Playwright viewport, single ffmpeg preset. Simplifies worker config. |
| **Static images at 3 sizes** | 1080×1920 (Reels/Stories/TikTok preview), 1080×1080 (IG feed), 1200×675 (X). Skip 1080×1350 / 1200×630 / 1080×566 day 1 — same audience, marginal lift, 2x QA surface. |
| **Render artifacts in Supabase Storage** | Bucket `social-renders/`, public URL signed 7 days, retention 30 days then auto-delete via cron. |
| **Job queue in Postgres table** | `social_render_jobs` row per request. Worker polls (or LISTEN/NOTIFY later). Simple, no Redis dep. |
| **Approval gate before any "publish"** | Admin previews, downloads asset, copies share-link. No auto-post. Phase 4 may add approve-and-mark-as-posted UX. |

## 4. Database Schema

Migration block: `20260801000001..06`.

### `social_render_jobs`
```sql
create table social_render_jobs (
  id uuid primary key default gen_random_uuid(),
  template_key text not null,                 -- e.g. 'leaderboard', 'top-scorers', 'player-of-week'
  size text not null,                         -- '1080x1920' | '1080x1080' | '1200x675'
  format text not null check (format in ('image','video')),
  source_data jsonb not null,                 -- snapshot of payload at render time (so re-runs are deterministic)
  season_id uuid references seasons(id),
  match_day_id uuid references match_days(id),
  status text not null default 'pending'      -- 'pending' | 'rendering' | 'ready' | 'failed' | 'cancelled'
    check (status in ('pending','rendering','ready','failed','cancelled')),
  output_url text,                            -- Supabase Storage signed URL
  output_size_bytes bigint,
  error_message text,
  duration_ms int,                            -- render wall-clock
  requested_by uuid references users(id),
  approved_by uuid references users(id),
  approved_at timestamptz,
  posted_marker text,                         -- free-text e.g. 'IG_2026-05-04_22:15' for audit
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz                      -- soft delete
);
create index ix_social_render_jobs_status on social_render_jobs(status) where deleted_at is null;
create index ix_social_render_jobs_template on social_render_jobs(template_key, created_at desc) where deleted_at is null;
select public.attach_audit('social_render_jobs');
```

### `social_render_templates` (catalog)
```sql
create table social_render_templates (
  template_key text primary key,              -- 'leaderboard', 'top-scorers', etc.
  label text not null,                        -- 'Weekly Leaderboard'
  description text,
  format text not null check (format in ('image','video','both')),
  data_endpoint text not null,                -- e.g. '/api/broadcast/sessions/{sessionId}/leaderboard'
  default_supports_size text[] not null default array['1080x1920'],
  scene_path text,                            -- for video: path to overlay HTML in KNOWLEDGE/...
  active boolean not null default true,
  sort_order int not null default 100,
  created_at timestamptz not null default now()
);
```

### Storage bucket
```sql
-- via supabase ui or cli
insert into storage.buckets (id, name, public, file_size_limit) values ('social-renders', 'social-renders', false, 50000000);
-- RLS: authenticated reads own jobs; admin reads all
```

### Seeds (Phase 1 only)

5 template rows seeded via `npm run seed:plan54`:
1. `leaderboard` — Weekly Leaderboard, both, `/api/broadcast/sessions/{id}/leaderboard`, 1080×1920+1080×1080+1200×675
2. `top-scorers` — Golden Boot Race, both, `/api/broadcast/sessions/{id}/top-scorers`, 1080×1920+1080×1080
3. `upcoming-fixtures` — Upcoming Fixtures, image, `/api/broadcast/sessions/{id}/match-scores-day`, 1080×1080+1080×1920
4. `gd-leaders` — Goal Difference Leaders, image, derived from leaderboard, 1080×1080
5. `league-avg` — League Average Stats, image, computed aggregate, 1080×1080

## 5. Permissions

Add to `src/perms.ts` seed:
- `social.read` — view social-render jobs + templates (admin, design, production, moderator roles)
- `social.render` — trigger a new render job (admin, design, production)
- `social.approve` — mark job as approved (admin, design, production)
- `social.delete` — soft-delete a job (admin only)

Run `npm run db:push` to apply migration `2026...000007_seed_social_perms.sql`.

## 6. File Structure (Phase 1 — static only)

### New files
```
apps/web/
├── src/
│   ├── app/
│   │   ├── admin/broadcast/social/
│   │   │   ├── page.tsx                                  # admin landing — template grid + recent jobs
│   │   │   ├── [templateKey]/page.tsx                    # render config + preview + download
│   │   │   ├── [templateKey]/preview/page.tsx            # live preview iframe (uses /api/social/og/...)
│   │   │   └── actions.ts                                # server actions: createJob, approveJob, deleteJob
│   │   ├── api/social/og/leaderboard/[size]/route.tsx   # next/og endpoint, size param e.g. '1080x1920'
│   │   ├── api/social/og/top-scorers/[size]/route.tsx
│   │   ├── api/social/og/upcoming-fixtures/[size]/route.tsx
│   │   ├── api/social/og/gd-leaders/[size]/route.tsx
│   │   └── api/social/og/league-avg/[size]/route.tsx
│   ├── components/admin/broadcast/social/
│   │   ├── TemplateGrid.tsx
│   │   ├── RenderJobsTable.tsx
│   │   ├── SizePicker.tsx
│   │   ├── PreviewIframe.tsx
│   │   └── DownloadButton.tsx
│   ├── server/social/
│   │   ├── templates.ts                                  # template registry — typed catalog of all 5 templates
│   │   ├── data.ts                                       # data fetchers per template (calls existing /api/broadcast/* endpoints internally)
│   │   ├── jobs.ts                                       # createJob, approveJob, listJobs, softDeleteJob
│   │   ├── og-shared.tsx                                 # shared <Wrapper>, <BrandHeader>, <SponsorRow>, font loaders
│   │   └── og-shared.test.ts
│   └── lib/
│       └── social-sizes.ts                               # SIZE_PRESETS = { '1080x1920': {w,h,aspect}, ... }
└── supabase/migrations/
    ├── 20260801000001_create_social_render_jobs.sql
    ├── 20260801000002_create_social_render_templates.sql
    ├── 20260801000003_attach_audit_social_render_jobs.sql
    ├── 20260801000004_seed_social_render_templates.sql
    ├── 20260801000005_create_social_renders_bucket.sql
    ├── 20260801000006_seed_social_perms.sql
```

### Modified files
- `src/perms.ts` — add 4 new perm strings + role mapping
- `apps/web/src/components/AdminSubnav.tsx` — add "Social" link to Broadcast subnav
- `tasks/todo.md` — add Plan 54 review section

## 7. File Structure (Phase 2 — video worker)

### New files (worker repo — separate from main app)
```
worker-social-renders/                                    # NEW REPO, deployed to Fly.io
├── src/
│   ├── index.ts                                         # poll loop or HTTP listener
│   ├── render.ts                                         # one-shot Playwright + ffmpeg pipeline
│   ├── scenes.ts                                         # template_key → scene HTML path map
│   ├── upload.ts                                         # Supabase Storage upload via service role
│   └── lib/ffmpeg.ts                                     # ffmpeg-static wrapper
├── package.json                                          # playwright, ffmpeg-static, @supabase/supabase-js
├── Dockerfile                                            # node:24 + playwright deps + ffmpeg-static
├── fly.toml                                              # fly.io app config
└── .env.example                                          # SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, POLL_INTERVAL_MS
```

### Modified files (main app, Phase 2)
- `apps/web/src/app/admin/broadcast/social/[templateKey]/page.tsx` — add "Render Video" button when template `format=video|both`
- `apps/web/src/server/social/jobs.ts` — `createJob({ format: 'video' })` enqueues to `social_render_jobs` with `status='pending'`, worker picks up
- `apps/web/src/components/admin/broadcast/social/RenderJobsTable.tsx` — show video status (pending/rendering/ready/failed) + thumbnail preview

## 8. Phased Rollout

### Phase 1 (Week 1) — Static-only foundation

Tasks:
1. Migration `social_render_jobs` + `social_render_templates` + bucket + perms
2. Template registry + data fetchers
3. Shared OG components (BrandHeader, SponsorRow, font loaders)
4. `next/og` route for `leaderboard` template, all 3 sizes
5. Admin page `/admin/broadcast/social` — grid view of 5 templates
6. Admin page `/admin/broadcast/social/[key]` — preview iframe + size picker + Download button
7. Server action `createJob` — saves render to bucket, returns signed URL
8. Server action `approveJob` + `softDeleteJob`
9. RenderJobsTable + recent renders list
10. E2E: login admin → /admin/broadcast/social → pick leaderboard → render 1080×1920 → download → assert PNG dimensions
11. Repeat OG route for templates 2-5

**Acceptance:** admin can render any of 5 static templates at supported sizes, download PNG locally, see job in jobs table.

### Phase 2 (Week 2) — Static expansion

Tasks:
1. Add 4 more templates: `player-of-week`, `biggest-movers`, `perfect-week`, `squad-reveal`
2. Per-template OG route + data fetcher + admin tile
3. Resend integration: "Email to social manager" action — sends signed URL + caption template via Resend
4. Copy-IG-link action: writes to clipboard via server-action-with-cookie pattern

**Acceptance:** 9 total static templates, email + copy-link works.

### Phase 3 (Week 3) — Video worker

Tasks:
1. Create `worker-social-renders/` repo from scratch
2. Dockerfile with node:24-slim + Playwright deps (`apt-get install` for fonts/libs) + `ffmpeg-static`
3. Worker `index.ts` — polls `social_render_jobs` where `status='pending' AND format='video'` every 5s
4. `render.ts` — Playwright launches headless Chromium 1080×1920, navigates to `file://<scene>`, postMessages payload, waits 17s, closes context, ffmpeg WebM→MP4
5. `upload.ts` — Supabase Storage upload via service role, returns 7-day signed URL
6. Update job status to `ready` with `output_url`
7. Deploy to Fly.io with persistent volume for ffmpeg cache
8. Main-app: admin "Render Video" button creates job with `format='video'`, polls every 3s for status
9. Add 3 video templates: `leaderboard-reel` (animated, like the one we just built), `match-day-recap` (15s), `golden-boot-race` (12s bar race)
10. E2E: admin → pick leaderboard-reel → render → wait → download MP4

**Acceptance:** admin renders MP4 in <60s wall-clock, downloads, plays in QuickTime + IG.

### Phase 4 (Week 4) — Event-driven triggers + approval gate

Tasks:
1. Supabase webhook on `match_results` insert → POST `/api/social/triggers/match-result` → enqueues `match-day-recap` + `top-scorers` jobs
2. `social_render_jobs.status='ready'` triggers Resend email to admin: "New social asset ready — review at <link>"
3. Admin approves via UI button — sets `approved_by` + `approved_at`. Optional `posted_marker` field for audit
4. Add 3 event-driven templates: `milestone-goal`, `win-streak-alert`, `dispute-public-note`

**Acceptance:** match result inserted → asset auto-renders → admin notified → 1-click approve → asset URL ready to share.

## 9. Risks + Mitigations

| Risk | Mitigation |
|---|---|
| `next/og` doesn't render Agharti/Quedora correctly | Pre-test font loading in OG context with `npm run dev` before committing template. Fallback to system font if needed. |
| Worker render exceeds 60s for complex scenes | Hard cap at 90s with `Promise.race` + abort. Fail job with `error_message='timeout'`. |
| Supabase Storage upload exceeds 50MB limit | Cap MP4 at 25MB via ffmpeg `-b:v 4M -maxrate 5M`. 17s × 4Mbps = 8MB target. Reject jobs that exceed. |
| Worker single-instance bottleneck | Phase 3 ships single worker (sequential). If queue depth > 5, scale to 2 instances with row-level locking via `FOR UPDATE SKIP LOCKED`. Defer until measured. |
| User wants 1080×1080 video later | Reject in Phase 3. Document in spec §2. Phase 5 conditional. |
| Wrong stat in shared asset | Approval gate. No auto-post. Output_url is signed but admin downloads + reviews before sharing. |
| Worker compromised → Supabase service role exposed | Rotate service role key quarterly. Worker reads keys from Fly secrets, never logs. |

## 10. Backwards Compatibility

None required — feature is additive. Soft-archive guard: `social_render_jobs.deleted_at` enables full restore via existing `/admin/trash` UI (Plan 1A pattern).

## 11. Verification Gate

Per `CLAUDE.md` §11+§12, after each Phase:
1. `npm run test` clean
2. `npm run lint` clean
3. `npm run build` clean
4. `npm --workspace apps/web run e2e` clean — including new specs
5. Manual: admin walks through `/admin/broadcast/social` end-to-end on Vercel preview deploy
6. DB check: `supabase db query` confirms migrations applied + audit triggers attached
7. Phase 3+ video: manually inspect rendered MP4 in QuickTime, IG mobile preview, verify no glitches

## 12. Effort Estimate

| Phase | Dev-Days | Wall-Clock (1 dev) |
|---|---|---|
| 1 — Static foundation + 5 templates | 4 | 1 week |
| 2 — Static expansion + Resend + copy-link | 2 | 3 days |
| 3 — Video worker + 3 video templates | 6 | 1.5 weeks |
| 4 — Event-driven + approval gate | 2 | 3 days |
| **Total** | **14** | **~3.5 weeks** |

## 13. Decisions Log

- **2026-05-04** — User locked all video output to IG Reel format (1080×1920, 9:16). Static images stay multi-size.
- **2026-05-04** — Architecture C (external Fly.io worker) chosen over A (Vercel Function with @sparticuz/chromium), B (Vercel Sandbox), D (Remotion+Lambda). Reasons in §3 + agent report from `a5bd4741660a13575`.
- **2026-05-04** — Phase 1 ships with 5 templates, not 18. Phased rollout in §8.
- **2026-05-05** — Spec authored. Implementation pending user execution decision.

## 14. References

- Agent brainstorm report (2026-05-04): full content types matrix + sizing matrix + architecture comparison — see conversation transcript or memory file `project_plan_54_broadcast_social.md` (to be created on execution start).
- Existing patterns to follow: `apps/web/src/components/broadcast/v2/OverlayDataInjector.tsx` (data injection), `apps/web/src/server/overlays/player-photos/resolver.ts` (player photo resolution), `apps/web/src/app/api/broadcast/sessions/[id]/leaderboard/route.ts` (data source for leaderboard template).
- Reel proof-of-concept: `C:\Users\Sweez\Downloads\leaderboard-reel-week2-redesign.mp4` (1080×1920 H.264, hand-rolled with Playwright + ffmpeg-static, 2026-05-04). Confirms pipeline viability before worker build.
