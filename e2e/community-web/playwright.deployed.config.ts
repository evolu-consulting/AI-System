// com-prod-seed · e2e community-web trên PRODUCTION (https://community.evoluconsulting.com), tenant demo, CHỈ ĐỌC (CS_READONLY=1):
// roles.cs.ts bỏ bước đăng bình luận; chỉ ghi dữ liệu duy nhất = đổi mật khẩu bắt buộc của đối tác (rồi ghi ngược vào file cred).
// Không thuộc `test:all` (test-all.discover loại `*.deployed.config.ts`). Chạy từ gốc repo, xem runbook ở
// docs/specs/com-c12-seed-e2e/tasks.md:
//   $env:CS_CRED_FILE='F:\workspace\secrets\community-demo-partners.txt'; $env:CS_NEW_PW='<mật khẩu mới>'
//   $env:CS_OWNER_CRED_FILE='F:\workspace\secrets\DEMO_CREDENTIALS.txt'
//   bun tools/scripts/src/run-playwright.ts e2e/community-web/playwright.deployed.config.ts
// Mật khẩu KHÔNG lên log: trace/screenshot/video tắt, reporter list không in giá trị fill.
import { defineConfig, devices } from "@playwright/test";
import { loadDeployedEnv, PROD_COMMUNITY_URL } from "./deployed.support";

loadDeployedEnv();

export default defineConfig({
  testDir: ".",
  testMatch: "roles.cs.ts",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  timeout: 90_000,
  expect: { timeout: 15_000 },
  outputDir: "../../test-results/community-deployed",
  use: {
    baseURL: process.env.COMMUNITY_URL ?? PROD_COMMUNITY_URL,
    locale: "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
    viewport: { width: 1440, height: 900 },
    trace: "off",
    screenshot: "off",
    video: "off",
    actionTimeout: 20_000,
    navigationTimeout: 60_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
