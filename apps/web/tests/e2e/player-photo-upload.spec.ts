import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as path from "node:path";
import * as fs from "node:fs";

/**
 * Plan 53 follow-up — E2E spec for the photo upload widget (T13).
 *
 * Walk:
 *   1. Login as admin.
 *   2. Visit /admin/broadcast/v2/design.
 *   3. Open Mr Oga's photo modal via the launcher card
 *      (`player-photo-card-mr_oga`).
 *   4. Click "+ Upload" — the lazy-loaded `PlayerPhotoUploadWidget` mounts.
 *   5. Switch upload mode to "Multi / ZIP from _process.py".
 *   6. setInputFiles 6 in-memory 1x1 transparent PNGs named per the
 *      `<variant>_<NN>[_nobg].<ext>` regex. All three coverage signals
 *      (`headshot_nobg`, `card`, `fullbody_nobg`) are present so the new
 *      uploaded pose lands with the "FULL" coverage badge.
 *   7. Click "Process & upload". The widget runs the 3-step flow:
 *        a) POST `/api/broadcast/v2/photos/uploads/url` → `{uploadId, uploads[]}`.
 *        b) PUT each blob to its signed Supabase storage URL.
 *        c) POST `/api/broadcast/v2/photos/uploads/<id>/finalize` with
 *           the `variants` map → DB row flips to `status='ready'` and
 *           gets the next `pose_index >= 100`.
 *      Afterwards `props.onComplete()` fires and the modal calls
 *      `loadGallery()` so the new uploaded pose appears in the gallery.
 *   8. Assert:
 *        - The widget's button reaches the "done" status text.
 *        - A `player_photo_uploads` row exists for Mr Oga with
 *          `status='ready'`, `pose_index >= 100`, all 6 variants_json keys.
 *        - The gallery refresh repaints with the new uploaded pose.
 *
 * Mode A (single auto-strip via @imgly) is intentionally skipped — the
 * @imgly bg-removal lib lazy-fetches a ~40MB ONNX model from a CDN on
 * first use, which is too flaky for E2E (network-dependent, ~10s+ load
 * on cold cache, would timeout on CI runners). A `test.skip` stub
 * documents the intent so a future engineer can wire it once we control
 * the model fetch (e.g. shipping the WASM payload locally).
 *
 * Cleanup:
 *   - Soft-delete every `player_photo_uploads` row this test created
 *     for Mr Oga. Cleanup is idempotent — if the test fails mid-flight
 *     we still leave the DB clean.
 *   - We deliberately do NOT touch the storage bucket: the rows are
 *     soft-deleted, so the gallery hides them. Hard-deleting orphan
 *     blobs would race other tests.
 */

const ADMIN_EMAIL = "admin@cade.local";
const ADMIN_PASSWORD = "dev-admin-2026";
const MR_OGA_SLUG = "mr_oga";
const MR_OGA_GAMER_TAG_NORMALIZED = "MROGA";

function loadEnv() {
  const p = path.resolve(__dirname, "..", "..", ".env.local");
  if (!fs.existsSync(p)) return;
  const text = fs.readFileSync(p, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}

function svc(): SupabaseClient | null {
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function login(page: Page): Promise<boolean> {
  try {
    await page.goto("/login");
    await page.getByLabel("Email").fill(ADMIN_EMAIL);
    // `getByLabel('Password')` is ambiguous after the show-password
    // toggle (2026-04 wave) — the toggle button's `aria-label="Show
    // password"` matches the same accessible label and trips strict
    // mode. Use the dedicated input testid (precedent: T14 spec).
    await page.getByTestId("login-password-input").fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: /Continue/i }).click();
    await expect(page).toHaveURL(/\/admin/, { timeout: 30_000 });
    return true;
  } catch {
    return false;
  }
}

function normalizeTag(s: string): string {
  return s.toUpperCase().replace(/[\s_]+/g, "");
}

async function findMrOgaPlayerId(sb: SupabaseClient): Promise<string | null> {
  const { data } = await sb
    .from("players")
    .select("id, gamer_tag")
    .is("deleted_at", null);
  if (!data || data.length === 0) return null;
  type Row = { id: string; gamer_tag: string | null };
  const match = (data as Row[]).find(
    (r) => r.gamer_tag && normalizeTag(r.gamer_tag) === MR_OGA_GAMER_TAG_NORMALIZED,
  );
  return match?.id ?? null;
}

/**
 * Soft-delete every `player_photo_uploads` row for Mr Oga whose
 * `pose_index` is in the test-uploaded range (>= 100). Used in setup
 * (so the `pose_index = max + 1` allocator stays predictable) AND
 * teardown (so repeat runs stay clean). Idempotent.
 */
