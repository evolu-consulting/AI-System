// [prod-journey] · bộ Playwright chạy tới môi trường ĐÃ DEPLOY qua URL công khai (không webServer, không dựng stack). Chạy qua deploy/smoke/prod-journey.ps1.
// testDir riêng ⇒ KHÔNG thuộc test:all. Một worker, ca nối tiếp theo thứ tự file.
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts$/,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  timeout: 900_000,
  expect: { timeout: 20_000 },
  outputDir: "../../.data/prod-journey",
  preserveOutput: "always",
  use: {
    locale: "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
    viewport: { width: 1440, height: 900 },
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
