# Overlay Design System (tokens + admin editor + templates + version history)

**Owner:** Spektakula
**Version:** 1.0
**Date:** 2026-04-29
**Status:** Draft — proposed for next sprint
**Supersedes:** N/A (greenfield feature)
**Related:** Plan 12 (overlay bridge), Plan 51 (broadcast v2), CLAUDE.md §14 (overlay HTML contract)

---

## 1. Goal + Success Criteria

**Goal:** Move 80%+ of overlay-design tweaks (color, font, scale, position, partner-strip toggles, template variant) out of code and into an admin UI, so producers can tune broadcast graphics without engineering. Keep the postMessage data contract and HTML contract from CLAUDE.md §14 frozen so DB-driven feeds (standings, score-bug, leaderboard rows) keep auto-updating regardless of which design variant is active.

**Success criteria (each demonstrable end-to-end before plan is complete):**

1. Admin opens `/admin/broadcast/v2/design`, picks `07-leaderboard`, changes the primary fill color from `#6bcd06` to `#fe036d`, clicks Save. A separate OBS browser source pointed at `/overlay/v2/07-leaderboard?demo=1` reflects the new color within **3 seconds** of the next paint, **without a redeploy**.
2. Admin enables a new "bold" template variant for `09-secondary-score-bug` from the template gallery. The OBS browser source switches to the new HTML on the next session, while the score payload (`home_score`, `away_score`, `match_id`) keeps flowing identically — the standings → score-bug binding does not break.
3. Admin clicks "Revert" on a color change made 5 minutes ago. The previous token snapshot restores. Audit log records both the change and the revert.
4. A user without `overlay.design.manage` permission gets 403 trying to mutate tokens or templates.
5. Every token write + template flip + revert lands in `audit_events` via the existing `audit_row_change()` trigger.
6. The live preview iframe inside the admin editor renders the same HTML the OBS source will render, with synthetic demo data, updating live as the operator drags color/scale sliders.
7. Page-level perf: tokens resolved server-side per overlay route in **<50 ms** added latency. No additional Realtime subscription required (CSS variables read at next render via the existing data injector).
8. Migration ships a `default` template variant per overlay key seeded from the current HTML, so the system is no-op on first deploy.

**Pre-flight (human action):** verify the existing 16 overlay HTMLs already satisfy CLAUDE.md §14 (font paths, observer script, demo guard) — they do per the 2026-04-26 audit, but a quick grep for `cade-visible-gate-observer-v2` across `apps/web/public/overlays/v2/<key>/index.html` confirms before this plan starts.

---

## 2. Scope Discipline

**In scope:**

- 3 new tables: `overlay_design_tokens`, `overlay_template_variants`, `overlay_design_history`.
- Migration that seeds one row per existing overlay key with the current visual values (color, font, scale, etc.) — non-destructive baseline.
- Server module `apps/web/src/server/overlays/design/` with token CRUD + template CRUD + version revert.
- Permission: re-use existing `broadcast.match_control` for read; gate writes on **new** `overlay.design.manage` (admin + design role per the 12-role matrix).
- Overlay HTML rewiring: every `KNOWLEDGE/brand-assets/elements/v2/<key>/index.html` consumes design tokens via CSS variables read from the page-level `<style>` block injected by the server route. **No new postMessage type.** Tokens flow through SSR → CSS variables, NOT runtime postMessage.
- Admin UI at `/admin/broadcast/v2/design`:
  - Per-overlay token editor (color pickers, font dropdown, sliders for scale + position, toggles for partner-strip / debug grid).
  - Live preview iframe (same `<key>` route mounted with `?demo=1&previewTokens=<base64-json>`).
  - Template gallery (variant cards with thumbnails, click to set active).
  - Version timeline with revert.
- Template authoring contract: a new template variant = a new HTML file at `KNOWLEDGE/brand-assets/elements/v2/<key>/templates/<variant-id>/index.html` (mirrored to public/) + a row in `overlay_template_variants`. Engineering still writes the HTML; admin picks which variant is active.
- ≥15 new unit tests covering tokens, variants, history, perm gates.
- 1 E2E spec: admin opens design tab, changes a color, opens preview iframe in second tab, asserts the CSS variable in the iframe's computed style.

**Out of scope (deferred):**

- AI-assisted edit ("make the score-bug bigger and red" → token diff via Claude). Plan 39 sanitize hardening + token-schema rigor must land first.
- Per-session token overrides (every overlay across sessions reads the same global tokens). Per-session scoping is a follow-up if a particular event needs a different look.
- Bulk template authoring tools (Figma plugin, drag-and-drop builder). Out of scope — engineers continue authoring HTML.
- Animation timing curves as tokens. Animations stay hard-coded inside each template. Future: extract to tokens once token catalog is stable.
- Dark / light mode toggle. Brand is dark-only.

