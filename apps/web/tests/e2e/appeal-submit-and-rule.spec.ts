import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as path from "node:path";
import * as fs from "node:fs";

/**
 * Plan 13B · Scenario B — player submits appeal, admin assigns 3-member
 * panel, rules. Status flips submitted → under_review → ruled.
 *
 * Setup: creates a dedicated e2e-player auth user + links them to an
 * existing seeded player. Seeds a disciplinary_case for that player.
 * Tears down all three at the end.
 */

const ADMIN_EMAIL = "admin@cade.local";
const ADMIN_PASSWORD = "dev-admin-2026";
const runId = Date.now();
const E2E_PLAYER_EMAIL = `e2e-appeal-player-${runId}@cade.local`;
const E2E_PLAYER_PASSWORD = "e2e-appeal-2026";

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
  caseId: string;
  adminUserId: string;
  modUserIds: string[];
};

async function setupContext(): Promise<Ctx> {
  const sb = svc();
  // 1. Create auth user.
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
      user_metadata: { display_name: `E2E Appeal Player ${runId}` },
    }),
  });
  if (!resp.ok) {
    throw new Error(`auth user create failed: ${resp.status} ${await resp.text()}`);
  }
  const authUser = await resp.json();
  const authId = authUser.id as string;

  // 2. Wait for public.users row (trigger-created), then ensure it exists.
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
    // Fallback: insert manually.
    const { data: inserted } = await sb
      .from("users")
      .insert({
        supabase_auth_id: authId,
        email: E2E_PLAYER_EMAIL,
        display_name: `E2E Appeal Player ${runId}`,
      })
      .select("id")
      .single();
    publicUser = inserted as { id: string };
  }
  const userId = publicUser!.id;

  // 3. Attach player role.
  await sb
    .from("user_roles")
    .upsert(
      { user_id: userId, role: "player", deleted_at: null },
      { onConflict: "user_id,role" },
    );

  // 4. Create a disposable player row owned by the new user. Avoids
  // hijacking seeded rows (players.user_id is NOT NULL UNIQUE).
  const { data: insertedPlayer, error: pErr } = await sb
    .from("players")
    .insert({
      user_id: userId,
      gamer_tag: `e2e-appeal-${runId}`,
    })
    .select("id")
    .single();
  if (pErr || !insertedPlayer) {
    throw new Error(`player create failed: ${pErr?.message ?? "unknown"}`);
  }
  const playerId = (insertedPlayer as { id: string }).id;

  // 5. Create disciplinary_case (reported_by = admin).
  const { data: admin } = await sb
    .from("users")
    .select("id")
    .eq("email", ADMIN_EMAIL)
    .maybeSingle();
  const adminUserId = (admin as { id: string }).id;

  const { data: discCase, error: caseErr } = await sb
    .from("disciplinary_cases")
    .insert({
      player_id: playerId,
      incident_type: "other",
      reported_by: adminUserId,
      status: "open",
      notes: `E2E appeal scenario ${runId}`,
    })
    .select("id")
    .single();
  if (caseErr) throw caseErr;
  const caseId = (discCase as { id: string }).id;

  // 6. Ensure 2 moderator users exist for panel assignment; assign idc
  // role to admin for eligibility.
  await sb
    .from("user_roles")
    .upsert(
      { user_id: adminUserId, role: "idc", deleted_at: null },
      { onConflict: "user_id,role" },
    );
  // Find 2 other users to use as panel members; assign them idc role.
  const { data: candidates } = await sb
    .from("users")
    .select("id, email")
    .neq("id", adminUserId)
    .neq("id", userId)
    .is("deleted_at", null)
    .limit(2);
  const modUserIds: string[] = ((candidates ?? []) as { id: string }[]).map(
    (c) => c.id,
  );
  for (const id of modUserIds) {
    await sb
      .from("user_roles")
      .upsert(
        { user_id: id, role: "idc", deleted_at: null },
        { onConflict: "user_id,role" },
      );
  }

  return { authId, userId, playerId, caseId, adminUserId, modUserIds };
}

async function teardownContext(ctx: Ctx | null) {
  if (!ctx) return;
  const sb = svc();
  loadEnv();
  // Delete appeals + case first to free refs.
  await sb.from("appeals").delete().eq("disciplinary_case_id", ctx.caseId);
  await sb.from("disciplinary_cases").delete().eq("id", ctx.caseId);
  // Delete the disposable player row. ON DELETE CASCADE on user_id so
  // users get cleaned up when auth user goes, but delete explicitly to
  // surface any FK errors from lingering test rows.
  await sb.from("players").delete().eq("id", ctx.playerId);
  await sb.from("user_roles").delete().eq("user_id", ctx.userId);
  await sb.from("users").delete().eq("id", ctx.userId);
  // Delete auth user.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  await fetch(`${url}/auth/v1/admin/users/${ctx.authId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${key}`, apikey: key },
  });
  // Best-effort: remove idc role added to admin + mod helpers.
  await sb.from("user_roles").delete().eq("user_id", ctx.adminUserId).eq("role", "idc");
  for (const id of ctx.modUserIds) {
    await sb.from("user_roles").delete().eq("user_id", id).eq("role", "idc");
  }
}

