// ADM-NFR-06, ADM-FR-01 · e2e chạy trên bản build thật của admin-web + admin-api thật với DB `ai_system_test` (plan-frontend M1 §9.12).
// Chạy từ gốc repo (test dùng process.cwd()). admin-api e2e chiếm cổng 3001 và `reuseExistingServer: false`
// (DB test phải được chuẩn bị lại) → TẮT `bun run dev` của admin-api trước khi chạy.
import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";
import { viStorageState } from "./e2e/support/locale-vi";

const CI = !!process.env.CI;

// Playwright chạy bằng Node nên không tự đọc .env.local; không ghi đè biến đã có trong môi trường.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

function need(name: string): string {
  const v = process.env[name];
  if (!v)
    throw new Error(`playwright.config: thiếu biến môi trường ${name} (chạy \`bun run keys:dev\`)`);
  return v;
}

const API_PORT = "3001";
const API_URL = `http://localhost:${API_PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // Các spec dùng chung một DB và tự reset fixture → chạy tuần tự.
  workers: 1,
  fullyParallel: false,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:3000",
    locale: "vi-VN",
    storageState: viStorageState(["http://localhost:3000"]),
    timezoneId: "Asia/Ho_Chi_Minh",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: [
    {
      command: "bun e2e/support/prepare-db.ts && bun apps/admin-api/src/server.ts",
      url: `${API_URL}/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        APP_ENV: "test",
        PORT: API_PORT,
        CORS_ORIGINS: "http://localhost:3000",
        // Luôn DB test, không bao giờ DB dev.
        TEST_DATABASE_URL: need("TEST_DATABASE_URL"),
        ADMIN_API_DATABASE_URL: need("TEST_ADMIN_API_DATABASE_URL"),
        TEST_ADMIN_API_DATABASE_URL: need("TEST_ADMIN_API_DATABASE_URL"),
        SEED_ADMIN_USERNAME: need("SEED_ADMIN_USERNAME"),
        SEED_ADMIN_PASSWORD: need("SEED_ADMIN_PASSWORD"),
        JWT_PRIVATE_KEY: need("JWT_PRIVATE_KEY"),
        JWT_PUBLIC_KEY: need("JWT_PUBLIC_KEY"),
        JWT_KID: need("JWT_KID"),
        // M2: admin-api (từ T3) bắt buộc khoá mã hoá secret.
        SECRET_MASTER_KEY: need("SECRET_MASTER_KEY"),
      },
    },
    {
      command: "bun run --filter @ai/admin-web build && bun run --filter @ai/admin-web preview",
      url: "http://localhost:3000",
      reuseExistingServer: !CI,
      timeout: 120_000,
      env: { ADMIN_API_URL: API_URL },
    },
  ],
});
