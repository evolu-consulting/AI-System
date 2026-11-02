// sohoptac2-stg · smoke e2e trên staging của image PROD (deploy/stg-sohoptac2). KHÔNG thuộc test:all (tên không khớp playwright*.config.ts).
// Chạy trong container `pw` (network host, chỉ 127.0.0.1:284xx) bằng deploy/stg-sohoptac2/smoke.sh; cần STG_* env (compose đặt).
// Dùng lại `e2e/community-web/roles.cs.ts` (3 vai) bằng COMMUNITY_URL + mật khẩu từ file; thêm `smoke.stg.ts`.
import { readFileSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

const need = (n: string): string => {
  const v = process.env[n];
  if (!v) throw new Error(`stg.config: thiếu ${n}`);
  return v;
};
const base = need("STG_WEB_BASE");
process.env.COMMUNITY_URL = `http://${base}:${need("STG_PORT_COMMUNITY")}`;
process.env.DEMO_OWNER_PW = readFileSync(need("STG_OWNER_PW_FILE"), "utf8").trim();
process.env.COMMUNITY_SEED_PW_FILE = need("STG_PARTNERS_FILE");

export default defineConfig({
  testDir: "..",
  testMatch: ["stg/*.stg.ts", "community-web/roles.cs.ts"],
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [
    ["list"],
    ["junit", { outputFile: "../../out/report/junit.xml" }],
    ["json", { outputFile: "../../out/report/report.json" }],
  ],
  timeout: 90_000,
  expect: { timeout: 15_000 },
  outputDir: "../../out/results",
  use: {
    locale: "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
    viewport: { width: 1440, height: 900 },
    trace: "off",
    screenshot: "only-on-failure",
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
