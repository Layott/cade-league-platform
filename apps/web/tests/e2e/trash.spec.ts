import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

// Load NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from the web app's
// .env.local so Playwright can talk to the same DB the dev server uses. We
// parse the file manually rather than depend on `dotenv` to keep the E2E
// bundle dep-free per project constraints.
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

const TARGET_GAMER_TAG = "P13_GAMER";

async function adminLogin(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/admin/);
}

function serviceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "trash.spec: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required in apps/web/.env.local"
    );
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function setPlayerDeletedAt(
  gamerTag: string,
  value: string | null
): Promise<string> {
  const sb = serviceClient();
  const { data: existing, error: selErr } = await sb
    .from("players")
    .select("id")
    .eq("gamer_tag", gamerTag)
    .maybeSingle();
  if (selErr) throw selErr;
  if (!existing) {
    throw new Error(`seed player ${gamerTag} not found`);
  }
  const { error: updErr } = await sb
    .from("players")
    .update({ deleted_at: value })
    .eq("id", existing.id);
  if (updErr) throw updErr;
  return existing.id;
}

test.describe.serial("admin trash: players soft-delete → restore roundtrip", () => {
  test.beforeAll(async () => {
    // Soft-delete the seeded player via service role so the Trash list has a row.
    await setPlayerDeletedAt(TARGET_GAMER_TAG, new Date().toISOString());
  });

  test.afterAll(async () => {
    // Ensure the player is restored even if the test fails mid-way.
    await setPlayerDeletedAt(TARGET_GAMER_TAG, null);
  });

  test("soft-deleted player appears in /admin/trash/players and Restore clears deleted_at", async ({
    page,
  }) => {
    await adminLogin(page);

    // Trash page shows the deleted row.
    await page.goto("/admin/trash/players");
    const trashTable = page.getByTestId("trash-table");
    await expect(trashTable).toBeVisible();
    const targetRow = trashTable
      .locator("tr", { hasText: TARGET_GAMER_TAG })
      .first();
    await expect(targetRow).toBeVisible();

    // Restore via the inline Server Action form.
    await targetRow.getByTestId("restore-button").click();

    // After Restore, row disappears from the trash list.
    await expect(page).toHaveURL(/\/admin\/trash\/players/);
    await expect(
      page.getByTestId("trash-table").locator("tr", {
        hasText: TARGET_GAMER_TAG,
      })
    ).toHaveCount(0);

    // And the player's deleted_at is cleared in the DB.
    const sb = serviceClient();
    const { data: restored, error } = await sb
      .from("players")
      .select("id, gamer_tag, deleted_at")
      .eq("gamer_tag", TARGET_GAMER_TAG)
      .maybeSingle();
    expect(error).toBeNull();
    expect(restored?.deleted_at).toBeNull();

    // And the player is visible on the public /players page.
    await page.goto("/players");
    await expect(
      page.getByText(TARGET_GAMER_TAG, { exact: false })
    ).toBeVisible();
  });

  test("purge button is rendered disabled with deferred tooltip", async ({
    page,
  }) => {
    // Re-soft-delete for this case since the first test restored the row.
    await setPlayerDeletedAt(TARGET_GAMER_TAG, new Date().toISOString());
    try {
      await adminLogin(page);
      await page.goto("/admin/trash/players");
      const purge = page.getByTestId("purge-button-stub").first();
      await expect(purge).toBeVisible();
      await expect(purge).toBeDisabled();
      await expect(purge).toHaveAttribute(
        "title",
        /30-day purge deferred/i
      );
    } finally {
      await setPlayerDeletedAt(TARGET_GAMER_TAG, null);
    }
  });
});

test("unauthenticated user is redirected or 403 from /admin/trash", async ({
  page,
  context,
}) => {
  await context.clearCookies();
  const res = await page.goto("/admin/trash/players");
  const isBlocked =
    res?.status() === 403 ||
    page.url().includes("/login") ||
    page.url().includes("/admin/trash/players") === false;
  expect(isBlocked).toBeTruthy();
});
