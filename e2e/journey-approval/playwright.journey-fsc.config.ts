// CR-125 · cr125-form-step-card · cùng stack hành trình thật như `playwright.journey.config.ts` nhưng CHỈ chạy spec «bước form trên thẻ HĐ»
// (Phần 1 «Mua hàng» điền form + tệp bằng giao diện) — một việc e2e riêng ⇒ không phải chạy cả bộ journey-approval để kiểm một tính năng.
import { defineConfig } from "@playwright/test";
import base from "./playwright.journey.config";

export default defineConfig({
  ...base,
  testMatch: ["**/cr125-form-step-card*.spec.ts"],
  preserveOutput: "always",
  outputDir: "../../test-results/journey-fsc",
});
