// UAT P-d2 · cấu hình Playwright: stack e2e P-d (cổng 5301…5306) do `start-stack.mjs` dựng sẵn (cùng lệnh/env với webServer của
// e2e/P-d/playwright.pd.config.ts) — config này KHÔNG dựng lại (build frontend ~1 phút/lần). Chromium 1280×800, vi-VN.
// Chạy: node node_modules/@playwright/test/cli.js test -c docs/specs/P-d-durable/evidence/2026-10-18-pd2/scripts/playwright.uat.config.ts
import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";
import { viStorageState } from "../../../../../../e2e/support/locale-vi";

const ENV_FILE = process.env.PD_E2E_ENV ?? ".env.test-pd_e2e.local";
if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const BASE = Number(process.env.PD_E2E_PORT_BASE ?? 5300);
const P = { api: BASE + 1, hub: BASE + 2, ready: BASE + 3, chat: BASE + 4, admin: BASE + 5 } as const;
const CHAT = `http://localhost:${P.chat}`;
const ADMIN = `http://localhost:${P.admin}`;
process.env.X2A_HUB_URL = `http://localhost:${P.hub}`;
process.env.X2A_API_URL = `http://localhost:${P.api}`;
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
  retries: 0,
  timeout: 150_000,
  expect: { timeout: 10_000 },
  reporter: "list",
  use: {
    baseURL: CHAT,
    locale: "vi-VN",
    storageState: viStorageState([CHAT, ADMIN]),
    timezoneId: "Asia/Ho_Chi_Minh",
    viewport: { width: 1280, height: 800 },
    actionTimeout: 15_000,
  },
  projects: [proj("admin", ADMIN), proj("chat", CHAT)],
});
