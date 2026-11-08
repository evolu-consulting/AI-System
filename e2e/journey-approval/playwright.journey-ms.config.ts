// CR-125 · cr125-manual-start-ui · cùng stack hành trình thật như `playwright.journey.config.ts` nhưng CHỈ chạy spec phiếu yêu cầu
// (một việc e2e riêng ⇒ không phải chạy cả bộ journey-approval để kiểm một tính năng).
import { defineConfig } from "@playwright/test";
import base from "./playwright.journey.config";

export default defineConfig({
  ...base,
  testMatch: ["**/cr125-manual-start*.spec.ts"],
  preserveOutput: "always",
  outputDir: "../../test-results/journey-ms",
});
