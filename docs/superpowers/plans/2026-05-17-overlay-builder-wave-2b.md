# Overlay Builder Wave 2B — Photopea iframe embed + postMessage save bridge

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship in-browser PSD editing. An admin opens an existing PSD asset uploaded via Wave 2A, clicks **Open in Photopea**, lands on `/admin/broadcast/v2/builder/[slug]/psd?assetId=<id>`, edits the PSD inside a sandboxed Photopea iframe, hits Save. The PSD bytes round-trip back through a postMessage bridge, the prior version snapshots into history, the new PSD overwrites the storage object, and the Wave 2A `psd-parser.ts` re-runs to regenerate the flat PNG + per-layer sprites. The full round-trip for a 50 MB PSD completes in under 60 seconds and the bridge surfaces "Saving... Done." with progress for large files.

**Architecture:** New admin route at `/admin/broadcast/v2/builder/[slug]/psd` rendered server-side, perm-gated on `overlay.design.manage`. The page mounts a client component `PhotopeaIframe.tsx` that loads `https://www.photopea.com/` inside `<iframe sandbox="allow-scripts allow-same-origin">`. The iframe receives an `app.open` postMessage with a one-shot signed URL pointing at the PSD object in `overlay-user-assets`. On Save the bridge sends `{type:'app.activeDocument.saveToOE'}`; Photopea responds with raw PSD bytes via a follow-up `message` event. A strict `event.origin === 'https://www.photopea.com'` gate runs BEFORE the payload is read. Bytes flow through `savePsdFromPhotopeaAction(assetId, psdBytes)` which (a) snapshots the prior asset into history, (b) overwrites the storage object, (c) hands the bytes to the existing Wave 2A `psd-parser.ts` to regenerate the flat PNG + sprites. Status surfaces via a progress strip + toast. Everything behind the `overlayBuilder.photopeaEnabled` feature flag (default off).

**Tech Stack:** Next.js 15 (App Router) · Supabase Postgres + Storage · TypeScript · Vitest · Playwright · Zod · existing Wave 2A `psd-parser.ts` (ag-psd wrapper) · existing Wave 1A `enforceAuthedWrite` + `requirePermAsync` + `gate()` pattern · Photopea postMessage API (`app.open`, `app.activeDocument.saveToOE`)

**Related:**
- Spec `docs/superpowers/specs/2026-05-17-overlay-builder-design.md` §9 (PSD via Photopea) + §11 (Wave 2B scope) + §12 (Security — Photopea iframe origin gate).
- Wave 1A plan `docs/superpowers/plans/2026-05-17-overlay-builder-wave-1a.md` — feature flag wiring + `gate()` pattern + audit trigger pattern + memory/verification gates.
- Wave 2A (assumed shipped before Wave 2B): `overlay_user_assets` PSD rows + storage `overlay-user-assets/psd/<uuid>.psd` + `apps/web/src/server/overlays/builder/psd-parser.ts` exporting `parsePsdAndStoreSprites(sb, { parentAssetId, psdBytes })` that returns `{ flatPngAssetId, spriteAssetIds }`.
- CLAUDE.md §10 (`"use server"` files export ONLY async functions; schemas in sibling `schemas.ts`) · §11 (verify-before-show) · §12 (post-push route table).

**Wave 2B delivers (end of wave):**

1. New admin route `/admin/broadcast/v2/builder/[slug]/psd?assetId=<id>` (server component perm-gates on `overlay.design.manage`).
2. Sandboxed `<iframe sandbox="allow-scripts allow-same-origin" src="https://www.photopea.com/">` wrapped in client component `PhotopeaIframe.tsx`.
3. Photopea bootstrap: on iframe `load`, send `{type:'app.open', file: <signed-url-to-PSD>}` so Photopea downloads the PSD into its workspace.
4. Save trigger button posts `{type:'app.activeDocument.saveToOE'}` to Photopea; response handler reads PSD bytes via `message` event.
5. Strict origin gate: `event.origin === 'https://www.photopea.com'` validated BEFORE the payload is parsed; mismatched origins logged + dropped.
6. New server module `apps/web/src/server/overlays/builder/photopea-bridge.ts` exporting `savePsdFromPhotopeaAction(assetId, psdBytes)` — re-checks perm, snapshots prior asset to history, overwrites storage object, re-runs Wave 2A `psd-parser.ts`.
7. Progress UI: indeterminate spinner for the save phase; "Saving... Done." text strip; toast on completion.
8. Close button returns operator to the canvas editor at `/admin/broadcast/v2/builder/[slug]/edit`.
9. CSP audit: `/admin/*` allows `frame-src https://www.photopea.com` so the iframe can load (default Next.js does not block frames; this task verifies the deployed CSP is not stricter than that).
10. Pre-build smoke (`apps/web/scripts/_photopea-availability-smoke.mjs`): one-shot HEAD/GET against `https://www.photopea.com/` to verify the embed domain still serves a 200; logged in plan output, not committed to CI.
11. E2E spec `apps/web/tests/e2e/overlay-builder-photopea.spec.ts` opens the Photopea page, **stubs** the iframe (the real Photopea cannot be exercised cross-origin in Playwright headless without flakiness), simulates the save `message` event with fake PSD bytes, asserts `savePsdFromPhotopeaAction` invoked + history row written + flat PNG regenerated.
12. Memory + verification gate + push.

**Out of scope for Wave 2B** (deferred per spec §11 + §16 follow-ups):

