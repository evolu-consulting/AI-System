// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: biến e2e/test, không ảnh hưởng cache build
// CR-165 · e2e «quy trình thật của 3 công ty» trên stack THẬT của journey-approval (DB + Redis DB + dịch cổng riêng, xem `test-e2e-par.rules.ts`).
// `_flows3-stack.ts` dựng 3 công ty (cây phòng ban của deploy/tenants/*.yaml) + áp ĐÚNG bộ quy trình `flowsFor`. Chạy: `run-tests.ps1 -Step e2e -Filter flows3`.
import { defineConfig } from "@playwright/test";
import base from "../journey-approval/playwright.journey.config";

const SH = Number(process.env.E2E_PORT_SHIFT ?? 0);
const READY = 3445 + SH;
process.env.FLOWS3_READY_PORT = String(READY);
process.env.FLOWS3_RUN ||= Date.now().toString(36);

export default defineConfig({
  ...base,
  testDir: "..",
  testMatch: ["**/flows3/*.spec.ts"],
  testIgnore: [],
  timeout: 600_000,
  preserveOutput: "always",
  outputDir: "../../test-results/flows3",
  webServer: [
    ...(Array.isArray(base.webServer) ? base.webServer : []),
    {
      command: "bun e2e/flows3/_flows3-stack.ts",
      cwd: "../..",
      url: `http://localhost:${READY}`,
      reuseExistingServer: false,
      timeout: 600_000,
      env: { FLOWS3_READY_PORT: String(READY) },
    },
  ],
});
