// HUB-FR-72 · H4a-AC-01, AC-02, AC-04, AC-06 · e2e studio-web: config riêng (mẫu `e2e/chat`), KHÔNG đụng
// `playwright.config.ts` gốc (admin) hay `e2e/chat`. Đuôi `.studio.ts` không khớp testMatch của hai bộ kia.
// API giả lập bằng `page.route` (spec §7 "test FE: mock http") — không cần Hub/admin-api/DB.
// Chạy từ gốc repo: `bunx playwright test -c e2e/studio/playwright.config.ts` (đề xuất script `e2e:studio`).
import { defineConfig, devices } from "@playwright/test";
import { viStorageState } from "../support/locale-vi";

const CI = !!process.env.CI;
// Cổng dev Studio 3200 (spec §7); đổi khi cổng đang bị dev server khác chiếm.
// biome-ignore lint/suspicious/noUndeclaredEnvVars: biến e2e tuỳ chọn, không thuộc task turbo
const WEB_PORT = Number(process.env.STUDIO_E2E_WEB_PORT ?? 3200);
const WEB = `http://localhost:${WEB_PORT}`;

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.studio.ts",
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
      name: "studio",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: [
    {
      command: `bun run --filter @ai/studio-web build && bun run --filter @ai/studio-web preview --port ${WEB_PORT}`,
      cwd: "../..",
      url: `${WEB}/studio/`,
      reuseExistingServer: false,
      timeout: 180_000,
      // spec §7: link "⇄ Admin"/Admin › Workflows chỉ hiện khi có URL Admin (E04 cần) — build nhận `PUBLIC_*` từ env.
      env: { ...process.env, PUBLIC_ADMIN_WEB_URL: "http://localhost:3000" } as Record<
        string,
        string
      >,
    },
  ],
});
