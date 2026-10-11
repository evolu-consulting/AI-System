// HUB-FR-120…124 · ADM-FR-68/69 · e2e P-b (test-plan §4.6): Hub THẬT + Runtime giả (stage `agent.cli` + `source.resolve`) + admin-web
// + chat-web. Đuôi `.pb.ts` (không `.spec.ts` — tránh config gốc `e2e/` nhặt). Project = thư mục: `admin` (E-PB01…09, 12),
// `chat` (E-PB10, 11, 13).
// Chạy từ gốc repo, 1 worker, TUẦN TỰ với bộ e2e khác dùng cùng DB:
//   bunx playwright test -c e2e/P-b/playwright.pb.config.ts --project=admin --reporter=line | tail -40
// Env: `PB_E2E_ENV` (mặc định `.env.test-pb_e2e.local`, tạo bằng `bun run db:test:create pb_e2e`) đọc TRƯỚC `.env.local`
// (không ghi đè) ⇒ DB test riêng. Cổng = `PB_E2E_PORT_BASE` (mặc định 4600): +1 admin-api · +2 hub-api · +3 sẵn sàng/Runtime giả
// · +4 chat-web · +5 admin-web. Redis DB `PB_REDIS_DB` (mặc định 9).
import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";
import { viStorageState } from "../support/locale-vi";

const CI = !!process.env.CI;
// biome-ignore lint/suspicious/noUndeclaredEnvVars: biến e2e tuỳ chọn
const ENV_FILE = process.env.PB_E2E_ENV ?? ".env.test-pb_e2e.local";
if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`playwright.pb.config: thiếu ${name} (chạy \`bun run keys:dev\`)`);
  return v;
}
// biome-ignore lint/suspicious/noUndeclaredEnvVars: biến e2e tuỳ chọn
const BASE = Number(process.env.PB_E2E_PORT_BASE ?? 4600);
const P = {
  api: BASE + 1,
  hub: BASE + 2,
  ready: BASE + 3,
  chat: BASE + 4,
  admin: BASE + 5,
} as const;
const CHAT = `http://localhost:${P.chat}`;
const ADMIN = `http://localhost:${P.admin}`;
const API = `http://localhost:${P.api}`;
const HUB = `http://localhost:${P.hub}`;
// `_x2a-support.ts` đọc X2A_* (token/hub/chatLogin dùng lại) ⇒ trỏ về stack P-b.
process.env.X2A_HUB_URL = HUB;
process.env.X2A_API_URL = API;
process.env.PB_RT_URL = `http://localhost:${P.ready}`;
process.env.PB_ADMIN_URL = ADMIN;
process.env.PB_CHAT_URL = CHAT;
// `_pa-support.ts` (settle/rtScript/…) đọc PA_*.
process.env.PA_RT_URL = `http://localhost:${P.ready}`;
process.env.PA_ADMIN_URL = ADMIN;
process.env.PA_CHAT_URL = CHAT;

const dir = (name: string, baseURL: string) => ({
  name,
  testMatch: `${name}/**/*.pb.ts`,
  use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 }, baseURL },
});

export default defineConfig({
  testDir: ".",
  workers: 1,
  fullyParallel: false,
  forbidOnly: CI,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: CHAT,
    locale: "vi-VN",
    storageState: viStorageState([CHAT, ADMIN]),
    timezoneId: "Asia/Ho_Chi_Minh",
    viewport: { width: 1280, height: 800 },
    trace: "retain-on-failure",
    // thao tác trên phần tử chưa có ⇒ lỗi locator sau 15s (đỏ đúng lý do), không hết giờ cả ca
    actionTimeout: 15_000,
  },
  projects: [dir("admin", ADMIN), dir("chat", CHAT)],
  webServer: [
    {
      command: "bun e2e/P-b/_pb-stack.ts",
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
        PB_API_PORT: String(P.api),
        PB_HUB_PORT: String(P.hub),
        PB_READY_PORT: String(P.ready),
        PB_CHAT_ORIGIN: CHAT,
        PB_ADMIN_ORIGIN: ADMIN,
        // biome-ignore lint/suspicious/noUndeclaredEnvVars: biến e2e tuỳ chọn
        PB_REDIS_DB: process.env.PB_REDIS_DB ?? "9",
      },
    },
    {
      command: `bun run --filter @ai/chat-web build && bun run --filter @ai/chat-web preview --port ${P.chat}`,
      cwd: "../..",
      url: CHAT,
      reuseExistingServer: false,
      timeout: 300_000,
      env: { HUB_URL: HUB, AUTH_URL: API },
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
