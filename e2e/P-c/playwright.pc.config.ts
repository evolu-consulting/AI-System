// HUB-FR-119 · HUB-FR-128 · HUB-FR-115 · P-c1 (test-plan P-c §4 E01–E12): dùng lại STACK P-b2 (Hub THẬT + Runtime giả P-a + admin-web +
// chat-web, `e2e/P-b2/_pb2-stack.ts`; dữ liệu thử nghiệm acme riêng — UAT trên evolu là việc của qc-uat); `StageView.autofix` + nội dung diff/log
// giả lập bằng `page.route`. Đuôi `.pc.ts`.
// Project = thư mục: `admin` (E01–E02), `chat` (E03–E12). Chạy từ gốc repo, 1 worker:
//   bunx playwright test -c e2e/P-c/playwright.pc.config.ts --project=admin --reporter=line | tail -40
// Env: `PC_E2E_ENV` (mặc định `.env.test-pc_e2e.local`, tạo bằng `bun run db:test:create pc_e2e`) đọc TRƯỚC `.env.local`
// (không ghi đè) ⇒ DB test riêng. Cổng = `PC_E2E_PORT_BASE` (mặc định 4900): +1 admin-api · +2 hub-api · +3 Runtime giả
// · +4 chat-web · +5 admin-web · +6 "đã seed P-b2". Redis DB `PC_REDIS_DB` (mặc định 12).
import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";
import { viStorageState } from "../support/locale-vi";

const CI = !!process.env.CI;
// biome-ignore lint/suspicious/noUndeclaredEnvVars: biến e2e tuỳ chọn
const ENV_FILE = process.env.PC_E2E_ENV ?? ".env.test-pc_e2e.local";
if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`playwright.pc.config: thiếu ${name} (chạy \`bun run keys:dev\`)`);
  return v;
}
// biome-ignore lint/suspicious/noUndeclaredEnvVars: biến e2e tuỳ chọn
const BASE = Number(process.env.PC_E2E_PORT_BASE ?? 4900);
const P = {
  api: BASE + 1,
  hub: BASE + 2,
  ready: BASE + 3,
  chat: BASE + 4,
  admin: BASE + 5,
  seeded: BASE + 6,
} as const;
const CHAT = `http://localhost:${P.chat}`;
const ADMIN = `http://localhost:${P.admin}`;
const API = `http://localhost:${P.api}`;
const HUB = `http://localhost:${P.hub}`;
// `_x2a-support.ts` (token/hub/chatLogin) đọc X2A_*; `_pa-support.ts` (rtScript/settle/adminLogin) đọc PA_*.
process.env.X2A_HUB_URL = HUB;
process.env.X2A_API_URL = API;
process.env.PA_RT_URL = `http://localhost:${P.ready}`;
process.env.PA_ADMIN_URL = ADMIN;
process.env.PA_CHAT_URL = CHAT;

const dir = (name: string, baseURL: string) => ({
  name,
  testMatch: `${name}/**/*.pc.ts`,
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
      command: "bun e2e/P-b2/_pb2-stack.ts",
      cwd: "../..",
      url: `http://localhost:${P.seeded}`,
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
        PA_API_PORT: String(P.api),
        PA_HUB_PORT: String(P.hub),
        PA_READY_PORT: String(P.ready),
        PA_CHAT_ORIGIN: CHAT,
        PA_ADMIN_ORIGIN: ADMIN,
        // biome-ignore lint/suspicious/noUndeclaredEnvVars: biến e2e tuỳ chọn
        PA_REDIS_DB: process.env.PC_REDIS_DB ?? "12",
        HUB_PROCESS_ENGINE: "on",
        PB2_SEEDED_PORT: String(P.seeded),
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
