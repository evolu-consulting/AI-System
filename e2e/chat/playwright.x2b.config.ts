// HUB-FR-101 · HUB-FR-103 · X2b-AC01…AC17 · e2e X2b (test-plan-e2e.md): như `playwright.x2a.config.ts` + fixture agent + Runtime giả.
// Đuôi `.x2b.ts`. Chạy từ gốc repo, TUẦN TỰ với các bộ e2e khác dùng DB test:
//   bunx playwright test -c e2e/chat/playwright.x2b.config.ts
// Cổng mặc định: admin-api 3032, hub-api 4051, sẵn sàng/Runtime giả 4058, chat-web 3131; đổi bằng
// `CHAT_E2E_HUB_PORT` / `CHAT_E2E_WEB_PORT` (thêm `CHAT_E2E_API_PORT`, `CHAT_E2E_READY_PORT`).
import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";
import { viStorageState } from "../support/locale-vi";

const CI = !!process.env.CI;
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`playwright.x2b.config: thiếu ${name} (chạy \`bun run keys:dev\`)`);
  return v;
}
const port = (k: string, d: number): number => Number(process.env[k] ?? d);

const P = {
  api: port("CHAT_E2E_API_PORT", 3032),
  hub: port("CHAT_E2E_HUB_PORT", 4051),
  ready: port("CHAT_E2E_READY_PORT", 4058),
  chat: port("CHAT_E2E_WEB_PORT", 3131),
} as const;
const CHAT = `http://localhost:${P.chat}`;
const API = `http://localhost:${P.api}`;
const HUB = `http://localhost:${P.hub}`;
process.env.X2B_HUB_URL = HUB;
process.env.X2B_API_URL = API;
// `_x2a-support.ts` đọc X2A_* ⇒ trỏ về stack X2b (dùng lại token/hub/apiGroup/locator X2a).
process.env.X2A_HUB_URL = HUB;
process.env.X2A_API_URL = API;
process.env.X2B_RT_URL = `http://localhost:${P.ready}`;

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.x2b.ts",
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
      command: "bun e2e/chat/_x2b-stack.ts",
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
        X2B_API_PORT: String(P.api),
        X2B_HUB_PORT: String(P.hub),
        X2B_READY_PORT: String(P.ready),
        X2B_CHAT_ORIGIN: CHAT,
      },
    },
    {
      command: `bun run --filter @ai/chat-web build && bun run --filter @ai/chat-web preview --port ${P.chat}`,
      cwd: "../..",
      url: CHAT,
      reuseExistingServer: false,
      timeout: 240_000,
      env: { HUB_URL: HUB, AUTH_URL: API },
    },
  ],
});
