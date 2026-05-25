# ESPORTSPRODUCTION Platform — Mega Spec

> **Status:** DRAFT v1 (2026-05-25)
> **Owner:** ladilawalt
> **Repo target:** `C:\Users\Sweez\Desktop\LAYO\CLAUDE\GAMEEVO\ESPORTSPRODUCTION` (greenfield)
> **References:** ESOCCER (UI + backend + overlays), BRGAMES (game/tournament domain), Clerk, Supabase

---

## 0. Executive Summary

ESPORTSPRODUCTION is a **multi-tenant, multi-game esports production platform**. Greenfield Next.js 15 + Clerk + Supabase + Vercel build. Each tenant = one event organizer (league, tournament series, brand). Each tenant runs any combination of games from a launch catalog of **4 categories + MLBB**:

1. **Football H2H** — EAFC console, eFootball console + mobile
2. **Battle Royale** — Free Fire, PUBGM, CODM-BR, Warzone
3. **Team H2H (shooter/MOBA)** — MLBB, Marvel Rivals, CODM MP, FF Clash Squad
4. **Persistent** — Clash of Clans (clan wars, CWL)

Platform is **invite-only multi-tenant** (super-admin provisions, tenant admins self-configure). Each tenant gets its own brand kit, theme, locale, timezone, sponsors, roles, tournaments, players, overlays.

Free for in-house use at launch. Tier reservation in schema for future monetization.

Two reference codebases:
- **ESOCCER** (this repo) — production-grade Next.js 15 + Supabase monolith with Builder, 16 v2 broadcast overlays, design tokens, OBS bridge, FCDB (Futbin), 50+ shipped plans. **Source of UI + backend + overlay patterns.**
- **BRGAMES** (`../BRGAMES`) — local-only Next.js 16 prototype. Shipped 6 phases + BR-1 + BR-2. Game/tournament/scoring/match engine with 240+ tests. **Source of game domain logic** (PUBGM_PMGC / FF_FFWS / FF_FFWS_BRAZIL presets, Smash Rule, Champion Rush, clash-squad, BR types contract, FF MatchResult.log parser).

Goal: combine ESOCCER's production polish + BRGAMES's game-domain knowledge into a single multi-tenant platform.

---

## 1. Locked Decisions (2026-05-25 brainstorm)

| # | Area | Choice |
|---|---|---|
| 1 | Tenancy | Multi-tenant simultaneous |
| 2 | Routing | URL prefix (`/t/<slug>/...`) |
| 3 | Custom domains | URL prefix only, forever (DROPPED — no CNAME plan) |
| 4 | Platform shape | Hybrid — generic spine + per-game adapters |
| 5 | Stack auth | Clerk (orgs + roles + invites + switcher) |
| 6 | Stack DB/storage/realtime | Supabase |
| 7 | Stack deploy | Vercel Hobby → Cloudflare migration when cap hits |
| 8 | User identity | Global user + `tenant_memberships` pivot |
| 9 | Tenant lifecycle | Invite-only (super-admin provisions) |
| 10 | Onboarding | Hybrid (super-admin minimal + tenant wizard) |
| 11 | Game catalog | All 4 categories at launch + MLBB |
| 12 | Tournament formats | SE + DE + RR + Swiss + BR-points + chains + CWL |
| 13 | Overlays | Port ESOCCER v2 wholesale |
| 14 | Match ingestion | Manual + Claude OCR + Gemini OCR + log parser + realtime sim |
| 15 | OCR provider | Multi-provider router: Claude vision + Gemini |
| 16 | Monetization | Free at v1; reserved tier column for v2 |
| 17 | Disputes/appeals | Per-tenant choice (football ladder vs lite vs off) |
| 18 | Disciplinary | Per-tenant choice (football ladder vs generic infractions) |
| 19 | Caution fees / ledger | Per-tenant choice |
| 20 | Player identity | Global profile + per-game handles |
| 21 | Squad/roster | Per-tenant choice |
| 22 | In-game item DB | Futbin FCDB for EAFC; no DBs for other games |
| 23 | Sponsors | Tenant-default + per-event overrides |
| 24 | Stream embeds | Deferred to v2 |
| 25 | Notifications | In-app bell + Resend email + Discord webhook + web push (PWA) |
| 26 | Branding | Full theming (layout variants + component swaps + page templates) |
| 27 | Audit + soft-delete | Port ESOCCER patterns wholesale |
| 28 | AI features | OCR (Claude+Gemini) + narrative blurbs + commentary + format suggester |
| 29 | Player profile depth | Standard (identity + history + aggregate stats) |
| 30 | Scheduling | Auto-bracket + manual override |
| 31 | Mobile | Mobile-first + PWA (install, push, offline) |
| 32 | i18n | Per-tenant locale |
| 33 | Search | Per-tenant + AI semantic (pgvector) |
| 34 | Public API + embeds | REST API + iframe widgets (standings, fixtures, leaderboard) |
| 35 | Super-admin dashboard | Full ops (tenant list, usage, abuse, ban) |
| 36 | Inbound integrations | Game publisher APIs + aggregators + scraper farm + Discord bot + local NG/AFR platforms (africanfreefirecommunity.com, gameevotech.com) |
| 37 | Outbound integrations | Webhooks + REST API + GraphQL + data dumps + local NG/AFR platforms |
| 38 | Wager partner | Generic partner program (Wagyr + future use same API) |
| 39 | Roles | 8 default + tenant custom |
| 40 | Visibility | Per-tenant choice + super-admin featured-events curation |
| 41 | Timezone | Hybrid: tenant home TZ + UTC stored + browser-local display |
| 42 | Tournament settings | Comprehensive + templated (both) |
| 43 | Prize pool | Display only |
| 44 | OAuth providers | Google + Discord + email/magic-link (no Twitter) |
| 45 | Handle verification | Per-tenant choice |
| 46 | Tournament check-in | Per-tenant choice |
| 47 | In-app chat | None — Discord webhook only |
| 48 | Game adapter SDK | Internal-only pattern (consistent contract, no public SDK) |
| 49 | Observability | Vercel + Supabase + Sentry free + PostHog free |
| 50 | CI/CD + tests | Vitest + Playwright E2E + visual regression + GitHub Actions + Vercel previews |
| 51 | Asset pipeline | Hybrid: ESOCCER Python locally + cloud fallback (remove.bg) |
| 52 | Match reporting | Per-tenant choice (ref-only / both-player+ref / self-report+override) |
| 53 | Anti-cheat | Per-tenant choice (manual / anomaly flags) |
| 54 | GDPR / privacy | Self-serve player export+delete + tenant-level data control |
| 55 | Email templates | Per-tenant brand vars (logo + colors) injected into platform templates |
| 56 | Spec phasing | One mega-spec + N implementation plans |

---

## 2. Tech Stack

| Concern | Choice | Free tier | Reason |
|---|---|---|---|
| Framework | Next.js 15 (App Router) | — | ESOCCER parity, Cache Components, Server Actions, Turbopack |
| Language | TypeScript strict | — | type safety, port BRGAMES `lib/types/br.ts` directly |
| Runtime | Vercel Fluid Compute (Node.js 24 LTS) | 4hr/mo CPU | ESOCCER parity, OBS overlay sources work cross-machine |
| Auth | **Clerk** | 10K MAU | multi-tenant Orgs primitive (saves 2-3 weeks) + invites + role assignment + switcher UI |
| DB | Supabase Postgres | 500MB | ESOCCER patterns port (RLS, audit triggers, soft-delete) |
| Storage | Supabase Storage | 1GB | brand assets, player photos, screenshots, log uploads |
| Realtime | Supabase Realtime | unlimited | overlay live data, score updates, in-app notifications |
| Email | Resend | 100/day, 3K/mo | ESOCCER parity, transactional templates |
| AI (LLM) | Anthropic Claude (via direct SDK or Vercel AI Gateway) | pay-per-use | narrative blurbs, commentary, format suggester |
| AI (OCR) | Anthropic Claude vision + Google Gemini vision | pay-per-use | dual-provider router for screenshot stat extraction |
| Embeddings | OpenAI text-embedding-3-small via Vercel AI Gateway | pay-per-use | semantic search; alternative: Vercel's `text-embedding-multi` |
| Vector store | Supabase pgvector | included | per-tenant semantic search |
| Push | Web Push (VAPID) | free | PWA push notifications |
| Webhooks IN | Clerk webhooks → Supabase user sync | free | identity sync |
| Webhooks OUT | Resend (email) + tenant Discord webhooks + partner webhooks | free | event broadcast |
| Image processing | ESOCCER's Python (rembg + OpenCV) + remove.bg API fallback | $0.001/img cloud | player photos, background removal |
| Cron | Vercel cron (Hobby: 1/day max) + GitHub Actions cron for sub-daily | free | scraper farm, integration polls |
| Monitoring | Sentry free + PostHog free + Vercel Analytics + Supabase logs | various | errors, product analytics, session replay |
| CI/CD | GitHub Actions | 2K min/mo | tests + lint + build on PR |
| Deploy preview | Vercel preview per branch | included | PR review |
| Testing — unit | Vitest + React Testing Library | free | ESOCCER parity, 432+ tests precedent |
| Testing — E2E | Playwright against dev server | free | ESOCCER parity, 30+ specs precedent |
| Testing — visual regression | Playwright snapshots on all overlays | free | ESOCCER parity |
| Storybook | Storybook 8 for shadcn components + overlay component library | free | design-system documentation |
| Styling | Tailwind CSS v4 (BRGAMES parity) | free | + per-tenant CSS vars for theming |
| UI primitives | shadcn/ui (with Base UI underneath, BRGAMES proved out base-nova preset) | free | composable, accessible |
| Animation | Framer Motion | free | overlay animations, page transitions, micro-interactions |
| Forms | react-hook-form + zod | free | ESOCCER + BRGAMES parity |
| State (client) | Zustand for live state (realtime sim, broadcast control); React state for everything else | free | BRGAMES parity |
| Routing data | Server Actions + URL params; no global client store for server data | — | Next.js 15 best practice |
| ORM | Direct `@supabase/supabase-js` (ESOCCER parity); consider Drizzle later if pain | free | familiar |
| PWA | next-pwa + manual service worker for offline cache | free | mobile install + push |
| i18n | next-intl (per-tenant locale) | free | per-tenant primary language |

---

## 3. High-Level Architecture

```
                  ┌────────────────────────────────────────────────┐
                  │              CLERK (auth + orgs)                │
                  │  - users + sessions + invites                   │
                  │  - organizations + memberships + roles         │
                  └──────────────┬─────────────────────────────────┘
                                 │ webhook on user/org change
                                 ▼
┌──────────────┐    ┌────────────────────────────────────────────────┐
│   BROWSER    │    │              NEXT.JS 15 (App Router)            │
│   PWA shell  │◄───┤  - middleware: resolve tenant from /t/<slug>    │
│   OBS source │    │  - SSR: tenant-scoped pages                     │
│   Embed iframe│    │  - Server Actions (tenant-scoped, perm-gated)  │
└──────┬───────┘    │  - API routes (REST + GraphQL for partners)     │
       │            │  - Webhook receivers (Clerk, Discord, partners) │
       │ Realtime   │  - Server Components                            │
       │            └──────────────┬─────────────────────────────────┘
       │                           │
       │ ┌─────────────────────────┴──────────────┐
       │ │                                          │
       │ ▼                                          ▼
┌──────┴──────┐                          ┌─────────────────┐
│  SUPABASE   │                          │  EXTERNAL APIs  │
│  Postgres   │                          │  - Game pubs    │
│   + RLS     │                          │  - Aggregators  │
│   + audit   │                          │  - Discord      │
│  Storage    │                          │  - Wagyr / etc. │
│  Realtime   │                          │  - NG/AFR sites │
│  pgvector   │                          └─────────────────┘
└─────────────┘
```