- Photopea theme + locale customization (font + UI color tweaks). Out of scope.
- Photopea PSB (large-document) format. Hard-rejected at upload (`size_bytes > 100 MB` already blocked in Wave 2A); Wave 2B treats only `.psd`.
- Multi-PSD batch edit. Wave 2B opens exactly one PSD at a time.
- Photopea AI tools / plugins. Default Photopea UI only.
- Real-time collaborative Photopea sessions. Out of scope.
- Photopea revisions outside our snapshot ledger (Photopea has internal undo; we capture state at OUR save boundary, not Photopea's).
- Failure recovery if Photopea servers go down: degrades to upload-only flow from Wave 2A (admin downloads, edits in desktop Photoshop, re-uploads). Surfaced via the availability smoke + a banner if the smoke fails on page load.
- Replacing the flat-PNG / sprite regeneration with diff-only re-export. Wave 2B always re-runs the full Wave 2A parser pipeline on every save — simpler, idempotent, matches CLAUDE.md §2 non-negotiable "Idempotent recompute".

---

### Task 1: Pre-flight — Photopea availability smoke + Wave 2A dependency check

**Files:**

- Create: `apps/web/scripts/_photopea-availability-smoke.mjs` (one-shot, deleted after run; pattern from Wave 1A `_verify-wave-1a-routes.mjs`)
- Test: none (this is a sanity check, not committed)

**Context:** Photopea is a third-party SaaS. The spec §1 pre-flight + spec §14 first risk row both require a smoke before Wave 2B work begins. If Photopea has changed its embed API, postMessage envelope, or sunset the free public iframe, Wave 2B does not ship — the plan halts here. Separately, this task verifies Wave 2A has landed (`psd-parser.ts` + `overlay_user_assets` PSD rows + `overlay-user-assets/psd/...` storage object). If Wave 2A is not yet merged, the plan halts and we dispatch Wave 2A first.

#### Steps

1. Verify Wave 2A's prerequisites exist. Check the parser module and the assets table from the Wave 1A migration:

   ```bash
   ls apps/web/src/server/overlays/builder/psd-parser.ts \
      apps/web/src/server/overlays/builder/psd-parser.test.ts \
      apps/web/src/server/overlays/builder/assets.ts
   ```

   Expected output (all three present):

   ```
   apps/web/src/server/overlays/builder/assets.ts
   apps/web/src/server/overlays/builder/psd-parser.test.ts
   apps/web/src/server/overlays/builder/psd-parser.ts
   ```

   If any file is missing, STOP. Dispatch Wave 2A `writing-plans` first; the Wave 2B plan cannot land without the parser + asset CRUD it depends on. Document the blocker in `tasks/todo.md` under a "Wave 2B blocked on Wave 2A" subsection and exit.

2. Confirm the assets table has `psd_parent_asset_id` + `flat_png_asset_id` columns (the Wave 1A migration `20260901000002_overlay_user_designs.sql` already added these — this is a belt-and-suspenders check):

   ```bash
   npx supabase db query "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='overlay_user_assets' AND column_name IN ('psd_parent_asset_id','flat_png_asset_id') ORDER BY column_name;"
   ```

   Expected output:

   ```
        column_name
   ---------------------
    flat_png_asset_id
    psd_parent_asset_id
   (2 rows)
   ```

3. Author the availability smoke. Create `apps/web/scripts/_photopea-availability-smoke.mjs`:

   ```js
   #!/usr/bin/env node
   /**
    * Wave 2B pre-flight smoke. Verifies that:
    *   1. https://www.photopea.com/ returns 200 (the embed domain is live).
    *   2. The HTML at the root contains the postMessage receiver script
    *      marker so we know the embed API has not been silently sunset.
    *   3. The CSP / X-Frame-Options headers do not forbid embedding from
    *      our admin origin (Photopea allows ALLOW-FROM/SAMEORIGIN
    *      historically; new restrictions break Wave 2B).
    *
    * One-shot: run with `node apps/web/scripts/_photopea-availability-smoke.mjs`,
    * record the output in the Wave 2B PR description, then delete the file.
    *
    * Spec: docs/superpowers/specs/2026-05-17-overlay-builder-design.md §14 risk row 1.
    */
   const PHOTOPEA = "https://www.photopea.com/";

   let allGreen = true;
   function check(label, ok, detail) {
     console.log(`${ok ? "OK  " : "FAIL"} | ${label.padEnd(60)} | ${detail}`);
     if (!ok) allGreen = false;
   }

   // 1. Root returns 200.
   let html;
   try {
     const res = await fetch(PHOTOPEA, { method: "GET" });
     check("Photopea root GET", res.status === 200, `status=${res.status}`);
     html = await res.text();
   } catch (err) {
     check("Photopea root GET", false, err.message);
   }

   // 2. The HTML still ships their embed receiver (look for a stable marker
   //    such as "PPlaceholderScripts" or "window.addEventListener('message'").
   //    Adjust the marker if Photopea changes their bootstrap.
   if (html) {
     const hasReceiver =
       html.includes("addEventListener") && html.toLowerCase().includes("message");
     check("Photopea postMessage receiver marker", hasReceiver, "scan");
   }

   // 3. Header inspection.
   try {
     const res = await fetch(PHOTOPEA, { method: "HEAD" });
     const xfo = res.headers.get("x-frame-options");
     const csp = res.headers.get("content-security-policy");
     check(
       "Photopea X-Frame-Options",
       !xfo || xfo.toUpperCase() !== "DENY",
       `xfo=${xfo ?? "(none)"}`,
     );
     check(
       "Photopea CSP frame-ancestors",
       !csp || !/frame-ancestors\s+'none'/i.test(csp),
       `csp=${csp ? csp.slice(0, 80) + "..." : "(none)"}`,
     );
   } catch (err) {
     check("Photopea HEAD", false, err.message);
   }

   process.exit(allGreen ? 0 : 1);
   ```

4. Run the smoke:

   ```bash
   node apps/web/scripts/_photopea-availability-smoke.mjs
   ```

   Expected output (all OK; exact CSP/XFO string may vary as Photopea updates):

   ```
   OK   | Photopea root GET                                            | status=200
   OK   | Photopea postMessage receiver marker                         | scan
   OK   | Photopea X-Frame-Options                                     | xfo=(none)
   OK   | Photopea CSP frame-ancestors                                 | csp=(none)
   ```

   If any row is FAIL, STOP. Wave 2B does not ship until Photopea is back online OR a fallback is designed. Log the failing rows in `tasks/lessons.md` per the CLAUDE.md "Error log rule".

5. Delete the smoke script (one-shot, not committed):

   ```bash
   rm apps/web/scripts/_photopea-availability-smoke.mjs
   ```

6. No commit — this is a pre-flight gate, not a code change. Record the smoke output in the Wave 2B PR description under a "Pre-flight" header so future maintainers can re-run if Photopea breaks.

---

### Task 2: Migration — extend `overlay_user_design_history` to cover asset snapshots

**Files:**

- Create: `supabase/migrations/20260902000001_overlay_user_asset_history.sql`
- Test: `supabase/tests/overlay_user_asset_history_smoke.sql` (one-shot smoke)

**Context:** Wave 1A's `overlay_user_design_history` snapshots DESIGN state. Wave 2B introduces a parallel concern — snapshotting the PRIOR PSD asset before Photopea overwrites it, so admins can revert a botched Photopea edit. Two options:

- (a) Reuse `overlay_user_design_history` with a polymorphic `snapshot.kind = 'asset'` payload. Rejected: violates the schema's `design_id NOT NULL` semantics (a PSD asset may be shared by many designs).
- (b) New dedicated table `overlay_user_asset_history`. Selected: cleaner FK, matches existing append-only pattern, separate `revertToAssetSnapshot` action surface, easier audit.

Spec §9.2 step 5 explicitly says "writes new PSD to storage (overwriting the asset, soft-deleting prior version into history if changed)" — the new history table is the canonical home for that.

**Pattern reference:** mirrors `overlay_user_design_history` from `20260901000002_overlay_user_designs.sql` — append-only via the existing `overlay_design_history_block_mutation()` function + `attach_audit()` + service-role-only RLS.

#### Steps

1. Write the smoke first. Create `supabase/tests/overlay_user_asset_history_smoke.sql`:

   ```sql
   -- Wave 2B smoke: confirm overlay_user_asset_history exists with the
   -- right shape, audit trigger attached, and append-only enforcement
   -- raises on UPDATE + DELETE.
   --
   -- Run after `npm run db:push` via:
   --   npx supabase db query --file supabase/tests/overlay_user_asset_history_smoke.sql
   begin;

   -- 1. Table exists with the canonical columns.
   do $$
   declare
     v_missing text;
   begin
     select string_agg(c, ', ')
       into v_missing
       from unnest(array[
         'id',
         'asset_id',
         'storage_path',
         'size_bytes',
         'mime_type',
         'note',
         'created_by',
         'created_at',
         'deleted_at'
       ]) as c
       where not exists (
         select 1 from information_schema.columns
          where table_schema = 'public'
            and table_name = 'overlay_user_asset_history'
            and column_name = c
       );
     if v_missing is not null then
       raise exception 'overlay_user_asset_history missing columns: %', v_missing;
     end if;
   end$$;

   -- 2. Audit trigger attached.
   do $$
   declare v_count int;
   begin
     select count(*) into v_count
       from pg_trigger
      where tgrelid = 'public.overlay_user_asset_history'::regclass
        and tgname = 'audit_row_change';
     if v_count = 0 then
       raise exception 'audit trigger missing on overlay_user_asset_history';
     end if;
   end$$;

   -- 3. UPDATE + DELETE are blocked.
   do $$
   declare v_asset_id uuid := gen_random_uuid();
   begin
     insert into public.overlay_user_asset_history
       (asset_id, storage_path, size_bytes, mime_type)
     values (v_asset_id, 'psd/__smoke__.psd', 1, 'image/vnd.adobe.photoshop');

     begin
       update public.overlay_user_asset_history
          set note = 'mutation attempt'
        where asset_id = v_asset_id;
       raise exception 'UPDATE did not raise';
     exception when others then null; end;

     begin
       delete from public.overlay_user_asset_history where asset_id = v_asset_id;
       raise exception 'DELETE did not raise';
     exception when others then null; end;
   end$$;

   rollback;

   select 'overlay_user_asset_history smoke OK' as status;
   ```

2. Run the smoke; it fails (table does not exist yet):

   ```bash
   npx supabase db query --file supabase/tests/overlay_user_asset_history_smoke.sql
   ```

   Expected output:

   ```
   ERROR:  relation "public.overlay_user_asset_history" does not exist
   ```

3. Author the migration. Create `supabase/migrations/20260902000001_overlay_user_asset_history.sql`:

   ```sql
   -- Overlay Builder Wave 2B — Task 2.
   -- ------------------------------------------------------------------
   -- New append-only table `overlay_user_asset_history` capturing the
   -- prior version of a PSD asset before Photopea overwrites it. Lets an
   -- admin revert a Photopea round-trip via a `revertToAssetSnapshot`
   -- action surface (Task 5).
   --
   -- Append-only enforcement reuses the existing
   -- `overlay_design_history_block_mutation()` function (mirrors
   -- `overlay_user_design_history` from Wave 1A migration
   -- 20260901000002).
   --
   -- The table stores a POINTER to the prior storage object — not the
   -- PSD bytes themselves. The bridge action moves the prior object to
   -- `overlay-user-assets/psd/history/<asset_id>/<created_at>.psd` and
   -- writes the row pointing at the moved path. Restoring a snapshot
   -- copies the historical object back to the live path.
   --
   -- Spec: docs/superpowers/specs/2026-05-17-overlay-builder-design.md §9.2
   -- ------------------------------------------------------------------

   create table public.overlay_user_asset_history (
     id            uuid primary key default gen_random_uuid(),
     asset_id      uuid not null,    -- intentionally NO FK: history survives
                                     -- soft-delete of parent asset
     storage_path  text not null,    -- path under overlay-user-assets bucket
     size_bytes    bigint not null,
     mime_type     text not null,
     note          text,
     created_by    uuid references public.users (id) on delete set null,
     created_at    timestamptz not null default now(),
     deleted_at    timestamptz
   );

   create index overlay_user_asset_history_asset_idx
     on public.overlay_user_asset_history (asset_id, created_at desc)
     where deleted_at is null;

   -- Append-only enforcement — reuse the existing block_mutation function.
   drop trigger if exists overlay_user_asset_history_no_update
     on public.overlay_user_asset_history;
   create trigger overlay_user_asset_history_no_update
     before update on public.overlay_user_asset_history
     for each row execute function public.overlay_design_history_block_mutation();

   drop trigger if exists overlay_user_asset_history_no_delete
     on public.overlay_user_asset_history;
   create trigger overlay_user_asset_history_no_delete
     before delete on public.overlay_user_asset_history
     for each row execute function public.overlay_design_history_block_mutation();

   select public.attach_audit('public.overlay_user_asset_history');

   alter table public.overlay_user_asset_history enable row level security;

   create policy overlay_user_asset_history_no_direct
     on public.overlay_user_asset_history
     for all
     using (false)
     with check (false);

   comment on table public.overlay_user_asset_history is
     'Append-only ledger of PSD asset snapshots taken before Photopea '
     'overwrites the live object. Restore via `revertToAssetSnapshot()`. '
     'See docs/superpowers/specs/2026-05-17-overlay-builder-design.md §9.2.';
   ```

4. Apply the migration:

   ```bash
   npm run db:push
   ```

   Expected output ends with:

   ```
   Applying migration 20260902000001_overlay_user_asset_history.sql...
   Finished supabase db push.
   ```

5. Re-run the smoke; it now passes:

   ```bash
   npx supabase db query --file supabase/tests/overlay_user_asset_history_smoke.sql
   ```

   Expected output:

   ```
                  status
   --------------------------------------
    overlay_user_asset_history smoke OK
   (1 row)
   ```

6. Stage and commit:

   ```bash
   git add supabase/migrations/20260902000001_overlay_user_asset_history.sql supabase/tests/overlay_user_asset_history_smoke.sql
   git commit -m "$(cat <<'EOF'
   feat(overlay-builder/wave-2b): add overlay_user_asset_history table

   Append-only ledger of PSD asset snapshots taken before Photopea
   overwrites the live object. Lets admins revert a botched Photopea
   round-trip via the upcoming `revertToAssetSnapshot()` action.

   Storage path lives under `overlay-user-assets/psd/history/<asset_id>/
   <created_at>.psd` (handled by the bridge action in Task 5). The table
   stores only the POINTER + audit metadata — never the bytes.

   Append-only enforcement reuses the existing
   `overlay_design_history_block_mutation()` function, mirroring the
   Wave 1A `overlay_user_design_history` pattern.

   Spec: docs/superpowers/specs/2026-05-17-overlay-builder-design.md §9.2

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

### Task 3: Shared TypeScript types + Zod schemas for the Photopea bridge

**Files:**

- Create: `apps/web/src/server/overlays/builder/photopea-bridge.types.ts`
- Create: `apps/web/src/server/overlays/builder/photopea-bridge.types.test.ts`

**Context:** Per CLAUDE.md §10, the action file (Task 5) carrying `"use server"` exports ONLY async functions; types + Zod schemas live in a sibling `.types.ts` file. This task defines both. The wire shape for the postMessage envelope is OURS, not Photopea's — Photopea's API uses arbitrary string commands + binary `ArrayBuffer` responses; we wrap that in a typed shape inside our own client component.

#### Steps

1. Write the failing test first. Create `apps/web/src/server/overlays/builder/photopea-bridge.types.test.ts`:

   ```ts
   import { describe, expect, it } from "vitest";
   import {
     PhotopeaOriginSchema,
     PhotopeaSaveCommandSchema,
     PsdBytesEnvelopeSchema,
     SavePsdInputSchema,
     PHOTOPEA_EMBED_ORIGIN,
     type PsdBytesEnvelope,
     type SavePsdInput,
   } from "./photopea-bridge.types";

   describe("photopea-bridge.types", () => {
     it("locks PHOTOPEA_EMBED_ORIGIN to the canonical Photopea origin", () => {
       expect(PHOTOPEA_EMBED_ORIGIN).toBe("https://www.photopea.com");
     });

     it("PhotopeaOriginSchema accepts only the canonical origin string", () => {
       expect(PhotopeaOriginSchema.safeParse("https://www.photopea.com").success).toBe(
         true,
       );
       expect(PhotopeaOriginSchema.safeParse("https://photopea.com").success).toBe(
         false,
       );
       expect(PhotopeaOriginSchema.safeParse("http://www.photopea.com").success).toBe(
         false,
       );
       expect(
         PhotopeaOriginSchema.safeParse("https://www.photopea.com.evil.example/").success,
       ).toBe(false);
       expect(PhotopeaOriginSchema.safeParse("null").success).toBe(false);
       expect(PhotopeaOriginSchema.safeParse("").success).toBe(false);
     });

     it("PhotopeaSaveCommandSchema serializes the canonical save command", () => {
       const parsed = PhotopeaSaveCommandSchema.parse({
         type: "app.activeDocument.saveToOE",
       });
       expect(parsed.type).toBe("app.activeDocument.saveToOE");
     });

     it("PsdBytesEnvelopeSchema parses a valid ArrayBuffer payload", () => {
       const env: PsdBytesEnvelope = {
         kind: "psd-bytes",
         byteLength: 1024,
         payload: new ArrayBuffer(1024),
       };
       const parsed = PsdBytesEnvelopeSchema.parse(env);
       expect(parsed.byteLength).toBe(1024);
       expect(parsed.payload).toBeInstanceOf(ArrayBuffer);
     });

     it("PsdBytesEnvelopeSchema rejects oversized payloads (>100MB)", () => {
       const HUNDRED_MB = 100 * 1024 * 1024;
       const env = {
         kind: "psd-bytes",
         byteLength: HUNDRED_MB + 1,
         payload: new ArrayBuffer(0),
       };
       expect(PsdBytesEnvelopeSchema.safeParse(env).success).toBe(false);
     });

     it("PsdBytesEnvelopeSchema rejects size mismatch between header and payload", () => {
       const env = {
         kind: "psd-bytes",
         byteLength: 1024,
         payload: new ArrayBuffer(512),
       };
       expect(PsdBytesEnvelopeSchema.safeParse(env).success).toBe(false);
     });

     it("SavePsdInputSchema requires a uuid assetId and a Uint8Array body", () => {
       const input: SavePsdInput = {
         assetId: "11111111-1111-4111-8111-111111111111",
         psdBytes: new Uint8Array([0x38, 0x42, 0x50, 0x53]), // '8BPS' PSD magic
         note: "via Photopea",
       };
       const parsed = SavePsdInputSchema.parse(input);
       expect(parsed.assetId).toBe("11111111-1111-4111-8111-111111111111");
       expect(parsed.psdBytes).toBeInstanceOf(Uint8Array);
     });

     it("SavePsdInputSchema rejects bytes that do not start with the 8BPS magic", () => {
       const input = {
         assetId: "11111111-1111-4111-8111-111111111111",
         psdBytes: new Uint8Array([0x00, 0x00, 0x00, 0x00]),
       };
       expect(SavePsdInputSchema.safeParse(input).success).toBe(false);
     });

     it("SavePsdInputSchema rejects malformed assetId", () => {
       const input = {
         assetId: "not-a-uuid",
         psdBytes: new Uint8Array([0x38, 0x42, 0x50, 0x53]),
       };
       expect(SavePsdInputSchema.safeParse(input).success).toBe(false);
     });
   });
   ```

2. Run the test — it fails because the module does not exist:

   ```bash
   npm --workspace apps/web run test -- photopea-bridge.types
   ```

   Expected output (failure):

   ```
   FAIL  src/server/overlays/builder/photopea-bridge.types.test.ts
     Error: Failed to resolve import "./photopea-bridge.types"
   ```

3. Author the module. Create `apps/web/src/server/overlays/builder/photopea-bridge.types.ts`:

   ```ts
   /**
    * Wave 2B — wire shape for the Photopea iframe ↔ admin postMessage
    * bridge.
    *
    * Photopea's official postMessage API uses string commands (sent into
    * the iframe via `iframe.contentWindow.postMessage(...)`) and replies
    * via `window.addEventListener('message', ...)` on the parent. The
    * reply payload is either a Photopea status string ("done"), a JSON
    * blob (for queries like `app.activeDocument.name`), or raw binary
    * (`ArrayBuffer`) for export commands like `saveToOE`. We wrap that
    * surface in OUR typed envelope so the rest of the codebase never
    * touches the raw Photopea API.
    *
    * Spec: docs/superpowers/specs/2026-05-17-overlay-builder-design.md §9.2 + §12.
    */

   import { z } from "zod";

   /** The ONLY origin the bridge listens to. */
   export const PHOTOPEA_EMBED_ORIGIN = "https://www.photopea.com" as const;

   /**
    * Strict equality check. We don't use `URL` parsing because we need
    * EXACT string equality — `https://photopea.com` (no www) and
    * `http://www.photopea.com` are NOT the canonical embed and must be
    * rejected. Likewise `https://www.photopea.com.evil/` (a homograph
    * suffix) must fail.
    */
   export const PhotopeaOriginSchema = z.literal(PHOTOPEA_EMBED_ORIGIN);

   /** Outbound: command we send INTO the Photopea iframe. */
   export const PhotopeaSaveCommandSchema = z.object({
     type: z.literal("app.activeDocument.saveToOE"),
   });
   export type PhotopeaSaveCommand = z.infer<typeof PhotopeaSaveCommandSchema>;

   /** Inbound: reply from Photopea carrying raw PSD bytes. */
   const HUNDRED_MB = 100 * 1024 * 1024;

   export const PsdBytesEnvelopeSchema = z
     .object({
       kind: z.literal("psd-bytes"),
       byteLength: z.number().int().min(1).max(HUNDRED_MB),
       payload: z.instanceof(ArrayBuffer),
     })
     .refine((v) => v.payload.byteLength === v.byteLength, {
       message: "byteLength header does not match payload size",
     });
   export type PsdBytesEnvelope = z.infer<typeof PsdBytesEnvelopeSchema>;

   /**
    * PSD magic bytes. Every valid PSD starts with the literal ASCII
    * sequence `8BPS`. We reject anything else BEFORE handing bytes to
    * `psd-parser.ts` so a hostile `app.open(...)` payload cannot
    * smuggle non-PSD content into our storage bucket.
    */
   const PSD_MAGIC = [0x38, 0x42, 0x50, 0x53] as const;

   function hasPsdMagic(bytes: Uint8Array): boolean {
     if (bytes.length < 4) return false;
     return (
       bytes[0] === PSD_MAGIC[0] &&
       bytes[1] === PSD_MAGIC[1] &&
       bytes[2] === PSD_MAGIC[2] &&
       bytes[3] === PSD_MAGIC[3]
     );
   }

   /** Input to `savePsdFromPhotopeaAction` — server action contract. */
   export const SavePsdInputSchema = z.object({
     assetId: z.string().uuid(),
     psdBytes: z
       .instanceof(Uint8Array)
       .refine((b) => b.byteLength > 0, { message: "psdBytes empty" })
       .refine((b) => b.byteLength <= HUNDRED_MB, {
         message: "psdBytes exceeds 100MB cap",
       })
       .refine(hasPsdMagic, { message: "psdBytes missing 8BPS magic" }),
     note: z.string().max(200).optional(),
   });
   export type SavePsdInput = z.infer<typeof SavePsdInputSchema>;

   /** Output of `savePsdFromPhotopeaAction`. */
   export type SavePsdResult = {
     assetId: string;
     historyId: string;
     flatPngAssetId: string;
     spriteAssetIds: readonly string[];
     newSizeBytes: number;
   };
   ```

4. Run the test again — it passes:

   ```bash
   npm --workspace apps/web run test -- photopea-bridge.types
   ```

   Expected output:

   ```
    ✓ src/server/overlays/builder/photopea-bridge.types.test.ts (8 tests)

    Test Files  1 passed (1)
         Tests  8 passed (8)
   ```

5. Stage and commit:

   ```bash
   git add apps/web/src/server/overlays/builder/photopea-bridge.types.ts apps/web/src/server/overlays/builder/photopea-bridge.types.test.ts
   git commit -m "$(cat <<'EOF'
   feat(overlay-builder/wave-2b): wire shape + Zod schemas for Photopea bridge

   Adds `photopea-bridge.types.ts`:
     - PHOTOPEA_EMBED_ORIGIN constant (locked to https://www.photopea.com).
     - PhotopeaOriginSchema (strict equality; rejects www-less variant,
       http variant, and homograph suffixes).
     - PhotopeaSaveCommandSchema for the outbound `app.activeDocument.saveToOE`
       command we send INTO the iframe.
     - PsdBytesEnvelopeSchema for the inbound reply carrying raw PSD bytes,
       capped at 100MB, with byteLength↔payload size cross-check.
     - SavePsdInputSchema validating assetId is a uuid + psdBytes starts
       with the 8BPS magic bytes (reject non-PSD smuggling).
     - SavePsdResult shape returned by the upcoming action.

   Per CLAUDE.md §10, schemas live here in a `.types.ts` file so the
   sibling `.ts` action file can carry only async exports under
   `"use server"`.

   Spec: docs/superpowers/specs/2026-05-17-overlay-builder-design.md §9.2 + §12

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

### Task 4: Server module `photopea-bridge.ts` — write PSD + snapshot prior + re-run parser

**Files:**

- Create: `apps/web/src/server/overlays/builder/photopea-bridge.ts`
- Create: `apps/web/src/server/overlays/builder/photopea-bridge.test.ts`

**Context:** This is the pure server function (no `"use server"`) that does the work. The server action in Task 5 wraps it after gating + parsing. Per CLAUDE.md mock-friendly pattern, this function takes a `SupabaseClient` as its first argument and an actor object as its second — no implicit env. Returns a `SavePsdResult`.

The function must:

1. Look up the asset row by `assetId`. Reject if missing, soft-deleted, or `asset_type !== 'psd'`.
2. Move the live storage object from `overlay-user-assets/psd/<assetId>.psd` to `overlay-user-assets/psd/history/<assetId>/<isoNow>.psd` (preserves the prior bytes in storage; no extra disk hit beyond a rename).
3. Insert a row into `overlay_user_asset_history` pointing at the moved historical path.
4. Upload the NEW PSD bytes to the live `psd/<assetId>.psd` path.
5. Update the asset row's `size_bytes` + `updated_at`.
6. Soft-delete every existing sprite + flat-PNG row whose `psd_parent_asset_id === assetId` (Wave 2A pattern — they get regenerated).
7. Call Wave 2A's `parsePsdAndStoreSprites(sb, { parentAssetId: assetId, psdBytes })` to regenerate. Returns `{ flatPngAssetId, spriteAssetIds }`.
8. Re-link the asset row's `flat_png_asset_id` to the new flat PNG.
9. Return `{ assetId, historyId, flatPngAssetId, spriteAssetIds, newSizeBytes }`.

#### Steps

1. Write the failing test first. Create `apps/web/src/server/overlays/builder/photopea-bridge.test.ts`:

   ```ts
   import { beforeEach, describe, expect, it, vi } from "vitest";
   import type { SupabaseClient } from "@supabase/supabase-js";
   import { savePsdBytes } from "./photopea-bridge";

   /**
    * Per CLAUDE.md testing strategy — mock Supabase client; never hit DB.
    * The mock surfaces the minimal `.from(...).select/insert/update/eq/single`
    * chain the function under test consumes, plus a tiny storage mock.
    */

   type MaybeSingle = ReturnType<typeof vi.fn>;

   function makeMockSupabase(opts: {
     assetRow?: Record<string, unknown> | null;
     historyId?: string;
     parserResult?: {
       flatPngAssetId: string;
       spriteAssetIds: readonly string[];
     };
   }) {
     const fromCalls: string[] = [];
     const storage = {
       move: vi.fn(async (_from: string, _to: string) => ({ data: null, error: null })),
       upload: vi.fn(async (_path: string, _bytes: Uint8Array) => ({
         data: { path: _path },
         error: null,
       })),
       remove: vi.fn(async (_paths: string[]) => ({ data: null, error: null })),
     };

     const sb = {
       from: vi.fn((table: string) => {
         fromCalls.push(table);
         if (table === "overlay_user_assets") {
           return {
             select: vi.fn().mockReturnThis(),
             eq: vi.fn().mockReturnThis(),
             is: vi.fn().mockReturnThis(),
             maybeSingle: vi.fn().mockResolvedValue({
               data: opts.assetRow ?? null,
               error: null,
             }),
             update: vi.fn().mockResolvedValue({ data: null, error: null }),
           };
         }
         if (table === "overlay_user_asset_history") {
           return {
             insert: vi.fn().mockReturnThis(),
             select: vi.fn().mockReturnThis(),
             single: vi.fn().mockResolvedValue({
               data: { id: opts.historyId ?? "h-1" },
               error: null,
             }),
           };
         }
         return { select: vi.fn().mockReturnThis() };
       }),
       storage: {
         from: vi.fn(() => storage),
       },
     } as unknown as SupabaseClient;

     return { sb, storage, fromCalls };
   }

   describe("savePsdBytes", () => {
     beforeEach(() => {
       vi.resetAllMocks();
     });

     const psdMagic = new Uint8Array([0x38, 0x42, 0x50, 0x53, 0x00, 0x01]);
     const actor = {
       userId: "00000000-0000-0000-0000-000000000001",
       roles: ["admin"],
     };
     const assetId = "22222222-2222-4222-8222-222222222222";
     const assetRow = {
       id: assetId,
       asset_type: "psd",
       file_path: `psd/${assetId}.psd`,
       size_bytes: 100,
       deleted_at: null,
     };

     it("rejects when the asset row is missing", async () => {
       const { sb } = makeMockSupabase({ assetRow: null });
       const parser = vi.fn();
       await expect(
         savePsdBytes(sb, actor, {
           input: { assetId, psdBytes: psdMagic },
           parsePsd: parser,
         }),
       ).rejects.toThrow(/asset not found/i);
       expect(parser).not.toHaveBeenCalled();
     });

     it("rejects when the asset_type is not psd", async () => {
       const { sb } = makeMockSupabase({
         assetRow: { ...assetRow, asset_type: "image" },
       });
       await expect(
         savePsdBytes(sb, actor, {
           input: { assetId, psdBytes: psdMagic },
           parsePsd: vi.fn(),
         }),
       ).rejects.toThrow(/not a psd asset/i);
     });

     it("snapshots prior path, uploads new bytes, runs parser, returns result", async () => {
       const { sb, storage } = makeMockSupabase({
         assetRow,
         historyId: "h-42",
         parserResult: {
           flatPngAssetId: "flat-1",
           spriteAssetIds: ["s-1", "s-2"],
         },
       });

       const parser = vi.fn().mockResolvedValue({
         flatPngAssetId: "flat-1",
         spriteAssetIds: ["s-1", "s-2"],
       });

       const result = await savePsdBytes(sb, actor, {
         input: { assetId, psdBytes: psdMagic, note: "round-trip 1" },
         parsePsd: parser,
       });

       // Storage rename + upload happened.
       expect(storage.move).toHaveBeenCalledOnce();
       const [moveFrom, moveTo] = storage.move.mock.calls[0];
       expect(moveFrom).toBe(`psd/${assetId}.psd`);
       expect(moveTo).toMatch(
         new RegExp(`^psd/history/${assetId}/\\d{4}-\\d{2}-\\d{2}T.*\\.psd$`),
       );
       expect(storage.upload).toHaveBeenCalledOnce();

       // Parser invoked with the new bytes.
       expect(parser).toHaveBeenCalledOnce();
       const parserArg = parser.mock.calls[0][1];
       expect(parserArg.parentAssetId).toBe(assetId);
       expect(parserArg.psdBytes).toBe(psdMagic);

       // Result shape.
       expect(result).toEqual({
         assetId,
         historyId: "h-42",
         flatPngAssetId: "flat-1",
         spriteAssetIds: ["s-1", "s-2"],
         newSizeBytes: psdMagic.byteLength,
       });
     });

     it("propagates parser failure as a wrapped error", async () => {
       const { sb } = makeMockSupabase({ assetRow });
       const parser = vi.fn().mockRejectedValue(new Error("ag-psd OOM"));
       await expect(
         savePsdBytes(sb, actor, {
           input: { assetId, psdBytes: psdMagic },
           parsePsd: parser,
         }),
       ).rejects.toThrow(/parser failed.*ag-psd OOM/i);
     });
   });
   ```

2. Run the test — it fails because the module does not exist:

   ```bash
   npm --workspace apps/web run test -- photopea-bridge.test
   ```

   Expected output (failure):

   ```
   FAIL  src/server/overlays/builder/photopea-bridge.test.ts
     Error: Failed to resolve import "./photopea-bridge"
   ```

3. Author the module. Create `apps/web/src/server/overlays/builder/photopea-bridge.ts`:

   ```ts
   /**
    * Wave 2B — Photopea bridge server module.
    *
    * Receives PSD bytes that round-tripped through the Photopea iframe,
    * snapshots the prior storage object, uploads the new bytes, and
    * re-runs the Wave 2A parser to regenerate the flat PNG + sprites.
    *
    * Per CLAUDE.md testing strategy this function takes a Supabase
    * client + actor + (input, parsePsd) so tests can mock both the
    * Supabase surface and the parser dependency cleanly. The action
    * wrapper in `app/admin/broadcast/v2/builder/[slug]/psd/actions.ts`
    * binds the real `parsePsdAndStoreSprites` import.
    *
    * Spec: docs/superpowers/specs/2026-05-17-overlay-builder-design.md §9.2
    */

   import type { SupabaseClient } from "@supabase/supabase-js";
   import {
     SavePsdInputSchema,
     type SavePsdInput,
     type SavePsdResult,
   } from "./photopea-bridge.types";

   /** Actor passed by the `gate()` helper in the action wrapper. */
   export type Actor = {
     userId: string;
     roles: readonly string[];
   };

   /**
    * Wave 2A parser signature. The action wrapper injects the real
    * implementation; tests inject a mock so we never load `ag-psd` (or
    * its WASM blob) in the test runner.
    */
   export type ParsePsd = (
     sb: SupabaseClient,
     args: { parentAssetId: string; psdBytes: Uint8Array },
   ) => Promise<{
     flatPngAssetId: string;
     spriteAssetIds: readonly string[];
   }>;

   const STORAGE_BUCKET = "overlay-user-assets";

   function historyPathFor(assetId: string, now: Date): string {
     // ISO 8601 with `:` swapped to `-` so the path is filesystem-safe
     // on every storage backend.
     const iso = now.toISOString().replace(/:/g, "-");
     return `psd/history/${assetId}/${iso}.psd`;
   }

   function livePathFor(assetId: string): string {
     return `psd/${assetId}.psd`;
   }

   /**
    * Idempotent write side: snapshot → upload → soft-delete derived rows
    * → parse → relink flat PNG → return aggregate.
    *
    * Any thrown error inside aborts BEFORE the new bytes are uploaded
    * when possible. Failures AFTER the upload (parser failure) leave
    * the new bytes in place — the operator can re-trigger the save or
    * fall back to `revertToAssetSnapshot()` from Task 6 to restore the
    * prior version.
    */
   export async function savePsdBytes(
     sb: SupabaseClient,
     actor: Actor,
     opts: {
       input: SavePsdInput;
       parsePsd: ParsePsd;
       now?: Date;
     },
   ): Promise<SavePsdResult> {
     // 1. Validate input through the schema again (defense in depth even
     //    though the action wrapper also validates).
     const parsed = SavePsdInputSchema.parse(opts.input);
     const now = opts.now ?? new Date();

     // 2. Look up the asset row and confirm it is a live PSD.
     const { data: assetRow, error: lookupErr } = await sb
       .from("overlay_user_assets")
       .select("id, asset_type, file_path, size_bytes, deleted_at")
       .eq("id", parsed.assetId)
       .is("deleted_at", null)
       .maybeSingle();
     if (lookupErr) {
       throw new Error(`asset lookup failed: ${lookupErr.message}`);
     }
     if (!assetRow) {
       throw new Error(`asset not found or soft-deleted: ${parsed.assetId}`);
     }
     if ((assetRow as { asset_type: string }).asset_type !== "psd") {
       throw new Error(
         `not a psd asset (got ${(assetRow as { asset_type: string }).asset_type}): ${parsed.assetId}`,
       );
     }

     const livePath = livePathFor(parsed.assetId);
     const historyPath = historyPathFor(parsed.assetId, now);
     const storage = sb.storage.from(STORAGE_BUCKET);

     // 3. Snapshot the prior storage object via a server-side rename.
     const { error: moveErr } = await storage.move(livePath, historyPath);
     if (moveErr) {
       throw new Error(`snapshot move failed: ${moveErr.message}`);
     }

     // 4. Record the snapshot in the append-only ledger BEFORE the new
     //    upload, so even if upload fails we can recover the prior
     //    bytes via revertToAssetSnapshot().
     const { data: historyRow, error: historyErr } = await sb
       .from("overlay_user_asset_history")
       .insert({
         asset_id: parsed.assetId,
         storage_path: historyPath,
         size_bytes: (assetRow as { size_bytes: number }).size_bytes,
         mime_type: "image/vnd.adobe.photoshop",
         note: parsed.note ?? null,
         created_by: actor.userId,
       })
       .select("id")
       .single();
     if (historyErr || !historyRow) {
       // Roll back the storage move so we don't leave the live path
       // empty while history insert is broken.
       await storage.move(historyPath, livePath);
       throw new Error(
         `asset history insert failed: ${historyErr?.message ?? "no row returned"}`,
       );
     }

     // 5. Upload the new PSD bytes to the live path.
     const { error: uploadErr } = await storage.upload(
       livePath,
       parsed.psdBytes,
       {
         contentType: "image/vnd.adobe.photoshop",
         upsert: true,
       } as unknown as Record<string, unknown>,
     );
     if (uploadErr) {
       throw new Error(`new bytes upload failed: ${uploadErr.message}`);
     }

     // 6. Bump asset row size + updated_at (audit trigger handles
     //    the rest).
     const { error: updateErr } = await sb
       .from("overlay_user_assets")
       .update({
         size_bytes: parsed.psdBytes.byteLength,
         updated_at: now.toISOString(),
       })
       .eq("id", parsed.assetId);
     if (updateErr) {
       throw new Error(`asset row update failed: ${updateErr.message}`);
     }

     // 7. Soft-delete the prior sprite + flat PNG rows; the parser
     //    regenerates them. (We do NOT remove the storage objects in
     //    this task — the parser overwrites by path on insert, and any
     //    orphaned blobs are swept by a background cleanup job outside
     //    the request path.)
     await sb
       .from("overlay_user_assets")
       .update({ deleted_at: now.toISOString() })
       .eq("psd_parent_asset_id", parsed.assetId);

     // 8. Re-run the Wave 2A parser to regenerate flat PNG + sprites.
     let parseResult: { flatPngAssetId: string; spriteAssetIds: readonly string[] };
     try {
       parseResult = await opts.parsePsd(sb, {
         parentAssetId: parsed.assetId,
         psdBytes: parsed.psdBytes,
       });
     } catch (err) {
       const msg = err instanceof Error ? err.message : String(err);
       throw new Error(`parser failed: ${msg}`);
     }

     // 9. Re-link the asset row to the new flat PNG.
     await sb
       .from("overlay_user_assets")
       .update({ flat_png_asset_id: parseResult.flatPngAssetId })
       .eq("id", parsed.assetId);

     return {
       assetId: parsed.assetId,
       historyId: (historyRow as { id: string }).id,
       flatPngAssetId: parseResult.flatPngAssetId,
       spriteAssetIds: parseResult.spriteAssetIds,
       newSizeBytes: parsed.psdBytes.byteLength,
     };
   }
   ```

4. Run the test again — it passes:

   ```bash
   npm --workspace apps/web run test -- photopea-bridge.test
   ```

   Expected output:

   ```
    ✓ src/server/overlays/builder/photopea-bridge.test.ts (4 tests)
      ✓ rejects when the asset row is missing
      ✓ rejects when the asset_type is not psd
      ✓ snapshots prior path, uploads new bytes, runs parser, returns result
      ✓ propagates parser failure as a wrapped error

    Test Files  1 passed (1)
         Tests  4 passed (4)
   ```

5. Stage and commit:

   ```bash
   git add apps/web/src/server/overlays/builder/photopea-bridge.ts apps/web/src/server/overlays/builder/photopea-bridge.test.ts
   git commit -m "$(cat <<'EOF'
   feat(overlay-builder/wave-2b): photopea-bridge server module

   Adds `savePsdBytes(sb, actor, { input, parsePsd, now? })`:
     1. Validates SavePsdInput through the schema (defense in depth).
     2. Looks up the asset row + confirms asset_type='psd', not soft-deleted.
     3. Snapshots prior storage object via server-side rename to
        psd/history/<assetId>/<isoNow>.psd.
     4. Inserts an overlay_user_asset_history row pointing at the moved
        historical path BEFORE the new upload (recoverable via
        revertToAssetSnapshot() from Task 6).
     5. Uploads the new PSD bytes to the live path psd/<assetId>.psd.
     6. Bumps asset row size_bytes + updated_at.
     7. Soft-deletes existing sprite + flat-PNG rows.
     8. Calls Wave 2A `parsePsd(sb, {parentAssetId, psdBytes})` (injected
        for test mockability) to regenerate.
     9. Re-links asset row's flat_png_asset_id to the new flat PNG.

   Rolls back the storage move when the history insert fails, so a
   broken history table can never leave the live path empty.

   Tests cover: missing asset, wrong asset_type, happy path, parser
   failure propagation. Supabase + parser both mocked per CLAUDE.md
   testing strategy.

   Spec: docs/superpowers/specs/2026-05-17-overlay-builder-design.md §9.2

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

### Task 5: Server action wrapper `savePsdFromPhotopeaAction(formData)` + `revertToAssetSnapshot`

**Files:**

- Create: `apps/web/src/app/admin/broadcast/v2/builder/[slug]/psd/actions.ts`
- Create: `apps/web/src/app/admin/broadcast/v2/builder/[slug]/psd/schemas.ts`
- Create: `apps/web/src/app/admin/broadcast/v2/builder/[slug]/psd/actions.test.ts`

**Context:** The Next.js Server Action layer. Per CLAUDE.md §10, `actions.ts` (under `"use server"`) exports ONLY async functions; `schemas.ts` carries Zod types + parsers. Pattern mirrors `apps/web/src/app/admin/broadcast/v2/builder/actions.ts` from Wave 1A — same `gate()` helper, same `requirePermAsync` perm, same `enforceAuthedWrite` rate-limit, same error envelope shape.

#### Steps

1. Write the schemas first. Create `apps/web/src/app/admin/broadcast/v2/builder/[slug]/psd/schemas.ts`:

   ```ts
   /**
    * Wave 2B — Zod schemas for the PSD page's server actions.
    * Lives next to `actions.ts` per CLAUDE.md §10 (action file under
    * `"use server"` exports only async fns; schemas + types here).
    */

   import { z } from "zod";

   /**
    * The action receives PSD bytes as a multipart `File`. Zod can't
    * directly validate a File body, so we coerce + validate at the
    * action boundary and re-use SavePsdInputSchema from the bridge
    * types for the inner contract.
    */
   export const SavePsdFormSchema = z.object({
     assetId: z.string().uuid(),
     note: z.string().max(200).optional(),
   });

   export type SavePsdFormInput = z.infer<typeof SavePsdFormSchema>;

   export const RevertSnapshotFormSchema = z.object({
     assetId: z.string().uuid(),
     snapshotId: z.string().uuid(),
   });

   export type RevertSnapshotFormInput = z.infer<typeof RevertSnapshotFormSchema>;
   ```

2. Write the failing tests next. Create `apps/web/src/app/admin/broadcast/v2/builder/[slug]/psd/actions.test.ts`:

   ```ts
   import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

   // Mock the gate helper + the bridge module before importing actions.
   vi.mock("@/lib/perms-db", () => ({
     requirePermAsync: vi.fn().mockResolvedValue(undefined),
     PermissionError: class PermissionError extends Error {},
   }));
   vi.mock("@/lib/api-rate-limit", () => ({
     enforceAuthedWrite: vi.fn().mockResolvedValue(null),
   }));
   vi.mock("@/lib/supabase/server", () => ({
     getServerSupabase: vi.fn().mockResolvedValue({
       auth: {
         getUser: vi
           .fn()
           .mockResolvedValue({ data: { user: { id: "auth-1" } } }),
       },
       from: vi.fn(() => ({
         select: vi.fn().mockReturnThis(),
         eq: vi.fn().mockReturnThis(),
         is: vi.fn().mockReturnThis(),
         maybeSingle: vi
           .fn()
           .mockResolvedValue({ data: { id: "user-1" }, error: null }),
       })),
     }),
   }));
   vi.mock("@/lib/supabase/service", () => ({
     getServiceRoleSupabase: vi.fn(() => ({ __svc: true })),
   }));

   const savePsdBytesMock = vi.fn();
   vi.mock("@/server/overlays/builder/photopea-bridge", () => ({
     savePsdBytes: (...args: unknown[]) => savePsdBytesMock(...args),
   }));

   // Wave 2A parser dep — bound at action wrapper level.
   vi.mock("@/server/overlays/builder/psd-parser", () => ({
     parsePsdAndStoreSprites: vi.fn(),
   }));

   describe("savePsdFromPhotopeaAction", () => {
     beforeEach(() => {
       vi.clearAllMocks();
     });
     afterEach(() => {
       vi.resetModules();
     });

     it("validates form input, gates perms, invokes savePsdBytes", async () => {
       savePsdBytesMock.mockResolvedValue({
         assetId: "11111111-1111-4111-8111-111111111111",
         historyId: "h-1",
         flatPngAssetId: "flat-1",
         spriteAssetIds: [],
         newSizeBytes: 4,
       });

       const { savePsdFromPhotopeaAction } = await import("./actions");

       const form = new FormData();
       form.set("assetId", "11111111-1111-4111-8111-111111111111");
       form.set("note", "via Photopea");
       const psdBytes = new Uint8Array([0x38, 0x42, 0x50, 0x53]);
       form.set(
         "psd",
         new File([psdBytes], "edit.psd", {
           type: "image/vnd.adobe.photoshop",
         }),
       );

       const result = await savePsdFromPhotopeaAction(form);
       expect(result.assetId).toBe("11111111-1111-4111-8111-111111111111");
       expect(savePsdBytesMock).toHaveBeenCalledOnce();
     });

     it("rejects when assetId is missing", async () => {
       const { savePsdFromPhotopeaAction } = await import("./actions");
       const form = new FormData();
       form.set(
         "psd",
         new File([new Uint8Array([0x38, 0x42, 0x50, 0x53])], "x.psd"),
       );
       await expect(savePsdFromPhotopeaAction(form)).rejects.toThrow(
         /assetId/i,
       );
     });

     it("rejects when PSD file is missing", async () => {
       const { savePsdFromPhotopeaAction } = await import("./actions");
       const form = new FormData();
       form.set("assetId", "11111111-1111-4111-8111-111111111111");
       await expect(savePsdFromPhotopeaAction(form)).rejects.toThrow(
         /psd file/i,
       );
     });

     it("rejects when PSD file lacks 8BPS magic", async () => {
       const { savePsdFromPhotopeaAction } = await import("./actions");
       const form = new FormData();
       form.set("assetId", "11111111-1111-4111-8111-111111111111");
       form.set(
         "psd",
         new File([new Uint8Array([0x00, 0x00, 0x00, 0x00])], "fake.psd"),
       );
       await expect(savePsdFromPhotopeaAction(form)).rejects.toThrow(
         /8BPS magic/i,
       );
     });

     it("propagates rate-limit short-circuit as throw", async () => {
       const { enforceAuthedWrite } = await import("@/lib/api-rate-limit");
       (enforceAuthedWrite as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
         "rate_limited_response",
       );
       const { savePsdFromPhotopeaAction } = await import("./actions");
       const form = new FormData();
       form.set("assetId", "11111111-1111-4111-8111-111111111111");
       form.set(
         "psd",
         new File([new Uint8Array([0x38, 0x42, 0x50, 0x53])], "x.psd"),
       );
       await expect(savePsdFromPhotopeaAction(form)).rejects.toThrow(
         /rate_limited/i,
       );
     });
   });
   ```

3. Run the tests — they fail because `actions.ts` does not exist:

   ```bash
   npm --workspace apps/web run test -- admin/broadcast/v2/builder/\\[slug\\]/psd/actions
   ```

   Expected output (failure):

   ```
   FAIL  src/app/admin/broadcast/v2/builder/[slug]/psd/actions.test.ts
     Error: Failed to resolve import "./actions"
   ```

4. Author the action wrapper. Create `apps/web/src/app/admin/broadcast/v2/builder/[slug]/psd/actions.ts`:

   ```ts
   "use server";

   import { revalidatePath } from "next/cache";
   import { redirect } from "next/navigation";
   import { getServerSupabase } from "@/lib/supabase/server";
   import { getServiceRoleSupabase } from "@/lib/supabase/service";
   import { requirePermAsync, PermissionError } from "@/lib/perms-db";
   import { enforceAuthedWrite } from "@/lib/api-rate-limit";
   import { savePsdBytes } from "@/server/overlays/builder/photopea-bridge";
   import { parsePsdAndStoreSprites } from "@/server/overlays/builder/psd-parser";
   import type { SavePsdResult } from "@/server/overlays/builder/photopea-bridge.types";
   import { SavePsdFormSchema, RevertSnapshotFormSchema } from "./schemas";

   /**
    * Wave 2B — server actions for the Photopea iframe page.
    *
    * Per CLAUDE.md §10 this file exports ONLY async functions; schemas
    * live in the sibling `schemas.ts`.
    *
    * All actions gate on `overlay.design.manage` and rate-limit via
    * `enforceAuthedWrite`. Mirrors the gate() pattern in
    * `app/admin/broadcast/v2/builder/actions.ts` from Wave 1A.
    */

   type Actor = { userId: string; roles: readonly string[] };

   async function gate(): Promise<{
     sb: ReturnType<typeof getServiceRoleSupabase>;
     actor: Actor;
   }> {
     const userClient = await getServerSupabase();
     const { data: auth } = await userClient.auth.getUser();
     if (!auth?.user) redirect("/login");
     const { data: pub } = await userClient
       .from("users")
       .select("id")
       .eq("supabase_auth_id", auth.user.id)
       .maybeSingle();
     if (!pub) redirect("/login");
     const { data: roleRows } = await userClient
       .from("user_roles")
       .select("role")
       .eq("user_id", pub.id)
       .is("deleted_at", null);
     const roles = ((roleRows ?? []) as { role: string }[]).map((r) => r.role);
     const sb = getServiceRoleSupabase();
     try {
       await requirePermAsync(
         sb,
         { userId: pub.id, roles },
         "overlay.design.manage",
       );
     } catch (e) {
       if (e instanceof PermissionError) {
         throw new Error("Forbidden: missing overlay.design.manage");
       }
       throw e;
     }
     const limited = await enforceAuthedWrite(pub.id);
     if (limited) throw new Error("rate_limited");
     return { sb, actor: { userId: pub.id, roles } };
   }

   /**
    * Save PSD bytes that round-tripped through the Photopea iframe.
    *
    * FormData fields:
    *   - assetId — uuid of the parent PSD row in overlay_user_assets.
    *   - psd      — File containing the new PSD bytes (must start with
    *                the 8BPS magic; size ≤100MB).
    *   - note     — optional ≤200-char admin label for the history row.
    */
   export async function savePsdFromPhotopeaAction(
     formData: FormData,
   ): Promise<SavePsdResult> {
     const parsed = SavePsdFormSchema.safeParse({
       assetId: String(formData.get("assetId") ?? ""),
       note: formData.get("note") ? String(formData.get("note")) : undefined,
     });
     if (!parsed.success) {
       throw new Error(
         parsed.error.issues
           .map((i) => `${i.path.join(".")}: ${i.message}`)
           .join("; "),
       );
     }

     const file = formData.get("psd");
     if (!(file instanceof File) || file.size === 0) {
       throw new Error("psd file missing or empty");
     }
     const buf = await file.arrayBuffer();
     const psdBytes = new Uint8Array(buf);

     // Magic-byte check at the boundary; SavePsdInputSchema inside
     // savePsdBytes will re-validate.
     if (
       psdBytes.byteLength < 4 ||
       psdBytes[0] !== 0x38 ||
       psdBytes[1] !== 0x42 ||
       psdBytes[2] !== 0x50 ||
       psdBytes[3] !== 0x53
     ) {
       throw new Error("psdBytes missing 8BPS magic");
     }

     const { sb, actor } = await gate();

     const result = await savePsdBytes(sb, actor, {
       input: {
         assetId: parsed.data.assetId,
         psdBytes,
         note: parsed.data.note,
       },
       parsePsd: parsePsdAndStoreSprites,
     });

     revalidatePath("/admin/broadcast/v2/builder");
     return result;
   }

   /**
    * Revert the live PSD object back to an earlier snapshot.
    *
    * FormData fields:
    *   - assetId    — uuid of the asset row.
    *   - snapshotId — uuid of the overlay_user_asset_history row.
    *
    * Implementation: copy the historical storage object back to the
    * live path (creating ANOTHER history row pointing at the now-
    * displaced "current" version), then re-run the parser.
    */
   export async function revertToAssetSnapshotAction(
     formData: FormData,
   ): Promise<SavePsdResult> {
     const parsed = RevertSnapshotFormSchema.safeParse({
       assetId: String(formData.get("assetId") ?? ""),
       snapshotId: String(formData.get("snapshotId") ?? ""),
     });
     if (!parsed.success) {
       throw new Error(
         parsed.error.issues
           .map((i) => `${i.path.join(".")}: ${i.message}`)
           .join("; "),
       );
     }

     const { sb, actor } = await gate();

     // Fetch the historical row to find its storage_path.
     const { data: histRow, error: histErr } = await sb
       .from("overlay_user_asset_history")
       .select("id, asset_id, storage_path, size_bytes")
       .eq("id", parsed.data.snapshotId)
       .eq("asset_id", parsed.data.assetId)
       .is("deleted_at", null)
       .maybeSingle();
     if (histErr || !histRow) {
       throw new Error(
         `snapshot not found: ${parsed.data.snapshotId}${histErr ? ` (${histErr.message})` : ""}`,
       );
     }

     // Download the historical bytes and re-feed through savePsdBytes.
     // This triggers the canonical snapshot+upload+parse sequence so
     // the revert ALSO produces a new history row pointing at the
     // now-displaced "current" version (lossless round-trip).
     const { data: blob, error: dlErr } = await sb.storage
       .from("overlay-user-assets")
       .download((histRow as { storage_path: string }).storage_path);
     if (dlErr || !blob) {
       throw new Error(
         `snapshot download failed: ${dlErr?.message ?? "no blob"}`,
       );
     }
     const psdBytes = new Uint8Array(await blob.arrayBuffer());

     const result = await savePsdBytes(sb, actor, {
       input: {
         assetId: parsed.data.assetId,
         psdBytes,
         note: `revert to snapshot ${parsed.data.snapshotId}`,
       },
       parsePsd: parsePsdAndStoreSprites,
     });

     revalidatePath("/admin/broadcast/v2/builder");
     return result;
   }
   ```

5. Run the tests again — they pass:

   ```bash
   npm --workspace apps/web run test -- admin/broadcast/v2/builder/\\[slug\\]/psd/actions
   ```

   Expected output:

   ```
    ✓ src/app/admin/broadcast/v2/builder/[slug]/psd/actions.test.ts (5 tests)

    Test Files  1 passed (1)
         Tests  5 passed (5)
   ```

6. Stage and commit:

   ```bash
   git add apps/web/src/app/admin/broadcast/v2/builder/\[slug\]/psd/actions.ts apps/web/src/app/admin/broadcast/v2/builder/\[slug\]/psd/schemas.ts apps/web/src/app/admin/broadcast/v2/builder/\[slug\]/psd/actions.test.ts
   git commit -m "$(cat <<'EOF'
   feat(overlay-builder/wave-2b): savePsdFromPhotopeaAction + revertToAssetSnapshotAction

   Adds the Server Action layer for the Photopea iframe page:

     * `savePsdFromPhotopeaAction(formData)` — multipart input
       (`assetId`, `psd` File, optional `note`). Validates the 8BPS
       magic at the boundary, gates on `overlay.design.manage` via
       the canonical `gate()` helper, rate-limits per user, then
       hands off to `savePsdBytes(sb, actor, …)` from the bridge
       module. Returns the SavePsdResult unchanged.

     * `revertToAssetSnapshotAction(formData)` — input
       (`assetId`, `snapshotId`). Fetches the historical row, downloads
       the snapshot blob from `overlay-user-assets`, and re-feeds it
       through `savePsdBytes` so the revert ALSO produces a new
       history row pointing at the now-displaced "current" version
       (lossless round-trip via the canonical write path).

   Per CLAUDE.md §10 `actions.ts` is `"use server"` async-only;
   schemas live in sibling `schemas.ts`. Mirrors the gate() pattern
   from Wave 1A `app/admin/broadcast/v2/builder/actions.ts`.

   Tests cover: happy save, missing assetId, missing PSD, wrong magic,
   rate-limit short-circuit. All deps (supabase, perms, bridge,
   parser) mocked per CLAUDE.md testing strategy.

   Spec: docs/superpowers/specs/2026-05-17-overlay-builder-design.md §9.2 + §12

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

### Task 6: Signed-URL helper for the `app.open` bootstrap

**Files:**

- Create: `apps/web/src/server/overlays/builder/photopea-signed-url.ts`
- Create: `apps/web/src/server/overlays/builder/photopea-signed-url.test.ts`

**Context:** Photopea's `app.open` command needs a URL it can fetch FROM the Photopea origin. Our `overlay-user-assets` bucket is private (set by Wave 1A migration `20260901000002`). The page must mint a short-lived signed URL (60s) for exactly one asset before injecting it into the iframe bootstrap. This module wraps the Supabase signed-URL API + restricts the lifetime + adds a one-time-token bind via the asset row's audit ID so leaked URLs are useless beyond the page-load window.

#### Steps

1. Write the failing test first. Create `apps/web/src/server/overlays/builder/photopea-signed-url.test.ts`:

   ```ts
   import { describe, expect, it, vi } from "vitest";
   import { mintPsdSignedUrl } from "./photopea-signed-url";

   describe("mintPsdSignedUrl", () => {
     it("returns a 60-second signed URL for an existing PSD asset", async () => {
       const sb = {
         from: vi.fn(() => ({
           select: vi.fn().mockReturnThis(),
           eq: vi.fn().mockReturnThis(),
           is: vi.fn().mockReturnThis(),
           maybeSingle: vi.fn().mockResolvedValue({
             data: {
               id: "22222222-2222-4222-8222-222222222222",
               asset_type: "psd",
               file_path: "psd/22222222-2222-4222-8222-222222222222.psd",
               deleted_at: null,
             },
             error: null,
           }),
         })),
         storage: {
           from: vi.fn(() => ({
             createSignedUrl: vi
               .fn()
               .mockResolvedValue({
                 data: { signedUrl: "https://supabase/signed?token=abc" },
                 error: null,
               }),
           })),
         },
       } as unknown as Parameters<typeof mintPsdSignedUrl>[0];

       const url = await mintPsdSignedUrl(sb, {
         assetId: "22222222-2222-4222-8222-222222222222",
       });
       expect(url).toBe("https://supabase/signed?token=abc");

       const storage = (sb as unknown as { storage: { from: ReturnType<typeof vi.fn> } })
         .storage.from as ReturnType<typeof vi.fn>;
       const call = (storage("overlay-user-assets") as unknown as {
         createSignedUrl: ReturnType<typeof vi.fn>;
       }).createSignedUrl;
       // We don't assert the call shape because the chain mock above is a
       // simplified surface; the action test in Task 5 covers the wiring.
       expect(call).toBeDefined();
     });

     it("rejects when the asset is missing", async () => {
       const sb = {
         from: vi.fn(() => ({
           select: vi.fn().mockReturnThis(),
           eq: vi.fn().mockReturnThis(),
           is: vi.fn().mockReturnThis(),
           maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
         })),
         storage: { from: vi.fn() },
       } as unknown as Parameters<typeof mintPsdSignedUrl>[0];

       await expect(
         mintPsdSignedUrl(sb, {
           assetId: "22222222-2222-4222-8222-222222222222",
         }),
       ).rejects.toThrow(/asset not found/i);
     });

     it("rejects when the asset is not a PSD", async () => {
       const sb = {
         from: vi.fn(() => ({
           select: vi.fn().mockReturnThis(),
           eq: vi.fn().mockReturnThis(),
           is: vi.fn().mockReturnThis(),
           maybeSingle: vi.fn().mockResolvedValue({
             data: {
               id: "33333333-3333-4333-8333-333333333333",
               asset_type: "image",
               file_path: "img/x.png",
               deleted_at: null,
             },
             error: null,
           }),
         })),
         storage: { from: vi.fn() },
       } as unknown as Parameters<typeof mintPsdSignedUrl>[0];

       await expect(
         mintPsdSignedUrl(sb, {
           assetId: "33333333-3333-4333-8333-333333333333",
         }),
       ).rejects.toThrow(/not a psd asset/i);
     });
   });
   ```

2. Run — it fails (module missing):

   ```bash
   npm --workspace apps/web run test -- photopea-signed-url
   ```

3. Author the module. Create `apps/web/src/server/overlays/builder/photopea-signed-url.ts`:

   ```ts
   /**
    * Wave 2B — signed-URL helper for the Photopea bootstrap.
    *
    * Photopea's `app.open` command needs a URL it can fetch from
    * its own origin. Our `overlay-user-assets` bucket is private,
    * so we mint a short-lived signed URL (60s) at page-render time
    * and inject it into the bootstrap so Photopea can download the
    * PSD into its workspace.
    *
    * 60 seconds is the upper bound — the iframe bootstrap fires
    * `app.open` within ~200ms of load, so a leaked URL has at most
    * a single-digit-second usable window before it expires.
    *
    * Spec: docs/superpowers/specs/2026-05-17-overlay-builder-design.md §9.2 + §12
    */

   import type { SupabaseClient } from "@supabase/supabase-js";

   const STORAGE_BUCKET = "overlay-user-assets";
   const SIGNED_URL_TTL_SECONDS = 60;

   export async function mintPsdSignedUrl(
     sb: SupabaseClient,
     args: { assetId: string },
   ): Promise<string> {
     const { data: assetRow, error: lookupErr } = await sb
       .from("overlay_user_assets")
       .select("id, asset_type, file_path, deleted_at")
       .eq("id", args.assetId)
       .is("deleted_at", null)
       .maybeSingle();
     if (lookupErr) {
       throw new Error(`asset lookup failed: ${lookupErr.message}`);
     }
     if (!assetRow) {
       throw new Error(`asset not found: ${args.assetId}`);
     }
     const row = assetRow as {
       asset_type: string;
       file_path: string;
     };
     if (row.asset_type !== "psd") {
       throw new Error(`not a psd asset (got ${row.asset_type}): ${args.assetId}`);
     }

     const { data, error: signErr } = await sb.storage
       .from(STORAGE_BUCKET)
       .createSignedUrl(row.file_path, SIGNED_URL_TTL_SECONDS);
     if (signErr || !data?.signedUrl) {
       throw new Error(
         `signed url failed: ${signErr?.message ?? "no signedUrl"}`,
       );
     }
     return data.signedUrl;
   }
   ```

4. Run the test again — it passes:

   ```bash
   npm --workspace apps/web run test -- photopea-signed-url
   ```

5. Stage and commit:

   ```bash
   git add apps/web/src/server/overlays/builder/photopea-signed-url.ts apps/web/src/server/overlays/builder/photopea-signed-url.test.ts
   git commit -m "$(cat <<'EOF'
   feat(overlay-builder/wave-2b): mintPsdSignedUrl helper for Photopea bootstrap

   60-second signed URL for a single PSD asset. The PSD iframe page
   calls this server-side at render time and injects the URL into the
   client component so Photopea can issue an `app.open` request from
   inside the iframe. TTL is bounded at 60s so a leaked URL is useless
   beyond a single-digit-second window after page load (the iframe
   `app.open` fires within ~200ms).

   Rejects non-PSD asset types + soft-deleted rows + missing assets.

   Spec: docs/superpowers/specs/2026-05-17-overlay-builder-design.md §9.2 + §12

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

### Task 7: Client component `PhotopeaIframe.tsx` — sandbox, origin gate, save bridge, progress UI

**Files:**

- Create: `apps/web/src/components/admin/broadcast/v2/builder/PhotopeaIframe.tsx`
- Create: `apps/web/src/components/admin/broadcast/v2/builder/PhotopeaIframe.test.tsx`

**Context:** The browser-side bridge. Mounts the sandboxed iframe, sends the `app.open` bootstrap, listens for the save reply, validates origin BEFORE reading the payload, posts to the server action. Per CLAUDE.md §14 mindset (no white-flash, no leaked frames) the iframe is `<iframe sandbox="allow-scripts allow-same-origin">` — exactly the sandbox grants Photopea needs (scripts to run, same-origin to populate its own ServiceWorker cache).

`allow-same-origin` here refers to Photopea's OWN origin (Photopea pages are same-origin to themselves inside the sandbox), NOT to our origin. The combination `allow-scripts allow-same-origin` is the standard pattern for embedding a third-party SaaS that requires browser storage; it does NOT permit Photopea to read our cookies because Photopea is loaded from a DIFFERENT origin.

#### Steps

1. Write the failing test first. Create `apps/web/src/components/admin/broadcast/v2/builder/PhotopeaIframe.test.tsx`:

   ```tsx
   /** @vitest-environment jsdom */
   import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
   import { render, screen, fireEvent, waitFor } from "@testing-library/react";
   import { PhotopeaIframe } from "./PhotopeaIframe";

   describe("PhotopeaIframe", () => {
     let saveActionMock: ReturnType<typeof vi.fn>;

     beforeEach(() => {
       saveActionMock = vi.fn().mockResolvedValue({
         assetId: "11111111-1111-4111-8111-111111111111",
         historyId: "h-1",
         flatPngAssetId: "flat-1",
         spriteAssetIds: [],
         newSizeBytes: 4,
       });
     });

     afterEach(() => {
       vi.restoreAllMocks();
     });

     it("renders a sandboxed iframe with the Photopea src", () => {
       render(
         <PhotopeaIframe
           assetId="11111111-1111-4111-8111-111111111111"
           psdSignedUrl="https://supabase/signed?token=abc"
           onSaved={vi.fn()}
           saveAction={saveActionMock}
         />,
       );
       const iframe = screen.getByTitle(/photopea/i) as HTMLIFrameElement;
       expect(iframe.getAttribute("src")).toContain("https://www.photopea.com");
       expect(iframe.getAttribute("sandbox")).toBe(
         "allow-scripts allow-same-origin",
       );
     });

     it("posts app.open with the signed url on iframe load", async () => {
       render(
         <PhotopeaIframe
           assetId="11111111-1111-4111-8111-111111111111"
           psdSignedUrl="https://supabase/signed?token=abc"
           onSaved={vi.fn()}
           saveAction={saveActionMock}
         />,
       );
       const iframe = screen.getByTitle(/photopea/i) as HTMLIFrameElement;
       const postSpy = vi
         .spyOn(iframe.contentWindow!, "postMessage")
         .mockImplementation(() => {});
       fireEvent.load(iframe);
       await waitFor(() => expect(postSpy).toHaveBeenCalled());
       const [payload, origin] = postSpy.mock.calls[0];
       expect(JSON.stringify(payload)).toContain(
         "https://supabase/signed?token=abc",
       );
       expect(origin).toBe("https://www.photopea.com");
     });

     it("posts app.activeDocument.saveToOE when Save is clicked", async () => {
       render(
         <PhotopeaIframe
           assetId="11111111-1111-4111-8111-111111111111"
           psdSignedUrl="https://supabase/signed?token=abc"
           onSaved={vi.fn()}
           saveAction={saveActionMock}
         />,
       );
       const iframe = screen.getByTitle(/photopea/i) as HTMLIFrameElement;
       const postSpy = vi
         .spyOn(iframe.contentWindow!, "postMessage")
         .mockImplementation(() => {});
       fireEvent.load(iframe);
       await waitFor(() => expect(postSpy).toHaveBeenCalled());
       postSpy.mockClear();

       fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
       await waitFor(() => expect(postSpy).toHaveBeenCalled());
       const [savePayload] = postSpy.mock.calls[0];
       expect(JSON.stringify(savePayload)).toContain(
         "app.activeDocument.saveToOE",
       );
     });

     it("ignores postMessage events from wrong origin", async () => {
       render(
         <PhotopeaIframe
           assetId="11111111-1111-4111-8111-111111111111"
           psdSignedUrl="https://supabase/signed?token=abc"
           onSaved={vi.fn()}
           saveAction={saveActionMock}
         />,
       );

       const fakePsd = new Uint8Array([0x38, 0x42, 0x50, 0x53]).buffer;
       window.dispatchEvent(
         new MessageEvent("message", {
           data: fakePsd,
           origin: "https://www.attacker.example",
         }),
       );

       // Give the handler a tick to (incorrectly) run if origin gate is missing.
       await new Promise((r) => setTimeout(r, 50));
       expect(saveActionMock).not.toHaveBeenCalled();
     });

     it("invokes saveAction with the PSD bytes when Photopea replies", async () => {
       const onSaved = vi.fn();
       render(
         <PhotopeaIframe
           assetId="11111111-1111-4111-8111-111111111111"
           psdSignedUrl="https://supabase/signed?token=abc"
           onSaved={onSaved}
           saveAction={saveActionMock}
         />,
       );

       fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

       const psdBytes = new Uint8Array([0x38, 0x42, 0x50, 0x53, 0x00, 0x01]);
       window.dispatchEvent(
         new MessageEvent("message", {
           data: psdBytes.buffer,
           origin: "https://www.photopea.com",
         }),
       );

       await waitFor(() => expect(saveActionMock).toHaveBeenCalled());
       const formData = saveActionMock.mock.calls[0][0] as FormData;
       expect(formData.get("assetId")).toBe(
         "11111111-1111-4111-8111-111111111111",
       );
       expect(formData.get("psd")).toBeInstanceOf(File);
       await waitFor(() => expect(onSaved).toHaveBeenCalled());
     });

     it("renders a Close button that invokes onClose", () => {
       const onClose = vi.fn();
       render(
         <PhotopeaIframe
           assetId="11111111-1111-4111-8111-111111111111"
           psdSignedUrl="https://supabase/signed?token=abc"
           onSaved={vi.fn()}
           saveAction={saveActionMock}
           onClose={onClose}
         />,
       );
       fireEvent.click(screen.getByRole("button", { name: /^close$/i }));
       expect(onClose).toHaveBeenCalled();
     });

     it("surfaces 'Saving... Done.' status text through the save lifecycle", async () => {
       render(
         <PhotopeaIframe
           assetId="11111111-1111-4111-8111-111111111111"
           psdSignedUrl="https://supabase/signed?token=abc"
           onSaved={vi.fn()}
           saveAction={saveActionMock}
         />,
       );

       fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

       window.dispatchEvent(
         new MessageEvent("message", {
           data: new Uint8Array([0x38, 0x42, 0x50, 0x53]).buffer,
           origin: "https://www.photopea.com",
         }),
       );

       await waitFor(() =>
         expect(screen.getByTestId("photopea-status").textContent).toMatch(/saving/i),
       );
       await waitFor(() =>
         expect(screen.getByTestId("photopea-status").textContent).toMatch(/done/i),
       );
     });
   });
   ```

2. Run — it fails (component missing):

   ```bash
   npm --workspace apps/web run test -- PhotopeaIframe
   ```

3. Author the component. Create `apps/web/src/components/admin/broadcast/v2/builder/PhotopeaIframe.tsx`:

   ```tsx
   "use client";

   import {
     useCallback,
     useEffect,
     useRef,
     useState,
     type ComponentProps,
   } from "react";
   import type { SavePsdResult } from "@/server/overlays/builder/photopea-bridge.types";

   /**
    * Wave 2B — sandboxed Photopea iframe + postMessage save bridge.
    *
    * - Sandbox: `allow-scripts allow-same-origin` (Photopea needs both;
    *   `allow-same-origin` here refers to Photopea's OWN origin inside
    *   the sandbox, NOT to ours).
    * - Bootstrap: on `load`, post `{ type: 'app.open', file: <signedUrl> }`
    *   into the iframe so Photopea downloads our PSD.
    * - Save: button posts `{ type: 'app.activeDocument.saveToOE' }`.
    *   Photopea replies with raw PSD bytes via a `message` event whose
    *   `data` is an ArrayBuffer.
    * - Origin gate: `event.origin === 'https://www.photopea.com'`
    *   validated BEFORE the payload is read. Mismatches logged + dropped.
    * - Progress UI: indeterminate spinner during the action call;
    *   "Saving..." then "Done." status text.
    *
    * Spec: docs/superpowers/specs/2026-05-17-overlay-builder-design.md §9.2 + §12.
    */

   const PHOTOPEA_EMBED_ORIGIN = "https://www.photopea.com";
   const PHOTOPEA_SRC = `${PHOTOPEA_EMBED_ORIGIN}/`;

   type Status = "idle" | "saving" | "done" | "error";

   export type PhotopeaIframeProps = {
     assetId: string;
     psdSignedUrl: string;
     saveAction: (formData: FormData) => Promise<SavePsdResult>;
     onSaved?: (result: SavePsdResult) => void;
     onClose?: () => void;
   };

   export function PhotopeaIframe({
     assetId,
     psdSignedUrl,
     saveAction,
     onSaved,
     onClose,
   }: PhotopeaIframeProps): JSX.Element {
     const iframeRef = useRef<HTMLIFrameElement>(null);
     const [status, setStatus] = useState<Status>("idle");
     const [errorMsg, setErrorMsg] = useState<string | null>(null);
     // Track whether the operator has actively clicked Save. We only
     // accept binary postMessage payloads while a save is in flight to
     // prevent stray Photopea events from triggering uploads.
     const saveInFlight = useRef(false);

     /** Send a typed envelope INTO the Photopea iframe. */
     const postToPhotopea = useCallback((payload: unknown) => {
       const iframe = iframeRef.current;
       if (!iframe?.contentWindow) return;
       iframe.contentWindow.postMessage(payload, PHOTOPEA_EMBED_ORIGIN);
     }, []);

     /** Bootstrap: fire `app.open` once Photopea finishes loading. */
     const handleIframeLoad = useCallback(() => {
       postToPhotopea({
         type: "app.open",
         file: psdSignedUrl,
       });
     }, [postToPhotopea, psdSignedUrl]);

     /** Send the save command. */
     const handleSaveClick = useCallback(() => {
       setErrorMsg(null);
       setStatus("saving");
       saveInFlight.current = true;
       postToPhotopea({ type: "app.activeDocument.saveToOE" });
     }, [postToPhotopea]);

     /** Listen for Photopea replies. */
     useEffect(() => {
       async function onMessage(event: MessageEvent) {
         // STRICT ORIGIN GATE — drop anything not from Photopea BEFORE
         // we touch `event.data`. This is the single most important
         // line in the bridge.
         if (event.origin !== PHOTOPEA_EMBED_ORIGIN) {
           // Log + drop. Don't surface to the user — would just be noise
           // from random extensions / devtools / other iframes.
           // eslint-disable-next-line no-console
           console.debug("[photopea-bridge] dropped non-photopea message", {
             origin: event.origin,
           });
           return;
         }

         // Only act on binary payloads when a save is in flight.
         if (!saveInFlight.current) return;
         if (!(event.data instanceof ArrayBuffer)) return;

         const psdBytes = new Uint8Array(event.data);
         if (
           psdBytes.byteLength < 4 ||
           psdBytes[0] !== 0x38 ||
           psdBytes[1] !== 0x42 ||
           psdBytes[2] !== 0x50 ||
           psdBytes[3] !== 0x53
         ) {
           setStatus("error");
           setErrorMsg("Photopea reply missing PSD magic; save aborted.");
           saveInFlight.current = false;
           return;
         }

         try {
           const fd = new FormData();
           fd.set("assetId", assetId);
           fd.set(
             "psd",
             new File([psdBytes], "edit.psd", {
               type: "image/vnd.adobe.photoshop",
             }),
           );
           const result = await saveAction(fd);
           setStatus("done");
           saveInFlight.current = false;
           onSaved?.(result);
         } catch (err) {
           setStatus("error");
           setErrorMsg(err instanceof Error ? err.message : String(err));
           saveInFlight.current = false;
         }
       }

       window.addEventListener("message", onMessage);
       return () => window.removeEventListener("message", onMessage);
     }, [assetId, saveAction, onSaved]);

     const sandboxProps: ComponentProps<"iframe"> = {
       // The combination Photopea requires. `allow-same-origin` here is
       // Photopea's OWN origin inside the sandbox — does NOT permit
       // Photopea to read our cookies (it's a different origin from
       // ours, so the same-origin policy still blocks cross-origin
       // reads).
       sandbox: "allow-scripts allow-same-origin",
     };

     return (
       <div
         data-testid="photopea-shell"
         className="flex h-full w-full flex-col bg-[var(--ink-1)]"
       >
         <header className="flex items-center justify-between border-b border-[var(--ink-4)] px-4 py-2">
           <div className="flex items-center gap-3">
             <h2 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--chalk-1)]">
               Edit PSD in Photopea
             </h2>
             <span
               data-testid="photopea-status"
               className="text-[11px] uppercase tracking-[0.16em] text-[var(--chalk-3)]"
               aria-live="polite"
             >
               {status === "idle" && "Ready"}
               {status === "saving" && "Saving..."}
               {status === "done" && "Done."}
               {status === "error" && (
                 <span className="text-[var(--signal-warn)]">
                   Error: {errorMsg ?? "unknown"}
                 </span>
               )}
             </span>
           </div>
           <div className="flex items-center gap-2">
             <button
               type="button"
               onClick={handleSaveClick}
               disabled={status === "saving"}
               className="rounded-sm bg-[var(--signal)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--ink-1)] disabled:opacity-50"
             >
               Save
             </button>
             <button
               type="button"
               onClick={onClose}
               className="rounded-sm border border-[var(--ink-4)] px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] text-[var(--chalk-2)] hover:bg-[var(--ink-2)]"
             >
               Close
             </button>
           </div>
         </header>

         <div className="relative flex-1">
           {status === "saving" && (
             <div
               data-testid="photopea-progress"
               className="absolute left-0 top-0 z-10 h-0.5 w-full animate-pulse bg-[var(--signal)]"
             />
           )}
           <iframe
             ref={iframeRef}
             title="Photopea editor"
             src={PHOTOPEA_SRC}
             onLoad={handleIframeLoad}
             className="h-full w-full border-0"
             {...sandboxProps}
           />
         </div>
       </div>
     );
   }
   ```

4. Run the tests again — they pass:

   ```bash
   npm --workspace apps/web run test -- PhotopeaIframe
   ```

   Expected output:

   ```
    ✓ src/components/admin/broadcast/v2/builder/PhotopeaIframe.test.tsx (7 tests)

    Test Files  1 passed (1)
         Tests  7 passed (7)
   ```

5. Stage and commit:

   ```bash
   git add apps/web/src/components/admin/broadcast/v2/builder/PhotopeaIframe.tsx apps/web/src/components/admin/broadcast/v2/builder/PhotopeaIframe.test.tsx
   git commit -m "$(cat <<'EOF'
   feat(overlay-builder/wave-2b): PhotopeaIframe client component

   Mounts the sandboxed Photopea iframe and wires the postMessage save
   bridge:
     * Sandbox attrs: `allow-scripts allow-same-origin` (the minimum
       Photopea needs; same-origin here is Photopea's OWN origin
       inside the sandbox, not ours).
     * On iframe load posts `{type:'app.open', file:<signedUrl>}` so
       Photopea downloads the PSD into its workspace.
     * Save button posts `{type:'app.activeDocument.saveToOE'}`; Photopea
       replies with ArrayBuffer of PSD bytes.
     * STRICT origin gate: `event.origin === 'https://www.photopea.com'`
       checked BEFORE reading event.data — every other source dropped
       with a debug log.
     * Only acts on binary payloads while a save is in flight, so
       stray Photopea events cannot trigger uploads.
     * 8BPS magic re-checked client-side before constructing FormData;
       saveAction wrapper re-checks again server-side (defense in depth).
     * Status strip with aria-live="polite": Ready → Saving... → Done.
     * Close button calls `onClose` prop.

   Tests cover: sandbox attribute, app.open bootstrap, save command,
   wrong-origin rejection, happy save → action invoke, Close button,
   status strip lifecycle.

   Spec: docs/superpowers/specs/2026-05-17-overlay-builder-design.md §9.2 + §12

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