---

## 3. Data Model

All three tables inherit Phase 1A conventions: `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`, `created_at TIMESTAMPTZ DEFAULT now()`, `updated_at TIMESTAMPTZ DEFAULT now()`, `deleted_at TIMESTAMPTZ NULL`. Audit trigger attached via `public.attach_audit('<table>')`. WAT for display; UTC in storage.

### 3.1 `overlay_template_variants`

One row per (overlay_key, variant_id). The `default` variant is seeded for every overlay key on initial migration. Only one variant per overlay_key can have `active = true`.

```sql
create table public.overlay_template_variants (
  id            uuid primary key default gen_random_uuid(),
  overlay_key   text not null,                    -- '07-leaderboard', '09-secondary-score-bug', ...
  variant_id    text not null,                    -- 'default', 'bold', 'minimal', 'elite-league-2026'
  label         text not null,                    -- human label for the gallery
  description   text null,
  html_path     text not null,                    -- 'KNOWLEDGE/brand-assets/elements/v2/07-leaderboard/templates/bold/index.html'
  thumbnail_path text null,                       -- 'apps/web/public/overlays/v2/_assets/thumbnails/07-leaderboard-bold.png'
  active        boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz null,
  unique (overlay_key, variant_id)
);

create unique index overlay_template_variants_active_unique
  on public.overlay_template_variants (overlay_key)
  where active = true and deleted_at is null;

select public.attach_audit('overlay_template_variants');

alter table public.overlay_template_variants enable row level security;
-- service-role only; admin reads come through server modules with perm gate.
```

### 3.2 `overlay_design_tokens`

One row per (overlay_key, variant_id, token_key). Tokens are typed via discriminated union — the server module enforces type per `token_key`.

```sql
create table public.overlay_design_tokens (
  id            uuid primary key default gen_random_uuid(),
  overlay_key   text not null,
  variant_id    text not null default 'default',
  token_key     text not null,                    -- 'bg-color', 'accent-color', 'font-display', 'scale', 'partner-strip-show', ...
  token_value   text not null,                    -- '#6bcd06' / 'Agharti' / '1.0' / 'true'
  token_type    text not null check (token_type in ('color','font','number','boolean','enum','string')),
  set_by        uuid not null references public.users(id),
  set_at        timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz null,
  unique (overlay_key, variant_id, token_key)
);

select public.attach_audit('overlay_design_tokens');

alter table public.overlay_design_tokens enable row level security;
```

**Token catalog** (initial — extensible):

| token_key | type | applies to | example |
|---|---|---|---|
| `bg-color` | color | all | `#050505` |
| `accent-color` | color | all | `#6bcd06` |
| `text-color` | color | all | `#ffffff` |
| `partner-strip-show` | boolean | brb / starting-soon / stream-ended / leaderboard | `true` |
| `font-display` | font | all | `Agharti` |
| `font-body` | font | all | `Quedora` |
| `scale` | number | all | `1.0` |
| `pos-x` | number | score-bug, lower-third, up-next-bug | `40` (px from edge) |
| `pos-y` | number | same | `40` |
| `row-highlight-count` | number | leaderboard, top-scorers | `2` (top-2 rows highlighted) |
| `pattern` | enum (`none`/`halftone`/`grid`) | leaderboard, brb | `halftone` |

Token rows missing for an overlay key fall back to a hard-coded default in `apps/web/src/server/overlays/design/defaults.ts`. Migration seeds only the values that override the hard-coded defaults — keeps row count tight.

### 3.3 `overlay_design_history`

Snapshot per save. Append-only; soft-delete only (never UPDATE / DELETE). Used for revert.

```sql
create table public.overlay_design_history (
  id            uuid primary key default gen_random_uuid(),
  overlay_key   text not null,
  variant_id    text not null,
  snapshot_json jsonb not null,                   -- full token map at snapshot time
  changed_by    uuid not null references public.users(id),
  reason        text null,
  created_at    timestamptz not null default now(),
  deleted_at    timestamptz null
);

create index overlay_design_history_lookup
  on public.overlay_design_history (overlay_key, variant_id, created_at desc)
  where deleted_at is null;

-- Append-only enforcement (mirrors auth_events / caution_ledger_entries pattern):
create or replace function public.overlay_design_history_block_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'overlay_design_history is append-only';
end;
$$;
create trigger overlay_design_history_no_update
  before update on public.overlay_design_history
  for each row execute procedure public.overlay_design_history_block_mutation();
create trigger overlay_design_history_no_delete
  before delete on public.overlay_design_history
  for each row execute procedure public.overlay_design_history_block_mutation();

select public.attach_audit('overlay_design_history');

alter table public.overlay_design_history enable row level security;
```

