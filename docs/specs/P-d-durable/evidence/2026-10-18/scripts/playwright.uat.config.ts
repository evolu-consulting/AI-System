// HUB-FR-143 Â· HUB-FR-144 Â· HUB-FR-145 Â· ADM-FR-71 Â· ADM-FR-72 Â· P-d1 (test-plan-e2e Â§1 PD-E01â€¦E08): dÃ¹ng láº¡i STACK P-b2 (Hub THáº¬T
// + Runtime giáº£ P-a + admin-web + chat-web, `e2e/P-b2/_pb2-stack.ts`). Tráº¡ng thÃ¡i chá» háº¹n/thá»­ láº¡i dá»±ng báº±ng SQL (khÃ´ng chá» giá» tháº­t).
// ÄuÃ´i `.pd.ts`. Project `admin` (admin-*.pd.ts) Â· `chat` (chat-*.pd.ts). Cháº¡y tá»« gá»‘c repo, 1 worker:
//   bunx playwright test -c e2e/P-d/playwright.pd.config.ts --reporter=line
// Env: `PD_E2E_ENV` (máº·c Ä‘á»‹nh `.env.test-pd_e2e.local`, táº¡o báº±ng `bun run db:test:create pd_e2e`) Ä‘á»c TRÆ¯á»šC `.env.local`.
// Cá»•ng = `PD_E2E_PORT_BASE` (máº·c Ä‘á»‹nh 5300): +1 admin-api Â· +2 hub-api Â· +3 Runtime giáº£ Â· +4 chat-web Â· +5 admin-web Â· +6 "Ä‘Ã£ seed".
// Redis DB `PD_REDIS_DB` (máº·c Ä‘á»‹nh 14).
import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";
import { viStorageState } from "../../../../../../e2e/support/locale-vi";

const REPO = process.cwd();
const CI = !!process.env.CI;
// biome-ignore lint/suspicious/noUndeclaredEnvVars: biáº¿n e2e tuá»³ chá»n
const ENV_FILE = process.env.PD_E2E_ENV ?? ".env.test-pd_e2e.local";
if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

/** KhoÃ¡ mÃ£ hoÃ¡ secret Hub CHá»ˆ cho DB test e2e (32 byte cá»‘ Ä‘á»‹nh) â€” khÃ´ng pháº£i secret tháº­t. */
const TEST_SECRETS_KEY = Buffer.from(
  Array.from({ length: 32 }, (_, i) => (i * 7 + 3) & 0xff),
).toString("base64");

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`playwright.pd.config: thiáº¿u ${name} (cháº¡y \`bun run keys:dev\`)`);
  return v;
}
// biome-ignore lint/suspicious/noUndeclaredEnvVars: biáº¿n e2e tuá»³ chá»n
const BASE = Number(process.env.PD_E2E_PORT_BASE ?? 5300);
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
  testMatch: `${name}-*.uat.ts`,
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
  projects: [proj("admin", ADMIN), proj("chat", CHAT)],
  webServer: [
    {
      command: "bun e2e/P-b2/_pb2-stack.ts",
      cwd: REPO,
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
        // biome-ignore lint/suspicious/noUndeclaredEnvVars: biáº¿n e2e tuá»³ chá»n
        PA_REDIS_DB: process.env.PD_REDIS_DB ?? "14",
        HUB_PROCESS_ENGINE: "on",
        // biome-ignore lint/suspicious/noUndeclaredEnvVars: biáº¿n e2e tuá»³ chá»n
        HUB_SECRETS_KEY: process.env.HUB_SECRETS_KEY ?? TEST_SECRETS_KEY,
        PB2_SEEDED_PORT: String(P.seeded),
      },
    },
    {
      command: `bun run --filter @ai/chat-web build && bun run --filter @ai/chat-web preview --port ${P.chat}`,
      cwd: REPO,
      url: CHAT,
      reuseExistingServer: false,
      timeout: 300_000,
      env: { HUB_URL: HUB, AUTH_URL: API },
    },
    {
      command: `bun run --filter @ai/admin-web build && bun run --filter @ai/admin-web preview --port ${P.admin}`,
      cwd: REPO,
      url: ADMIN,
      reuseExistingServer: false,
      timeout: 300_000,
      env: { ADMIN_API_URL: API, PUBLIC_HUB_URL: HUB },
    },
  ],
});