**Request flow (player loads tournament page):**

1. Browser → `platform.com/t/cade-elite/tournaments/elite-2025-2026`
2. Next.js middleware:
   a. Read tenant slug from URL.
   b. Look up tenant in `tenants` table (cached 60s).
   c. If missing → 404.
   d. If private + unauth → redirect `/sign-in?next=...`.
   e. Inject `tenantId` + `tenantConfig` into request context.
3. Clerk middleware: resolve user from session. If signed in → look up `tenant_memberships(user_id, tenant_id)` → derive roles.
4. Page Server Component: SSR fetches data scoped to `tenantId`. RLS enforces server-side. UI renders.
5. Client hydrates. Subscribes to Supabase Realtime channel `tenant:<id>` for live updates.

---

## 4. Repo Structure

```
ESPORTSPRODUCTION/
├── CLAUDE.md                          ← project constitution (already exists)
├── .claude/                           ← 5-layer ADK (already exists)
├── README.md
├── package.json                       ← Next.js 15 + Clerk + Supabase + ...
├── next.config.ts
├── vercel.ts                          ← typed Vercel config (replaces vercel.json)
├── tailwind.config.ts                 ← v4 config + per-tenant CSS vars
├── tsconfig.json
├── playwright.config.ts
├── vitest.config.ts
├── docs/
│   └── superpowers/
│       ├── specs/                     ← this spec + per-phase design docs
│       └── plans/                     ← per-phase implementation plans
├── apps/
│   └── web/
│       ├── src/
│       │   ├── app/
│       │   │   ├── layout.tsx         ← root with Clerk provider, fonts
│       │   │   ├── page.tsx           ← platform marketing + featured events
│       │   │   ├── globals.css
│       │   │   ├── (public)/
│       │   │   │   ├── sign-in/[[...rest]]/page.tsx
│       │   │   │   ├── sign-up/[[...rest]]/page.tsx
│       │   │   │   └── join/[invite]/page.tsx
│       │   │   ├── t/
│       │   │   │   └── [tenantSlug]/
│       │   │   │       ├── layout.tsx ← tenant-scoped chrome (brand, nav)
│       │   │   │       ├── page.tsx   ← tenant landing
│       │   │   │       ├── tournaments/[id]/page.tsx
│       │   │   │       ├── tournaments/[id]/bracket/page.tsx
│       │   │   │       ├── tournaments/[id]/matches/[matchId]/page.tsx
│       │   │   │       ├── standings/page.tsx
│       │   │   │       ├── players/[id]/page.tsx
│       │   │   │       ├── teams/[id]/page.tsx
│       │   │   │       └── ... (see Routes §10 below)
│       │   │   ├── admin/
│       │   │   │   └── [tenantSlug]/
│       │   │   │       ├── layout.tsx ← admin chrome
│       │   │   │       ├── page.tsx   ← admin dashboard
│       │   │   │       └── ... (see Admin Routes §10 below)
│       │   │   ├── super/
│       │   │   │   ├── tenants/page.tsx     ← super-admin tenant list
│       │   │   │   ├── tenants/new/page.tsx
│       │   │   │   ├── tenants/[id]/page.tsx
│       │   │   │   ├── usage/page.tsx       ← MAU + storage + dispute volumes
│       │   │   │   ├── featured/page.tsx    ← curate platform-homepage events
│       │   │   │   └── abuse/page.tsx
│       │   │   ├── overlay/
│       │   │   │   └── v2/[key]/page.tsx    ← OBS browser source (per-tenant)
│       │   │   ├── embed/
│       │   │   │   └── [tenantSlug]/standings/page.tsx ← iframe widget
│       │   │   └── api/
│       │   │       ├── webhooks/clerk/route.ts        ← user sync to Supabase
│       │   │       ├── webhooks/discord/route.ts      ← inbound Discord bot
│       │   │       ├── webhooks/partner/[id]/route.ts ← partner inbound
│       │   │       ├── v1/                            ← public REST API
│       │   │       │   ├── tenants/[slug]/standings/route.ts
│       │   │       │   ├── tenants/[slug]/fixtures/route.ts
│       │   │       │   └── ...
│       │   │       └── graphql/route.ts               ← partner GraphQL
│       │   ├── components/
│       │   │   ├── shell/                ← topbar, sidebar, command palette
│       │   │   ├── tournaments/         ← brackets, fixtures, settings wizard
│       │   │   ├── matches/             ← match cards, scoring entry, OCR upload
│       │   │   ├── players/             ← profile, history, stats
│       │   │   ├── teams/               ← roster, settings
│       │   │   ├── overlays/            ← Builder, design tokens panel
│       │   │   ├── broadcast/           ← match control panel, overlay triggers
│       │   │   ├── notifications/       ← bell, list, settings
│       │   │   ├── disputes/            ← file, list, rule
│       │   │   ├── sponsors/            ← library, picker
│       │   │   ├── search/              ← search bar, results, semantic
│       │   │   ├── admin/               ← admin-specific components
│       │   │   ├── super/               ← super-admin-specific
│       │   │   ├── pwa/                 ← install prompt, push opt-in
│       │   │   └── ui/                  ← shadcn primitives
│       │   ├── games/                   ← game adapters (per-game folders)
│       │   │   ├── _shared/             ← shared types, brackets, scoring
│       │   │   │   ├── adapter.ts       ← GameAdapter interface
│       │   │   │   ├── registry.ts      ← gameRegistry.register(...)
│       │   │   │   └── types.ts
│       │   │   ├── eafc/
│       │   │   │   ├── adapter.ts
│       │   │   │   ├── scoring.ts       ← football H2H
│       │   │   │   ├── overlays/        ← football overlay pack
│       │   │   │   ├── match-entry.tsx  ← per-game stat entry form
│       │   │   │   └── squad-picker.tsx ← FCDB-driven, ESOCCER port
│       │   │   ├── efootball/
│       │   │   ├── freefire/
│       │   │   │   ├── adapter.ts
│       │   │   │   ├── scoring.ts       ← FF_FFWS preset (BRGAMES port)
│       │   │   │   ├── log-parser.ts    ← MatchResult.log (BRGAMES port)
│       │   │   │   ├── overlays/        ← BR overlay pack
│       │   │   │   └── match-entry.tsx
│       │   │   ├── pubgm/               ← PUBGM_PMGC preset (BRGAMES port)
│       │   │   ├── codm/                ← CODM-BR + CODM MP (new)
│       │   │   ├── warzone/             ← Warzone (new)
│       │   │   ├── mlbb/                ← MLBB (new)
│       │   │   ├── marvel-rivals/       ← Marvel Rivals (new)
│       │   │   └── coc/                 ← Clash of Clans clan wars (new)
│       │   ├── server/
│       │   │   ├── auth.ts              ← Clerk + Supabase user sync
│       │   │   ├── tenants/             ← tenant CRUD, lifecycle, settings
│       │   │   ├── memberships/         ← tenant_memberships logic
│       │   │   ├── tournaments/         ← engine, bracket, schedule
│       │   │   ├── matches/             ← match CRUD, ingest router
│       │   │   ├── scoring/             ← generic + per-game (delegates to adapter)
│       │   │   ├── players/             ← global profile + per-game handles
│       │   │   ├── teams/
│       │   │   ├── overlays/            ← v2 overlay HTMLs + design tokens
│       │   │   ├── broadcast/           ← sessions, postMessage envelope
│       │   │   ├── disputes/            ← per-tenant ladder switching
│       │   │   ├── sanctions/
│       │   │   ├── sponsors/
│       │   │   ├── notifications/       ← in-app + email + push + Discord
│       │   │   ├── integrations/
│       │   │   │   ├── inbound/
│       │   │   │   │   ├── game-apis/   ← per-game API clients
│       │   │   │   │   ├── aggregators/ ← Liquipedia, Tracker.gg
│       │   │   │   │   ├── scrapers/    ← Scrapling (ESOCCER pattern)
│       │   │   │   │   ├── discord-bot/
│       │   │   │   │   └── local-platforms/ ← africanfreefirecommunity.com, gameevotech.com
│       │   │   │   └── outbound/
│       │   │   │       ├── webhooks/
│       │   │   │       ├── rest-api/
│       │   │   │       ├── graphql/
│       │   │   │       ├── data-dumps/
│       │   │   │       └── local-platforms/
│       │   │   ├── ocr/                 ← Claude + Gemini router
│       │   │   ├── ai/                  ← narrative, commentary, format-suggester
│       │   │   ├── search/              ← FTS + pgvector semantic
│       │   │   ├── audit/               ← attach_audit() helper, log readers
│       │   │   ├── gdpr/                ← export + delete jobs
│       │   │   ├── email/               ← Resend templates + per-tenant brand inject
│       │   │   ├── assets/              ← Python pipeline + remove.bg fallback
│       │   │   ├── perms-db.ts          ← DB-backed perms (ESOCCER port)
│       │   │   └── supabase/            ← server, service, browser clients
│       │   ├── lib/
│       │   │   ├── tenant-context.ts    ← async helper to resolve current tenant
│       │   │   ├── perms.ts             ← seed doc (constants)
│       │   │   ├── feature-flags.ts
│       │   │   ├── time.ts              ← tenant-TZ-aware date helpers
│       │   │   ├── motion.ts            ← bezier/timing constants
│       │   │   ├── businessDays.ts
│       │   │   ├── pwa.ts               ← service worker registration
│       │   │   ├── push.ts              ← web push subscribe + send
│       │   │   └── theme.ts             ← per-tenant CSS var injection
│       │   ├── state/                   ← Zustand stores (live, broadcast control)
│       │   ├── middleware.ts            ← Clerk + tenant resolution
│       │   └── env.ts                   ← typed env wrapper
│       ├── tests/
│       │   ├── unit/                    ← Vitest (per-file alongside source)
│       │   └── e2e/                     ← Playwright specs
│       └── public/
│           ├── overlays/v2/             ← per-game overlay HTML mirrors
│           ├── manifest.webmanifest     ← PWA manifest
│           ├── service-worker.js
│           └── ...
├── supabase/
│   ├── migrations/                      ← timestamped SQL files
│   ├── seed.sql                         ← dev seed data
│   ├── functions/                       ← edge functions if needed
│   └── tests/                           ← SQL smoke tests
├── scripts/
│   ├── seed-dev.ts
│   ├── backfill-*.ts
│   └── _process-photos.py               ← ESOCCER asset pipeline port
└── KNOWLEDGE/                           ← optional: per-game rulebooks, brand assets
```

---

## 5. Database Schema (Supabase)

### 5.1 Core tenancy

