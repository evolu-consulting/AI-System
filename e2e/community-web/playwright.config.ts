// CR-102 · C5 · e2e community-web (adapter mock, không cần backend). VIẾT, CHƯA CHẠY (Luật 0b: e2e chạy một lần cuối đợt).
// Chạy từ gốc repo: `bun tools/scripts/src/run-playwright.ts e2e/community-web/playwright.config.ts`.
import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.COMMUNITY_E2E_PORT ?? 3410);
const URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.cm.ts",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: URL,
    locale: "vi-VN",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `bun run --filter @ai/community-web build && bun run --filter @ai/community-web preview --port ${PORT}`,
    cwd: "../..",
    url: URL,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
