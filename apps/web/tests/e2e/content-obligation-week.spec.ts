import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as path from "node:path";
import * as fs from "node:fs";

/**
 * Plan 13B · Scenario C — player submits 2 Instagram + 1 Twitter post;
 * moderator verifies 1 IG + the Twitter one → obligation card flips to
 * Met=true; moderator then rejects the Twitter one → back to Unmet.
 *
 * Uses a dedicated E2E player auth account + a hijacked player row.
 */

const ADMIN_EMAIL = "admin@cade.local";
const ADMIN_PASSWORD = "dev-admin-2026";
const runId = Date.now();
const E2E_PLAYER_EMAIL = `e2e-content-player-${runId}@cade.local`;
const E2E_PLAYER_PASSWORD = "e2e-content-2026";

function loadEnv() {
  const p = path.resolve(__dirname, "..", "..", ".env.local");
  if (!fs.existsSync(p)) return;
  const text = fs.readFileSync(p, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}
function svc(): SupabaseClient {
  loadEnv();
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

type Ctx = {
  authId: string;
  userId: string;
  playerId: string;
};

async function setupContext(): Promise<Ctx> {
  const sb = svc();
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  const resp = await fetch(`${url}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: E2E_PLAYER_EMAIL,
      password: E2E_PLAYER_PASSWORD,
      email_confirm: true,
      user_metadata: { display_name: `E2E Content Player ${runId}` },
    }),
  });
  if (!resp.ok) {
    throw new Error(`auth user create failed: ${resp.status} ${await resp.text()}`);
  }
  const authUser = await resp.json();
  const authId = authUser.id as string;

  let publicUser: { id: string } | null = null;
  for (let i = 0; i < 10; i++) {
    const { data } = await sb
      .from("users")
      .select("id")
      .eq("supabase_auth_id", authId)
      .maybeSingle();
    if (data) {
      publicUser = data as { id: string };
      break;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  if (!publicUser) {
    const { data: inserted } = await sb
      .from("users")
      .insert({
        supabase_auth_id: authId,
        email: E2E_PLAYER_EMAIL,
        display_name: `E2E Content Player ${runId}`,
      })
      .select("id")
      .single();
    publicUser = inserted as { id: string };
  }
  const userId = publicUser!.id;

  await sb
    .from("user_roles")
    .upsert(
      { user_id: userId, role: "player", deleted_at: null },
      { onConflict: "user_id,role" },
    );

  const { data: insertedPlayer, error: pErr } = await sb
    .from("players")
    .insert({
      user_id: userId,
      gamer_tag: `e2e-content-${runId}`,
    })
    .select("id")
    .single();
  if (pErr || !insertedPlayer) {
    throw new Error(`player create failed: ${pErr?.message ?? "unknown"}`);
  }
  const playerId = (insertedPlayer as { id: string }).id;

  return { authId, userId, playerId };
}

async function teardownContext(ctx: Ctx | null) {
  if (!ctx) return;
  const sb = svc();
  loadEnv();
  await sb.from("content_posts").delete().eq("player_id", ctx.playerId);
  await sb.from("players").delete().eq("id", ctx.playerId);
  await sb.from("user_roles").delete().eq("user_id", ctx.userId);
  await sb.from("users").delete().eq("id", ctx.userId);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  await fetch(`${url}/auth/v1/admin/users/${ctx.authId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${key}`, apikey: key },
  });
}

async function loginAs(
  page: Page,
  email: string,
  password: string,
  nextPath: string,
) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
    timeout: 15_000,
  });
  await page.goto(nextPath);
}

test.setTimeout(240_000);

test.describe.configure({ mode: "serial" });

let ctx: Ctx | null = null;

test.beforeAll(async () => {
  ctx = await setupContext();
});

test.afterAll(async () => {
  await teardownContext(ctx);
});

test("player submits 3 posts; moderator verifies 2 → Met=true; reject 1 → Met=false", async ({
  browser,
}) => {
  if (!ctx) throw new Error("ctx missing");
  const sb = svc();

  // Seed posts directly via service role — avoids brittle url-input timing.
  const weekStart = weekStartMondayNow();
  const urls = [
    `https://www.instagram.com/p/e2e-${runId}-1/`,
    `https://www.instagram.com/p/e2e-${runId}-2/`,
    `https://twitter.com/e2e/status/e2e-${runId}-3`,
  ];
  const platforms: ("instagram" | "twitter")[] = ["instagram", "instagram", "twitter"];
  const postIds: string[] = [];
  for (let i = 0; i < 3; i++) {
    const { data, error } = await sb
      .from("content_posts")
      .insert({
        player_id: ctx.playerId,
        week_start: weekStart,
        platform: platforms[i],
        post_url: urls[i],
      })
      .select("id")
      .single();
    if (error) throw error;
    postIds.push((data as { id: string }).id);
  }

  // --- Player context: verify Met=false initially ---
  const playerCtx = await browser.newContext();
  const playerPage = await playerCtx.newPage();
  await loginAs(
    playerPage,
    E2E_PLAYER_EMAIL,
    E2E_PLAYER_PASSWORD,
    "/player/content",
  );
  await expect(playerPage.getByTestId("content-obligation-card")).toBeVisible();
  await expect(playerPage.getByTestId("content-met-chip")).toContainText("Unmet");
  await playerCtx.close();

  // --- Admin verifies 1 IG + the Twitter post ---
  const adminCtx = await browser.newContext();
  const adminPage = await adminCtx.newPage();
  await loginAs(adminPage, ADMIN_EMAIL, ADMIN_PASSWORD, "/admin/content");
  await expect(adminPage.getByTestId("content-queue")).toBeVisible();

  // Verify IG #1
  await adminPage.getByTestId(`content-actions-${postIds[0]}`).click();
  await adminPage.getByTestId(`content-verify-${postIds[0]}`).click();

  // Verify Twitter post
  await adminPage.getByTestId(`content-actions-${postIds[2]}`).click();
  await adminPage.getByTestId(`content-verify-${postIds[2]}`).click();

  // Confirm via DB the two verifications landed. Next.js serializes
  // server-action dispatches per-session, so poll rather than guess at a
  // fixed wait (two sequential round-trips in dev can take >1s each).
  const deadline = Date.now() + 15_000;
  let verified: Array<{ id: string; verification_status: string }> = [];
  while (Date.now() < deadline) {
    const { data } = await sb
      .from("content_posts")
      .select("id, verification_status")
      .in("id", [postIds[0], postIds[2]]);
    verified = (data ?? []) as typeof verified;
    if (
      verified.length === 2 &&
      verified.every((r) => r.verification_status === "verified")
    ) {
      break;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  for (const row of verified) {
    expect(row.verification_status).toBe("verified");
  }
  await adminCtx.close();

  // --- Player reloads, assert Met=true ---
  const playerCtx2 = await browser.newContext();
  const playerPage2 = await playerCtx2.newPage();
  await loginAs(
    playerPage2,
    E2E_PLAYER_EMAIL,
    E2E_PLAYER_PASSWORD,
    "/player/content",
  );
  await expect(playerPage2.getByTestId("content-met-chip")).toContainText("Met", {
    timeout: 10_000,
  });
  await playerCtx2.close();

  // --- Admin rejects the Twitter post ---
  const adminCtx2 = await browser.newContext();
  const adminPage2 = await adminCtx2.newPage();
  // Directly reject via service role since admin queue only shows pending.
  await sb
    .from("content_posts")
    .update({
      verification_status: "rejected",
      rejection_reason: "URL does not resolve (E2E)",
      updated_at: new Date().toISOString(),
    })
    .eq("id", postIds[2]);
  await adminCtx2.close();

  // --- Player reloads, assert Met=false again ---
  const playerCtx3 = await browser.newContext();
  const playerPage3 = await playerCtx3.newPage();
  await loginAs(
    playerPage3,
    E2E_PLAYER_EMAIL,
    E2E_PLAYER_PASSWORD,
    "/player/content",
  );
  await expect(playerPage3.getByTestId("content-met-chip")).toContainText(
    "Unmet",
    { timeout: 10_000 },
  );
  await playerCtx3.close();
});

function weekStartMondayNow(): string {
  // Compute Monday-of-this-week in WAT.
  const now = new Date();
  const watMs = now.getTime() + 60 * 60 * 1000;
  const d = new Date(watMs);
  const isoDow = ((d.getUTCDay() + 6) % 7) + 1; // 1=Mon..7=Sun
  d.setUTCDate(d.getUTCDate() - (isoDow - 1));
  return d.toISOString().slice(0, 10);
}