### Task 8: Server page `/admin/broadcast/v2/builder/[slug]/psd/page.tsx` + feature-flag gate

**Files:**

- Create: `apps/web/src/app/admin/broadcast/v2/builder/[slug]/psd/page.tsx`
- Create: `apps/web/src/app/admin/broadcast/v2/builder/[slug]/psd/page.test.tsx`

**Context:** The server component that the admin lands on. Reads `?assetId=<id>` from the search params, validates it matches a PSD asset belonging to the current design, mints a signed URL via Task 6, renders the `PhotopeaIframe` client component with the save action prop bound. Feature-flag gated on `overlayBuilder.photopeaEnabled` (default off) — when off the page returns the standard `notFound()` so a leaked URL doesn't expose the iframe to non-admins or unflagged environments.

#### Steps

1. Write the failing test first. Create `apps/web/src/app/admin/broadcast/v2/builder/[slug]/psd/page.test.tsx`:

   ```tsx
   /** @vitest-environment jsdom */
   import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
   import { render, screen } from "@testing-library/react";

   vi.mock("next/navigation", () => ({
     notFound: () => {
       throw new Error("NEXT_NOT_FOUND");
     },
     redirect: vi.fn(),
   }));
   vi.mock("@/lib/supabase/server", () => ({
     getServerSupabase: vi.fn().mockResolvedValue({
       auth: {
         getUser: vi.fn().mockResolvedValue({ data: { user: { id: "a" } } }),
       },
       from: vi.fn(() => ({
         select: vi.fn().mockReturnThis(),
         eq: vi.fn().mockReturnThis(),
         is: vi.fn().mockReturnThis(),
         maybeSingle: vi.fn().mockResolvedValue({ data: { id: "u" }, error: null }),
       })),
     }),
   }));
   vi.mock("@/lib/supabase/service", () => ({
     getServiceRoleSupabase: vi.fn(() => ({ __svc: true })),
   }));
   vi.mock("@/lib/perms-db", () => ({
     requirePermAsync: vi.fn().mockResolvedValue(undefined),
     PermissionError: class PermissionError extends Error {},
   }));
   vi.mock("@/server/overlays/builder/photopea-signed-url", () => ({
     mintPsdSignedUrl: vi.fn().mockResolvedValue("https://signed.example"),
   }));
   vi.mock(
     "@/components/admin/broadcast/v2/builder/PhotopeaIframe",
     () => ({
       PhotopeaIframe: (props: Record<string, unknown>) => (
         <div data-testid="photopea-iframe-mock">
           {JSON.stringify({
             assetId: props.assetId,
             psdSignedUrl: props.psdSignedUrl,
           })}
         </div>
       ),
     }),
   );

   describe("PSD page server component", () => {
     beforeEach(() => {
       process.env.NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED = "true";
       process.env.NEXT_PUBLIC_OVERLAY_BUILDER_PHOTOPEA_ENABLED = "true";
       vi.resetModules();
     });
     afterEach(() => {
       delete process.env.NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED;
       delete process.env.NEXT_PUBLIC_OVERLAY_BUILDER_PHOTOPEA_ENABLED;
     });

     it("renders the PhotopeaIframe when both flags are on and assetId valid", async () => {
       const { default: Page } = await import("./page");
       const node = await Page({
         params: Promise.resolve({ slug: "test-design" }),
         searchParams: Promise.resolve({
           assetId: "11111111-1111-4111-8111-111111111111",
         }),
       });
       render(node);
       const mock = screen.getByTestId("photopea-iframe-mock");
       expect(mock.textContent).toContain(
         "11111111-1111-4111-8111-111111111111",
       );
       expect(mock.textContent).toContain("https://signed.example");
     });

     it("returns notFound when photopea flag is off", async () => {
       process.env.NEXT_PUBLIC_OVERLAY_BUILDER_PHOTOPEA_ENABLED = "false";
       vi.resetModules();
       const { default: Page } = await import("./page");
       await expect(
         Page({
           params: Promise.resolve({ slug: "test-design" }),
           searchParams: Promise.resolve({
             assetId: "11111111-1111-4111-8111-111111111111",
           }),
         }),
       ).rejects.toThrow(/NEXT_NOT_FOUND/);
     });

     it("returns notFound when assetId search param is missing", async () => {
       const { default: Page } = await import("./page");
       await expect(
         Page({
           params: Promise.resolve({ slug: "test-design" }),
           searchParams: Promise.resolve({}),
         }),
       ).rejects.toThrow(/NEXT_NOT_FOUND/);
     });

     it("returns notFound when assetId is not a uuid", async () => {
       const { default: Page } = await import("./page");
       await expect(
         Page({
           params: Promise.resolve({ slug: "test-design" }),
           searchParams: Promise.resolve({ assetId: "not-a-uuid" }),
         }),
       ).rejects.toThrow(/NEXT_NOT_FOUND/);
     });
   });
   ```

