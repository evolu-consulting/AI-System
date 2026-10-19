// N2-FR-04 · N2-FR-05 · e2e admin-web lát N2 (readiness #4) — khuôn `e2e/P-d/playwright.pd.config.ts`, dùng lại STACK P-b2 (Hub THẬT
// + Runtime giả P-a + admin-web + chat-web, `e2e/P-b2/_pb2-stack.ts`). Trạng thái chờ hẹn/thử lại dựng bằng SQL (không chờ giờ thật).
// Đuôi `.n2.ts`, project `admin` (admin-*.n2.ts). Chạy từ gốc repo, 1 worker:
//   bunx playwright test -c e2e/N2/playwright.n2.config.ts --reporter=line
// Env: `PD_E2E_ENV` (mặc định `.env.test-pd_e2e.local`, tạo bằng `bun run db:test:create pd_e2e`) đọc TRƯỚC `.env.local`.
// Cổng = `PD_E2E_PORT_BASE` (mặc định 5300): +1 admin-api · +2 hub-api · +3 Runtime giả · +4 chat-web · +5 admin-web · +6 "đã seed".
// Redis DB `PD_REDIS_DB` (mặc định 14).
import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";
import { viStorageState } from "../support/locale-vi";

const CI = !!process.env.CI;
// biome-ignore lint/suspicious/noUndeclaredEnvVars: biến e2e tuỳ chọn
const ENV_FILE = process.env.PD_E2E_ENV ?? ".env.test-pd_e2e.local";
if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

/** Khoá mã hoá secret Hub CHỈ cho DB test e2e (32 byte cố định) — không phải secret thật. */
const TEST_SECRETS_KEY = Buffer.from(
  Array.from({ length: 32 }, (_, i) => (i * 7 + 3) & 0xff),
).toString("base64");

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`playwright.n2.config: thiếu ${name} (chạy \`bun run keys:dev\`)`);
  return v;
}
// biome-ignore lint/suspicious/noUndeclaredEnvVars: biến e2e tuỳ chọn
const BASE = Number(process.env.N2_E2E_PORT_BASE ?? 5340);
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
process.env.X2A_HUB_URL = HUB;
process.env.X2A_API_URL = API;
process.env.PA_RT_URL = `http://localhost:${P.ready}`;
process.env.PA_ADMIN_URL = ADMIN;
process.env.PA_CHAT_URL = CHAT;

const proj = (name: string, baseURL: string) => ({
  name,
  testMatch: `${name}-*.n2.ts`,
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
    actionTimeout: 15_000,
  },
  projects: [proj("admin", ADMIN)],
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
        PA_REDIS_DB: process.env.N2_REDIS_DB ?? "13",
        HUB_PROCESS_ENGINE: "on",
        // biome-ignore lint/suspicious/noUndeclaredEnvVars: biến e2e tuỳ chọn
        HUB_SECRETS_KEY: process.env.HUB_SECRETS_KEY ?? TEST_SECRETS_KEY,
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
