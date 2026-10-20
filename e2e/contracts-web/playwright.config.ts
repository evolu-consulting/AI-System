// PK-FR-10 · nav-v2 (người dùng chốt 2026-10-20) · N1 plan-frontend §6 (TF7): cảnh màn hình contracts-web, 3 lớp (chữ / khung / ảnh) so với
// BASELINE của chính contracts-web (cấu trúc trang + giao diện theo mockup NITI; không còn so với mgmt-app).
// Hai chế độ cùng một bộ spec (`*.cw.ts`):
//  - so (mặc định): build + preview contracts-web (cổng 3310), backend giả `page.route`; thiếu baseline ⇒ đỏ NGAY (updateSnapshots none).
//  - chụp baseline (`CW_MODE=capture`, lệnh `bun run e2e:contracts:capture`): cùng web, ghi `baseline/<platform>/*.png|json` (commit).
//    Bản Linux (CI/evotest): `deploy/evotest/run-tests.ps1 -Step e2e -Capture cw`.
// Nằm dưới `e2e/**` ⇒ `test:all` tự nhận. Chạy từ gốc repo: `<node> node_modules/@playwright/test/cli.js test -c e2e/contracts-web/playwright.config.ts`.
import { defineConfig, devices } from "@playwright/test";

const CAPTURE = process.env.CW_MODE === "capture";
const HUB_PORT = Number(process.env.CW_E2E_WEB_PORT ?? 3310);
const HUB_URL = `http://localhost:${HUB_PORT}`;
const DEAD = "http://localhost:3399";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.cw.ts",
  snapshotPathTemplate: "{testDir}/baseline/{platform}/{arg}{ext}",
  updateSnapshots: CAPTURE ? "all" : "none",
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: HUB_URL,
    locale: "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
    deviceScaleFactor: 1,
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], deviceScaleFactor: 1 } }],
  webServer: {
    command: `bun run --filter @ai/contracts-web build && bun run --filter @ai/contracts-web preview --port ${HUB_PORT}`,
    cwd: "../..",
    url: HUB_URL,
    reuseExistingServer: false,
    timeout: 180_000,
    env: { AUTH_URL: DEAD, HUB_URL: DEAD, ADMIN_API_URL: DEAD },
  },
});
