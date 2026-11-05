// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: biến e2e/test, không ảnh hưởng cache build
// e2e-journey-approval · HÀNH TRÌNH duyệt hợp đồng trên STACK THẬT, KHÔNG mock: admin-api + hub-api (hai tiến trình, cấu hình như prod) +
// workspace-web (Sổ Hợp Tác) + admin-web (ai-admin). `_ja-stack.ts` reset DB test riêng → migrate → hub:seed → dựng tenant `e2e-approval` đúng
// như seed-niti (nhưng chưa gán quy trình / luật / feature engine) → hub-api; CLI Claude là thứ DUY NHẤT giả (nhà cung cấp AI ngoài).
// Spec `*.ja.ts` chạy NỐI TIẾP một project: platform admin gán quy trình + luật ở ai-admin, nhân viên Kinh doanh tải HĐ, trưởng phòng Kế toán
// và Ban Giám đốc duyệt; cộng hành trình âm (engine tắt ⇒ UI phải nói rõ vì sao không có luồng duyệt).
// Chạy từ gốc repo: `bun tools/scripts/src/run-playwright.ts e2e/journey-approval/playwright.journey.config.ts`
// hoặc evotest: `run-tests.ps1 -Step e2e -Filter journey-approval -Dirty` (hoặc đã commit).
// Cổng (dịch theo làn E2E_PORT_SHIFT): Sổ Hợp Tác 3440 · ai-admin 3441 · admin-api 3442 · hub-api 3443 · "sẵn sàng" 3444. Redis DB `JA_REDIS_DB`.
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";
import { viStorageState } from "../support/locale-vi";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const need = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`playwright.journey.config: thiếu ${name} (chạy \`bun run keys:dev\`)`);
  return v;
};
const SH = Number(process.env.E2E_PORT_SHIFT ?? 0);
const P = {
  cw: 3440 + SH,
  admin: 3441 + SH,
  api: 3442 + SH,
  hub: 3443 + SH,
  ready: 3444 + SH,
} as const;
const CW = `http://localhost:${P.cw}`;
const ADMIN = `http://localhost:${P.admin}`;
const API = `http://localhost:${P.api}`;
const HUB = `http://localhost:${P.hub}`;
const DIST = process.env.E2E_DIST_DIR ?? "dist-e2e/ja";

// Worker kế thừa env của tiến trình cấu hình: spec đọc các địa chỉ + mật khẩu này (mật khẩu ngẫu nhiên mỗi lượt, không nằm trong repo).
process.env.JA_CW_URL = CW;
process.env.JA_ADMIN_URL = ADMIN;
process.env.JA_USER_PW ||= `${randomBytes(12).toString("base64url")}-Aa1`;

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.ja.ts",
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  timeout: 180_000,
  expect: { timeout: 15_000 },
  outputDir: "../../test-results/journey-approval",
  use: {
    baseURL: CW,
    locale: "vi-VN",
    storageState: viStorageState([CW, ADMIN]),
    timezoneId: "Asia/Ho_Chi_Minh",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 45_000,
  },
  projects: [
    {
      name: "journey",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: [
    {
      command: "bun e2e/journey-approval/_ja-stack.ts",
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
        JA_USER_PW: need("JA_USER_PW"),
        JA_API_PORT: String(P.api),
        JA_HUB_PORT: String(P.hub),
        JA_READY_PORT: String(P.ready),
        JA_ORIGINS: `${CW},${ADMIN}`,
        JA_REDIS_DB: process.env.JA_REDIS_DB ?? "11",
      },
    },
    {
      command: `bun run --filter @ai/workspace-web build && bun run --filter @ai/workspace-web preview --port ${P.cw}`,
      cwd: "../..",
      url: CW,
      reuseExistingServer: false,
      timeout: 300_000,
      // PUBLIC_SSO_URL rỗng ⇒ đăng nhập thẳng ở /login của web gộp (như workspace-web stack).
      env: {
        E2E_DIST_DIR: `${DIST}-cw`,
        ADMIN_API_URL: API,
        AUTH_URL: API,
        HUB_URL: HUB,
        PUBLIC_SSO_URL: "",
        PUBLIC_TENANT_KEY: "",
      },
    },
    {
      command: `bun run --filter @ai/admin-web build && bun run --filter @ai/admin-web preview --port ${P.admin}`,
      cwd: "../..",
      url: ADMIN,
      reuseExistingServer: false,
      timeout: 300_000,
      // PUBLIC_HUB_URL + PUBLIC_FROZEN_MODULES: menu "Quy trình" + khối gán quy trình như `pm:setup`.
      env: {
        E2E_DIST_DIR: `${DIST}-admin`,
        ADMIN_API_URL: API,
        PUBLIC_HUB_URL: HUB,
        PUBLIC_FROZEN_MODULES: "on",
      },
    },
  ],
});
