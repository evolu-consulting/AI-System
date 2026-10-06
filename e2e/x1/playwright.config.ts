// X1-AC10…AC13 · e2e admin-web X1 (test-plan §0 P5/P6): config riêng, KHÔNG đụng `playwright.config.ts` gốc.
// Đuôi `.x1.ts` không khớp testMatch của config gốc/chat/studio. Chạy từ gốc repo, TUẦN TỰ với các bộ admin khác
// (cùng `apps/admin-web/dist`, cùng DB test): `bunx playwright test -c e2e/x1/playwright.config.ts`.
// Cổng: admin-api 3011, admin-web 3010 (preview, build có PUBLIC_HUB_URL/PUBLIC_STUDIO_URL), Hub stub 4030.
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

const CI = !!process.env.CI;
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

function need(name: string): string {
  const v = process.env[name];
  if (!v)
    throw new Error(
      `playwright.config(x1): thiếu biến môi trường ${name} (chạy \`bun run keys:dev\`)`,
    );
  return v;
}

export const API_PORT = 3011;
export const WEB_PORT = 3010;
export const HUB_STUB_PORT = 4030;
const API = `http://localhost:${API_PORT}`;
const WEB = `http://localhost:${WEB_PORT}`;
const HUB = `http://localhost:${HUB_STUB_PORT}`;
const STUDIO = "http://localhost:3200/studio/";
// 48 ký tự sinh lúc chạy (P1: không chuỗi cố định). Workers kế thừa `process.env` của tiến trình config.
const TOKEN = process.env.HUB_INTERNAL_TOKEN ?? randomBytes(24).toString("hex");
process.env.HUB_INTERNAL_TOKEN = TOKEN;
process.env.X1_API_URL = API;
process.env.X1_HUB_URL = HUB;

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.x1.ts",
  workers: 1,
  fullyParallel: false,
  forbidOnly: CI,
  retries: 0,
  reporter: CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: WEB,
    locale: "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
    viewport: { width: 1280, height: 800 },
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: [
    {
      command: "bun e2e/x1/_hub-stub.ts",
      cwd: "../..",
      url: `${HUB}/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        X1_HUB_STUB_PORT: String(HUB_STUB_PORT),
        X1_WEB_ORIGIN: WEB,
        HUB_INTERNAL_TOKEN: TOKEN,
      },
    },
    {
      command: "bun e2e/x1/_prepare.ts && bun apps/admin-api/src/server.ts",
      cwd: "../..",
      url: `${API}/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        APP_ENV: "test",
        PORT: String(API_PORT),
        CORS_ORIGINS: WEB,
        TEST_DATABASE_URL: need("TEST_DATABASE_URL"),
        ADMIN_API_DATABASE_URL: need("TEST_ADMIN_API_DATABASE_URL"),
        TEST_ADMIN_API_DATABASE_URL: need("TEST_ADMIN_API_DATABASE_URL"),
        SEED_ADMIN_USERNAME: need("SEED_ADMIN_USERNAME"),
        SEED_ADMIN_PASSWORD: need("SEED_ADMIN_PASSWORD"),
        JWT_PRIVATE_KEY: need("JWT_PRIVATE_KEY"),
        JWT_PUBLIC_KEY: need("JWT_PUBLIC_KEY"),
        JWT_KID: need("JWT_KID"),
        SECRET_MASTER_KEY: need("SECRET_MASTER_KEY"),
        // B2: admin-api gọi Hub `/internal/test-run` bằng Bearer token; token chỉ ở server (X1-AC11).
        ADMIN_HUB_URL: HUB,
        HUB_INTERNAL_TOKEN: TOKEN,
      },
    },
    {
      command: `bun run --filter @ai/admin-web build && bun run --filter @ai/admin-web preview --port ${WEB_PORT}`,
      cwd: "../..",
      url: WEB,
      reuseExistingServer: false,
      timeout: 180_000,
      // Build-time `PUBLIC_*` (plan-frontend §0 D6, §2.5). KHÔNG đưa HUB_INTERNAL_TOKEN xuống bundle (AC11).
      env: {
        ADMIN_API_URL: API,
        PUBLIC_HUB_URL: HUB,
        PUBLIC_STUDIO_URL: STUDIO,
      },
    },
  ],
});