async function cleanupTestUploads(
  sb: SupabaseClient,
  playerId: string,
): Promise<void> {
  await sb
    .from("player_photo_uploads")
    .update({ deleted_at: new Date().toISOString() })
    .eq("player_id", playerId)
    .gte("pose_index", 100)
    .is("deleted_at", null);
  // Also wipe any rows we created that never reached `ready` status
  // (e.g. earlier failed runs left `status='uploading'` rows with
  // `pose_index = null`). Without this they pollute the row list and
  // (more importantly) leave dangling raw/<uploadId>/* storage paths.
  await sb
    .from("player_photo_uploads")
    .update({ deleted_at: new Date().toISOString() })
    .eq("player_id", playerId)
    .is("pose_index", null)
    .is("deleted_at", null);
}

/**
 * Canonical 1x1 transparent PNG byte sequence. Suitable as a placeholder
 * in any flow that just cares about "is this a parseable PNG?". The
 * upload widget treats the file as an opaque blob (Mode B doesn't
 * decode), and Supabase storage accepts any bytes through a signed PUT
 * URL, so size doesn't matter for the test.
 */
const TINY_PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44,
  0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89, 0, 0, 0,
  13, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x62, 0, 0, 0, 0, 0, 5, 0, 1, 0x0d,
  0x0a, 0x2d, 0xb4, 0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

/** The 6 filenames `_process.py` produces per pose. All 3 required
 *  coverage keys (`headshot_nobg`, `card`, `fullbody_nobg`) are present
 *  so the new pose lands with the "FULL" badge.
 */
const FIXTURE_FILES = [
  "headshot_100.png",
  "headshot_100_nobg.png",
  "card_100.png",
  "card_100_nobg.png",
  "fullbody_100.png",
  "fullbody_100_nobg.png",
] as const;

test.setTimeout(240_000);

