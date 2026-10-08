// CHAT-AC-35 · e2e chat-web: config riêng, KHÔNG đụng `playwright.config.ts` gốc (admin/M4).
// Đuôi `.chat.ts` không khớp testMatch mặc định của config admin ⇒ hai bộ không chạy lẫn.
// Chạy từ gốc repo: `bun run e2e:chat`. Mock Hub cổng CHAT_E2E_HUB_PORT (mặc định 4020), chat-web 3100.
import { defineConfig, devices } from "@playwright/test";
import { viStorageState } from "../support/locale-vi";

const CI = !!process.env.CI;
const HUB_PORT = Number(process.env.CHAT_E2E_HUB_PORT ?? 4020);
const HUB = `http://localhost:${HUB_PORT}`;
// Mặc định 3100 (AC-34); đổi khi cổng đang bị dev server khác chiếm.
const WEB_PORT = Number(process.env.CHAT_E2E_WEB_PORT ?? 3100);
const WEB = `http://localhost:${WEB_PORT}`;

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.chat.ts",
  workers: 1,
  fullyParallel: false,
  forbidOnly: CI,
  retries: 0,
  reporter: CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: WEB,
    locale: "vi-VN",
    storageState: viStorageState([WEB]),
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
      command: "bun ./tools/mocks/src/server.ts",
      cwd: "../..",
      url: `${HUB}/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      // DIFY_MOCK_PORT lệch 8 để không đụng mock dev (4010).
      env: {
        HUB_MOCK_PORT: String(HUB_PORT),
        DIFY_MOCK_PORT: String(HUB_PORT - 8),
        MOCK_FAST: "1",
      },
    },
    {
      command: `bun run --filter @ai/chat-web build && bun run --filter @ai/chat-web preview --port ${WEB_PORT}`,
      cwd: "../..",
      url: WEB,
      reuseExistingServer: false,
      timeout: 180_000,
      // AUTH_URL trống = HUB_URL (CHAT-AC-34: đổi đích chỉ bằng biến môi trường).
      env: { HUB_URL: HUB, AUTH_URL: "" },
    },
  ],
});