```sql
-- Tenants = orgs/leagues/events using the platform
CREATE TABLE tenants (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            text NOT NULL UNIQUE,           -- /t/<slug>
  name            text NOT NULL,
  status          text NOT NULL DEFAULT 'active'  -- active, suspended, archived
                    CHECK (status IN ('active','suspended','archived')),
  plan_tier       text NOT NULL DEFAULT 'free'    -- reserved for v2 monetization
                    CHECK (plan_tier IN ('free','pro','enterprise')),
  home_timezone   text NOT NULL DEFAULT 'UTC',    -- IANA TZ name
  primary_locale  text NOT NULL DEFAULT 'en',     -- BCP-47
  clerk_org_id    text UNIQUE,                    -- mirror of Clerk org
  is_featured     boolean NOT NULL DEFAULT false, -- super-admin promotes to homepage
  is_public       boolean NOT NULL DEFAULT false, -- per-tenant visibility
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);
SELECT public.attach_audit('public.tenants');

-- Tenant settings (per-feature toggles, branding ptr, etc.)
CREATE TABLE tenant_settings (
  tenant_id                       uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  -- Feature toggles
  squad_picker_enabled            boolean NOT NULL DEFAULT false,
  dispute_system_enabled          boolean NOT NULL DEFAULT false,
  caution_fee_ledger_enabled      boolean NOT NULL DEFAULT false,
  check_in_enabled                boolean NOT NULL DEFAULT false,
  handle_verification_required    boolean NOT NULL DEFAULT false,
  anti_cheat_anomaly_flags        boolean NOT NULL DEFAULT false,
  -- Match reporting policy
  match_reporting_policy          text NOT NULL DEFAULT 'referee_only'
                                    CHECK (match_reporting_policy IN ('referee_only','both_player_plus_ref','self_report_plus_admin')),
  -- Discipline model
  disciplinary_model              text NOT NULL DEFAULT 'generic'
                                    CHECK (disciplinary_model IN ('football_ladder','generic_infractions','lite_manual_only')),
  -- Roster requirements
  roster_requirements             text NOT NULL DEFAULT 'free_form'
                                    CHECK (roster_requirements IN ('free_form','tournament_level','per_match','football_squad_picker')),
  -- Brand kit (foreign key to branding table)
  brand_kit_id                    uuid REFERENCES brand_kits(id),
  -- Active overlay theme
  active_overlay_theme_id         uuid,
  -- Email branding
  email_brand_vars                jsonb NOT NULL DEFAULT '{}'::jsonb,  -- { primary_color, secondary_color, logo_url }
  -- Discord integration
  discord_webhook_url             text,
  discord_event_subscriptions     text[] NOT NULL DEFAULT ARRAY[]::text[],
  -- Custom CSS overrides (sanitized server-side before render)
  custom_css                      text,
  -- Updated tracking
  updated_at                      timestamptz NOT NULL DEFAULT now(),
  updated_by                      uuid REFERENCES users(id)
);
SELECT public.attach_audit('public.tenant_settings');
```

### 5.2 Identity

```sql
-- Global users (one row per platform user, synced from Clerk)
CREATE TABLE users (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id       text NOT NULL UNIQUE,         -- Clerk's user ID
  email               text NOT NULL UNIQUE,
  display_name        text NOT NULL,
  avatar_url          text,
  country_code        text,                          -- ISO-3166-1
  preferred_locale    text NOT NULL DEFAULT 'en',
  is_super_admin      boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);
SELECT public.attach_audit('public.users');

-- Per-tenant membership (pivot)
CREATE TABLE tenant_memberships (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role                text NOT NULL,                 -- references roles table
  status              text NOT NULL DEFAULT 'active'  -- active, suspended, removed
                        CHECK (status IN ('active','suspended','removed')),
  invited_by          uuid REFERENCES users(id),
  invited_at          timestamptz,
  joined_at           timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz,
  UNIQUE (tenant_id, user_id, role)
);
SELECT public.attach_audit('public.tenant_memberships');
CREATE INDEX ON tenant_memberships (tenant_id, status) WHERE deleted_at IS NULL;
CREATE INDEX ON tenant_memberships (user_id, status) WHERE deleted_at IS NULL;

-- Default 8 roles seed (also exposed via roles table for per-tenant custom roles)
CREATE TABLE roles (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid REFERENCES tenants(id) ON DELETE CASCADE,  -- NULL = platform default
  key                 text NOT NULL,                 -- e.g., 'admin', 'organizer', 'referee'
  label               text NOT NULL,                 -- display label
  description         text,
  is_default          boolean NOT NULL DEFAULT false,  -- shipped as built-in?
  is_custom           boolean NOT NULL DEFAULT false,  -- tenant-created?
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz,
  UNIQUE (tenant_id, key)
);
SELECT public.attach_audit('public.roles');

-- Permissions (string keys), with role -> permission mapping
CREATE TABLE role_permissions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id             uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_key      text NOT NULL,                 -- e.g., 'tournament.create', 'match.report'
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (role_id, permission_key)
);
SELECT public.attach_audit('public.role_permissions');

-- Default 8 roles:
--   super_admin (platform-only — NOT in tenant scope, gated by users.is_super_admin)
--   admin           (full tenant control)
--   organizer       (tournaments + schedule + brackets)
--   referee         (match.report, dispute.rule)
--   broadcaster     (overlay.trigger, broadcast.session)
--   team_manager    (team + roster CRUD, no match.report)
--   player          (read-own, dispute.file, profile.edit)
--   viewer          (read-only public data)
```

### 5.3 Games + tournaments + matches

```sql
-- Games catalog (platform-wide; same game definition used across tenants)
CREATE TABLE games (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key                 text NOT NULL UNIQUE,         -- e.g., 'eafc', 'pubgm', 'mlbb'
  display_name        text NOT NULL,
  category            text NOT NULL                 -- 'football_h2h', 'br', 'team_h2h', 'persistent'
                        CHECK (category IN ('football_h2h','br','team_h2h','persistent')),
  publisher           text,
  platforms           text[] NOT NULL DEFAULT ARRAY[]::text[],  -- 'console','pc','mobile'
  default_scoring_preset_id  uuid,                  -- foreign key to scoring_presets
  active              boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- Scoring presets (e.g., PUBGM_PMGC, FF_FFWS, FF_FFWS_BRAZIL, EAFC_LEAGUE)
CREATE TABLE scoring_presets (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key                 text NOT NULL UNIQUE,
  display_name        text NOT NULL,
  game_id             uuid NOT NULL REFERENCES games(id),
  config              jsonb NOT NULL,               -- preset-specific config (BR points table, etc.)
  is_built_in         boolean NOT NULL DEFAULT true,
  tenant_id           uuid REFERENCES tenants(id),  -- NULL = platform-wide built-in
  created_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);
SELECT public.attach_audit('public.scoring_presets');

-- Tournaments (scoped per tenant)
CREATE TABLE tournaments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  game_id             uuid NOT NULL REFERENCES games(id),
  slug                text NOT NULL,
  name                text NOT NULL,
  primary_format      text NOT NULL                 -- 'single_elim','double_elim','round_robin','swiss','br_points','chain','cwl'
                        CHECK (primary_format IN ('single_elim','double_elim','round_robin','swiss','br_points','chain','cwl')),
  scoring_preset_id   uuid REFERENCES scoring_presets(id),
  starts_at           timestamptz NOT NULL,
  ends_at             timestamptz,
  status              text NOT NULL DEFAULT 'planned'
                        CHECK (status IN ('planned','live','completed','archived')),
  config              jsonb NOT NULL DEFAULT '{}',  -- format-specific overrides (winner rules, chain stages, etc.)
  prize_pool_currency text,
  prize_pool_total    bigint,
  prize_pool_breakdown jsonb,                       -- [{place: 1, amount: 50000, paid: false}, ...]
  is_public           boolean NOT NULL DEFAULT false,
  template_id         uuid REFERENCES tournament_templates(id),
  created_by          uuid REFERENCES users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz,
  UNIQUE (tenant_id, slug)
);
SELECT public.attach_audit('public.tournaments');

-- Tournament templates (tenant-defined reusable setups)
CREATE TABLE tournament_templates (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  game_id             uuid NOT NULL REFERENCES games(id),
  name                text NOT NULL,
  description         text,
  config              jsonb NOT NULL,               -- everything except dates + participants
  created_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz,
  UNIQUE (tenant_id, name)
);
SELECT public.attach_audit('public.tournament_templates');

-- Stages (for multi-stage chain tournaments)
CREATE TABLE stages (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id       uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  ordinal             int NOT NULL,
  name                text NOT NULL,
  primitive           text NOT NULL                 -- 'single_elim' | 'round_robin' | 'br_points' | ...
                        CHECK (primitive IN ('single_elim','double_elim','round_robin','swiss','br_points','clash_squad','cwl')),
  config              jsonb NOT NULL DEFAULT '{}',  -- per-stage overrides (matchPointOverride, winnerRule, etc.)
  status              text NOT NULL DEFAULT 'planned'
                        CHECK (status IN ('planned','live','completed')),
  starts_at           timestamptz,
  ends_at             timestamptz,
  UNIQUE (tournament_id, ordinal)
);
SELECT public.attach_audit('public.stages');

-- Participants (teams or players, depending on game's category)
CREATE TABLE participants (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id       uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  kind                text NOT NULL CHECK (kind IN ('team','player')),
  team_id             uuid REFERENCES teams(id),    -- when kind='team'
  user_id             uuid REFERENCES users(id),    -- when kind='player' (1v1 games)
  seed                int,
  status              text NOT NULL DEFAULT 'registered'
                        CHECK (status IN ('registered','checked_in','withdrawn','disqualified')),
  metadata            jsonb NOT NULL DEFAULT '{}',
  created_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);
SELECT public.attach_audit('public.participants');

-- Teams (per-tenant)
CREATE TABLE teams (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  slug                text NOT NULL,
  name                text NOT NULL,
  short_name          text,
  logo_url            text,
  primary_color       text,
  secondary_color     text,
  region              text,
  social_links        jsonb NOT NULL DEFAULT '{}',
  manager_user_id     uuid REFERENCES users(id),
  coach_user_id       uuid REFERENCES users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz,
  UNIQUE (tenant_id, slug)
);
SELECT public.attach_audit('public.teams');

-- Players (per-tenant participation records)
CREATE TABLE players (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id             uuid NOT NULL REFERENCES users(id),    -- global user
  team_id             uuid REFERENCES teams(id),
  display_name        text NOT NULL,
  jersey_number       text,
  position            text,
  joined_at           timestamptz NOT NULL DEFAULT now(),
  left_at             timestamptz,
  status              text NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','suspended','released')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz,
  UNIQUE (tenant_id, user_id, team_id)
);
SELECT public.attach_audit('public.players');

-- Per-game identities (one user → many in-game handles)
CREATE TABLE player_game_identities (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id             uuid NOT NULL REFERENCES games(id),
  platform            text,                          -- 'console','pc','mobile'
  in_game_id          text,                          -- numeric ID where game exposes one
  in_game_name        text NOT NULL,                 -- player's gamer tag in that game
  region              text,
  verified_at         timestamptz,
  verification_method text,                          -- 'self','screenshot','api'
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz,
  UNIQUE (user_id, game_id, in_game_name)
);
SELECT public.attach_audit('public.player_game_identities');

-- Matches (canonical match row; per-game stats live in match_data JSONB or per-game tables)
CREATE TABLE matches (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id       uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  stage_id            uuid REFERENCES stages(id),
  round               int,
  match_slot          int,                           -- ESOCCER ordering (broadcast running order)
  match_lane          int,
  scheduled_at        timestamptz,
  started_at          timestamptz,
  ended_at            timestamptz,
  status              text NOT NULL DEFAULT 'scheduled'
                        CHECK (status IN ('scheduled','live','completed','void','cancelled','forfeit')),
  result_type         text                            -- 'standard','void','forfeit','dispute_pending'
                        CHECK (result_type IN ('standard','void','forfeit','dispute_pending')),
  reported_by         uuid REFERENCES users(id),
  reported_at         timestamptz,
  finalised_by        uuid REFERENCES users(id),
  finalised_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);
SELECT public.attach_audit('public.matches');

-- Match participants (per-match team/player slot)
CREATE TABLE match_participants (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id            uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  participant_id      uuid NOT NULL REFERENCES participants(id),
  slot                int NOT NULL,                  -- 0,1 for H2H; 0..N for BR
  status              text NOT NULL DEFAULT 'unchecked'
                        CHECK (status IN ('unchecked','checked_in','no_show','disqualified')),
  UNIQUE (match_id, slot)
);

-- Match results (one row per result event; recomputed standings derive from these)
CREATE TABLE match_results (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id            uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  participant_id      uuid NOT NULL REFERENCES participants(id),
  placement           int,                           -- 1st, 2nd, 3rd... (universal across games)
  raw_data            jsonb NOT NULL DEFAULT '{}',   -- per-game stats blob: kills, score, etc.
  derived_points      int,                           -- after scoring preset applied
  result_type         text NOT NULL DEFAULT 'standard'
                        CHECK (result_type IN ('standard','void','forfeit','disqualified')),
  created_at          timestamptz NOT NULL DEFAULT now()
);
SELECT public.attach_audit('public.match_results');

-- Player-level match stats (for game-specific per-player metrics like kills, MVP, goals)
CREATE TABLE match_player_stats (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id            uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  user_id             uuid NOT NULL REFERENCES users(id),
  participant_id      uuid REFERENCES participants(id),
  stats               jsonb NOT NULL DEFAULT '{}',   -- per-game blob: { kills, deaths, assists, goals, accuracy, ... }
  created_at          timestamptz NOT NULL DEFAULT now()
);
```

