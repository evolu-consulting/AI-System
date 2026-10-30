// CR-104 · ops-ui · e2e trang `/system` "Tình trạng hệ thống": dùng lại stack P-a (`e2e/P-a/_pa-stack.ts`: admin-api + Hub THẬT + DB test
// + persona M1/P-a) + admin-web build thật; KHÔNG dựng chat-web. `HUB_OPS_WATCH=off` ⇒ vòng nền tắt, kiểm bằng nút "Kiểm tra ngay".
// Đuôi `.ops.ts` (không `.spec.ts` — config gốc `e2e/` không nhặt). Chạy: `bun run test:e2e:par --only=ops` (làn tự cấp cổng/DB/Redis).
// Chạy tay: `bunx playwright test -c e2e/ops/playwright.ops.config.ts --reporter=line` (cần `.env.test-ops_e2e.local`:
// `bun run db:test:create ops_e2e`). Cổng = `OPS_E2E_PORT_BASE` (mặc định 5400): +1 admin-api · +2 hub-api · +3 sẵn sàng · +5 admin-web.
import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";
import { viStorageState } from "../support/locale-vi";

const CI = !!process.env.CI;
// biome-ignore lint/suspicious/noUndeclaredEnvVars: biến e2e tuỳ chọn
const ENV_FILE = process.env.OPS_E2E_ENV ?? ".env.test-ops_e2e.local";
if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`playwright.ops.config: thiếu ${name} (chạy \`bun run keys:dev\`)`);
  return v;
}
// biome-ignore lint/suspicious/noUndeclaredEnvVars: biến e2e tuỳ chọn
const BASE = Number(process.env.OPS_E2E_PORT_BASE ?? 5400);
const P = { api: BASE + 1, hub: BASE + 2, ready: BASE + 3, admin: BASE + 5 } as const;
const ADMIN = `http://localhost:${P.admin}`;
const API = `http://localhost:${P.api}`;
const HUB = `http://localhost:${P.hub}`;
// helper dùng lại của P-a (`token`, `adminLogin`, `withSql`) đọc PA_* / X2A_*.
process.env.X2A_HUB_URL = HUB;
process.env.X2A_API_URL = API;
process.env.PA_RT_URL = `http://localhost:${P.ready}`;
process.env.PA_ADMIN_URL = ADMIN;
process.env.PA_CHAT_URL = ADMIN;
process.env.OPS_E2E_ADMIN_URL = ADMIN;

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.ops.ts",
  workers: 1,
  fullyParallel: false,
  forbidOnly: CI,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: CI ? [["github"], ["list"]] : "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: ADMIN,
    locale: "vi-VN",
    storageState: viStorageState([ADMIN]),
    timezoneId: "Asia/Ho_Chi_Minh",
    viewport: { width: 1280, height: 800 },
    trace: "retain-on-failure",
    actionTimeout: 15_000,
  },
  webServer: [
    {
      command: "bun e2e/P-a/_pa-stack.ts",
      cwd: "../..",
      url: `http://localhost:${P.ready}`,
      reuseExistingServer: false,
      timeout: 300_000,
      env: {
        APP_ENV: "test",
        TEST_DATABASE_URL: need("TEST_DATABASE_URL"),
        TEST_ADMIN_API_DATABASE_URL: need("TEST_ADMIN_API_DATABASE_URL"),
        SEED_ADMIN_USERNAME: need("SEED_ADMIN_USERNAME"),
        SEED_ADMIN_PASSWORD: need("SEED_ADMIN_PASSWORD"),
        JWT_PRIVATE_KEY: need("JWT_PRIVATE_KEY"),
        JWT_PUBLIC_KEY: need("JWT_PUBLIC_KEY"),
        JWT_KID: need("JWT_KID"),
        SECRET_MASTER_KEY: need("SECRET_MASTER_KEY"),
        PA_API_PORT: String(P.api),
        PA_HUB_PORT: String(P.hub),
        PA_READY_PORT: String(P.ready),
        PA_CHAT_ORIGIN: ADMIN,
        PA_ADMIN_ORIGIN: ADMIN,
        // biome-ignore lint/suspicious/noUndeclaredEnvVars: biến e2e tuỳ chọn
        PA_REDIS_DB: process.env.OPS_REDIS_DB ?? "11",
        HUB_PROCESS_ENGINE: "off",
        HUB_OPS_WATCH: "off",
      },
    },
    {
      command: `bun run --filter @ai/admin-web build && bun run --filter @ai/admin-web preview --port ${P.admin}`,
      cwd: "../..",
      url: ADMIN,
      reuseExistingServer: false,
      timeout: 300_000,
      env: { ADMIN_API_URL: API, PUBLIC_HUB_URL: HUB },
    },
  ],
});
