import { test, expect, type Page } from "@playwright/test";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

// Load NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from the web app's
// .env.local so Playwright can talk to the same DB the dev server uses.
function loadLocalEnv() {
  const envPath = path.resolve(__dirname, "..", "..", ".env.local");
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i);
    if (!m) continue;
    const key = m[1];
    let value = m[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadLocalEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const ADMIN_EMAIL = "admin@cade.local";
const ADMIN_PASSWORD = "dev-admin-2026";

function serviceClient(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "users-crud.spec: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required in apps/web/.env.local",
    );
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function adminLogin(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/admin/);
}

// One throwaway email per run so concurrent runs do not collide.
const STAMP = Date.now().toString(36);
const TARGET_EMAIL = `crud-test+${STAMP}@cade.local`;
const ORIGINAL_NAME = `CRUD Test ${STAMP}`;
const RENAMED = `CRUD Test ${STAMP} (renamed)`;

test.describe.serial("admin users CRUD", () => {
  test.afterAll(async () => {
    // Hard-delete the throwaway via service role so the test is self-cleaning.
    const sb = serviceClient();
    const { data: pub } = await sb
      .from("users")
      .select("id, supabase_auth_id")
      .eq("email", TARGET_EMAIL)
      .maybeSingle();
    if (pub) {
      const { id, supabase_auth_id } = pub as {
        id: string;
        supabase_auth_id: string;
      };
      // Soft-delete cascades aren't enabled; clean rows manually.
      await sb.from("user_roles").delete().eq("user_id", id);
      await sb.from("players").delete().eq("user_id", id);
      await sb.from("users").delete().eq("id", id);
      // Removing the auth.users row cascades public.users via FK with
      // on delete cascade, but we already cleaned that up above.
      try {
        await sb.auth.admin.deleteUser(supabase_auth_id);
      } catch {
        // best-effort
      }
    }
  });

  test("create → view → edit → soft-delete → restore", async ({ page }) => {
    await adminLogin(page);

    // Step 1: open list, click Add user.
    await page.goto("/admin/people/users");
    await page.getByTestId("add-user-button").click();
    await expect(page).toHaveURL(/\/admin\/people\/users\/new/);

    // Step 2: fill the form.
    await page.getByTestId("new-user-email").fill(TARGET_EMAIL);
    await page.getByTestId("new-user-display-name").fill(ORIGINAL_NAME);
    await page.getByTestId("new-user-jersey").fill("42");
    await page.getByTestId("new-user-role").selectOption("player");
    await page.getByTestId("new-user-submit").click();

    // Step 3: redirected to /admin/users/<id>.
    await expect(page).toHaveURL(/\/admin\/people\/users\/[0-9a-f-]{36}$/);
    await expect(page.locator("h1")).toContainText(ORIGINAL_NAME);

    // Step 4: edit display_name.
    await page.getByTestId("edit-display-name").fill(RENAMED);
    await page.getByTestId("edit-profile-submit").click();
    await expect(page.locator("h1")).toContainText(RENAMED);

    // Step 5: soft-delete via danger zone (open <details> first).
    const deleteSummary = page.locator(
      '[data-testid="delete-user-form"]',
    );
    // Open the surrounding <details> by clicking its summary.
    await page.getByText(/Delete this user/i).click();
    await expect(deleteSummary).toBeVisible();
    await page.getByTestId("delete-user-confirm").click();

    // Step 6: redirected to /admin/users; user no longer in list.
    await expect(page).toHaveURL(/\/admin\/people\/users\/?$/);
    await expect(
      page.getByTestId("users-table").getByText(TARGET_EMAIL),
    ).toHaveCount(0);

    // Step 7: appears in /admin/trash/users.
    await page.goto("/admin/system/trash/users");
    const trashTable = page.getByTestId("trash-table");
    await expect(trashTable).toBeVisible();
    await expect(trashTable.getByText(TARGET_EMAIL)).toBeVisible();

    // Step 8: restore from trash.
    const restoreRow = trashTable.locator("tr", { hasText: TARGET_EMAIL });
    await restoreRow.getByTestId("restore-button").click();

    // After restore, user appears back on /admin/users.
    await page.goto("/admin/people/users");
    await expect(
      page.getByTestId("users-table").getByText(TARGET_EMAIL),
    ).toBeVisible();

    // And in the DB, deleted_at is null.
    const sb = serviceClient();
    const { data: row } = await sb
      .from("users")
      .select("id, email, deleted_at, display_name")
      .eq("email", TARGET_EMAIL)
      .maybeSingle();
    expect(row).toBeTruthy();
    expect((row as { deleted_at: string | null }).deleted_at).toBeNull();
    expect((row as { display_name: string }).display_name).toBe(RENAMED);
  });
});
