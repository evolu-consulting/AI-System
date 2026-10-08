// X1-AC08, AC11 · e2e combine (test-plan §0 P5/P6, §4): Hub THẬT + Dify MOCK (không Runtime, không Dify thật) + chat-web + admin-web.
// Config riêng, đuôi `.combine.ts`. Chạy từ gốc repo, TUẦN TỰ với mọi bộ e2e dùng DB test/`apps/admin-web/dist`
// (Postgres + Redis của `docker compose up -d`, `.env.local` có khoá JWT/SECRET_MASTER_KEY/TEST_*):
//   bunx playwright test -c e2e/combine/playwright.config.ts
// Cổng: admin-api 3021, hub-api 4040, Dify mock 4048, sẵn sàng 4049, chat-web 3120, admin-web 3020.
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";
import { viStorageState } from "../support/locale-vi";

const CI = !!process.env.CI;
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`playwright.config(combine): thiếu ${name} (chạy \`bun run keys:dev\`)`);
  return v;
}

const P = { api: 3021, hub: 4040, dify: 4048, ready: 4049, chat: 3120, admin: 3020 } as const;
const CHAT = `http://localhost:${P.chat}`;
const ADMIN = `http://localhost:${P.admin}`;
const API = `http://localhost:${P.api}`;
const HUB = `http://localhost:${P.hub}`;
const TOKEN = process.env.HUB_INTERNAL_TOKEN ?? randomBytes(24).toString("hex");
process.env.HUB_INTERNAL_TOKEN = TOKEN;
process.env.COMBINE_DIFY_URL = `http://localhost:${P.dify}`;
process.env.COMBINE_ADMIN_URL = ADMIN;
process.env.COMBINE_HUB_URL = HUB;
process.env.COMBINE_API_URL = API;

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.combine.ts",
  workers: 1,
  fullyParallel: false,
  forbidOnly: CI,
  retries: 0,
  reporter: CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: CHAT,
    locale: "vi-VN",
    storageState: viStorageState([CHAT, ADMIN]),
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
      command: "bun e2e/combine/_stack.ts",
      cwd: "../..",
      url: `http://localhost:${P.ready}`,
      reuseExistingServer: false,
      timeout: 240_000,
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
        HUB_INTERNAL_TOKEN: TOKEN,
        COMBINE_API_PORT: String(P.api),
        COMBINE_HUB_PORT: String(P.hub),
        COMBINE_DIFY_PORT: String(P.dify),
        COMBINE_READY_PORT: String(P.ready),
        COMBINE_CHAT_ORIGIN: CHAT,
        COMBINE_ADMIN_ORIGIN: ADMIN,
      },
    },
    {
      command: `bun run --filter @ai/chat-web build && bun run --filter @ai/chat-web preview --port ${P.chat}`,
      cwd: "../..",
      url: CHAT,
      reuseExistingServer: false,
      timeout: 240_000,
      // Đăng nhập chat qua admin-api (AUTH_URL), nghiệp vụ qua Hub thật.
      env: { HUB_URL: HUB, AUTH_URL: API },
    },
    {
      command: `bun run --filter @ai/admin-web build && bun run --filter @ai/admin-web preview --port ${P.admin}`,
      cwd: "../..",
      url: ADMIN,
      reuseExistingServer: false,
      timeout: 240_000,
      env: { ADMIN_API_URL: API, PUBLIC_HUB_URL: HUB },
    },
  ],
});