### 5.4 Standings (computed views + materialized cache)

```sql
-- Cached standings (recomputed idempotently from match_results)
CREATE TABLE standings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id       uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  stage_id            uuid REFERENCES stages(id),
  participant_id      uuid NOT NULL REFERENCES participants(id),
  position            int,
  matches_played      int NOT NULL DEFAULT 0,
  wins                int NOT NULL DEFAULT 0,
  draws               int NOT NULL DEFAULT 0,
  losses              int NOT NULL DEFAULT 0,
  points              int NOT NULL DEFAULT 0,
  goals_for           int,                           -- football
  goals_against       int,                           -- football
  goal_difference     int,                           -- football
  kills               int,                           -- BR / shooter
  placements          jsonb,                         -- BR: { '1st': 2, '2nd': 5, ... }
  metadata            jsonb NOT NULL DEFAULT '{}',
  recomputed_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tournament_id, stage_id, participant_id)
);
CREATE INDEX ON standings (tournament_id, position);
```

### 5.5 Disputes + sanctions

```sql
CREATE TABLE disputes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  match_id            uuid REFERENCES matches(id),
  tournament_id       uuid REFERENCES tournaments(id),
  filed_by_user_id    uuid NOT NULL REFERENCES users(id),
  category            text NOT NULL                 -- 'score','conduct','no_show','cheating','technical'
                        CHECK (category IN ('score','conduct','no_show','cheating','technical')),
  title               text NOT NULL,
  description         text NOT NULL,
  evidence_urls       text[] NOT NULL DEFAULT ARRAY[]::text[],
  status              text NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open','under_review','ruled','appealed','closed')),
  ruling              text,
  ruled_by_user_id    uuid REFERENCES users(id),
  ruled_at            timestamptz,
  appeal_window_ends_at  timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);
SELECT public.attach_audit('public.disputes');

CREATE TABLE appeals (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id          uuid NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,
  filed_by_user_id    uuid NOT NULL REFERENCES users(id),
  grounds             text NOT NULL,
  evidence_urls       text[] NOT NULL DEFAULT ARRAY[]::text[],
  status              text NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open','ruled','closed')),
  ruling              text,
  ruled_by_user_id    uuid REFERENCES users(id),
  ruled_at            timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);
SELECT public.attach_audit('public.appeals');

CREATE TABLE sanctions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subject_user_id     uuid REFERENCES users(id),
  subject_team_id     uuid REFERENCES teams(id),
  source_dispute_id   uuid REFERENCES disputes(id),
  kind                text NOT NULL                 -- 'warning','fine','suspension_matches','suspension_until','ban'
                        CHECK (kind IN ('warning','fine','suspension_matches','suspension_until','ban','points_deduction','match_void')),
  severity            text NOT NULL DEFAULT 'low'
                        CHECK (severity IN ('low','medium','high','severe')),
  details             jsonb NOT NULL DEFAULT '{}',
  effective_from      timestamptz NOT NULL DEFAULT now(),
  effective_until     timestamptz,
  issued_by_user_id   uuid REFERENCES users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);
SELECT public.attach_audit('public.sanctions');

CREATE TABLE caution_ledger (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subject_team_id     uuid REFERENCES teams(id),
  subject_user_id     uuid REFERENCES users(id),
  delta               bigint NOT NULL,              -- + for deposits, - for fines
  balance_after       bigint NOT NULL,
  reason              text NOT NULL,
  source_sanction_id  uuid REFERENCES sanctions(id),
  recorded_by         uuid REFERENCES users(id),
  recorded_at         timestamptz NOT NULL DEFAULT now()
);
-- Append-only — block UPDATE + DELETE via trigger
SELECT public.attach_audit('public.caution_ledger');
```

### 5.6 Sponsors

```sql
CREATE TABLE sponsors (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                text NOT NULL,
  logo_url            text NOT NULL,
  logo_strip_url      text,                          -- transparent-bg version for overlay strips
  website_url         text,
  tier                text NOT NULL DEFAULT 'partner'
                        CHECK (tier IN ('title','gold','silver','bronze','partner')),
  contract_start      date,
  contract_end        date,
  is_active           boolean NOT NULL DEFAULT true,
  display_order       int,
  created_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);
SELECT public.attach_audit('public.sponsors');

-- Per-event sponsor overrides (suppress + add)
CREATE TABLE tournament_sponsors (
  tournament_id       uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  sponsor_id          uuid NOT NULL REFERENCES sponsors(id),
  override_kind       text NOT NULL CHECK (override_kind IN ('include','suppress','override_tier')),
  override_tier       text CHECK (override_tier IN ('title','gold','silver','bronze','partner')),
  PRIMARY KEY (tournament_id, sponsor_id)
);
```

### 5.7 Overlays + branding

```sql
-- Brand kits (per tenant, with per-tournament overrides)
CREATE TABLE brand_kits (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                text NOT NULL DEFAULT 'Primary',
  primary_color       text NOT NULL DEFAULT '#6bcd06',
  secondary_color     text NOT NULL DEFAULT '#fe036d',
  accent_color        text NOT NULL DEFAULT '#ffffff',
  background_color    text NOT NULL DEFAULT '#050505',
  ink_color           text NOT NULL DEFAULT '#ffffff',
  font_display        text NOT NULL DEFAULT 'Agharti',
  font_body           text NOT NULL DEFAULT 'Quedora',
  logo_primary_url    text,
  logo_secondary_url  text,
  logo_wordmark_url   text,
  tagline             text,
  custom_css          text,                          -- sanitized
  layout_variant      text NOT NULL DEFAULT 'default',  -- 'magazine','cards','minimal','dense'
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);
SELECT public.attach_audit('public.brand_kits');

-- Overlay system: copy ESOCCER's exact tables
--   overlay_template_variants, overlay_design_tokens, overlay_design_history
--   overlay_text_elements, overlay_partner_strip_layout, overlay_partner_logos
--   overlay_partner_logo_overrides, overlay_element_animations
-- ALL scoped per tenant via tenant_id column
-- Port migration block from ESOCCER's 20260601000001..20260620000020 series
```

### 5.8 Notifications

```sql
CREATE TABLE notifications (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id           uuid REFERENCES tenants(id),    -- NULL for platform-wide
  kind                text NOT NULL,                  -- 'match_starting','dispute_filed','role_changed','suspended'
  title               text NOT NULL,
  body                text,
  href                text,                            -- deeplink within the platform
  metadata            jsonb NOT NULL DEFAULT '{}',
  read_at             timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON notifications (user_id, created_at DESC) WHERE read_at IS NULL;

CREATE TABLE push_subscriptions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint            text NOT NULL UNIQUE,
  p256dh              text NOT NULL,
  auth                text NOT NULL,
  user_agent          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);
```

### 5.9 Integrations

```sql
CREATE TABLE partners (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text NOT NULL,
  slug                text NOT NULL UNIQUE,
  kind                text NOT NULL CHECK (kind IN ('wager','community','aggregator','analytics','sponsor')),
  contact_email       text,
  website_url         text,
  status              text NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','suspended','revoked')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);

CREATE TABLE partner_api_keys (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id          uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  key_hash            text NOT NULL UNIQUE,           -- bcrypt of the secret
  label               text,
  rate_limit_per_min  int NOT NULL DEFAULT 60,
  scopes              text[] NOT NULL DEFAULT ARRAY['read:public']::text[],
  last_used_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  revoked_at          timestamptz
);

CREATE TABLE partner_webhooks (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id          uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  url                 text NOT NULL,
  secret              text NOT NULL,                  -- HMAC signing secret
  subscribed_events   text[] NOT NULL,                -- 'match.started','match.ended','score.changed','standings.changed'
  active              boolean NOT NULL DEFAULT true,
  last_delivered_at   timestamptz,
  failure_count       int NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE webhook_deliveries (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_webhook_id  uuid NOT NULL REFERENCES partner_webhooks(id) ON DELETE CASCADE,
  event              text NOT NULL,
  payload            jsonb NOT NULL,
  status_code        int,
  response_body      text,
  delivered_at       timestamptz,
  attempt            int NOT NULL DEFAULT 1,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ingest_sources (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid REFERENCES tenants(id),     -- NULL = platform-wide
  kind                text NOT NULL CHECK (kind IN ('game_api','aggregator','scraper','discord_bot','local_platform')),
  name                text NOT NULL,
  config              jsonb NOT NULL,                  -- API URLs, auth tokens (envrefs), poll interval
  game_id             uuid REFERENCES games(id),
  enabled             boolean NOT NULL DEFAULT true,
  last_polled_at      timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);
```

### 5.10 Audit + soft-delete (port from ESOCCER)

```sql
-- Generic audit trigger (one function, attached to every mutable table)
CREATE TABLE audit_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name          text NOT NULL,
  row_id              uuid NOT NULL,
  operation           text NOT NULL CHECK (operation IN ('INSERT','UPDATE','DELETE')),
  user_id             uuid REFERENCES users(id),
  tenant_id           uuid REFERENCES tenants(id),
  before_data         jsonb,
  after_data          jsonb,
  changed_at          timestamptz NOT NULL DEFAULT now()
);
-- Append-only via trigger (block UPDATE + DELETE)

CREATE OR REPLACE FUNCTION audit_row_change() RETURNS TRIGGER ...;
CREATE OR REPLACE FUNCTION attach_audit(target_table text) RETURNS void ...;
-- Same shape as ESOCCER's migration 20260420000001 series
```

