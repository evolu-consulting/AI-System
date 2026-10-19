// PK-FR-10 · D-02 · N1 plan-frontend §6 (TF7): so màn hình contracts-web với mgmt-app thật, 3 lớp (chữ / khung / ảnh).
// Hai chế độ cùng một spec (`scenes.cw.ts`):
//  - so (mặc định): build + preview contracts-web (cổng 3310), backend giả `page.route`; thiếu baseline ⇒ đỏ NGAY (updateSnapshots none).
//  - chụp tham chiếu (`CW_MODE=ref`, lệnh `bun run e2e:contracts:ref`): chạy web mgmt-app (Vite) ở `MGMT_WEB_DIR` (mặc định
//    `F:\workspace\mgmt-app\web`) cổng 5199, API giả `page.route`; ghi `baseline/<platform>/*.png|json` (commit).
// Nằm dưới `e2e/**` ⇒ `test:all` tự nhận. Chạy từ gốc repo: `<node> node_modules/@playwright/test/cli.js test -c e2e/contracts-web/playwright.config.ts`.
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const REF = process.env.CW_MODE === "ref";
const MGMT_DIR = process.env.MGMT_WEB_DIR ?? "F:\\workspace\\mgmt-app\\web";
const REF_URL = "http://127.0.0.1:5199";
const HUB_PORT = Number(process.env.CW_E2E_WEB_PORT ?? 3310);
const HUB_URL = `http://localhost:${HUB_PORT}`;
const DEAD = "http://localhost:3399";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.cw.ts",
  snapshotPathTemplate: "{testDir}/baseline/{platform}/{arg}{ext}",
  updateSnapshots: REF ? "all" : "none",
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: REF ? REF_URL : HUB_URL,
    locale: "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
    deviceScaleFactor: 1,
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], deviceScaleFactor: 1 } }],
  webServer: REF
    ? {
        command: `"${process.execPath}" node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5199 --strictPort`,
        cwd: join(MGMT_DIR),
        url: REF_URL,
        reuseExistingServer: false,
        timeout: 120_000,
      }
    : {
        command: `bun run --filter @ai/contracts-web build && bun run --filter @ai/contracts-web preview --port ${HUB_PORT}`,
        cwd: "../..",
        url: HUB_URL,
        reuseExistingServer: false,
        timeout: 180_000,
        env: { AUTH_URL: DEAD, HUB_URL: DEAD, ADMIN_API_URL: DEAD },
      },
});
