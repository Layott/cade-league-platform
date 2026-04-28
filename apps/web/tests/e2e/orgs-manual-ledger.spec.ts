import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as path from "node:path";
import * as fs from "node:fs";

/**
 * Plan 13B · Scenario A — admin creates an org, links 2 seeded players,
 * records a 50k deposit + a 5k fine_deduction, asserts balance=45k and
 * no edit/delete UI on ledger rows. Self-cleans (soft-deletes the org +
 * hard-deletes test link state on players) at the end.
 */

const ADMIN_EMAIL = "admin@cade.local";
const ADMIN_PASSWORD = "dev-admin-2026";

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

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/admin/);
}

const runId = Date.now();
const ORG_NAME = `Lagos Crown Esports E2E-${runId}`;

test.setTimeout(180_000);

test.afterAll(async () => {
  const sb = svc();
  // Soft-delete our E2E orgs — idempotent if the row already gone.
  const { data } = await sb
    .from("organizations")
    .select("id")
    .eq("name", ORG_NAME)
    .is("deleted_at", null);
  const ids = (data ?? []).map((d) => d.id);
  if (ids.length > 0) {
    // Unlink players linked to these orgs.
    await sb
      .from("players")
      .update({ organization_id: null })
      .in("organization_id", ids);
    await sb
      .from("organizations")
      .update({ deleted_at: new Date().toISOString() })
      .in("id", ids);
  }
});

test("admin creates org, records deposit + fine, balance=45,000, ledger append-only", async ({
  page,
}) => {
  const sb = svc();
  // Grab 2 players to link.
  const { data: players } = await sb
    .from("players")
    .select("id, gamer_tag")
    .is("deleted_at", null)
    .is("organization_id", null)
    .limit(2);
  expect(players?.length ?? 0).toBeGreaterThanOrEqual(2);

  await login(page);

  // 1. Navigate to orgs/new. Plan 31 — CAC input is gone; only name +
  // optional logo upload remain. Skip the file upload here so the test
  // remains hermetic.
  await page.goto("/admin/people/orgs/new");
  await expect(page.getByTestId("org-create-form")).toBeVisible();
  await page.getByTestId("org-name-input").fill(ORG_NAME);
  await page.getByTestId("org-create-submit").click();

  // 2. Landed on detail page. Cold compile of the detail route in dev can
  // eat a chunk of the default 5s.
  await expect(page).toHaveURL(/\/admin\/people\/orgs\/[0-9a-f-]+/, {
    timeout: 30_000,
  });
  const url = page.url();
  const orgId = url.split("/").pop()!;
  await expect(page.getByTestId("org-players-table")).toBeVisible({
    timeout: 30_000,
  });

  // 3. Link 2 players.
  for (const p of players!.slice(0, 2)) {
    await page.getByTestId("org-link-player-select").selectOption(p.id);
    await page.getByTestId("org-link-submit").click();
    await expect(page).toHaveURL(/\/admin\/people\/orgs\/[0-9a-f-]+/);
  }

  // 4. Record first ledger entry: deposit 50_000. Cold-compile of the
  // /ledger/new segment can eat >5s on a warm-but-not-compiled dev
  // server, so give the form a generous visibility window.
  await page.getByTestId("ledger-new-btn").click();
  await expect(page.getByTestId("ledger-new-form")).toBeVisible({
    timeout: 30_000,
  });
  await page.getByTestId("ledger-entry-type").selectOption("deposit");
  await page.getByTestId("ledger-amount").fill("50000");
  await page.getByTestId("ledger-reference").fill("initial caution fee");
  await page.getByTestId("ledger-submit").click();

  // 5. Back on detail; assert ledger row + balance. The recordLedgerEntry
  // server action redirects to `/admin/orgs/<id>#ledger`, so wait until the
  // URL has left `/ledger/new` before asserting on the detail page. Cold
  // compile of the detail route can push this past the default 5s.
  await expect(page).toHaveURL(
    new RegExp(`/admin/people/orgs/${orgId}(?:[#?]|$)`),
    { timeout: 30_000 },
  );
  const ledger = page.getByTestId("org-ledger-table");
  await expect(ledger).toBeVisible();
  await expect(ledger).toContainText("50,000");

  // 6. Record fine_deduction 5_000.
  await page.getByTestId("ledger-new-btn").click();
  await expect(page.getByTestId("ledger-new-form")).toBeVisible({
    timeout: 30_000,
  });
  await page.getByTestId("ledger-entry-type").selectOption("fine_deduction");
  await page.getByTestId("ledger-amount").fill("5000");
  await page.getByTestId("ledger-reference").fill("forfeit sanction");
  await page.getByTestId("ledger-submit").click();
  await expect(page).toHaveURL(
    new RegExp(`/admin/people/orgs/${orgId}(?:[#?]|$)`),
    { timeout: 30_000 },
  );

  // 7. Assert balance in info panel == 45,000.
  const { data: org } = await sb
    .from("organizations")
    .select("caution_fee_balance_coins")
    .eq("id", orgId)
    .maybeSingle();
  expect(Number(org?.caution_fee_balance_coins)).toBe(45_000);

  // 8. Assert no Edit / Delete buttons inside the ledger panel.
  const ledgerSection = page.locator("#ledger");
  await expect(
    ledgerSection.getByRole("button", { name: /edit/i }),
  ).toHaveCount(0);
  await expect(
    ledgerSection.getByRole("button", { name: /^delete/i }),
  ).toHaveCount(0);
});