test("admin uploads multi-file pose set and gallery refreshes", async ({
  page,
}) => {
  const sb = svc();
  test.skip(!sb, "service-role client unavailable — check .env.local");

  // ---- Setup ------------------------------------------------------------
  const mrOgaId = await findMrOgaPlayerId(sb!);
  test.skip(!mrOgaId, "Mr Oga player row not found in DB");

  // Wipe any prior test uploads so the pose_index allocator (max + 1)
  // stays predictable. Without this a leftover row at pose_index 250
  // would push the new pose to 251 and the assertion below would still
  // pass — but the gallery would also show the stale pose.
  await cleanupTestUploads(sb!, mrOgaId!);

  try {
    // ---- Drive the UI ---------------------------------------------------
    const ok = await login(page);
    test.skip(!ok, "login failed; dev server unreachable");

    // `networkidle` lets the design page's lazy chunks (OverlayDesignEditor
    // + PlayerPhotoPanel) settle before we click. Without this the lazy
    // modal chunk can race the navigation; <Suspense fallback={null}>
    // gives no visible hint while the chunk compiles. Same precedent as
    // T14 spec.
    await page.goto("/admin/broadcast/v2/design", {
      waitUntil: "networkidle",
    });
    await expect(page.getByTestId("player-photo-panel")).toBeVisible({
      timeout: 30_000,
    });

    // Open Mr Oga's modal via the launcher card.
    const mrOgaCard = page.getByTestId(`player-photo-card-${MR_OGA_SLUG}`);
    await expect(mrOgaCard).toBeVisible({ timeout: 15_000 });
    await mrOgaCard.scrollIntoViewIfNeeded();
    await mrOgaCard.click();

    // The modal renders a `role="dialog"` wrapper regardless of gallery
    // load state — wait on it to confirm the lazy chunk resolved.
    const dialog = page.getByRole("dialog", { name: /photo picker/i });
    await expect(dialog).toBeVisible({ timeout: 60_000 });

    // Wait for the gallery itself to load (otherwise the "+ Upload"
    // button isn't rendered yet — it lives in the global-default
    // section). The "Per-overlay overrides" header is the load-bearing
    // signal that `loadGallery()` resolved.
    await expect(
      dialog.getByRole("heading", { name: /Per-overlay overrides/i }),
    ).toBeVisible({ timeout: 30_000 });

    // Click "+ Upload" → mounts <PlayerPhotoUploadWidget> via React.lazy.
    await dialog.getByRole("button", { name: /\+ Upload/ }).click();

    // The widget's testid (`player-photo-upload-widget`) is the
    // load-bearing signal that the lazy chunk resolved.
    const widget = page.getByTestId("player-photo-upload-widget");
    await expect(widget).toBeVisible({ timeout: 30_000 });

    // Switch to multi mode. The widget defaults to "single" — one click
    // on the second radio is enough.
    const multiRadio = widget.locator('input[type="radio"]').nth(1);
    await multiRadio.check();
    await expect(multiRadio).toBeChecked();

    // Drop the 6 fixture files into the file input. Playwright's
    // setInputFiles accepts in-memory blobs via `{name, mimeType, buffer}`
    // so we don't need to write anything to disk.
    const fileInput = widget.locator('input[type="file"]');
    await fileInput.setInputFiles(
      FIXTURE_FILES.map((name) => ({
        name,
        mimeType: "image/png",
        buffer: TINY_PNG,
      })),
    );

    // Click "Process & upload". The widget runs:
    //   1. POST /api/broadcast/v2/photos/uploads/url → uploadId + signed PUT URLs.
    //   2. PUT each blob to its signed URL.
    //   3. POST /api/broadcast/v2/photos/uploads/<id>/finalize.
    // Capture the URL response so we can correlate the returned
    // uploadId with the DB row we'll inspect.
    //
    // The submit button is the FIRST `<button>` inside the widget's
    // bottom action row (the second is "Cancel"). We anchor on
    // position rather than text — `{children}` is `{status === 'idle'
    // ? 'Process & upload' : status}` so the textual filter goes stale
    // the moment the click fires.
    const submitButton = widget
      .locator(".mt-2 button[type='button']")
      .first();
    const [urlResponse] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes("/api/broadcast/v2/photos/uploads/url") &&
          r.request().method() === "POST",
        { timeout: 60_000 },
      ),
      submitButton.click(),
    ]);
    expect(urlResponse.status()).toBe(200);
    const urlJson = (await urlResponse.json()) as {
      uploadId: string;
      uploads: { uploadUrl: string; publicUrl: string }[];
    };
    expect(urlJson.uploadId).toBeTruthy();
    expect(urlJson.uploads).toHaveLength(FIXTURE_FILES.length);

    // Wait for the finalize POST to land. The widget transitions
    //   processing -> uploading -> finalizing -> done
    // synchronously inside a single promise chain. Once `done` is set
    // the modal's `onComplete` callback fires, which calls
    // `setShowUpload(false)` and unmounts the widget — so the "done"
    // text is fleeting. The finalize POST itself is the stable signal.
    const finalizeResponse = await page.waitForResponse(
      (r) =>
        r.url().includes(`/uploads/${urlJson.uploadId}/finalize`) &&
        r.request().method() === "POST",
      { timeout: 90_000 },
    );
    expect(finalizeResponse.status()).toBe(200);
    const finalizeJson = (await finalizeResponse.json()) as {
      poseIndex: number;
    };
    expect(finalizeJson.poseIndex).toBeGreaterThanOrEqual(100);

    // ---- Verify DB row landed cleanly -----------------------------------
    const { data: persisted } = await sb!
      .from("player_photo_uploads")
      .select("id, pose_index, status, upload_mode, variants_json")
      .eq("player_id", mrOgaId!)
      .eq("status", "ready")
      .is("deleted_at", null)
      .gte("pose_index", 100)
      .order("uploaded_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    expect(persisted).toBeTruthy();
    type UploadRow = {
      id: string;
      pose_index: number;
      status: string;
      upload_mode: string;
      variants_json: Record<string, string> | null;
    };
    const row = persisted as UploadRow;
    expect(row.status).toBe("ready");
    expect(row.upload_mode).toBe("multi");
    expect(row.pose_index).toBe(finalizeJson.poseIndex);
    // All 6 variant keys must have been recorded — that's how the
    // gallery determines `coverage='full'`.
    const variants = row.variants_json ?? {};
    for (const key of [
      "headshot",
      "headshot_nobg",
      "card",
      "card_nobg",
      "fullbody",
      "fullbody_nobg",
    ]) {
      expect(variants[key]).toBeTruthy();
    }

    // ---- Verify the gallery refreshed in-modal --------------------------
    // The widget's `onComplete` callback runs `setShowUpload(false)`
    // (unmounts the widget) + `loadGallery()` (re-fetches). The new
    // uploaded pose then appears in the global-default row with a
    // "FULL" badge (per `gallery.ts::UploadCoverage = 'full' when
    // hasHead && hasCard && hasFull`). The badge sits inside the
    // upload-pose button as a `<span>` with text `full` (lowercase
    // per the gallery code).
    //
    // Use toHaveCount(0) instead of toBeHidden — the widget is fully
    // unmounted, not just hidden, and toBeHidden waits for a *visible*
    // element to flip rather than checking presence.
    await expect(widget).toHaveCount(0, { timeout: 30_000 });
    const newPoseButton = dialog
      .locator(`button[title*="upload pose ${finalizeJson.poseIndex}"]`)
      .first();
    await expect(newPoseButton).toBeVisible({ timeout: 30_000 });
    await expect(newPoseButton).toContainText(/full/i);
  } finally {
    // ---- Cleanup --------------------------------------------------------
    if (mrOgaId) {
      await cleanupTestUploads(sb!, mrOgaId);
    }
  }
});

// Mode A (single auto-strip via @imgly) is intentionally NOT exercised
// here. The `@imgly/background-removal` lib lazy-fetches a ~40MB ONNX
// model from a CDN on first use. The fetch is network-dependent, takes
// ~10s+ on cold cache, and frequently flakes on CI runners with strict
// egress firewalls. The skip stub documents the intent — a future
// engineer can wire it once we control the model artifact (e.g. ship
// the WASM payload as a static asset under /public/onnx/).
test.skip("admin uploads single auto-strip photo (Mode A) — DEFERRED", async () => {
  // Intentional skip; see comment above.
});
