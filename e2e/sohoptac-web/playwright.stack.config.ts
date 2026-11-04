// CR-118 · cr118-auth · e2e login gộp của web hợp nhất `sohoptac-web` trên STACK THẬT: backend dùng chung `e2e/community-web/_cs-stack.ts`
// (reset DB test riêng → migrate → seed tenant demo + demo-owner + đối tác mật khẩu tạm) + build/preview sohoptac-web (proxy /auth →
// admin-api, /pack → hub-api). Không mock. Chỉ nhận `*.ss.ts`.
// Chạy: `bun tools/scripts/src/run-playwright.ts e2e/sohoptac-web/playwright.stack.config.ts`
//   hoặc evotest: `run-tests.ps1 -Step e2e -Filter sohoptac-web-stack`.
// Cổng (dịch theo làn E2E_PORT_SHIFT): web 3410 · admin-api 3411 · hub-api 3412 · sẵn sàng 3413. Redis DB `SS_REDIS_DB` (mặc định 14).
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const need = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`sohoptac-web stack: thiếu ${name} (chạy \`bun run keys:dev\`)`);
  return v;
};
const SH = Number(process.env.E2E_PORT_SHIFT ?? 0);
const P = { web: 3410 + SH, api: 3411 + SH, hub: 3412 + SH, ready: 3413 + SH } as const;
const WEB = `http://localhost:${P.web}`;

process.env.DEMO_OWNER_PW ||= `${randomBytes(12).toString("base64url")}-Aa1`;
process.env.SS_SEED_PW_FILE ||= resolve("test-results/sohoptac-stack-seed/pw.json");
process.env.E2E_API_URL ||= `http://localhost:${P.api}`;

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.ss.ts",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  outputDir: "../../test-results/sohoptac-stack",
  use: {
    baseURL: WEB,
    locale: "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 45_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "bun e2e/community-web/_cs-stack.ts",
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
        DEMO_OWNER_PW: need("DEMO_OWNER_PW"),
        CS_SEED_OUT: need("SS_SEED_PW_FILE"),
        CS_API_PORT: String(P.api),
        CS_HUB_PORT: String(P.hub),
        CS_READY_PORT: String(P.ready),
        CS_WEB_ORIGIN: WEB,
        CS_REDIS_DB: process.env.SS_REDIS_DB ?? "14",
      },
    },
    {
      command: `bun run --filter @ai/sohoptac-web build && bun run --filter @ai/sohoptac-web preview --port ${P.web}`,
      cwd: "../..",
      url: WEB,
      reuseExistingServer: false,
      timeout: 300_000,
      // Không cấu hình AI System (PUBLIC_SSO_URL rỗng) ⇒ path SHT cũng vào thẳng /login của web gộp.
      env: {
        ADMIN_API_URL: `http://localhost:${P.api}`,
        HUB_URL: `http://localhost:${P.hub}`,
        PUBLIC_SSO_URL: "",
        PUBLIC_TENANT_KEY: "",
      },
    },
  ],
});