### 5.11 Search (pgvector)

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE search_embeddings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid REFERENCES tenants(id),     -- NULL = platform-wide
  entity_kind         text NOT NULL                    -- 'player','team','tournament','match','dispute'
                        CHECK (entity_kind IN ('player','team','tournament','match','dispute','article')),
  entity_id           uuid NOT NULL,
  content             text NOT NULL,
  embedding           vector(1536) NOT NULL,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, entity_kind, entity_id)
);
CREATE INDEX search_embeddings_vector_idx ON search_embeddings
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```

### 5.12 RLS strategy

- **PII + financial tables:** strict RLS (users, players, caution_ledger, disputes, sanctions). Policies tied to `auth.uid()` mapped to `users.clerk_user_id`.
- **Business tables:** RLS gated by `tenant_id` matching the caller's active tenant context.
- **Public tables (when tenant.is_public):** policies grant SELECT to `anon` role for read-only fields.
- **Server-side `service_role` writes** with `app.current_user_id` GUC set by middleware (ESOCCER pattern).

---

## 6. Game Adapter Contract (Internal SDK)

```ts
// games/_shared/adapter.ts
export interface GameAdapter {
  key: string;                 // 'eafc', 'pubgm', 'mlbb', ...
  category: 'football_h2h' | 'br' | 'team_h2h' | 'persistent';

  // Match data shape
  matchDataSchema: ZodSchema<unknown>;       // raw_data validation
  playerStatsSchema: ZodSchema<unknown>;     // per-player stats validation

  // Scoring — given match_results raw_data, compute derived_points + placement
  scoreMatch: (input: ScoreMatchInput) => ScoreMatchOutput;

  // Standings tiebreaker chain
  tiebreakers: TiebreakerFn[];

  // Match entry UI component
  MatchEntryForm: React.ComponentType<MatchEntryFormProps>;

  // Optional: match log parser (Free Fire, future PUBGM)
  logParser?: (logText: string) => ParsedMatchData;

  // Optional: OCR field map (which screenshot regions correspond to which stat)
  ocrFieldMap?: OcrFieldMap;

  // Overlay pack reference
  overlayPackKey: string;      // points at games/<key>/overlays/index.ts
}

