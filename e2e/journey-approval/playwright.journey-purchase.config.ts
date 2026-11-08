// CR-126 · hành trình «Quy trình mua hàng» 11 bước (`cr125-purchase-full.spec.ts`) trên cùng stack thật như `playwright.journey.config.ts`
// nhưng là MỘT việc e2e riêng: trình duyệt mới, không gánh bộ nhớ của ~40 spec trước (GPU Chromium bị giết exit 9 giữa ca dài), và chạy
// song song với việc gốc. DB / Redis / dịch cổng riêng ở META (`test-e2e-par.rules.ts`).
import { defineConfig } from "@playwright/test";
import base from "./playwright.journey.config";

export default defineConfig({
  ...base,
  testMatch: ["**/cr125-purchase-full.spec.ts"],
  testIgnore: [],
  preserveOutput: "always",
  outputDir: "../../test-results/journey-purchase",
});
