// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: biến e2e/test, không ảnh hưởng cache build
// CR-161 · hành trình «kết nối hai công ty» trên stack THẬT của journey-approval (DB + Redis DB + dịch cổng riêng, xem `test-e2e-par.rules.ts`).
// Hai công ty NitiGroup-test / Preschool-test dựng bởi `_cr161-stack.ts` sau `_ja-stack.ts`. Chạy: `run-tests.ps1 -Step e2e -Filter cr161`.
import { defineConfig } from "@playwright/test";
import base from "../journey-approval/playwright.journey.config";

const SH = Number(process.env.E2E_PORT_SHIFT ?? 0);
const READY = 3445 + SH;
process.env.CR161_READY_PORT = String(READY);
// một mã lượt chạy cho MỌI worker (worker khởi động lại sau ca đỏ sẽ nạp lại spec — mã tính trong spec sẽ khác nhau)
process.env.CR161_RUN ||= Date.now().toString(36);

export default defineConfig({
  ...base,
  testDir: "..",
  testMatch: ["**/cr161/*.spec.ts"],
  testIgnore: [],
  preserveOutput: "always",
  outputDir: "../../test-results/cr161",
  webServer: [
    ...(Array.isArray(base.webServer) ? base.webServer : []),
    {
      command: "bun e2e/cr161/_cr161-stack.ts",
      cwd: "../..",
      url: `http://localhost:${READY}`,
      reuseExistingServer: false,
      timeout: 300_000,
      env: { CR161_READY_PORT: String(READY) },
    },
  ],
});