async function loginAs(page: Page, email: string, password: string, nextPath = "/player/appeals") {
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

test("player submits appeal → admin assigns 3-member panel → rules → status=ruled", async ({
  browser,
}) => {
  if (!ctx) throw new Error("ctx missing");

  // --- Player context ---
  const playerCtx = await browser.newContext();
  const playerPage = await playerCtx.newPage();
  await loginAs(
    playerPage,
    E2E_PLAYER_EMAIL,
    E2E_PLAYER_PASSWORD,
    `/player/appeals/new?caseId=${ctx.caseId}`,
  );

  await expect(playerPage.getByTestId("appeal-submit-form")).toBeVisible();
  const grounds =
    "The sanction was issued after a contested replay. I have footage showing the incident was misidentified.";
  await playerPage.getByTestId("appeal-grounds-input").fill(grounds);
  await playerPage.getByTestId("appeal-submit-btn").click();
  await playerPage.waitForURL(/\/player\/appeals(\?|$)/);

  // Assert appeal row shows in player list.
  await expect(playerPage.getByTestId("player-appeals-list")).toBeVisible();
  await playerCtx.close();

  // --- Admin context ---
  const adminCtx = await browser.newContext();
  const adminPage = await adminCtx.newPage();
  await loginAs(adminPage, ADMIN_EMAIL, ADMIN_PASSWORD, "/admin/appeals");
  await expect(adminPage.getByTestId("appeals-list")).toBeVisible();

  // Find the appeal row (most recent for this case).
  const sb = svc();
  const { data: appeal } = await sb
    .from("appeals")
    .select("id")
    .eq("disciplinary_case_id", ctx.caseId)
    .is("deleted_at", null)
    .order("submitted_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  expect(appeal).toBeTruthy();
  const appealId = (appeal as { id: string }).id;

  // Open detail page.
  await adminPage.goto(`/admin/appeals/${appealId}`);
  await expect(adminPage.getByTestId("appeal-panel-form")).toBeVisible();
  await expect(adminPage.getByTestId("appeal-deadline-badge")).toBeVisible();

  // Assign panel: admin + 2 moderators.
  await adminPage
    .getByTestId("panel-member-1")
    .selectOption(ctx.adminUserId);
  await adminPage
    .getByTestId("panel-member-2")
    .selectOption(ctx.modUserIds[0]);
  await adminPage
    .getByTestId("panel-member-3")
    .selectOption(ctx.modUserIds[1]);
  await adminPage.getByTestId("appeal-panel-save").click();
  await adminPage.waitForURL(/\/admin\/appeals\/[0-9a-f-]+/);

  // Verify status flipped to under_review. Server actions on the same
  // detail URL don't trigger a URL change, so poll instead of sampling.
  const waitFor = async <T extends { status: string }>(
    fetchRow: () => Promise<T | null>,
    want: string,
  ): Promise<T> => {
    const deadline = Date.now() + 15_000;
    let last: T | null = null;
    while (Date.now() < deadline) {
      last = await fetchRow();
      if (last && last.status === want) return last;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(
      `timed out waiting for appeal status=${want}; last=${JSON.stringify(last)}`,
    );
  };

  const afterAssign = await waitFor(
    async () => {
      const { data } = await sb
        .from("appeals")
        .select("status, panel_member_user_ids")
        .eq("id", appealId)
        .maybeSingle();
      return data as {
        status: string;
        panel_member_user_ids: string[];
      } | null;
    },
    "under_review",
  );
  expect(afterAssign.status).toBe("under_review");
  expect(afterAssign.panel_member_user_ids.length).toBe(3);

  // Rule on appeal.
  await adminPage
    .getByTestId("appeal-ruling-text")
    .fill("Uphold the original case; evidence insufficient to revoke.");
  await adminPage.getByTestId("appeal-rule-btn").click();
  await adminPage.waitForURL(/\/admin\/appeals\/[0-9a-f-]+/);

  const finalRow = await waitFor(
    async () => {
      const { data } = await sb
        .from("appeals")
        .select("status, ruled_at, ruling")
        .eq("id", appealId)
        .maybeSingle();
      return data as {
        status: string;
        ruled_at: string | null;
        ruling: string | null;
      } | null;
    },
    "ruled",
  );
  expect(finalRow.status).toBe("ruled");
  expect((finalRow as { ruled_at: string | null }).ruled_at).not.toBeNull();
  expect((finalRow as { ruling: string | null }).ruling).toContain("Uphold");

  await adminCtx.close();
});