### 3.4 Permission seed

```sql
insert into role_permissions (role, perm) values
  ('admin',   'overlay.design.manage'),
  ('design',  'overlay.design.manage'),
  ('production', 'overlay.design.manage')
on conflict do nothing;
```

`broadcast.match_control` (existing) covers READ; `overlay.design.manage` (new) gates writes + reverts + template flips.

---

## 4. Server Modules

### 4.1 `apps/web/src/server/overlays/design/tokens.ts`

```ts
export type TokenType = 'color' | 'font' | 'number' | 'boolean' | 'enum' | 'string';

export type DesignToken = {
  overlayKey: string;
  variantId: string;
  tokenKey: string;
  tokenValue: string;
  tokenType: TokenType;
  setBy: string;
  setAt: string;
};

export async function getDesignTokens(
  sb: SupabaseClient,
  overlayKey: string,
  variantId?: string,
): Promise<Record<string, DesignToken>>;

export async function setDesignToken(
  sb: SupabaseClient,
  actor: Actor,
  overlayKey: string,
  variantId: string,
  tokenKey: string,
  tokenValue: string,
  tokenType: TokenType,
): Promise<DesignToken>;

export async function clearDesignToken(
  sb: SupabaseClient,
  actor: Actor,
  overlayKey: string,
  variantId: string,
  tokenKey: string,
): Promise<void>;

/**
 * Resolve effective tokens for a given overlay+variant: merges DB rows
 * over the hard-coded defaults from `defaults.ts`. Used by the SSR
 * overlay route to inject CSS variables.
 */
export async function resolveTokens(
  sb: SupabaseClient,
  overlayKey: string,
  variantId?: string,
): Promise<Record<string, string>>;
```

Mutations gate on `overlay.design.manage`. Every successful `setDesignToken` writes a snapshot row to `overlay_design_history` BEFORE the upsert (ordering matters for revert correctness).

### 4.2 `apps/web/src/server/overlays/design/templates.ts`

```ts
export type TemplateVariant = {
  id: string;
  overlayKey: string;
  variantId: string;
  label: string;
  description: string | null;
  htmlPath: string;
  thumbnailPath: string | null;
  active: boolean;
};

export async function listTemplates(
  sb: SupabaseClient,
  overlayKey?: string,
): Promise<TemplateVariant[]>;

export async function setActiveTemplate(
  sb: SupabaseClient,
  actor: Actor,
  overlayKey: string,
  variantId: string,
): Promise<void>;

export async function createTemplate(
  sb: SupabaseClient,
  actor: Actor,
  input: Omit<TemplateVariant, 'id' | 'active'>,
): Promise<TemplateVariant>;
```

`setActiveTemplate` flips the partial-unique-index pivot atomically: SET active=false on the current active row, SET active=true on the new one, in one transaction.

### 4.3 `apps/web/src/server/overlays/design/history.ts`

```ts
export type HistorySnapshot = {
  id: string;
  overlayKey: string;
  variantId: string;
  snapshot: Record<string, string>;
  changedBy: string;
  reason: string | null;
  createdAt: string;
};

export async function listHistory(
  sb: SupabaseClient,
  overlayKey: string,
  variantId: string,
  limit?: number,
): Promise<HistorySnapshot[]>;

/**
 * Restore tokens for an overlay+variant to a prior snapshot. Writes
 * a NEW history row first (the revert is itself a snapshot), then
 * upserts every token from the chosen snapshot.
 */
export async function revertToSnapshot(
  sb: SupabaseClient,
  actor: Actor,
  snapshotId: string,
): Promise<void>;
```

### 4.4 `apps/web/src/server/overlays/design/defaults.ts`

Hard-coded fallback map. Mirrors the visual values currently hard-coded in each overlay HTML, so first-deploy is no-op. Re-exported as the single source of truth for "what does this overlay look like with no DB tokens set".

---

## 5. UI

### 5.1 Admin: `/admin/broadcast/v2/design`

New hub sub-tab on the Broadcast hub. Order in `BroadcastHubTabs`: `Sessions · Stingers · Design · Branding · YouTube`.

Layout:

