import { defineConfig, devices } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

// Load .env.local into process.env so specs that talk directly to Supabase
// (e.g. wave-3a cleanup helper) have NEXT_PUBLIC_SUPABASE_URL +
// SUPABASE_SERVICE_ROLE_KEY available without requiring the caller to
// export them in their shell. We parse a minimal `KEY=value` subset
// (one assignment per line, # comments stripped, surrounding quotes
// trimmed) so we don't pull in `dotenv` for this lone use.
function loadEnvFile(file: string): void {
  if (!existsSync(file)) return;
  const txt = readFileSync(file, "utf8");
  for (const rawLine of txt.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    if (!key || process.env[key] !== undefined) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
loadEnvFile(path.resolve(__dirname, ".env.local"));

export default defineConfig({
  testDir: "./tests/e2e",
  // Tests share the same admin user; running them in parallel races on the
  // login session. Serialize within each file; allow parallelism across
  // files only when ports permit.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:3030",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- -p 3030",
    url: "http://127.0.0.1:3030",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    // Plan 14 — stats OCR manual-entry path is enforced via OCR_DISABLED=1
    // in apps/web/.env.local (dev default). CI should explicitly export
    // OCR_DISABLED=1 before playwright spawns the webServer.
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
