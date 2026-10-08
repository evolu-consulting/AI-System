// HUB-FR-96…102 · CHAT-AC-37…45 · X2a-AC06 · X2a-AC15 · e2e X2a (test-plan X2a §6): Hub THẬT + admin-api (auth) + chat-web +
// Postgres/Redis test (spec Q7). Config riêng, đuôi `.x2a.ts` (không lẫn `*.chat.ts` của C1/X1). Chạy từ gốc repo, TUẦN TỰ
// với các bộ e2e khác dùng DB test (`docker compose up -d`, `.env.local` có khoá JWT/TEST_*):
//   bunx playwright test -c e2e/chat/playwright.x2a.config.ts   (script I1: `bun run e2e:chat:x2a`)
// Cổng: admin-api 3031, hub-api 4050, sẵn sàng 4059, chat-web 3130.
import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";
import { viStorageState } from "../support/locale-vi";

const CI = !!process.env.CI;
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`playwright.x2a.config: thiếu ${name} (chạy \`bun run keys:dev\`)`);
  return v;
}

const P = { api: 3031, hub: 4050, ready: 4059, chat: 3130 } as const;
const CHAT = `http://localhost:${P.chat}`;
const API = `http://localhost:${P.api}`;
const HUB = `http://localhost:${P.hub}`;
process.env.X2A_HUB_URL = HUB;
process.env.X2A_API_URL = API;

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.x2a.ts",
  workers: 1,
  fullyParallel: false,
  forbidOnly: CI,
  retries: 0,
  timeout: 60_000,
  reporter: CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: CHAT,
    locale: "vi-VN",
    storageState: viStorageState([CHAT]),
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
      command: "bun e2e/chat/_x2a-stack.ts",
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
        X2A_API_PORT: String(P.api),
        X2A_HUB_PORT: String(P.hub),
        X2A_READY_PORT: String(P.ready),
        X2A_CHAT_ORIGIN: CHAT,
      },
    },
    {
      command: `bun run --filter @ai/chat-web build && bun run --filter @ai/chat-web preview --port ${P.chat}`,
      cwd: "../..",
      url: CHAT,
      reuseExistingServer: false,
      timeout: 240_000,
      // Đăng nhập qua admin-api (AUTH_URL), nghiệp vụ qua Hub thật.
      env: { HUB_URL: HUB, AUTH_URL: API },
    },
  ],
});