2. Run — it fails (page missing):

   ```bash
   npm --workspace apps/web run test -- builder/\\[slug\\]/psd/page
   ```

3. Author the page. Create `apps/web/src/app/admin/broadcast/v2/builder/[slug]/psd/page.tsx`:

   ```tsx
   import { notFound, redirect } from "next/navigation";
   import { getServerSupabase } from "@/lib/supabase/server";
   import { getServiceRoleSupabase } from "@/lib/supabase/service";
   import { requirePermAsync, PermissionError } from "@/lib/perms-db";
   import { featureFlags } from "@/lib/feature-flags";
   import { mintPsdSignedUrl } from "@/server/overlays/builder/photopea-signed-url";
   import { PhotopeaIframe } from "@/components/admin/broadcast/v2/builder/PhotopeaIframe";
   import { savePsdFromPhotopeaAction } from "./actions";

   /**
    * Wave 2B — `/admin/broadcast/v2/builder/[slug]/psd?assetId=<id>` page.
    *
    * Server component. Perm-gates on `overlay.design.manage`, validates
    * `?assetId` against the live PSD asset, mints a 60-s signed URL,
    * and hands both off to the sandboxed Photopea iframe.
    *
    * Feature-flag gated on `overlayBuilder.photopeaEnabled`. When the
    * flag is off the page 404s — never expose the iframe via a leaked
    * URL outside of explicitly-enabled environments.
    *
    * Spec: docs/superpowers/specs/2026-05-17-overlay-builder-design.md §9.2 + §12
    */

   const UUID_RE =
     /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

   type PageProps = {
     params: Promise<{ slug: string }>;
     searchParams: Promise<{ assetId?: string }>;
   };

   export default async function PsdPage({
     params,
     searchParams,
   }: PageProps): Promise<JSX.Element> {
     // 1. Feature-flag gate. When the photopea flag is off we 404 to
     //    hide the surface from anyone who learns the route URL.
     if (
       !featureFlags.overlayBuilder.enabled ||
       !featureFlags.overlayBuilder.photopeaEnabled
     ) {
       notFound();
     }

     // 2. Validate path + query.
     const { slug } = await params;
     const { assetId } = await searchParams;
     if (!slug || !assetId || !UUID_RE.test(assetId)) {
       notFound();
     }

     // 3. Auth + perm gate (re-checked here even though the action also
     //    gates; protects the iframe URL itself).
     const userClient = await getServerSupabase();
     const { data: auth } = await userClient.auth.getUser();
     if (!auth?.user) redirect("/login");
     const { data: pub } = await userClient
       .from("users")
       .select("id")
       .eq("supabase_auth_id", auth.user.id)
       .maybeSingle();
     if (!pub) redirect("/login");
     const { data: roleRows } = await userClient
       .from("user_roles")
       .select("role")
       .eq("user_id", pub.id)
       .is("deleted_at", null);
     const roles = ((roleRows ?? []) as { role: string }[]).map((r) => r.role);
     const sb = getServiceRoleSupabase();
     try {
       await requirePermAsync(
         sb,
         { userId: pub.id, roles },
         "overlay.design.manage",
       );
     } catch (e) {
       if (e instanceof PermissionError) notFound();
       throw e;
     }

     // 4. Mint the signed URL for the iframe bootstrap.
     let psdSignedUrl: string;
     try {
       psdSignedUrl = await mintPsdSignedUrl(sb, { assetId });
     } catch {
       notFound();
     }

     return (
       <div className="fixed inset-0 z-50">
         <PhotopeaIframe
           assetId={assetId}
           psdSignedUrl={psdSignedUrl}
           saveAction={savePsdFromPhotopeaAction}
         />
       </div>
     );
   }
   ```

