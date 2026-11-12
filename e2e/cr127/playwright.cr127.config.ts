// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: biến e2e/test, không ảnh hưởng cache build
// CR-127 · 10 hành trình U2–U6 trên stack THẬT của journey-approval (cùng backend/CLI giả/web build, cấu hình công ty dựng bởi `_cr127-stack.ts` sau
// `_ja-stack.ts`) — việc e2e riêng (DB + Redis DB + dịch cổng riêng, xem `test-e2e-par.rules.ts`). Chạy:
//   bun tools/scripts/src/run-playwright.ts e2e/cr127/playwright.cr127.config.ts
//   hoặc evotest: `run-tests.ps1 -Step e2e -Dirty -Filter cr127`.
import { defineConfig } from "@playwright/test";
import base from "../journey-approval/playwright.journey.config";

const SH = Number(process.env.E2E_PORT_SHIFT ?? 0);
const READY = 3445 + SH;
process.env.CR127_READY_PORT = String(READY);

export default defineConfig({
  ...base,
  testDir: ".",
  testMatch: ["**/j*.spec.ts"],
  testIgnore: [],
  preserveOutput: "always",
  outputDir: "../../test-results/cr127",
  webServer: [
    ...(Array.isArray(base.webServer) ? base.webServer : []),
    {
      command: "bun e2e/cr127/_cr127-stack.ts",
      cwd: "../..",
      url: `http://localhost:${READY}`,
      reuseExistingServer: false,
      timeout: 300_000,
      env: { CR127_READY_PORT: String(READY) },
    },
  ],
});
