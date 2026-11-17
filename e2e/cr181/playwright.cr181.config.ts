// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: biến e2e/test, không ảnh hưởng cache build
// CR-181 · ký trên tài liệu: hành trình 3 vai + 5 spec trên stack THẬT của journey-approval (cùng backend/CLI giả/web build, cấu hình công ty dựng bởi
// `_cr181-stack.ts` sau `_ja-stack.ts`) — việc e2e riêng (DB + Redis DB + dịch cổng riêng, xem `test-e2e-par.rules.ts`). Chạy:
//   bun tools/scripts/src/run-playwright.ts e2e/cr181/playwright.cr181.config.ts
//   hoặc evotest: `run-tests.ps1 -Step e2e -Dirty -Filter cr181`.
import { defineConfig } from "@playwright/test";
import base from "../journey-approval/playwright.journey.config";

const SH = Number(process.env.E2E_PORT_SHIFT ?? 0);
const READY = 3446 + SH;
process.env.CR181_READY_PORT = String(READY);

export default defineConfig({
  ...base,
  testDir: "..",
  testMatch: "**/cr181/*.spec.ts", // chuỗi (không mảng) để evotest đếm đúng số spec
  testIgnore: [],
  preserveOutput: "always",
  outputDir: "../../test-results/cr181",
  webServer: [
    ...(Array.isArray(base.webServer) ? base.webServer : []),
    {
      command: "bun e2e/cr181/_cr181-stack.ts",
      cwd: "../..",
      url: `http://localhost:${READY}`,
      reuseExistingServer: false,
      timeout: 300_000,
      env: { CR181_READY_PORT: String(READY) },
    },
  ],
});