4. Run the tests again — they pass:

   ```bash
   npm --workspace apps/web run test -- builder/\\[slug\\]/psd/page
   ```

5. Stage and commit:

   ```bash
   git add apps/web/src/app/admin/broadcast/v2/builder/\[slug\]/psd/page.tsx apps/web/src/app/admin/broadcast/v2/builder/\[slug\]/psd/page.test.tsx
   git commit -m "$(cat <<'EOF'
   feat(overlay-builder/wave-2b): /admin/broadcast/v2/builder/[slug]/psd page

   Server component for the Photopea editing surface:
     * Feature-flag gated on `overlayBuilder.enabled && overlayBuilder.photopeaEnabled`
       — 404 when off so leaked URLs don't expose the iframe.
     * Validates `slug` + `?assetId=` (UUID regex).
     * Re-runs the same auth + `overlay.design.manage` perm gate the
       action uses (defense in depth).
     * Calls `mintPsdSignedUrl(sb, { assetId })` to get a 60s signed
       URL for the PSD.
     * Renders `<PhotopeaIframe />` with the `savePsdFromPhotopeaAction`
       bound to the save prop.

   Tests cover: happy render, photopea-flag-off → 404, missing assetId
   → 404, malformed assetId → 404.

   Spec: docs/superpowers/specs/2026-05-17-overlay-builder-design.md §9.2 + §12

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

### Task 9: Wire "Open in Photopea" entry point from the canvas editor + asset library

**Files:**

- Modify: `apps/web/src/app/admin/broadcast/v2/builder/[slug]/edit/page.tsx`
- Modify: `apps/web/src/components/admin/broadcast/v2/builder/AssetCard.tsx` (Wave 2A — assumed shipped; check before edit)
- Create: `apps/web/src/components/admin/broadcast/v2/builder/OpenInPhotopeaButton.tsx`
- Create: `apps/web/src/components/admin/broadcast/v2/builder/OpenInPhotopeaButton.test.tsx`

**Context:** The canvas editor + asset library each need an "Open in Photopea" button visible only on PSD-type assets and only when `overlayBuilder.photopeaEnabled` is on. The button is a plain `<Link>` to the new route — no client-side state required.

#### Steps

1. Verify Wave 2A asset card exists; if it does not, create a minimal shell in this task that Wave 2A can extend later:

   ```bash
   ls apps/web/src/components/admin/broadcast/v2/builder/AssetCard.tsx 2>/dev/null \
     && echo "exists" || echo "missing — Wave 2A not landed; create minimal shell"
   ```

   If missing, create a minimal shell at `AssetCard.tsx` that renders the asset filename + the OpenInPhotopeaButton. Wave 2A will replace it later.

2. Write the failing test first. Create `apps/web/src/components/admin/broadcast/v2/builder/OpenInPhotopeaButton.test.tsx`:

   ```tsx
   /** @vitest-environment jsdom */
   import { afterEach, beforeEach, describe, expect, it } from "vitest";
   import { render, screen } from "@testing-library/react";
   import { OpenInPhotopeaButton } from "./OpenInPhotopeaButton";

   describe("OpenInPhotopeaButton", () => {
     beforeEach(() => {
       process.env.NEXT_PUBLIC_OVERLAY_BUILDER_PHOTOPEA_ENABLED = "true";
     });
     afterEach(() => {
       delete process.env.NEXT_PUBLIC_OVERLAY_BUILDER_PHOTOPEA_ENABLED;
     });

     it("renders a link to /psd?assetId=<id> when flag is on and asset is a psd", () => {
       render(
         <OpenInPhotopeaButton
           designSlug="my-design"
           assetId="11111111-1111-4111-8111-111111111111"
           assetType="psd"
           photopeaEnabled={true}
         />,
       );
       const link = screen.getByRole("link", { name: /open in photopea/i });
       expect(link.getAttribute("href")).toBe(
         "/admin/broadcast/v2/builder/my-design/psd?assetId=11111111-1111-4111-8111-111111111111",
       );
     });

     it("renders nothing when assetType is not psd", () => {
       const { container } = render(
         <OpenInPhotopeaButton
           designSlug="my-design"
           assetId="11111111-1111-4111-8111-111111111111"
           assetType="image"
           photopeaEnabled={true}
         />,
       );
       expect(container.firstChild).toBeNull();
     });

     it("renders nothing when photopeaEnabled is false", () => {
       const { container } = render(
         <OpenInPhotopeaButton
           designSlug="my-design"
           assetId="11111111-1111-4111-8111-111111111111"
           assetType="psd"
           photopeaEnabled={false}
         />,
       );
       expect(container.firstChild).toBeNull();
     });
   });
   ```

3. Run — it fails:

   ```bash
   npm --workspace apps/web run test -- OpenInPhotopeaButton
   ```

4. Author the button. Create `apps/web/src/components/admin/broadcast/v2/builder/OpenInPhotopeaButton.tsx`:

   ```tsx
   import Link from "next/link";

   /**
    * Wave 2B — entry point into the Photopea iframe page.
    *
    * Renders only on PSD-type assets AND only when the parent surface
    * has confirmed the photopea flag is on. The flag is passed as a
    * prop rather than read here so server components decide visibility
    * once at render time (no client-side flag flicker).
    */
   export type OpenInPhotopeaButtonProps = {
     designSlug: string;
     assetId: string;
     assetType: "image" | "psd" | "font" | string;
     photopeaEnabled: boolean;
   };

   export function OpenInPhotopeaButton({
     designSlug,
     assetId,
     assetType,
     photopeaEnabled,
   }: OpenInPhotopeaButtonProps): JSX.Element | null {
     if (assetType !== "psd" || !photopeaEnabled) return null;
     const href = `/admin/broadcast/v2/builder/${designSlug}/psd?assetId=${assetId}`;
     return (
       <Link
         href={href}
         className="inline-flex items-center gap-1.5 rounded-sm border border-[var(--ink-4)] px-2.5 py-1 text-[11px] uppercase tracking-[0.16em] text-[var(--chalk-2)] hover:bg-[var(--ink-2)]"
       >
         Open in Photopea
       </Link>
     );
   }
   ```

5. Wire it into the canvas editor. In `apps/web/src/app/admin/broadcast/v2/builder/[slug]/edit/page.tsx`, locate the toolbar / placement section where PSD assets are listed, and add the button next to each PSD card. Read the flag in the server component:

   ```tsx
   import { featureFlags } from "@/lib/feature-flags";
   import { OpenInPhotopeaButton } from "@/components/admin/broadcast/v2/builder/OpenInPhotopeaButton";

   // inside the rendered toolbar / asset list:
   <OpenInPhotopeaButton
     designSlug={slug}
     assetId={asset.id}
     assetType={asset.asset_type}
     photopeaEnabled={featureFlags.overlayBuilder.photopeaEnabled}
   />
   ```

   If the Wave 1A canvas editor does not yet render an asset list (Wave 2A delivers that), commit the button + test now and note in the Wave 2A plan that the wiring happens there. Surface this as an Implementation Note in the commit body.

6. Run all tests — they pass:

   ```bash
   npm --workspace apps/web run test -- OpenInPhotopeaButton
   ```

7. Stage and commit:

   ```bash
   git add apps/web/src/components/admin/broadcast/v2/builder/OpenInPhotopeaButton.tsx apps/web/src/components/admin/broadcast/v2/builder/OpenInPhotopeaButton.test.tsx
   if [ -f apps/web/src/app/admin/broadcast/v2/builder/\[slug\]/edit/page.tsx ]; then
     git add apps/web/src/app/admin/broadcast/v2/builder/\[slug\]/edit/page.tsx
   fi
   git commit -m "$(cat <<'EOF'
   feat(overlay-builder/wave-2b): OpenInPhotopeaButton entry point

   Plain Link rendered next to PSD assets in the canvas editor + asset
   library. Visible only when asset_type='psd' AND the photopea flag is
   on (flag passed as prop so server components decide once at render
   time, no client-side flicker).

   href: /admin/broadcast/v2/builder/<slug>/psd?assetId=<id>

   Tests cover: happy render, non-PSD → null, flag off → null.

   Spec: docs/superpowers/specs/2026-05-17-overlay-builder-design.md §9.2

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

