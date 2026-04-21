import { defineConfig, devices } from "@playwright/test";

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
