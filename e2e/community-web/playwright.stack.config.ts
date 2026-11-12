// CR-102 · C12b · e2e 3 vai (chủ quản / NCC / người mua) trên STACK THẬT: community-web + hub-api + admin-api (SSO), DB test riêng đã
// seed bằng `seed-community-demo` (tenant demo). Tự đủ (e2e-stack-server): `webServer` dựng backend (`_cs-stack.ts`: reset DB →
// migrate → seed) + build/preview community-web (adapter `http`, proxy /auth→admin-api, /pack→hub-api). Không mock.
// Chạy từ gốc repo (cần .env.local từ `bun run keys:dev`, Postgres + Redis test):
//   bun tools/scripts/src/run-playwright.ts e2e/community-web/playwright.stack.config.ts
// hoặc cả bộ: `bun run test:e2e:par --only=community-web-stack` (evotest: run-tests.ps1 -Step e2e -Filter community-web-stack -All).
// Cổng (dịch theo làn E2E_PORT_SHIFT): web 3400 · admin-api 3401 · hub-api 3402 · sẵn sàng 3403. Redis DB `CS_REDIS_DB` (mặc định 13).
// Mật khẩu demo-owner sinh ngẫu nhiên mỗi lượt (không nằm trong repo); mật khẩu tạm đối tác nằm ở test-results/community-stack-seed.
// Chỉ nhận `*.cs.ts` (không đụng bộ mock `*.cm.ts`). Dùng bên ngoài: đặt `COMMUNITY_URL` + `COMMUNITY_SEED_PW_FILE` + `DEMO_OWNER_PW`
// và `CS_EXTERNAL=1` để bỏ qua webServer (stack đã chạy sẵn).
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const need = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`playwright.stack.config: thiếu ${name} (chạy \`bun run keys:dev\`)`);
  return v;
};
// biome-ignore lint/suspicious/noUndeclaredEnvVars: biến môi trường của runner e2e (không khai báo trong turbo)
const SH = Number(process.env.E2E_PORT_SHIFT ?? 0);
const P = {
  web: 3400 + SH,
  api: 3401 + SH,
  hub: 3402 + SH,
  ready: 3403 + SH,
  admin: 3405 + SH,
} as const;
const WEB = `http://localhost:${P.web}`;
// biome-ignore lint/suspicious/noUndeclaredEnvVars: biến môi trường của runner e2e (không khai báo trong turbo)
const EXTERNAL = process.env.CS_EXTERNAL === "1";

// Workers thừa kế env của tiến trình cấu hình (`||=`: cấu hình nạp lại ở worker không đổi giá trị).
process.env.DEMO_OWNER_PW ||= `${randomBytes(12).toString("base64url")}-Aa1`;
process.env.COMMUNITY_SEED_PW_FILE ||= resolve("test-results/community-stack-seed/pw.json");
process.env.COMMUNITY_URL ||= WEB;
// CR-120: ai-admin (platform admin gán quy trình duyệt bài ở hành trình `flows.cs.ts`).
process.env.CS_ADMIN_URL ||= `http://localhost:${P.admin}`;
// CR-127 Z7: API đường platform (tạo quy trình công ty từ sơ đồ trống): admin-api + hub-api của stack.
process.env.CS_API_URL ||= `http://localhost:${P.api}`;
process.env.CS_HUB_URL ||= `http://localhost:${P.hub}`;

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.cs.ts",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  outputDir: "../../test-results/community-stack",
  use: {
    // biome-ignore lint/suspicious/noUndeclaredEnvVars: biến môi trường của runner e2e (không khai báo trong turbo)
    baseURL: process.env.COMMUNITY_URL,
    locale: "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 45_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: EXTERNAL
    ? []
    : [
        {
          command: "bun e2e/community-web/_cs-stack.ts",
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
            DEMO_OWNER_PW: need("DEMO_OWNER_PW"),
            CS_SEED_OUT: need("COMMUNITY_SEED_PW_FILE"),
            CS_API_PORT: String(P.api),
            CS_HUB_PORT: String(P.hub),
            CS_READY_PORT: String(P.ready),
            CS_WEB_ORIGIN: WEB,
            CS_ADMIN_ORIGIN: `http://localhost:${P.admin}`,
            // biome-ignore lint/suspicious/noUndeclaredEnvVars: biến môi trường của runner e2e (không khai báo trong turbo)
            CS_REDIS_DB: process.env.CS_REDIS_DB ?? "13",
          },
        },
        {
          command: `bun run --filter @ai/workspace-web build && bun run --filter @ai/workspace-web preview --port ${P.web}`,
          cwd: "../..",
          url: WEB,
          reuseExistingServer: false,
          timeout: 300_000,
          // Bản build `http` (không mock), proxy cùng origin tới backend thật.
          env: {
            PUBLIC_COMMUNITY_API: "http",
            ADMIN_API_URL: `http://localhost:${P.api}`,
            HUB_URL: `http://localhost:${P.hub}`,
          },
        },
        {
          command: `bun run --filter @ai/admin-web build && bun run --filter @ai/admin-web preview --port ${P.admin}`,
          cwd: "../..",
          url: `http://localhost:${P.admin}`,
          reuseExistingServer: false,
          timeout: 300_000,
          env: {
            E2E_DIST_DIR: "dist-e2e/cs-admin",
            ADMIN_API_URL: `http://localhost:${P.api}`,
            PUBLIC_HUB_URL: `http://localhost:${P.hub}`,
            PUBLIC_FROZEN_MODULES: "on",
          },
        },
      ],
});