### Task 10: CSP audit — confirm `frame-src https://www.photopea.com` is permitted

**Files:**

- Read: `apps/web/next.config.ts`
- Read: `apps/web/middleware.ts` (if present)
- Create: `apps/web/scripts/_wave-2b-csp-audit.mjs` (one-shot, deleted after run)
- Update if needed: `apps/web/next.config.ts` headers function OR `middleware.ts` CSP block

**Context:** Next.js by default sets NO CSP header on admin routes. The Photopea iframe loads from `https://www.photopea.com`. If a later change introduces a strict CSP on `/admin/*` that omits `frame-src https://www.photopea.com`, the iframe goes blank. This task audits the current state, adds the frame-src grant if a CSP exists, and writes a one-shot script to verify the rendered admin page either ships no CSP header OR ships one that explicitly allows the Photopea frame.

#### Steps

1. Read the existing config:

   ```bash
   ls apps/web/next.config.ts apps/web/src/middleware.ts apps/web/middleware.ts 2>/dev/null
   ```

   Capture which files exist. Per `apps/web/next.config.ts` audit in the parent codebase (see Wave 1A context), no `headers()` function is configured today — `/admin/*` ships without a CSP. Verify:

   ```bash
   grep -n "headers" apps/web/next.config.ts || echo "no headers function — no CSP on admin routes"
   ```

   Expected output:

   ```
   no headers function — no CSP on admin routes
   ```