```
┌─────────────────────────────────────────────────────────────┐
│  Overlay (dropdown: 16 overlays)   Variant (default ▼)      │
├──────────────────────┬──────────────────────────────────────┤
│ Tokens               │ Live preview                          │
│ ──────               │ ───────────                           │
│ Background  [color]  │  ┌────────────────────────────────┐  │
│ Accent      [color]  │  │                                │  │
│ Text        [color]  │  │  iframe @ /overlay/v2/<key>?   │  │
│ Display fnt [select] │  │   demo=1&previewTokens=<...>   │  │
│ Body fnt    [select] │  │  (1920×1080 scaled to fit)     │  │
│ Scale       [slider] │  │                                │  │
│ Pos X       [slider] │  └────────────────────────────────┘  │
│ Pos Y       [slider] │                                       │
│ Partner str [toggle] │                                       │
│                      │                                       │
│ [Save]  [Discard]    │                                       │
├──────────────────────┴──────────────────────────────────────┤
│  Templates (gallery)         │  Version history             │
│  ─────────────────           │  ────────────                │
│  [Default ✓]  [Bold]  [Min]  │  09:42 by admin (revert)     │
│                              │  09:18 by design (revert)    │
│                              │  yesterday by admin          │
└─────────────────────────────────────────────────────────────┘
```

Token edits update a `previewTokens` URL param on the iframe (debounced 250ms) so the iframe re-renders WITHOUT touching the DB. Save persists. Discard reverts to last DB state.

Server actions in `apps/web/src/app/admin/broadcast/v2/design/actions.ts`:

```ts
export async function saveTokensAction(formData: FormData);
export async function setActiveTemplateAction(formData: FormData);
export async function revertToSnapshotAction(formData: FormData);
```

All gate on `overlay.design.manage`, wrapped in `enforceAuthedWrite` rate-limit, and `revalidatePath('/admin/broadcast/v2/design')` + `revalidateTag(\`overlay-tokens-${overlayKey}\`)` on success.

### 5.2 Overlay route: `apps/web/src/app/(overlay)/overlay/v2/[key]/page.tsx`

Add a server-side token resolution step. Inject CSS variables in a `<style>` tag at the top of the body BEFORE the iframe content.

```tsx
// Pseudocode addition near the top of the existing OverlayV2Page:
const tokens = await resolveTokens(getServiceRoleSupabase(), key, variantId);
const cssVars = Object.entries(tokens)
  .map(([k, v]) => `--overlay-${k}: ${v};`)
  .join(' ');

return (
  <>
    <style dangerouslySetInnerHTML={{ __html: `:root { ${cssVars} }` }} />
    <OverlayDataInjector
      overlayKey={key}
      variantId={variantId}
      htmlPath={resolveTemplateHtmlPath(key, variantId)}
      ...
    />
  </>
);
```

Each overlay HTML's existing inline `<style>` updates to read from CSS variables:

```css
:root {
  --overlay-bg-color: #050505;       /* fallback if no token injected */
  --overlay-accent-color: #6bcd06;
  /* ... */
}
.leaderboard-row.highlight {
  background: var(--overlay-accent-color);
}
```

The `previewTokens` URL param (admin live-preview path) decodes a base64 JSON map and overrides the SSR-injected variables with `<style id="preview-tokens">` higher up the cascade.

### 5.3 Template gallery thumbnails

Each template variant ships a 320×180 thumbnail at `apps/web/public/overlays/v2/_assets/thumbnails/<key>-<variant>.png`. Engineering generates these via Playwright headless screenshot of the variant HTML during build (or hand-supplied at PR time). Out-of-band script at `apps/web/scripts/generate-overlay-thumbnails.mjs` runs on demand.

---

## 6. Testing

### 6.1 Unit tests (Vitest)

- `tokens.test.ts` — get/set/clear/resolve with mock Supabase. Cover (a) DB row overrides default, (b) missing row falls back to default, (c) perm rejection returns 403, (d) resolveTokens merges multiple keys.
- `templates.test.ts` — listTemplates, setActiveTemplate flips partial-unique-index pivot atomically, createTemplate rejects duplicate (overlay_key, variant_id).
- `history.test.ts` — listHistory ordered desc, revertToSnapshot writes new history row + restores every token, revert respects soft-delete.
- `defaults.test.ts` — every overlay key has at least one default for every required token type.
- `OverlayV2Page.test.ts` — SSR injects CSS variables; missing tokens use defaults.
- ≥15 new tests total.

### 6.2 E2E (Playwright)

`tests/e2e/overlay-design-tokens.spec.ts`:

