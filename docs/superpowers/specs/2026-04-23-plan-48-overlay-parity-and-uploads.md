# Plan 48 — Overlay 1920×1080 parity + off-triggers + asset uploads

**Owner:** Spektakula
**Date:** 2026-04-23
**Status:** Approved
**Depends on:** Plan 12 (overlay bridge), Plan 16 Wave A (motion ports), Plan 37 (active_instances + clear), Plan 45 (structured forms)

---

## Goals

1. **1920×1080 parity.** Every overlay route under `(overlay)/overlay/<key>` must render at exactly 1920×1080 CSS pixels as its root frame. Content scales/positions against that. OBS browser-source at 1920×1080 should match 1:1.
2. **Design parity with HTML references.** The 27 HTML files in `KNOWLEDGE/brand-assets/elements/` are the canonical design. Every overlay page must visually match its reference within reason (colours, typography, spacing, animation timings). Where a page drifted during Wave A, re-align.
3. **Off-trigger for every template.** Each template's admin card gets a "Trigger OFF" button that clears that instance from on-stream. Missing today for most templates.
4. **File uploads for image + video payload fields.** Currently admin pastes URLs. Replace with inline upload → Supabase Storage → fills the payload field automatically.

---

## Success criteria

1. Load any overlay page with `?preview=1` and inspect: root element is `width: 1920px; height: 1080px`, no overflow, content positions against those dims. Browser source at 1920×1080 shows pixel-perfect render.
2. For each of the 27 templates, the rendered overlay looks like its reference HTML (side-by-side screenshot within acceptable delta — colours, layout, typography within ±5%).
3. Every template card in `/admin/broadcast/[sessionId]` has both a trigger button AND a "Trigger OFF" button. OFF clears the current instance via `clearOverlayAction` or `clearInstanceAction` as appropriate.
4. Admin trigger forms: fields of type `photoUrl`, `cardImageUrl`, `adVideoUrl`, `adPosterUrl`, and any `*_image_url` / `*_video_url` get a file-upload widget above the URL field. Upload → signed PUT → fills URL. Accept: jpg/png/webp for images; mp4/webm for video. Max: 10MB image, 100MB video.

---

## Architecture

### 3.1 1920×1080 root

`apps/web/src/app/(overlay)/layout.tsx` already sets transparent body. Extend: every child overlay page root element = `<div data-overlay-root className="relative w-[1920px] h-[1080px] overflow-hidden">`. Add a shared `<OverlayFrame>` component that wraps children in this root. Migrate each of the 27 overlay `page.tsx` files to use it.

### 3.2 Design parity pass

For each of the 27 templates:
- Open the reference HTML in `KNOWLEDGE/brand-assets/elements/<file>.html`.
- Extract: bg colour / gradient, font family, title text size + weight, keyframe timings, accent bar colour + size, logo placement + size, player-photo crop + size.
- Compare to current `/overlay/<key>/page.tsx`.
- Patch discrepancies. The reference is the source of truth.

Focus on the 5 most-used first (score-bug, lower-third, up-next-bug, layout-timer, stinger-goal). Others follow.

### 3.3 Off-triggers

For templates using `overlay_events` (Plan 12): add per-template "Trigger OFF" → calls `clearOverlayAction(eventId, sessionId)` against the latest live event.

For templates using `active_instances` (Plan 37 multi-instance — lower_third, score_bug, up_next_bug, layout_timer): add "Trigger OFF" → `clearInstanceAction(sessionId, templateKey, instanceSlot)`.

For score_bug specifically (Plan 45 shipped `clearScoreBugAction`): already done; ensure button is present.

Add a generic `<OffTriggerButton templateKey instance?>` component mounted inside `EditableTemplatePanel` + every trigger form card.

### 3.4 File upload widgets

New component `<AssetUploader kind="image"|"video" onUploaded={(url) => setFormValue}>`:
- Renders a "Upload file" button + hidden `<input type="file">`.
- On file select: calls new server action `requestOverlayAssetUploadUrl(kind, filename)` which returns a signed Supabase Storage PUT URL for bucket `overlay-assets` (public-read).
- PUT the file directly to Storage.
- On success, calls `onUploaded(publicUrl)` → caller fills the URL text input.
- Shows progress + file-size validation client-side.

Migration `supabase/migrations/20260512000100_plan48_overlay_assets_bucket.sql`:
- `insert into storage.buckets (id, name, public) values ('overlay-assets', 'overlay-assets', true) on conflict do nothing;`
- RLS: service-role writes; public reads.

Server module `apps/web/src/server/overlays/asset_upload.ts`:
- `requestUploadUrl({ kind, filename, actor })` — returns `{ uploadUrl, publicUrl }`. Perm-gated on `broadcast.trigger`.

---

## Implementation order (agent brief)

Ship in this order (each stage verifiable):

1. **Migration + server helper** for overlay-assets bucket.
2. **`<AssetUploader>` component** + wire into `EditableTemplatePanel` form fields that look like `*url` with image/video type inference.
3. **Universal `<OffTriggerButton>`** in every template card.
4. **`<OverlayFrame>` 1920×1080 wrapper** + migrate all 27 overlay pages to use it.
5. **Design parity pass** on 5 priority overlays (score_bug, lower_third, up_next_bug, layout_timer, stinger_goal).

## Tests

- `asset_upload.test.ts` — signed-URL happy path, perm gate, file-size refusal.
- RTL test for `AssetUploader` — file select → upload → callback fires.
- RTL test for `OffTriggerButton` — clicking calls correct server action based on template key.
- E2E smoke: admin opens broadcast, triggers score-bug → clicks Trigger OFF → overlay clears.
- Visual regression (manual): capture 1920×1080 screenshots of 5 priority overlays, compare to reference HTML screenshots.

## Rollout risks

- Existing player-photo URLs stay valid. Upload widget is additive; URL paste still works.
- 1920×1080 wrapper may zero out responsive behaviour for small-screen preview. Include `?preview=1` flag that scales via CSS transform for preview harness.
- Design-parity pass is visual; use reference HTMLs as judge.
