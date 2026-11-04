// CR-118 · UAT smoke từ máy dev qua SSH tunnel tới stack sohoptac2-cr118 (không thuộc test:all: tên không khớp playwright*.config.ts).
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "uat-cr118.stg.ts",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  outputDir: "../../test-results/uat-cr118",
  use: { ...devices["Desktop Chrome"], locale: "vi-VN", timezoneId: "Asia/Ho_Chi_Minh" },
});
