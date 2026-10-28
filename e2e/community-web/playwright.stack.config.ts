// CR-102 · C12b · e2e 3 vai (chủ quản / NCC / người mua) trên STACK LOCAL thật: community-web + hub-api + admin-api + AI System (SSO),
// DB đã seed bằng `seed-community-demo --apply` (tenant demo). VIẾT, CHƯA CHẠY (Luật 0b: e2e chạy một lần cuối đợt). Không webServer,
// không mock. Chạy từ gốc repo, sau khi dựng stack + seed:
//   $env:COMMUNITY_SEED_PW_FILE = '<file --out của seed>'; $env:DEMO_OWNER_PW = '<mật khẩu demo-owner>'
//   bun tools/scripts/src/run-playwright.ts e2e/community-web/playwright.stack.config.ts
// Cổng community-web mặc định 3400 (`COMMUNITY_URL` để đổi). Chỉ nhận `*.cs.ts` (không đụng bộ mock `*.cm.ts`).
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.cs.ts",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  outputDir: "../../test-results/community-stack",
  use: {
    baseURL: process.env.COMMUNITY_URL ?? "http://localhost:3400",
    locale: "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 45_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
