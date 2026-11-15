// CR-159 · bài kiểm hành trình THẬT trên môi trường đã deploy (do deploy/smoke/smoke-journey.ps1 gọi, đã tạo sẵn smoke-a / smoke-b). Không webServer, không mock.
// Tên file *.smoke.ts ⇒ KHÔNG nằm trong test:all / bun test. Một test nối tiếp (từng bước ghi Đạt/Không đạt vào results.json).
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.smoke\.ts$/,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  timeout: 1_200_000,
  expect: { timeout: 20_000 },
  outputDir: "../../.data/smoke/pw-output",
  use: {
    locale: "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
    viewport: { width: 1440, height: 900 },
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
  },
});
