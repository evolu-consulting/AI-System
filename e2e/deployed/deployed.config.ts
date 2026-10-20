// CR-095 · e2e TRIỂN KHAI: chạy với stack production `sohoptac2` (tenant demo, dữ liệu giả) qua SSH tunnel do runner mở
// (`deploy/prod-sohoptac2/e2e-deployed.ps1` → `bun run e2e:deployed`). Không webServer, không mock. Tên file KHÔNG khớp
// `playwright*.config.ts` ⇒ `test:all` không tự nhận (cần tunnel + mật khẩu demo). Web chia theo CỔNG (cùng host localhost
// ⇒ cookie refresh dùng chung giữa các web ⇒ SSO); không cần host-resolver-rules.
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.deployed.ts",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  timeout: 360_000, // chat AI thật (gói Claude) có thể chậm
  expect: { timeout: 15_000 },
  outputDir: "../../test-results/deployed",
  use: {
    locale: "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
});
