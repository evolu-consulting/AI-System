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

// TS1: `test:e2e:par` chia cấu hình gốc thành nhiều ca file chạy song song, mỗi ca một cặp cổng (E2E_ROOT_WEB_PORT) và
// DB test riêng; mặc định vẫn 3000/3001 như cũ.
// biome-ignore lint/suspicious/noUndeclaredEnvVars: biến e2e/test, không ảnh hưởng cache build
const WEB_PORT = process.env.E2E_ROOT_WEB_PORT ?? "3000";
const WEB_URL = `http://localhost:${WEB_PORT}`;
const API_PORT = String(Number(WEB_PORT) + 1);
const API_URL = `http://localhost:${API_PORT}`;
// Spec/helper gọi thẳng admin-api (apiAsAdmin, enable2faApi) đọc địa chỉ này; worker kế thừa env của tiến trình config.
process.env.E2E_API_URL = API_URL;
// Đồng hồ máy chủ e2e (xem tools/scripts/src/e2e-clock-skew.ts): spec TOTP dịch đồng hồ thay vì chờ 30 s thật.
// biome-ignore lint/suspicious/noUndeclaredEnvVars: biến e2e/test, không ảnh hưởng cache build
const CLOCK_FILE = process.env.E2E_CLOCK_FILE ?? "";
const PRELOAD = CLOCK_FILE ? "--preload ./tools/scripts/src/e2e-clock-skew.ts " : "";

export default defineConfig({
  testDir: "./e2e",
  // Các spec dùng chung một DB và tự reset fixture → chạy tuần tự.
  workers: 1,
  fullyParallel: false,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: WEB_URL,
    locale: "vi-VN",
    storageState: viStorageState([WEB_URL]),
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
      command: `bun e2e/support/prepare-db.ts && bun ${PRELOAD}apps/admin-api/src/server.ts`,
      url: `${API_URL}/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        APP_ENV: "test",
        PORT: API_PORT,
        CORS_ORIGINS: WEB_URL,
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
      command: `bun run --filter @ai/admin-web build && bun run --filter @ai/admin-web preview --port ${WEB_PORT}`,
      url: WEB_URL,
      reuseExistingServer: !CI,
      timeout: 120_000,
      // Các ca "vắng PUBLIC_HUB_URL" cần bản build KHÔNG có Hub/Studio: `.env.local` dev có PUBLIC_HUB_URL ⇒ ép rỗng (GX).
      env: { ADMIN_API_URL: API_URL, PUBLIC_HUB_URL: "", PUBLIC_STUDIO_URL: "" },
    },
  ],
});