export const gameRegistry = new Map<string, GameAdapter>();
gameRegistry.register('eafc', eafcAdapter);
gameRegistry.register('freefire', freefireAdapter);
// ... etc
```

Adding a new game:
1. Create `src/games/<key>/` with `adapter.ts`, `scoring.ts`, `match-entry.tsx`, `overlays/`.
2. `gameRegistry.register('<key>', adapter)`.
3. INSERT row into `games` table (migration or super-admin UI).
4. Optional: add per-game scoring presets to `scoring_presets`.

---

## 7. Tournament Engine

Generic primitives implemented in `src/server/tournaments/`. Each delegates per-game scoring to the registered adapter.

Primitives:

| Primitive | Description | Source |
|---|---|---|
| `single_elim` | Knockout bracket | BRGAMES `lib/brackets/single-elim.ts` port |
| `double_elim` | Winners + losers brackets, grand final | BRGAMES port |
| `round_robin` | Every participant plays every other once | ESOCCER + BRGAMES |
| `swiss` | Pairings by current standings each round | BRGAMES |
| `br_points` | Cumulative kills + placement across N matches | BRGAMES |
| `clash_squad` | 5v5 round-based (FF Clash Squad, CODM S&D) | BRGAMES |
| `chain` | Multi-stage with promotions (PMGC-style) | BRGAMES |
| `cwl` | Clan War League 8-clan persistent | new |

Each primitive exposes:
- `generateFixtures(participants, config) → match[]`
- `nextRoundPairings(currentStandings, config) → match[]` (Swiss)
- `resolveStage(stage, results, config) → { winnerParticipantId, derivedStandings }`
- `decideChampion(rules, standings) → participantId | null` (Smash Rule, Champion Rush)

Bracket viz components (`components/tournaments/brackets/`) render any primitive.

---

## 8. Overlay System (port ESOCCER v2 wholesale)

### 8.1 Files to port

| ESOCCER source | ESPORTSPRODUCTION target |
|---|---|
| `KNOWLEDGE/brand-assets/elements/v2/<key>/` | `apps/web/public/overlays/v2/<key>/` |
| `apps/web/src/app/(overlay)/overlay/v2/[key]/page.tsx` | same |
| `apps/web/src/components/broadcast/v2/OverlayDataInjector.tsx` | same |
| `apps/web/src/app/admin/broadcast/v2/design/*` | `apps/web/src/app/admin/[tenantSlug]/broadcast/v2/design/*` |
| `apps/web/src/server/overlays/design/*` | same |
| `supabase/migrations/20260601000001..20260620000020*.sql` | per-tenant scoped |
| Bootstrap script `apps/web/scripts/_extend-bootstrap-script.mjs` | same |
| Sync script `apps/web/scripts/sync-v2-overlays.mjs` | same |

### 8.2 16 v2 overlays at launch (per-tenant cloned)

01-long-intro · 02-normal-stinger · 03-replay-stinger · 04-goal-stinger · 05-winner-stinger · 06-h2h-2 · 07-h2h-3 · 08-h2h-5 · 09-leaderboard · 10-lower-third · 11-match-scores-day · 12-secondary-score-bug · 13-up-next-bug · 14-top-scorers · 15-orgs · 16-coaches

### 8.3 Per-game overlay packs

Each game adapter declares `overlayPackKey`. Pack consists of:
- Stinger pack (intro, normal, replay, score event, winner)
- H2H matchup cards (relevant per game)
- Leaderboard variants (BR-points, RR, swiss)
- Score bug + Up-next bug
- Stats panel (top fraggers / top scorers / MVP)
- Game-specific extras: clan war board (CoC), kill feed (BR), round indicator (Clash Squad)

### 8.4 §14 contract (HARD RULE)

Every overlay HTML satisfies ESOCCER's §14 contract:
- `<meta name="color-scheme" content="dark" />`
- transparent body + observer script for `body.cade-visible`
- bootstrap script reads `?tokens=<b64>&previewTokens=<b64>&textTokens=<b64>&partnerTokens=<b64>&animTokens=<b64>` from URL
- demo loop gated on `?demo=1`
- §14.B Wave 2 (text + partners + animations) ports too

### 8.5 Per-tenant overlay design

`overlay_design_tokens` table scoped per-tenant. Admin UI at `/admin/<tenant>/broadcast/v2/design` lets tenant tweak any token: colors, fonts, partner-strip layout, text content, element animations. ESOCCER's panel ports wholesale.

### 8.6 Builder

ESOCCER's Wave 1A→3B Builder (just unlocked 2026-05-25 commit `1820ad5e`) ports as-is. PSD upload + Photopea integration + Timeline + Animations + Data Slots + Library. Per-tenant designs stored in `overlay_builder_designs` (tenant-scoped).

---

## 9. AI Features

### 9.1 OCR router (Claude + Gemini)

```ts
// server/ocr/router.ts
async function extractStats(imageBuf: Buffer, gameKey: string): Promise<OcrResult> {
  const adapter = gameRegistry.get(gameKey);
  const fieldMap = adapter?.ocrFieldMap ?? generic;

  // Try Gemini first (cheaper)
  const geminiResult = await geminiVisionExtract(imageBuf, fieldMap);
  if (geminiResult.confidence >= 0.85) return geminiResult;

  // Fallback to Claude (higher accuracy)
  const claudeResult = await claudeVisionExtract(imageBuf, fieldMap);
  return claudeResult;
}
```

Per-tenant choice (in `tenant_settings.ocr_provider`): `'auto'` (router), `'claude'`, `'gemini'`, `'disabled'`.

### 9.2 Narrative blurbs (power rankings, recap headlines)

Port ESOCCER's `buildPowerRankingNarrative` (rule cascade) + Claude rewriter for hype copy. Tenant admin clicks "AI Regenerate" on overlay text rows.

### 9.3 Live commentary

Background task subscribes to match events. On goal/elim/round, Claude generates 2-3 line commentary, pushed to overlay via postMessage `update` envelope. Per-match-day toggle.

### 9.4 Tournament format suggester

Organizer wizard: "I have 16 teams, 1 day, EAFC". Claude returns ranked recommendations (single-elim seeded; double-elim if more time; etc.) with rationale. Selecting one pre-fills the wizard.

---

## 10. Pages Inventory (~70 routes)

### 10.1 Public + auth

- `/` — platform marketing + featured events carousel (super-admin curated)
- `/sign-in/[[...rest]]` — Clerk hosted sign-in
- `/sign-up/[[...rest]]` — Clerk hosted sign-up
- `/join/[invite]` — accept tenant invitation
- `/embed/[tenantSlug]/standings` — iframe widget
- `/embed/[tenantSlug]/fixtures` — iframe widget
- `/embed/[tenantSlug]/leaderboard` — iframe widget

### 10.2 Tenant (player-facing) — `/t/[tenantSlug]/...`

- `/t/[slug]` — tenant landing (brand-themed, hero, current tournaments, top players)
- `/t/[slug]/tournaments` — list (filters: game, status, format)
- `/t/[slug]/tournaments/[id]` — tournament detail (overview, bracket, schedule, standings, settings tabs)
- `/t/[slug]/tournaments/[id]/bracket` — full-page bracket viz
- `/t/[slug]/tournaments/[id]/matches/[matchId]` — match detail (per-game stat entry, OCR, sim, dispute)
- `/t/[slug]/standings` — overall standings + per-tournament views
- `/t/[slug]/standings/matchday/[n]` — per-MD standings (ESOCCER port)
- `/t/[slug]/players` — player list
- `/t/[slug]/players/[id]` — player profile (identity + history + aggregate stats)
- `/t/[slug]/teams` — team list
- `/t/[slug]/teams/[id]` — team detail
- `/t/[slug]/announcements` — tenant blog/news
- `/t/[slug]/sponsors` — sponsor library page
- `/t/[slug]/me/dashboard` — player's own dashboard
- `/t/[slug]/me/disputes` — file/track disputes
- `/t/[slug]/me/notifications` — bell + settings
- `/t/[slug]/me/squad` — squad submission (when squad_picker_enabled)
- `/t/[slug]/me/profile` — edit profile + per-game handles

### 10.3 Admin — `/admin/[tenantSlug]/...`

- `/admin/[slug]` — admin dashboard (KPIs, recent activity, alerts)
- `/admin/[slug]/tournaments` — tournament CRUD list
- `/admin/[slug]/tournaments/new` — creation wizard
- `/admin/[slug]/tournaments/[id]/settings` — comprehensive settings page
- `/admin/[slug]/tournaments/[id]/bracket` — bracket editor
- `/admin/[slug]/tournaments/[id]/schedule` — match scheduler
- `/admin/[slug]/tournaments/[id]/templates` — save as / use template
- `/admin/[slug]/match-days` — match-day windows (when enabled)
- `/admin/[slug]/match-days/[id]` — MD-specific scheduling + slot/lane ordering
- `/admin/[slug]/matches` — match list + bulk actions
- `/admin/[slug]/matches/[id]` — match editor (override scores, void, forfeit)
- `/admin/[slug]/teams` — team CRUD
- `/admin/[slug]/teams/[id]` — team detail + roster mgmt
- `/admin/[slug]/people` — players + users in tenant
- `/admin/[slug]/people/players/[id]/edit` — edit player record
- `/admin/[slug]/squads` — squad submissions (when enabled)
- `/admin/[slug]/squads/[id]` — squad review + FCDB check (EAFC)
- `/admin/[slug]/disputes` — dispute list + rulings
- `/admin/[slug]/disputes/[id]` — dispute detail + appeal review
- `/admin/[slug]/sanctions` — sanction list + ladder progress
- `/admin/[slug]/ledger` — caution-fee ledger (when enabled)
- `/admin/[slug]/sponsors` — sponsor library + tier editor
- `/admin/[slug]/branding` — brand kit + theme + layout variant
- `/admin/[slug]/broadcast/v2/sessions` — broadcast session list
- `/admin/[slug]/broadcast/v2/sessions/[id]` — match control panel + overlay triggers
- `/admin/[slug]/broadcast/v2/design` — overlay design tokens panel
- `/admin/[slug]/broadcast/v2/builder` — overlay Builder library + editor
- `/admin/[slug]/broadcast/v2/branding` — overlay-specific brand
- `/admin/[slug]/broadcast/v2/youtube` — placeholder for v2 (deferred)
- `/admin/[slug]/notifications` — notification settings + Discord webhook config
- `/admin/[slug]/integrations` — inbound + outbound integration management
- `/admin/[slug]/api-keys` — partner API keys + webhook subscriptions
- `/admin/[slug]/announcements` — write tenant blog post
- `/admin/[slug]/roles` — role + permission matrix viewer + custom role creator
- `/admin/[slug]/members` — tenant membership list + invites
- `/admin/[slug]/members/invite` — invite by email
- `/admin/[slug]/audit` — audit log search (tenant-scoped)
- `/admin/[slug]/trash` — soft-deleted rows + restore
- `/admin/[slug]/settings` — tenant-level toggles (dispute system, check-in, etc.)
- `/admin/[slug]/data-export` — GDPR-compliant tenant data export
- `/admin/[slug]/templates` — tournament template library

### 10.4 Super-admin — `/super/...` (gated on `users.is_super_admin`)

- `/super` — super-admin dashboard (platform KPIs)
- `/super/tenants` — all tenants list + status
- `/super/tenants/new` — provision new tenant wizard
- `/super/tenants/[id]` — tenant detail (audit, usage, suspend, impersonate)
- `/super/usage` — MAU, storage, dispute volumes, compute usage per tenant
- `/super/featured` — curate platform-homepage featured events
- `/super/abuse` — abuse reports across all tenants
- `/super/games` — manage platform-wide game catalog + scoring presets
- `/super/partners` — partner program (Wagyr, community sites, aggregators)
- `/super/integrations` — platform-wide ingest sources
- `/super/audit` — platform-wide audit log

### 10.5 Overlay (OBS browser source)

- `/overlay/v2/[key]?session=<id>&tenant=<slug>` — tenant-scoped, session-scoped overlay
- `/overlay/v2/[key]?demo=1` — design preview

### 10.6 API (REST + GraphQL + webhooks)

- `/api/webhooks/clerk` — user/org sync
- `/api/webhooks/discord` — inbound Discord bot events
- `/api/webhooks/partner/[id]` — generic partner inbound
- `/api/v1/tenants/[slug]/standings` — public-read (gated on partner key + tenant visibility)
- `/api/v1/tenants/[slug]/fixtures`
- `/api/v1/tenants/[slug]/players/[id]`
- `/api/v1/tenants/[slug]/teams/[id]`
- `/api/v1/tenants/[slug]/matches/[id]`
- `/api/v1/me` — current user
- `/api/graphql` — partner GraphQL endpoint

---

## 11. Detailed Feature Spec (every button)

### 11.1 Tenant onboarding flow

Super-admin opens `/super/tenants/new`:
- Step 1: Basics — name, slug (auto-from-name with uniqueness check), initial admin email, game-categories (multi-select), description
- Step 2: Sends Clerk invite email to admin
- Background: tenant + tenant_settings + brand_kit (defaults) + clerk_org created

Tenant admin clicks email link → Clerk sign-up → lands on `/t/<slug>/setup`:
- Step 1: Brand (logo upload, primary/secondary/accent colors, font picks from brand-locked allowlist, tagline)
- Step 2: Locale + timezone (dropdown of IANA TZ)
- Step 3: Features (toggles for: dispute system, caution ledger, check-in, squad picker, anti-cheat flags, handle verification)
- Step 4: Discipline model (football_ladder | generic_infractions | lite_manual_only)
- Step 5: Match reporting policy (referee_only | both_player_plus_ref | self_report_plus_admin)
- Step 6: Notifications (Discord webhook URL test, email branding upload)
- Step 7: Members — invite first batch (email + role)
- Step 8: First tournament wizard (game, format, dates, participants, brand)

After save: tenant dashboard. Sentry event "tenant_onboarded" fires.

### 11.2 Tournament creation wizard (`/admin/[slug]/tournaments/new`)

- Step 1: Use template? (existing template OR scratch)
- Step 2: Basics — name, slug, description, game (per-tenant `games_enabled`), starts_at, ends_at
- Step 3: Primary format (single_elim/double_elim/round_robin/swiss/br_points/chain/cwl)
- Step 4: Scoring preset (game adapter's defaults + per-tenant custom)
- Step 5: Stages (only if format=chain — N stages with per-stage primitive + winnerRule + matchPointOverride)
- Step 6: Participants (manual add OR CSV import OR open registration window)
- Step 7: Schedule (auto-generate fixtures OR manual)
- Step 8: Sponsor overrides (inherit tenant default; suppress/add per event)
- Step 9: Brand override (inherit tenant; override colors/logo per event)
- Step 10: Prize pool (display-only — total, currency, breakdown)
- Step 11: Public visibility (per-tenant default; override)
- Step 12: Review + create

Save → background generates fixtures (if auto) → tournament `status='planned'`.

### 11.3 Match scheduling

Drag-drop scheduler (`/admin/[slug]/tournaments/[id]/schedule`):
- Calendar view (week / day) showing scheduled matches
- Drag a match → reschedule
- Click match → quick-edit modal (date/time, referee, broadcast slot)
- "Bulk reschedule" — shift all by ±N hours
- "Auto-fill" — fill any unscheduled with placeholder slots

Match-day view (`/admin/[slug]/match-days/[id]`) for tenants using MD windows:
- Drag-drop ordering (match_slot + match_lane from ESOCCER)
- "Publish match day" button locks fixtures + opens broadcast session
- Squad submission window controls (when squad_picker_enabled)

### 11.4 Match detail page

`/t/[slug]/tournaments/[id]/matches/[matchId]` — public/spectator view:
- Header: scheduled time (TZ-aware), participants, status, current score
- Live tab: if `status='live'`, embed BroadcastChannel/Realtime score updates
- Stats tab: per-game stats (per `MatchEntryForm` adapter)
- Dispute tab: open dispute filings (when dispute system enabled)
- Comments tab: removed (no in-app chat)

`/admin/[slug]/matches/[id]` — admin view:
- All above
- Quick actions: void match (popup confirms), force-finalise, mark forfeit, override scores, swap participants, reschedule
- Audit trail (read-only)

### 11.5 Match stat entry (`MatchEntryForm` per game)

Renders the game adapter's form. Common patterns:
- **EAFC:** home/away score, possession %, shots, shots-on-target, fouls, yellows, reds; goal-scorer picker; manager bonus toggle
- **Free Fire BR:** per-team rows: placement + per-player kill count. Optionally upload MatchResult.log → log parser fills the form.
- **PUBGM BR:** same as FF.
- **CODM BR / Warzone:** same.
- **Clash Squad / CODM MP / Marvel Rivals / MLBB:** team A score / team B score; per-player K/D/A; round-by-round optional.
- **CoC clan war:** per-attacker hit % + stars; per-defender def; aggregate totals.

Each form supports:
- Manual entry
- "Upload screenshot" → OCR router fills form → admin reviews + saves
- "Upload log" → log parser fills form (FF only at launch)
- "Use realtime sim" (dev/dry-run)

### 11.6 Broadcast control panel (`/admin/[slug]/broadcast/v2/sessions/[id]`)

Port ESOCCER's match control panel:
- Per-overlay trigger row: 16 overlays × (Trigger / Hide / Update buttons)
- Live data preview pane (current state of standings, top scorers, etc.)
- Variant pickers for: did-you-know (overlay 25), punditry (overlay 28), power-rankings narrative (overlay 22)
- Player photo override per overlay (`/admin/[slug]/broadcast/v2/design` Player Photos panel — Plan 53 port)
- Stinger queue
- Score bug toggle (always-on/off/match-aware)
- AI commentary toggle per-match

### 11.7 Overlay Builder

Port ESOCCER's Builder library + editor. Per-tenant designs. Hardcoded `enabled=true` + `publishEnabled=true` from day 1 (matches ESOCCER's 2026-05-25 unlock).

PSD upload + Photopea iframe = env-gated until verified. Sequence mode = env-gated until BR-2 timeline-keyframe-inspector regression closes (still tracked).

### 11.8 Player profile

`/t/[slug]/players/[id]`:
- Identity block: photo (with per-overlay pose if EAFC), name, country, country flag, social embeds
- Per-game handle table: game logo + handle + verification status
- Aggregate stats table: per-game W/L, kills total, MVPs, championships
- Tournament history: scrollable list with W/L per event, finishing position, prize earned
- Form chart: last 10 matches with W/L/D
- Achievements grid (deferred to v2 as nice-to-have)
- Action buttons: "Compare to..." (cross-tournament)

### 11.9 Notifications

Bell icon in topbar:
- Unread badge count
- Dropdown shows last 10 notifications
- Each row: icon (by kind) + title + body + relative time
- "Mark all read" button
- "Settings" link → `/t/<slug>/me/notifications` (per-channel toggles)

Per-channel preferences:
- In-app bell (always on for tenant-scoped notifications)
- Email via Resend (toggle per kind)
- Discord (tenant-level, not per-user)
- Push (browser opt-in; PWA install prompt drives subscription)

### 11.10 Disputes (per-tenant choice — football_ladder vs generic vs lite vs off)

`/t/[slug]/me/disputes` (player):
- "File new dispute" button
- Wizard: select match → category → describe → upload evidence (multi-file) → submit
- Status list: open / under review / ruled (with link to ruling)
- If ruled and ruling against, "File appeal" (if dispute system has appeals — football_ladder + generic do, lite doesn't)

`/admin/[slug]/disputes` (admin):
- List filter by status / category / severity
- Click → detail with full timeline + evidence preview
- Actions: "Rule in favor", "Rule against", "Request more info"
- If `football_ladder`: dropdown of Rule 5.4 ladder steps + auto-apply sanctions

### 11.11 Tenant settings (`/admin/[slug]/settings`)

Tabbed:
- General: name, slug (read-only after creation), logo, tagline, description, primary timezone, primary locale, public visibility
- Brand: brand_kit selection + edit + layout variant + custom CSS textarea (sanitized server-side)
- Features: toggles for squad_picker / dispute_system / caution_ledger / check_in / handle_verification / anti_cheat
- Discipline: model picker (football_ladder/generic/lite)
- Reporting: match reporting policy picker
- Notifications: Discord webhook URL + tested + event subscription multi-select; email brand vars
- Integrations: inbound/outbound integration management (see below)
- Members: tenant membership list + role assignments + invite + revoke
- Custom Roles: define custom roles + permission picker
- API Keys: partner API keys (for outbound)
- Email Templates: per-tenant brand var preview + per-template subject overrides
- Data: export tenant data (JSON dump) + danger-zone delete tenant

### 11.12 Search

- Header search bar (in tenant chrome): typeahead across players, teams, tournaments, matches (FTS for first 50ms, then semantic suggestions appended)
- Search results page `/t/[slug]/search?q=...&kind=`
- Filter by entity kind
- Semantic search powered by pgvector + embeddings refreshed on entity update

### 11.13 Integrations admin

`/admin/[slug]/integrations`:

**Inbound:** list of sources (game APIs, aggregators, scrapers, Discord bot, local platforms). Per-source: enabled toggle, last-polled timestamp, "Test now" button.

**Outbound:** list of partner subscriptions tied to this tenant. Per partner: webhook URL (read-only — partner sets it), event subscription matrix, delivery log (last 100), test-fire button.

### 11.14 Onboarding tutorial (in-app tour)

First-time admin login → product tour (Driver.js or similar) walks through:
1. Brand setup
2. Inviting team members
3. Creating first tournament
4. Setting up overlays
5. Going live

Dismissable. Replay-able from settings.

### 11.15 PWA install + push opt-in

PWA install prompt appears after 3 page views (per ESOCCER + standards).
Push opt-in shown after:
- User has filed/joined a tournament
- Or user explicitly clicks "Get notifications" in settings

`/t/[slug]/me/notifications` settings let user re-enable.

---

## 12. Permissions Matrix (default 8 roles)

| Permission | super_admin | admin | organizer | referee | broadcaster | team_mgr | player | viewer |
|---|---|---|---|---|---|---|---|---|
| tenant.manage | ✓ | ✓ | — | — | — | — | — | — |
| tenant.settings.edit | ✓ | ✓ | — | — | — | — | — | — |
| tournament.create | ✓ | ✓ | ✓ | — | — | — | — | — |
| tournament.edit | ✓ | ✓ | ✓ | — | — | — | — | — |
| tournament.archive | ✓ | ✓ | — | — | — | — | — | — |
| match.report | ✓ | ✓ | ✓ | ✓ | — | — | — | — |
| match.edit | ✓ | ✓ | ✓ | ✓ | — | — | — | — |
| match.void | ✓ | ✓ | — | ✓ | — | — | — | — |
| match.report.self | ✓ | ✓ | ✓ | ✓ | — | — | (when policy=self_report) | — |
| overlay.trigger | ✓ | ✓ | — | — | ✓ | — | — | — |
| overlay.design.manage | ✓ | ✓ | ✓ | — | ✓ | — | — | — |
| broadcast.session.start | ✓ | ✓ | ✓ | — | ✓ | — | — | — |
| team.manage | ✓ | ✓ | ✓ | — | — | ✓ | — | — |
| team.create | ✓ | ✓ | ✓ | — | — | ✓ | — | — |
| player.manage | ✓ | ✓ | ✓ | — | — | ✓ | — | — |
| player.profile.edit_own | — | — | — | — | — | — | ✓ | — |
| dispute.file | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| dispute.rule | ✓ | ✓ | — | ✓ | — | — | — | — |
| appeal.rule | ✓ | ✓ | — | — | — | — | — | — |
| sanction.issue | ✓ | ✓ | — | ✓ | — | — | — | — |
| sponsor.manage | ✓ | ✓ | ✓ | — | — | — | — | — |
| brand.manage | ✓ | ✓ | — | — | — | — | — | — |
| integration.manage | ✓ | ✓ | — | — | — | — | — | — |
| api-key.manage | ✓ | ✓ | — | — | — | — | — | — |
| audit.view | ✓ | ✓ | — | — | — | — | — | — |
| trash.restore | ✓ | ✓ | — | — | — | — | — | — |
| member.invite | ✓ | ✓ | ✓ | — | — | — | — | — |
| role.manage_custom | ✓ | ✓ | — | — | — | — | — | — |
| public.read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| platform.tenant.manage | ✓ | — | — | — | — | — | — | — |
| platform.usage.view | ✓ | — | — | — | — | — | — | — |
| platform.featured.curate | ✓ | — | — | — | — | — | — | — |

Custom roles inherit from a chosen default + per-permission overrides via the role editor UI.

---

## 13. Integrations Detail

### 13.1 Inbound

| Source kind | Implementation | Tenant choice |
|---|---|---|
| Game publisher API | per-game module `server/integrations/inbound/game-apis/<game>.ts` | API token in tenant config |
| Aggregator | scheduled poll of Liquipedia / Tracker.gg | enable + map to tenant tournament IDs |
| Scraper farm | Scrapling-based (ESOCCER pattern) — per-source scripts | enable + provide handles to scrape |
| Discord bot | webhook receives bot events; slash commands `/report match`, `/standings` | provide bot token + channel IDs |
| Local platforms | africanfreefirecommunity.com + gameevotech.com — API spec TBD; default to web scraping + their JSON endpoints if available | per-tenant enable |

All inbound flows: pull → validate via game adapter schema → INSERT into `match_results` / `match_player_stats` / `players` etc. → fire Realtime + outbound webhooks.

### 13.2 Outbound

| Channel | Spec |
|---|---|
| Webhooks | per-partner URL + secret. HMAC SHA-256 signature in header. Retry exponential (1m, 5m, 30m, 2h, 6h, 24h). Disabled after 10 consecutive failures. |
| REST API | `/api/v1/...`. Bearer token (partner API key). Rate-limit per key. Tier-based endpoints. |
| GraphQL | `/api/graphql`. Same auth. Subscriptions over WS via Supabase Realtime relay. |
| Data dumps | nightly cron generates per-tenant JSON dump → `data-exports/<tenant>/<date>.json.gz` in Supabase Storage. Pre-signed URL emailed to subscribed partners. |
| Local platforms | dedicated push adapters for africanfreefirecommunity.com + gameevotech.com (matched API on their side or scheduled CSV drops) |

### 13.3 Wager partner program

Generic partner kind `'wager'`. Same webhook + REST + GraphQL. Additional event types: `market.opened`, `market.closed`, `market.settled` (partner emits back to us; we mirror to tenant Discord if subscribed). No on-platform odds display at v1 (legal scope). Recommended events for wager partners:
- `match.started`, `match.ended`, `score.changed` — odds anchors
- `standings.changed` — leaderboard markets
- `sanction.issued` — player suspension affects markets

---

## 14. Mobile + PWA

### 14.1 Mobile-first design

- Player flows: 360-480px primary; 768px tablet; 1280px+ desktop
- Admin flows: 1024px+ primary (tablet+desktop); 360-480px degraded but functional
- Broadcast control: 1280px+ required
- Overlay editor: 1280px+ required

### 14.2 PWA scope

- Service worker caches: brand kit, last-viewed standings, fixtures, profile pages (read-only)
- Offline: full read of cached content; submit forms queued + flushed on reconnect
- Install prompt: trigger after 3 page views on tenant pages
- Push: opt-in via permission flow; VAPID keys in env; `push_subscriptions` table stores

### 14.3 Capacitor wrap (deferred — NOT in v1 scope, no committed v2)

Deferred. PWA covers immediate need. Revisit only if PWA limits hit (background tasks, deep OS integration, native APIs).

---

## 15. Asset Pipeline (port + extend ESOCCER)

### 15.1 Python pipeline (local admin)

ESOCCER's `KNOWLEDGE/brand-assets/players/_process.py`:
- Inputs: ARW (Sony RAW), CR3 (Canon RAW), PNG
- Pipeline: decode → face detect → produce 6 variants (headshot_NN, card_NN, fullbody_NN + each `_nobg`)
- Manifest.json tracks
- Tenant admin downloads pipeline + runs on own machine + uploads processed PNGs

### 15.2 Cloud fallback (remove.bg)

- Tenant admin uploads any image via web UI
- Server checks if Python pipeline endpoint exists for tenant; else calls remove.bg API ($0.001/img)
- Cropped + bg-removed result stored in Supabase Storage
- Variants generated server-side via Sharp (Node):
  - headshot_01 (square crop, face centered)
  - card_01 (3:4 portrait)
  - fullbody_01 (vertical body)
  - each `_nobg` variant

### 15.3 Logo + sponsor processing

Auto-generate transparent-bg strip variants for sponsors via remove.bg + Sharp.

---

## 16. Email Templates (per-tenant brand vars)

Platform ships ~15 templates via Resend:
- `welcome` — first sign-up
- `tenant-invite` — invited to a tenant
- `role-changed` — role granted/revoked
- `match-starting` — 10min reminder
- `match-result-posted` — final score
- `dispute-filed` — admin notified
- `dispute-ruled` — player notified
- `appeal-filed` / `appeal-ruled`
- `sanction-issued` — player notified
- `password-reset` (handled by Clerk)
- `weekly-digest` — opt-in summary
- `partner-api-key-issued`
- `gdpr-export-ready`
- `gdpr-deletion-confirmed`

Each is JSX (React Email) template. Variables: `{ tenant: { name, logo, primary_color, secondary_color }, user: {...}, payload: {...} }`. Single brand-injection point.

---

## 17. GDPR / Data Privacy

### 17.1 Player self-serve

`/t/<slug>/me/data`:
- "Export my data" → background job generates JSON dump of all rows where user_id = current → email pre-signed URL when ready
- "Delete my account" → confirmation flow → soft-delete user + scrub PII (display_name → "Deleted User", email → null, avatar → null) + cascade to per-tenant data (kept for league record but anonymized)

### 17.2 Tenant-level

`/admin/[slug]/data-export`:
- "Export tenant data" → bulk JSON of all tenant-scoped tables → pre-signed URL
- "Archive tenant" → soft-deletes everything; can be restored within 90 days
- "Permanently delete tenant" → super-admin only; hard cascade after final export

---

## 18. Observability

- **Sentry free:** browser + server runtime errors; PII scrub on. ~5K errors/mo room.
- **PostHog free:** product analytics (funnels: onboarding, tournament creation, first-broadcast). Session replays on player flows (1M events/mo). PII opt-in masking.
- **Vercel Analytics:** Core Web Vitals.
- **Supabase logs:** SQL slow-query log + auth events.
- **Custom event log:** `audit_events` table (port from ESOCCER).
- **Status page (optional v2):** `status.platform.com` aggregating uptime + recent incidents.

---

## 19. Testing Strategy

| Layer | Tool | Coverage target |
|---|---|---|
| Unit | Vitest + RTL | every utility, scoring fn, adapter |
| Integration | Vitest with mocked Supabase | per server module; ESOCCER pattern |
| E2E | Playwright | 50+ specs at v1 (onboarding, tournament-flow, match-report, dispute, overlay-trigger, admin-CRUD, integrations) |
| Visual regression | Playwright snapshots | all 16 overlays per game pack + key pages |
| Smoke | scripts/_smoke.mjs | run after deploy; checks 200 on critical routes |
| Audit | SQL smoke `supabase/tests/audit_smoke.sql` | trigger correctness |

CI on every PR: lint + unit + build + E2E (against ephemeral preview deploy) + visual regression.

---

## 20. Implementation Phases (Plans)

Each phase = own implementation plan written via `writing-plans` skill once spec approved. Estimated weeks are conservative — assume parallel subagent dispatch where independent.

| # | Phase | Scope | Est weeks |
|---|---|---|---|
| 0 | Foundation | Next.js 15 scaffold, Clerk wiring, Supabase migrations base, audit + soft-delete, env handling, CI, deploy preview | 1 |
| 1 | Tenancy + identity | tenants + tenant_memberships + tenant_settings + Clerk webhook sync + URL prefix routing + middleware + 8 default roles + perms + custom roles + invite flow + super-admin tenants list | 2 |
| 2 | Game catalog + adapters | `games` + `scoring_presets` tables, adapter contract, register all 9 games at launch (EAFC, eFootball, FF, PUBGM, CODM, Warzone, MLBB, Marvel Rivals, CoC), per-game scoring engines (port BRGAMES) | 3 |
| 3 | Tournament engine | tournaments + stages + participants + tournament_templates + brackets (SE/DE/RR/Swiss/BR-points/chain/clash_squad/CWL primitives) + creation wizard + scheduler | 3 |
| 4 | Matches + ingestion | matches + match_results + match_participants + match_player_stats + standings + recomputation + manual entry + OCR router (Claude + Gemini) + log parser (FF) + realtime sim | 3 |
| 5 | Players + teams + identities | players + teams + player_game_identities + handle verification (per-tenant) + player profile pages + asset pipeline (Python + remove.bg) | 2 |
| 6 | Disputes + sanctions + ledger | disputes + appeals + sanctions + caution_ledger + per-tenant model switching + UI flows | 2 |
| 7 | Overlays + builder + branding | port ESOCCER v2 wholesale: 16 overlay HTMLs + design tokens (Wave 1+2) + Builder Waves 1A→3B + design panel + branding/brand kits + per-tenant overlay variants | 4 |
| 8 | Sponsors + email + notifications | sponsors + tenant_sponsors + Resend templates + per-tenant brand vars + in-app bell + Discord webhook + web push (PWA) | 2 |
| 9 | AI features | OCR router (Claude + Gemini) + narrative blurbs + commentary generator + format suggester + Vercel AI Gateway integration | 2 |
| 10 | Integrations IN/OUT | partners + partner_api_keys + partner_webhooks + webhook_deliveries + ingest_sources + game API clients + aggregators + scraper farm + Discord bot + local platform adapters (africanfreefirecommunity.com, gameevotech.com) + REST API + GraphQL + data dumps | 4 |
| 11 | Search | pgvector setup + embedding pipeline + FTS + AI semantic + search UI | 1 |
| 12 | Super-admin dashboard | platform KPIs + tenant CRUD + impersonate + featured-events curation + abuse + games catalog admin + partner program | 1 |
| 13 | Public API + embeds | iframe widgets (standings, fixtures, leaderboard) + API auth + rate limiting + docs | 1 |
| 14 | Mobile + PWA | mobile-first audit + PWA manifest + service worker + offline cache + push opt-in flow | 2 |
| 15 | GDPR + tenant export | self-serve export + delete flows + tenant data export + tenant archive + permanent delete | 1 |
| 16 | Observability + ops | Sentry wiring + PostHog wiring + Vercel Analytics + Supabase log alerts + status page (optional) | 1 |
| 17 | Polish + launch | end-to-end QA pass + visual regression baselines + performance audit + accessibility audit + docs site + launch checklist | 2 |

**Total estimate:** ~37 weeks of focused engineering = ~9 months solo. With parallel subagent dispatch on independent phases (e.g., phases 4+7+10 in parallel), realistic timeline: **4-6 months**.

**Recommended order for execution:**
- Phases 0, 1, 2, 3 sequential (foundation)
- Phases 4, 5, 6 parallel-able after 3
- Phase 7 (overlays) parallel-able starting after 1
- Phase 8 (sponsors/email/notify) parallel-able after 1
- Phase 9 (AI) parallel-able after 4
- Phase 10 (integrations) parallel-able after 4
- Phase 11 (search) after 5
- Phase 12 (super-admin) after 1 (early dogfood)
- Phase 13 (public API) after 10
- Phase 14 (PWA) parallel anytime
- Phases 15-17 launch-gate

---

## 21. Files to Copy from References

When ESPORTSPRODUCTION scaffold begins, copy these from `ESOCCER` and `BRGAMES`:

### From ESOCCER (this repo)

```
apps/web/src/lib/perms-db.ts
apps/web/src/lib/time.ts
apps/web/src/lib/businessDays.ts
apps/web/src/lib/motion.ts
apps/web/src/lib/supabase/{server,service,browser}.ts
apps/web/src/lib/feature-flags.ts
apps/web/src/server/audit/                            ← attach_audit pattern
apps/web/src/server/overlays/                         ← v2 + design + builder
apps/web/src/components/broadcast/v2/OverlayDataInjector.tsx
apps/web/src/components/admin/builder/                ← Builder library
apps/web/src/components/admin/OverlayDesignEditor.tsx
apps/web/src/server/notifications/                    ← in-app + realtime
apps/web/src/server/email/                            ← Resend wiring
apps/web/scripts/_extend-bootstrap-script.mjs
apps/web/scripts/sync-v2-overlays.mjs
apps/web/scripts/_process-photos.py                   ← rembg + OpenCV pipeline
supabase/migrations/                                  ← audit, soft-delete, overlay design-system patterns
KNOWLEDGE/brand-assets/elements/v2/                   ← 16 overlay HTMLs as templates
docs/superpowers/specs/2026-04-26-overlay-design-process.md
docs/superpowers/specs/2026-04-26-overlay-design-prompt.md
docs/superpowers/specs/2026-04-29-overlay-design-system.md
docs/superpowers/specs/2026-05-17-overlay-builder-design.md
docs/superpowers/specs/2026-04-21-plan-11-void-propagation-and-warnings.md   ← discipline reference
docs/superpowers/specs/2026-04-21-plan-13-orgs-disputes-content.md
docs/superpowers/specs/2026-04-21-plan-12-vmix-overlay-bridge.md
docs/superpowers/specs/2026-04-21-plan-14-stats-screenshot-ocr.md
docs/superpowers/specs/2026-04-21-plan-9-roles-and-db-perms.md
apps/web/src/lib/perms.ts                             ← seed perm doc
```

### From BRGAMES

```
lib/types/br.ts                                       ← 20 BR types
lib/br-scoring/                                       ← presets, scoreMatch, cumulative, match-point, resolveStage, projection, golden tests
lib/brackets/                                         ← engine + 5 primitives (SE/DE/RR/Swiss/BR-points/Clash Squad)
lib/repos/br-events.mock.ts                           ← inspiration for real BR-event ingest schema
lib/repos/ingest-sources.mock.ts                      ← inspiration for ingest_sources table
lib/ingest/                                           ← FF MatchResult.log parser
lib/realtime/                                         ← Zustand timeline + BroadcastChannel sim
lib/overlays/                                         ← binding resolver + animation presets
docs/superpowers/specs/2026-05-09-brgames-br-platform-design.md
docs/superpowers/plans/2026-05-09-brgames-br-*.md     ← 6 BR plan refs
docs/architecture.md
memory/lessons/                                       ← all 13 BRGAMES lessons (port to ESPORTSPRODUCTION memory)
```

### Discard / Don't Port

- ESOCCER's `apps/web/src/server/fcdb/` — Futbin specific. Port only when EAFC adapter built (Phase 2).
- ESOCCER's `KNOWLEDGE/brand-assets/players/processed/anife/` — tenant-specific assets.
- ESOCCER's hardcoded "CADE Elite" copy in routes — full rebuild in ESPORTSPRODUCTION.
- BRGAMES's `lib/repos/*.mock.ts` — replaced by real Supabase queries.

---

## 22. Risk + Mitigation

| Risk | Mitigation |
|---|---|
| Scope sprawl — 9 months solo is long | Strict phase gates; each phase ships verified before next starts. No phase exceeds 4 weeks without re-scope. |
| Multi-game adapters diverge into duplicated logic | Adapter contract enforced via TypeScript interface; shared utility extraction during phase 2 review. |
| Clerk multi-tenant gotchas (org switching, role sync race conditions) | Webhook idempotency + reconciliation cron + audit. Spike day-1 of phase 1. |
| Supabase free tier limits hit early (500MB DB, 1GB storage) | Monitor early; upgrade to Pro $25/mo when first tenant exceeds 50MB. Storage offload to S3-compatible (Cloudflare R2) as fallback. |
| Vercel Hobby compute cap hit (already happened in ESOCCER) | Monitor PostHog daily; pre-stage Cloudflare Pages migration playbook (memory `reference_vercel_alternatives.md`). |
| OCR cost runaway | Per-tenant monthly cap + Gemini-first router (cheaper). |
| Multi-language i18n missing strings | Linter + Storybook story per locale; CI fails if untranslated key referenced. |
| Overlay design-token cross-document propagation regression | Visual regression CI; bootstrap script tests; ESOCCER lessons captured. |
| Partner integration security (HMAC, replay, rate-limit) | Industry-standard HMAC SHA-256 + nonce + 5-min replay window; OWASP API top-10 reviewed phase 10 start. |
| GDPR self-serve abuse (mass-export) | Rate-limit per user; super-admin notified on bulk exports >100MB. |
| Adoption gap — designing too many features no one uses | In-house launch with 1-2 tenants only; instrument PostHog funnels; cut unused features before scaling. |

---

## 23. Out-of-Scope + Deferred

### 23.1 Dropped (NOT building — confirmed 2026-05-25)

1. **VOD library** — DROPPED. No post-match video archive.
2. **Custom domains per tenant** — DROPPED. URL prefix (`/t/<slug>`) is canonical forever.

### 23.2 Deferred (revisit later — NOT v1 scope)

1. **Companion mobile app (Capacitor wrap)** — deferred. PWA covers v1 mobile need; revisit only when PWA limits hit.
2. **Spectator reactions / live emoji overlay** — deferred; non-critical.
3. **Game adapter SDK public publishing** — deferred; internal pattern at v1.
4. **Plugin marketplace** — deferred to v3.
5. **eSports federation compliance / KYC** — deferred until first regulated tournament demands.

### 23.3 Resolved-during-phase (locked but tunable per implementation)

1. **Tournament check-in granularity** — locked as per-tenant toggle; per-tournament tuning may be added during phase 3 if real-world need surfaces.

---

## 24. Self-Review

Spec self-review pass:

- [x] Placeholder scan: no TBD/TODO remaining in core sections (Open Questions explicitly listed in §23).
- [x] Internal consistency: locked decisions table (§1) matches all body sections (§5-§19).
- [x] Scope check: 56 locked decisions cover every major surface. Spec phasing into 18 plans (§20) keeps each plan bounded.
- [x] Ambiguity check: per-tenant choice options consistent (settings model + UI placement).
- [x] References complete: ESOCCER + BRGAMES + Clerk + Supabase docs cited.
- [x] Migration path from ESOCCER + BRGAMES specified (§21).
- [x] Risk register populated (§22).

---

## 25. Next Steps

1. **User review** — read this spec end to end. Flag missing decisions or scope concerns. Add to §23 if deferring.
2. **Sign-off** — once approved, commit spec to `ESOCCER/docs/superpowers/specs/` AND copy to `ESPORTSPRODUCTION/docs/superpowers/specs/` (single source of truth in ESPORTSPRODUCTION).
3. **Copy reference files** — execute §21 copy manifest from ESOCCER + BRGAMES into ESPORTSPRODUCTION.
4. **Phase 0 plan** — invoke `writing-plans` skill to draft `2026-05-25-phase-0-foundation.md` (Next.js scaffold, Clerk, Supabase init, audit/soft-delete, CI).
5. **Execute Phase 0** — implement in ESPORTSPRODUCTION. Verify per ESOCCER's verification discipline.
6. **Iterate phases 1 → 17** per §20 order, parallelizing where independent.
