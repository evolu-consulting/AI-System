// PK-FR-10 · D-02 · N1 plan-frontend §6–§7 (TF4, TF5): e2e khung `contracts-web` — đăng nhập, quyền/trạng thái gói, layout/menu,
// trạng thái đang tải/lỗi. Config RIÊNG (`e2e/**/playwright*.config.ts` ⇒ `test:all` tự nhận), đuôi `.n1.ts`. Backend GIẢ bằng
// `page.route` (auth + /pack/contracts/me) ⇒ không cần stack; so ảnh với mgmt-app là việc của TF7 (`e2e/contracts-web`). Chạy từ
// gốc repo: `bunx playwright test -c e2e/N1/playwright.config.ts`. App chưa có ⇒ webServer `bun run --filter @ai/contracts-web
// build` thoát lỗi NGAY ⇒ đỏ ngay (không treo chờ cổng).
import { defineConfig, devices } from "@playwright/test";
import { viStorageState } from "../support/locale-vi";

const CI = !!process.env.CI;
// biome-ignore lint/suspicious/noUndeclaredEnvVars: biến e2e tuỳ chọn
const WEB_PORT = Number(process.env.N1_E2E_WEB_PORT ?? 3300);
const WEB = `http://localhost:${WEB_PORT}`;
// Proxy dev `/auth` `/pack` trỏ cổng không ai nghe: mọi lời gọi phải bị `page.route` chặn trước; lọt ra ⇒ lỗi kết nối rõ ràng.
const DEAD = "http://localhost:3399";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.n1.ts",
  workers: 1,
  fullyParallel: false,
  forbidOnly: CI,
  retries: 0,
  reporter: CI ? [["github"], ["list"]] : "list",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: WEB,
    locale: "vi-VN",
    storageState: viStorageState([WEB]),
    timezoneId: "Asia/Ho_Chi_Minh",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    command: `bun run --filter @ai/contracts-web build && bun run --filter @ai/contracts-web preview --port ${WEB_PORT}`,
    cwd: "../..",
    url: WEB,
    reuseExistingServer: false,
    timeout: 180_000,
    env: { AUTH_URL: DEAD, HUB_URL: DEAD, ADMIN_API_URL: DEAD },
  },
});