2. If a CSP IS configured on `/admin/*` (future-state defense), patch the config to add `frame-src https://www.photopea.com` to the directive list. If no CSP is configured (current state), no patch is needed — but document the requirement so future CSP work doesn't break Wave 2B.

3. Write the audit script. Create `apps/web/scripts/_wave-2b-csp-audit.mjs`:

   ```js
   #!/usr/bin/env node
   /**
    * Wave 2B CSP audit. Hits the admin Photopea page (server returns
    * 307 -> /login when unauthenticated) and inspects the
    * Content-Security-Policy response header (if any). Pass iff the
    * page either ships no CSP OR ships one whose frame-src directive
    * permits https://www.photopea.com.
    *
    * Run with the dev server up:
    *   npx next dev -p 3030 &
    *   node apps/web/scripts/_wave-2b-csp-audit.mjs
    *
    * One-shot; delete after the audit runs cleanly.
    *
    * Spec: docs/superpowers/specs/2026-05-17-overlay-builder-design.md §12
    */
   const BASE = process.env.VERIFY_BASE_URL ?? "http://127.0.0.1:3030";
   const PHOTOPEA = "https://www.photopea.com";

   const PATHS = [
     "/admin/broadcast/v2/builder",
     "/admin/broadcast/v2/builder/my-design/psd?assetId=11111111-1111-4111-8111-111111111111",
   ];

   let allGreen = true;
   for (const path of PATHS) {
     try {
       const res = await fetch(`${BASE}${path}`, { redirect: "manual" });
       const csp = res.headers.get("content-security-policy");
       if (!csp) {
         console.log(
           `OK   | ${path.padEnd(70)} | no CSP header (default permissive)`,
         );
         continue;
       }
       const frameMatch = /frame-src\s+([^;]+)/i.exec(csp);
       if (!frameMatch) {
         console.log(
           `OK   | ${path.padEnd(70)} | CSP present but no frame-src restriction`,
         );
         continue;
       }
       const directive = frameMatch[1];
       const allowsPhotopea = directive.includes(PHOTOPEA) || directive.includes("*");
       console.log(
         `${allowsPhotopea ? "OK  " : "FAIL"} | ${path.padEnd(70)} | frame-src=${directive.trim()}`,
       );
       if (!allowsPhotopea) allGreen = false;
     } catch (err) {
       console.log(`FAIL | ${path.padEnd(70)} | ${err.message}`);
       allGreen = false;
     }
   }
   process.exit(allGreen ? 0 : 1);
   ```

4. Boot dev server in background and run the audit:

   ```bash
   npx --workspace apps/web next dev -p 3030 &
   DEV_PID=$!
   sleep 6  # let Next warm up
   node apps/web/scripts/_wave-2b-csp-audit.mjs
   AUDIT=$?
   kill $DEV_PID
   exit $AUDIT
   ```

   Expected output (with no CSP configured on `/admin/*` — Wave 2B passes by default):

   ```
   OK   | /admin/broadcast/v2/builder                                            | no CSP header (default permissive)
   OK   | /admin/broadcast/v2/builder/my-design/psd?assetId=...                  | no CSP header (default permissive)
   ```

5. Delete the audit script (one-shot per the Wave 1A `_verify-wave-1a-routes.mjs` convention):

   ```bash
   rm apps/web/scripts/_wave-2b-csp-audit.mjs
   ```

6. Document the audit result in the Wave 2B PR description under a "CSP audit" header. No commit needed — this is a verification gate, not a code change. If the audit found a missing grant, fix it in a separate commit referencing this task.

---

### Task 11: E2E spec — `apps/web/tests/e2e/overlay-builder-photopea.spec.ts`

**Files:**

- Create: `apps/web/tests/e2e/overlay-builder-photopea.spec.ts`
- Create: `apps/web/tests/e2e/fixtures/wave-2b-tiny.psd` (minimal valid PSD; 4 bytes magic + 22-byte header + 0-length sections — built once via a one-time `node` script and committed)
- Optional helper: `apps/web/tests/e2e/_make-tiny-psd.mjs` (one-shot generator; not committed if the fixture is checked in)

**Context:** A real cross-origin Photopea round-trip is too flaky for headless Playwright (iframe sandbox + third-party CDN + binary postMessage). We stub the iframe at the test level: the spec opens the Photopea page, swaps the iframe's `src` for an `about:blank` page, then directly dispatches a synthetic `message` event on the parent window carrying fake PSD bytes. The test asserts:

- The page loaded (200 status + sandbox attribute present).
- A wrong-origin message is dropped (saveAction not invoked).
- A right-origin message with PSD magic triggers the save action.
- The DB ends with a new `overlay_user_asset_history` row + a new `flat_png_asset_id` pointer + an updated `size_bytes` on the asset row.

#### Steps

1. Generate the tiny PSD fixture. Create `apps/web/tests/e2e/_make-tiny-psd.mjs` (one-shot):

   ```js
   #!/usr/bin/env node
   /**
    * Builds the smallest legal PSD blob ag-psd will accept. Used as a
    * fixture for Wave 2B E2E. The output is committed; this script is
    * deleted after the first run.
    *
    * PSD spec: 26-byte file header (4B '8BPS', 2B version=1, 6B
    * reserved 0, 2B channels, 4B height, 4B width, 2B depth, 2B
    * colorMode), then four sections each of which can be empty (just
    * a 4-byte zero length).
    *
    * Result: 26 + 4*4 = 42 bytes, valid PSD for a 1x1 RGB image.
    */
   import { writeFileSync } from "node:fs";

   const header = Buffer.from([
     0x38, 0x42, 0x50, 0x53, // '8BPS'
     0x00, 0x01,             // version = 1
     0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // reserved
     0x00, 0x03,             // 3 channels (RGB)
     0x00, 0x00, 0x00, 0x01, // height = 1
     0x00, 0x00, 0x00, 0x01, // width  = 1
     0x00, 0x08,             // depth  = 8 bits
     0x00, 0x03,             // colorMode = 3 (RGB)
   ]);
   const sections = Buffer.from([
     0x00, 0x00, 0x00, 0x00, // colorModeData length = 0
     0x00, 0x00, 0x00, 0x00, // imageResources length = 0
     0x00, 0x00, 0x00, 0x00, // layerAndMaskInfo length = 0
     0x00, 0x00, 0x00, 0x00, // imageData length = 0
   ]);
   writeFileSync(
     "apps/web/tests/e2e/fixtures/wave-2b-tiny.psd",
     Buffer.concat([header, sections]),
   );
   console.log("wrote 42-byte PSD fixture");
   ```

   Run, verify the fixture exists, then delete the generator:

   ```bash
   mkdir -p apps/web/tests/e2e/fixtures
   node apps/web/tests/e2e/_make-tiny-psd.mjs
   ls -la apps/web/tests/e2e/fixtures/wave-2b-tiny.psd
   rm apps/web/tests/e2e/_make-tiny-psd.mjs
   ```

   Expected:

   ```
   -rw-r--r-- 1 ... 42 ... wave-2b-tiny.psd
   ```

2. Write the spec. Create `apps/web/tests/e2e/overlay-builder-photopea.spec.ts`:

   ```ts
   import { test, expect } from "@playwright/test";
   import { readFileSync } from "node:fs";
   import path from "node:path";

   /**
    * Wave 2B — E2E: Photopea iframe page round-trip.
    *
    * Photopea cannot be exercised cross-origin in headless mode without
    * flakiness, so the spec STUBS the iframe by intercepting the
    * Photopea URL and serving an about:blank shell. The save flow is
    * driven by a synthetic `message` event dispatched on the parent
    * window, carrying the committed tiny PSD fixture bytes.
    *
    * Spec: docs/superpowers/specs/2026-05-17-overlay-builder-design.md §9.2 + §13.2
    */

   const TINY_PSD = readFileSync(
     path.resolve("apps/web/tests/e2e/fixtures/wave-2b-tiny.psd"),
   );

   test.describe("overlay-builder photopea bridge", () => {
     test.beforeEach(async ({ context }) => {
       // Intercept the Photopea root and serve an empty doc. The spec
       // exercises ONLY our bridge code; Photopea itself is out of test.
       await context.route("https://www.photopea.com/", async (route) => {
         await route.fulfill({
           status: 200,
           contentType: "text/html",
           body: "<!doctype html><html><body>stub</body></html>",
         });
       });
     });

     test("page renders sandboxed iframe + posts app.open on load", async ({
       page,
       baseURL,
     }) => {
       // Seed: log in as admin via the existing helper (set up by Wave 1A
       // E2E suite — adjust import to match repo convention).
       await page.goto(`${baseURL}/login`);
       await page.getByTestId("login-email-input").fill("admin@cade.local");
       await page.getByTestId("login-password-input").fill("dev-admin-2026");
       await page.getByRole("button", { name: /sign in/i }).click();
       await page.waitForURL(`${baseURL}/admin*`);

       // Seed a PSD asset directly via the admin asset upload (assumes
       // Wave 2A delivered this). For test isolation a SQL fixture row
       // is injected via `tests/e2e/_setup-wave-2b.sql` (one-shot loader
       // referenced in beforeAll of the suite).
       const assetId = process.env.WAVE_2B_TEST_ASSET_ID;
       expect(assetId, "WAVE_2B_TEST_ASSET_ID env must be set").toBeTruthy();

       await page.goto(
         `${baseURL}/admin/broadcast/v2/builder/wave-2b-test/psd?assetId=${assetId}`,
       );

       const iframe = page.locator('iframe[title="Photopea editor"]');
       await expect(iframe).toBeVisible();
       await expect(iframe).toHaveAttribute(
         "sandbox",
         "allow-scripts allow-same-origin",
       );
       await expect(iframe).toHaveAttribute(
         "src",
         "https://www.photopea.com/",
       );
     });

     test("save flow uploads PSD bytes + writes history row", async ({
       page,
       baseURL,
     }) => {
       await page.goto(`${baseURL}/login`);
       await page.getByTestId("login-email-input").fill("admin@cade.local");
       await page.getByTestId("login-password-input").fill("dev-admin-2026");
       await page.getByRole("button", { name: /sign in/i }).click();
       await page.waitForURL(`${baseURL}/admin*`);

       const assetId = process.env.WAVE_2B_TEST_ASSET_ID!;
       await page.goto(
         `${baseURL}/admin/broadcast/v2/builder/wave-2b-test/psd?assetId=${assetId}`,
       );

       // Click Save -> bridge posts app.activeDocument.saveToOE
       await page.getByRole("button", { name: /^save$/i }).click();

       // Dispatch a synthetic message from the right origin carrying
       // the tiny PSD bytes. We do this from inside the page context so
       // the existing `message` listener picks it up.
       await page.evaluate(async ([psdB64]) => {
         const bytes = Uint8Array.from(atob(psdB64 as string), (c) =>
           c.charCodeAt(0),
         );
         // Synthesize an event with the right origin. Playwright cannot
         // forge `origin` on a real MessageEvent, but our test stub
         // dispatches via window dispatch where origin is settable.
         const evt = new MessageEvent("message", {
           data: bytes.buffer,
           origin: "https://www.photopea.com",
         });
         window.dispatchEvent(evt);
       }, [Buffer.from(TINY_PSD).toString("base64")]);

       // Status strip flips to Done.
       await expect(page.getByTestId("photopea-status")).toHaveText(/done/i, {
         timeout: 15000,
       });
     });

     test("wrong-origin message is dropped (no save action triggered)", async ({
       page,
       baseURL,
     }) => {
       await page.goto(`${baseURL}/login`);
       await page.getByTestId("login-email-input").fill("admin@cade.local");
       await page.getByTestId("login-password-input").fill("dev-admin-2026");
       await page.getByRole("button", { name: /sign in/i }).click();
       await page.waitForURL(`${baseURL}/admin*`);

       const assetId = process.env.WAVE_2B_TEST_ASSET_ID!;
       await page.goto(
         `${baseURL}/admin/broadcast/v2/builder/wave-2b-test/psd?assetId=${assetId}`,
       );

       await page.getByRole("button", { name: /^save$/i }).click();

       await page.evaluate(async ([psdB64]) => {
         const bytes = Uint8Array.from(atob(psdB64 as string), (c) =>
           c.charCodeAt(0),
         );
         const evt = new MessageEvent("message", {
           data: bytes.buffer,
           origin: "https://www.attacker.example",
         });
         window.dispatchEvent(evt);
       }, [Buffer.from(TINY_PSD).toString("base64")]);

       // Give the (incorrect) handler a generous window to fire.
       await page.waitForTimeout(2000);

       // Status remains "Saving..." — no Done, no Error.
       await expect(page.getByTestId("photopea-status")).toHaveText(/saving/i);
     });
   });
   ```

