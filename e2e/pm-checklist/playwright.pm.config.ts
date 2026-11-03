// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: biến e2e/test, không ảnh hưởng cache build
// pm-checklist-e2e · chứng minh checklist test CR-112/CR-113 trong docs/PM-SETUP.md chạy được trên UI THẬT với đúng dữ liệu seed của PM
// (tenant `evolu`, 5 user, quy trình duyệt mẫu CR-113, 3 HĐ mẫu). Mẫu `e2e/community-web/playwright.stack.config.ts`: `_pm-stack.ts` dựng
// backend thật (reset DB test riêng → migrate → seed như `pm:setup` → admin-api → hub-api trong tiến trình) + build/preview ai-admin
// (admin-web) và Sổ Hợp Tác (contracts-web). KHÔNG mock. Đuôi `*.pm.ts`; project `admin` (admin-*.pm.ts), `cw` (cw-*.pm.ts).
// Chạy từ gốc repo: `bun tools/scripts/src/run-playwright.ts e2e/pm-checklist/playwright.pm.config.ts`
// hoặc `bun run test:e2e:par --only=pm-checklist-pm` (evotest: run-tests.ps1 -Step e2e -Filter pm-checklist-pm -All).
// Cổng (dịch theo làn E2E_PORT_SHIFT): Sổ Hợp Tác 3420 · ai-admin 3421 · admin-api 3422 · hub-api 3423 · "sẵn sàng"+điều khiển 3424.
// Redis DB `PMC_REDIS_DB` (mặc định 12). Chỉ DB `*_test` + APP_ENV=test (xem `_pm-stack.ts`).
import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";
import { viStorageState } from "../support/locale-vi";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const need = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`playwright.pm.config: thiếu ${name} (chạy \`bun run keys:dev\`)`);
  return v;
};
const SH = Number(process.env.E2E_PORT_SHIFT ?? 0);
const P = {
  cw: 3420 + SH,
  admin: 3421 + SH,
  api: 3422 + SH,
  hub: 3423 + SH,
  ready: 3424 + SH,
} as const;
const CW = `http://localhost:${P.cw}`;
const ADMIN = `http://localhost:${P.admin}`;
const HUB = `http://localhost:${P.hub}`;
const API = `http://localhost:${P.api}`;
// Worker kế thừa env của tiến trình cấu hình: spec đọc các địa chỉ này.
process.env.PM_CW_URL = CW;
process.env.PM_ADMIN_URL = ADMIN;
process.env.PM_CTL_URL = `http://localhost:${P.ready}`;

/** Khoá mã hoá secret Hub CHỈ cho DB test e2e (32 byte cố định) — không phải secret thật. */
const TEST_SECRETS_KEY = Buffer.from(
  Array.from({ length: 32 }, (_, i) => (i * 7 + 3) & 0xff),
).toString("base64");
const DIST = process.env.E2E_DIST_DIR ?? "dist-e2e/pm";

const proj = (name: string, baseURL: string) => ({
  name,
  testMatch: `${name}-*.pm.ts`,
  use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, baseURL },
});

export default defineConfig({
  testDir: ".",
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  timeout: 120_000,
  expect: { timeout: 10_000 },
  outputDir: "../../test-results/pm-checklist",
  use: {
    baseURL: CW,
    locale: "vi-VN",
    storageState: viStorageState([CW, ADMIN]),
    timezoneId: "Asia/Ho_Chi_Minh",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 45_000,
  },
  projects: [proj("admin", ADMIN), proj("cw", CW)],
  webServer: [
    {
      command: "bun e2e/pm-checklist/_pm-stack.ts",
      cwd: "../..",
      url: `http://localhost:${P.ready}`,
      reuseExistingServer: false,
      timeout: 420_000,
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
        HUB_SECRETS_KEY: process.env.HUB_SECRETS_KEY ?? TEST_SECRETS_KEY,
        PM_API_PORT: String(P.api),
        PM_HUB_PORT: String(P.hub),
        PM_READY_PORT: String(P.ready),
        PM_ORIGINS: `${CW},${ADMIN}`,
        PM_REDIS_DB: process.env.PMC_REDIS_DB ?? "12",
        HUB_PROCESS_ENGINE: "on",
        CONTRACTS_APPROVAL_ENGINE: "on",
      },
    },
    {
      command: `bun run --filter @ai/contracts-web build && bun run --filter @ai/contracts-web preview --port ${P.cw}`,
      cwd: "../..",
      url: CW,
      reuseExistingServer: false,
      timeout: 300_000,
      env: { E2E_DIST_DIR: `${DIST}-cw`, ADMIN_API_URL: API, AUTH_URL: API, HUB_URL: HUB },
    },
    {
      command: `bun run --filter @ai/admin-web build && bun run --filter @ai/admin-web preview --port ${P.admin}`,
      cwd: "../..",
      url: ADMIN,
      reuseExistingServer: false,
      timeout: 300_000,
      // PUBLIC_HUB_URL + PUBLIC_FROZEN_MODULES: menu "Quy trình" như `pm:setup` (web dev nhận cùng hai biến).
      env: {
        E2E_DIST_DIR: `${DIST}-admin`,
        ADMIN_API_URL: API,
        PUBLIC_HUB_URL: HUB,
        PUBLIC_FROZEN_MODULES: "on",
      },
    },
  ],
});