1. Login as admin, navigate to `/admin/broadcast/v2/design`.
2. Select overlay `07-leaderboard`, variant `default`.
3. Change `accent-color` to `#fe036d` via color picker. Click Save.
4. Open second tab to `/overlay/v2/07-leaderboard?demo=1`.
5. Wait for inline `<style>` tag, query `:root` computed `--overlay-accent-color`.
6. Assert it equals `rgb(254, 3, 109)`.
7. Click Revert in admin tab.
8. Reload OBS tab, assert variable back to `#6bcd06`.

### 6.3 Smoke + manual

After ship:
- Manual click-through every overlay key in admin → change one token → verify preview iframe reflects.
- Curl `/overlay/v2/<key>?demo=1` for every overlay; assert response includes `--overlay-` CSS variables in the SSR output.

---

## 7. Acceptance Criteria

A staff engineer can confirm each of these with a clean clone + `npm install`:

1. Migrations apply cleanly via `npm run db:push` (or auto-applied via GH Actions). Three new tables exist with audit triggers + RLS enabled.
2. `npm run test` exits 0 with ≥15 new tests added.
3. `npx playwright test overlay-design-tokens` passes against a running dev server.
4. Visiting `/admin/broadcast/v2/design` as admin renders the editor.
5. Changing a color + saving + reloading any `/overlay/v2/<key>` browser source within 5 seconds reflects the new color.
6. Reverting to a prior snapshot restores the exact prior token map.
7. Activating a different template variant on `09-secondary-score-bug` swaps the HTML the OBS source loads, while live match `home_score`/`away_score` data continues to flow.
8. A non-staff user navigating to `/admin/broadcast/v2/design` redirects to `/login`. A logged-in player gets a 403 / forbidden render.
9. Audit trail for any token write / revert / template flip visible in `audit_events` via the existing `audit_row_change()` trigger.
10. CLAUDE.md §14 contract still satisfied for every overlay HTML — color-scheme dark meta, transparent body, observer script, demo guard, brand fonts.

---

## 8. Open Questions

1. **Per-session token overrides** — if an event sponsor wants a one-off color scheme for a single broadcast, do tokens scope per-session or stay global? Default: stay global. Open follow-up: add nullable `session_id` column on `overlay_design_tokens` later if a real ask lands.
2. **Token catalog growth** — who decides when a new token gets added? Default: engineering (via PR adding to `defaults.ts` + UI knob). Avoid letting tokens grow unbounded by keeping the catalog editorial.
3. **Animation timing** — out of scope for this plan, but a likely follow-up. Token-ize ease curves + duration once token catalog is stable.
4. **Thumbnail generation** — manual upload first, headless-screenshot script second. Decision deferred to plan execution.
5. **CSS-variables vs inline-styles for preview** — `<style id="preview-tokens">` higher in cascade is the proposal. Validate during implementation that it cleanly overrides SSR-injected `:root` block.
6. **AI-assisted edit (suggestion #5 in the brainstorm)** — explicitly deferred. Token catalog must be richly expressive AND prompt UX must be designed before this is worth building.

---

## 9. Migration sequencing

1. Migration `<stamp>_overlay_template_variants.sql` — create table + seed `default` row per overlay key pointing at current HTML.
2. Migration `<stamp>_overlay_design_tokens.sql` — create table + seed only divergent values (most overlays seed nothing; HTML defaults take over).
3. Migration `<stamp>_overlay_design_history.sql` — create table + append-only triggers.
4. Migration `<stamp>_overlay_design_perm_seed.sql` — insert `overlay.design.manage` rows for admin/design/production roles.
5. Server modules + tests (no UI yet).
6. Overlay HTMLs rewired to consume CSS variables — one PR per overlay key for safe rollback (16 small commits, not one big bang).
7. Admin UI + live-preview iframe.
8. Playwright E2E.
9. Documentation in CLAUDE.md §14 — extend with token catalog reference + template-variant authoring guide.

Steps 1–4 ship as one commit; 5–9 are separate.

---

## 10. Effort estimate

| Phase | Effort |
|---|---|
| Migrations (1–4) | 0.5 day |
| Server modules + tests (5) | 1 day |
| Overlay HTML CSS-variable rewiring (6) | 1 day (16 files × ~30 min each) |
| Admin UI + live preview (7) | 1 day |
| E2E + smoke (8–9) | 0.5 day |
| **Total** | **~4 dev-days** (single agent serial; ~2 days with parallel slicing) |

Adding a new template variant after this lands: ~30 min of HTML authoring + 1 SQL row insert + thumbnail. Same overlay, different look, no engineering review needed beyond the HTML.