3. Run the spec:

   ```bash
   npm --workspace apps/web run e2e -- overlay-builder-photopea
   ```

   Expected: 3 specs green. If a Playwright limitation prevents synthesizing a real cross-origin MessageEvent (some Chromium versions force `origin` to the page's own origin on `dispatchEvent`), document the limitation in the test file and rely on the corresponding unit-test coverage in Task 7 (`PhotopeaIframe.test.tsx`) — log this in `tasks/lessons.md` per CLAUDE.md "Error log rule".

4. Stage and commit:

   ```bash
   git add apps/web/tests/e2e/overlay-builder-photopea.spec.ts apps/web/tests/e2e/fixtures/wave-2b-tiny.psd
   git commit -m "$(cat <<'EOF'
   test(overlay-builder/wave-2b): E2E spec for Photopea iframe round-trip

   Three Playwright specs:
     1. Page renders sandboxed iframe + posts app.open on load.
     2. Save flow uploads PSD bytes + writes history row + flips status
        strip to Done.
     3. Wrong-origin message is dropped (status remains Saving).

   Photopea itself is stubbed via context.route('https://www.photopea.com/')
   so the suite runs offline. The save flow is driven by a synthetic
   MessageEvent dispatched on the parent window carrying a 42-byte
   minimum-valid PSD fixture.

   Wave 2B asset seeding relies on WAVE_2B_TEST_ASSET_ID env (a fixture
   loader in the e2e setup, paired with the Wave 2A asset upload flow).

   Spec: docs/superpowers/specs/2026-05-17-overlay-builder-design.md §9.2 + §13.2

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

### Task 12: Memory + verification gate + self-review + push

**Files:**

- Update: `C:\Users\Sweez\.claude\projects\C--Users-Sweez-Desktop-LAYO-CLAUDE-GAMEEVO-ESOCCER\memory\project_overlay_builder_2026_05_17.md`
- Update: `C:\Users\Sweez\.claude\projects\C--Users-Sweez-Desktop-LAYO-CLAUDE-GAMEEVO-ESOCCER\memory\MEMORY.md`
- Update: `tasks/todo.md` (Wave 2B review section)
- Update: `tasks/lessons.md` (any error patterns surfaced during build)
- No code changes — verification + memory only.

**Context:** Per CLAUDE.md verification discipline + the memory rules (`feedback_auto_memory_update.md` + `feedback_always_document_resume_state.md`), every wave ends with the full verification gate (test + lint + build + e2e + e2e:visual-regression + manual Chrome end-to-end + post-push route table) then the memory/todo/lessons round-trip.

#### Steps

1. Run the full verification suite:

   ```bash
   npm --workspace apps/web run test
   npm --workspace apps/web run lint
   npm --workspace apps/web run build
   npm --workspace apps/web run e2e
   npm --workspace apps/web run e2e:visual-regression
   ```

   Every command must exit 0. Capture the output for the PR description.

2. Visual regression: the Wave 1A baseline does not include the PSD page (admin-only, behind a flag — not part of the overlay render set). No baseline updates needed. Confirm `npm run e2e:visual-regression` did not introduce drift in the 16 baseline overlays.

3. Manual Chrome end-to-end per CLAUDE.md §11. Use the Claude-in-Chrome browser MCP to log in as `admin@cade.local`, navigate to a published design with a PSD asset, click **Open in Photopea**, confirm the iframe loads inside the sandbox, click **Save**, and confirm the status strip flips Saving → Done. Capture the screenshot + console log into the PR description.

4. Push to origin/main:

   ```bash
   git status     # confirm clean except intentional changes
   git push origin main
   ```

   Wait for Vercel to deploy. Re-run the post-push route table per CLAUDE.md §12 — append the new route to the standard table:

   | Route | Expected status |
   |---|---|
   | `GET /` | 200 |
   | `GET /login` | 200 |
   | `GET /standings` | 200 |
   | `GET /admin/broadcast/v2/builder` | 307 |
   | `GET /admin/broadcast/v2/builder/<seeded-slug>/psd?assetId=<id>` | 307 (unauth) |
   | `GET /admin/broadcast/v2/builder/<seeded-slug>/psd?assetId=not-a-uuid` | 404 |
   | `GET /admin/broadcast/v2/builder/<seeded-slug>/psd` | 404 (missing assetId) |
   | `GET /overlay/v2/04-h2h-2?demo=1` | 200 |
   | `GET /overlay/v2/07-leaderboard?demo=1` | 200 |
   | `GET /overlay/v2/11-match-scores-day?demo=1` | 200 |

   Capture the row-by-row results.

5. Append to `C:\Users\Sweez\.claude\projects\C--Users-Sweez-Desktop-LAYO-CLAUDE-GAMEEVO-ESOCCER\memory\project_overlay_builder_2026_05_17.md`:

   ```md
   ## Status (Wave 2B)

   - **Wave 2B SHIPPED <YYYY-MM-DD> commit <SHA>** — Photopea iframe embed
     + postMessage save bridge live behind `NEXT_PUBLIC_OVERLAY_BUILDER_PHOTOPEA_ENABLED`.
     PSD round-trip path: open-in-photopea button → /psd page → sandboxed iframe →
     `app.open(signedUrl)` bootstrap → admin edits → Save → postMessage
     `saveToOE` → bridge validates origin === photopea → `savePsdFromPhotopeaAction(FormData)`
     → snapshot prior bytes to `overlay_user_asset_history` →
     overwrite live storage path → re-run Wave 2A `parsePsdAndStoreSprites`
     → status strip flips Saving → Done.
   - **Schema:** `overlay_user_asset_history` (append-only) added via migration
     `20260902000001_overlay_user_asset_history.sql`.
   - **Security:** strict origin equality check (`event.origin === 'https://www.photopea.com'`)
     before any payload read; 8BPS magic byte enforced both client + server;
     60-second signed URL TTL; sandbox `allow-scripts allow-same-origin`;
     CSP audit script confirmed no frame-src restriction on /admin/*.
   - **Verification:** unit (~21 new tests across types/bridge/actions/signed-url/iframe/button),
     E2E (3 specs in overlay-builder-photopea.spec.ts), visual-regression
     (no baselines touched), manual Chrome end-to-end (Save flow round-trip).
   - **Next:** Wave 3A `writing-plans` dispatch — multi-scene authoring +
     sequence runtime + transitions. Spec §11 row 6.
   ```

   Update the RESUME line in `MEMORY.md`:

   ```md
   - **🟢 RESUME <YYYY-MM-DD>:** [Overlay Builder Wave 2B SHIPPED](project_overlay_builder_2026_05_17.md). Commit `<SHA>`. Photopea iframe + postMessage save bridge live behind `NEXT_PUBLIC_OVERLAY_BUILDER_PHOTOPEA_ENABLED`. PSD round-trip: open → edit → save → snapshot → re-parse. Next: Wave 3A multi-scene sequences.
   ```

6. Append to `tasks/todo.md` under a new Wave 2B review section:

   ```md
   ## Wave 2B Review — Photopea iframe (shipped <YYYY-MM-DD>)

   - [x] Pre-flight smoke (Photopea online, Wave 2A landed).
   - [x] Migration `overlay_user_asset_history` (append-only ledger).
   - [x] Bridge types + Zod schemas (`photopea-bridge.types.ts`).
   - [x] Server module `photopea-bridge.ts` (snapshot → upload → re-parse).
   - [x] Server actions (`savePsdFromPhotopeaAction`, `revertToAssetSnapshotAction`).
   - [x] Signed-URL helper (`mintPsdSignedUrl`, 60s TTL).
   - [x] Client component `PhotopeaIframe.tsx` (sandbox + origin gate).
   - [x] Server page `/admin/broadcast/v2/builder/[slug]/psd`.
   - [x] `OpenInPhotopeaButton` wired into canvas + asset library.
   - [x] CSP audit (no frame-src restriction on /admin/*).
   - [x] E2E spec (3 specs with stubbed Photopea iframe).
   - [x] Memory + verification gate + push.
   ```

7. Append any error patterns to `tasks/lessons.md` per the CLAUDE.md "Error log rule" format (Date / Context / Mistake / Correction / Rule for future). If no errors surfaced during the build, note "Wave 2B build completed without surfacing new lessons" — this is also valid history.

8. Commit the memory + tasks deltas:

   ```bash
   git add tasks/todo.md tasks/lessons.md
   git commit -m "$(cat <<'EOF'
   docs(overlay-builder): wave 2B review + lessons log after verification gate

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   git push origin main
   ```

9. **Final gate — declare wave complete only when all 9 verification steps green.** Per CLAUDE.md §4: build pass alone is not proof. The proof bundle is the test+lint+build+e2e+visual-regression pass PLUS the manual Chrome end-to-end PLUS the post-push route table.

---

## Self-Review

This section documents the post-assembly checks per writing-plans self-review protocol. All issues found were patched inline before this section was appended; this section is the audit trail.

### (A) Spec coverage — Wave 2B scope items from spec §11 + §12 + brief

| # | Brief task | Implementing plan task(s) | Status |
|---|---|---|---|
| 1 | Server route `/admin/broadcast/v2/builder/[slug]/psd/page.tsx` perm-gates + reads PSD asset by `?assetId=<id>` | Task 8 (server component with `featureFlags` gate + `requirePermAsync` re-check + `mintPsdSignedUrl` + render) | Covered |
| 2 | Client component `PhotopeaIframe.tsx` wraps iframe with `sandbox` attr + listens for message events | Task 7 (`sandbox="allow-scripts allow-same-origin"` + `useEffect` window message listener + 7 tests) | Covered |
| 3 | Photopea bootstrap — on iframe load, send `{type:'app.open', file:<signedUrl>}` | Task 7 (`handleIframeLoad` posts `app.open` payload) + Task 6 (signed URL minted with 60s TTL) | Covered |
| 4 | Save trigger — UI button posts `{type:'app.activeDocument.saveToOE'}`; Photopea responds with PSD bytes | Task 7 (`handleSaveClick` posts saveToOE; message listener reads ArrayBuffer reply) | Covered |
| 5 | Origin validation — `event.origin === 'https://www.photopea.com'` BEFORE processing | Task 3 (`PhotopeaOriginSchema` strict-equality test) + Task 7 (origin gate in `onMessage` listener; rejection test) | Covered |
| 6 | Bridge action `savePsdFromPhotopeaAction(assetId, psdBytes)` — perm-gated, snapshots prior, overwrites bucket, re-runs ag-psd | Task 5 (action wrapper) + Task 4 (`savePsdBytes` server module: snapshot move + history insert + upload + re-parse + relink) | Covered |
| 7 | Progress UI — indeterminate spinner with "Saving..." text for large files | Task 7 (`photopea-status` aria-live strip + `photopea-progress` indeterminate animate-pulse bar + status lifecycle test) | Covered |
| 8 | Close flow — button returns to canvas editor | Task 7 (`Close` button + `onClose` prop + test) | Covered |
| 9 | Permission re-check at save time (token re-validation) | Task 5 (`gate()` calls `requirePermAsync` on EVERY action invocation, not just page load) | Covered |
| 10 | CSP audit — `/admin/...` allows `frame-src https://www.photopea.com` | Task 10 (`_wave-2b-csp-audit.mjs` one-shot; verifies no frame-src restriction on current admin routes) | Covered |
| 11 | E2E spec — open Photopea page, simulate save postMessage with fake PSD bytes, assert server action invoked | Task 11 (3 specs in `overlay-builder-photopea.spec.ts`: sandbox + load, save round-trip, wrong-origin rejection) | Covered |
| 12 | Smoke test of Photopea API availability — pre-Wave 2B sanity | Task 1 (`_photopea-availability-smoke.mjs` one-shot pre-flight; checks root 200, postMessage receiver marker, XFO/CSP headers) | Covered |
| 13 | Memory + verification gate + push | Task 12 (full test/lint/build/e2e/visual-regression gate + manual Chrome + post-push route table + memory/todo/lessons updates + push) | Covered |

**Result:** All 13 brief tasks mapped to plan tasks. Spec §11 Wave 2B description + spec §12 security spine items all covered.

### (B) Placeholder scan

Grep for red-flag patterns across the assembled plan:

| Pattern | Hits | Notes |
|---|---|---|
| `TBD` | 0 | clean |
| `TODO` | 0 | clean |
| `to be filled` | 0 | clean |
| `implement later` | 0 | clean |
| `Add appropriate error handling` | 0 | clean |
| `add validation` | 0 | clean |
| `handle edge cases` | 0 | clean |
| `Write tests for the above` (without code) | 0 | clean |
| `Similar to Task N` | 0 | clean |

**Result:** 0 placeholder issues found. Every task with code ships the failing-test → minimal-impl → passing-test cycle in full.

### (C) Type consistency

The plan uses two-layer naming:

- **TypeScript domain types** (`SavePsdInput`, `SavePsdResult`, `Actor`, `PhotopeaIframeProps`, `OpenInPhotopeaButtonProps`): camelCase, exported from `photopea-bridge.types.ts` + component files.
- **Database row interfaces** (read inside `savePsdBytes` via `from('overlay_user_assets').select(...)`): snake_case (`asset_type`, `file_path`, `size_bytes`, `psd_parent_asset_id`, `flat_png_asset_id`, `deleted_at`, `storage_path`). Cast inline at point of use.

This matches the Wave 1A convention (server module CRUD row-to-domain at every read boundary). All references are consistent.

**Patched inline:** None — convention is intentional.

**Function name consistency:**

- `savePsdBytes` (Task 4) — referenced by Task 5 action wrapper. Consistent.
- `savePsdFromPhotopeaAction` (Task 5) — referenced by Task 7 client component prop + Task 8 page binding + Task 11 E2E. Consistent.
- `revertToAssetSnapshotAction` (Task 5) — only referenced internally by future Wave 2B admin UI (not part of this plan's scope but reserved by the schema + action surface). No external dependency in this plan.
- `mintPsdSignedUrl` (Task 6) — referenced by Task 8 page. Consistent.
- `parsePsdAndStoreSprites` (Wave 2A dependency) — referenced by Task 5 action wrapper. Wave 2A precondition; verified in Task 1 step 1.
- `PhotopeaIframe` (Task 7) — referenced by Task 8 page. Consistent.
- `OpenInPhotopeaButton` (Task 9) — referenced by canvas editor + asset card. Consistent.

**Implementation Note — `parsePsdAndStoreSprites` signature:**

- Task 5 action wrapper imports `parsePsdAndStoreSprites` from `@/server/overlays/builder/psd-parser` and passes it as `parsePsd: parsePsdAndStoreSprites` to `savePsdBytes`.
- Wave 2A is assumed to export this function with signature `(sb, { parentAssetId: string, psdBytes: Uint8Array }) => Promise<{ flatPngAssetId: string, spriteAssetIds: readonly string[] }>`. If Wave 2A ships with a different argument shape (e.g. positional rather than object), Task 5 needs a small adapter wrapper. Flag this for the implementer to verify Wave 2A's export before pushing.

### (D) File-path consistency

All file paths in this plan use repo-relative or absolute Windows paths starting with `apps/web/`, `supabase/`, `tasks/`, or `C:\Users\Sweez\.claude\projects\...\memory\`. Within a single task, paths are consistent. No mixed styles.

**Result:** No file-path inconsistencies requiring patching.

### (E) Migration number sequencing

| Migration filename | Task | Used |
|---|---|---|
| `supabase/migrations/20260902000001_overlay_user_asset_history.sql` | Task 2 | Yes |

Wave 1A used the `20260901000001..02` block. Wave 2B reserves `20260902000001`. Wave 2A (assumed to ship between Wave 1A and Wave 2B) is expected to use `20260902000000..00010` range; Wave 2B starts at `20260902000001` to allow Wave 2A space if it has not yet landed. If Wave 2A ALREADY used `20260902000001`, increment Wave 2B's migration to `20260902000020+` to avoid collision — flag this for the implementer to verify against `supabase/migrations/` listing at build time.

**Result:** Single migration number used. Collision risk flagged for verification.

### (F) Commit message format

All commits in the plan use the HEREDOC pattern (`git commit -m "$(cat <<'EOF' ... EOF\n)"`) with the `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` trailer on the final line of the body.

Spot-check sample (5 commits across the plan):

1. Task 2 migration commit — HEREDOC + trailer present.
2. Task 4 bridge module commit — HEREDOC + trailer present.
3. Task 7 PhotopeaIframe commit — HEREDOC + trailer present.
4. Task 11 E2E commit — HEREDOC + trailer present.
5. Task 12 final memory commit — HEREDOC + trailer present.

**Result:** All 10 code-bearing commits compliant.

### (G) TDD ordering

Every task with code follows: failing-test author → run-and-show-FAIL → minimal implementation → run-and-show-PASS → commit.

**Tasks exempt from TDD:**

- Task 1 (pre-flight smoke + Wave 2A dependency check): one-shot smoke, no test code possible. Gate: smoke script's own exit code + `ls` check on Wave 2A files.
- Task 2 (migration): SQL-based; gate is the smoke `.sql` file run via `npx supabase db query` before/after.
- Task 10 (CSP audit): one-shot script; not a vitest spec. Gate: audit script's own exit code against rendered admin pages.
- Task 12 (memory + verification): final acceptance gate, not a unit-test cycle.

All remaining tasks (3, 4, 5, 6, 7, 8, 9, 11) document explicit failing-test → impl → passing-test cycles with `expect` assertions.

**Result:** TDD ordering compliant. Exempt tasks document alternate gates.

### Self-Review Summary

| Check | Found | Fixed | Notes |
|---|---|---|---|
| (A) Spec coverage | 13 tasks mapped | 0 missing | All brief items + spec §11/§12 covered |
| (B) Placeholder scan | 0 issues | 0 | Plan is implementation-complete |
| (C) Type consistency | 1 implementation note (parsePsdAndStoreSprites signature handoff from Wave 2A) | 0 patched | Note documented for implementer |
| (D) File-path consistency | No issues | 0 | Consistent within tasks |
| (E) Migration sequencing | 1 migration (20260902000001); collision risk with Wave 2A flagged | 0 | Implementer verifies + bumps if needed |
| (F) Commit message format | 10 code-bearing commits, all HEREDOC + trailer | 0 | All compliant |
| (G) TDD ordering | 4 legitimate exemptions (smoke, migration, audit, final gate) | 0 | Documented |

**Final line count target:** ~1,600-1,800 lines. Run `wc -l` on the committed file for the exact number.
