// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: biến e2e/test, không ảnh hưởng cache build
// CR-169 · hành trình «nhắn tin người–người giữa hai công ty đã kết nối» trên stack THẬT của journey-approval, cùng cách dựng hai công ty của CR-161
// (`e2e/cr161/_cr161-stack.ts` + `e2e/_kit/two-companies*.ts`) nhưng DB + cổng riêng (xem `test-e2e-par.rules.ts`). Chạy: `run-tests.ps1 -Step e2e -Filter cr169`.
import { defineConfig } from "@playwright/test";
import base from "../journey-approval/playwright.journey.config";

const SH = Number(process.env.E2E_PORT_SHIFT ?? 0);
const READY = 3445 + SH;
// Chat AI app (chat-web) cùng stack: đăng nhập qua admin-api, nghiệp vụ qua hub-api; cổng kế sau «sẵn sàng» của cr161.
const CHAT_PORT = 3446 + SH;
const CHAT = `http://localhost:${CHAT_PORT}`;
process.env.JA_CHAT_URL = CHAT;
process.env.CR161_READY_PORT = String(READY); // `_cr161-stack.ts` đọc biến này
// một mã lượt chạy cho MỌI worker (worker khởi động lại sau ca đỏ sẽ nạp lại spec — mã tính trong spec sẽ khác nhau)
process.env.CR169_RUN ||= Date.now().toString(36);

export default defineConfig({
  ...base,
  testDir: "..",
  testMatch: ["**/cr169/*.spec.ts"],
  testIgnore: [],
  preserveOutput: "always",
  outputDir: "../../test-results/cr169",
  webServer: [
    // chat-web gọi hub/admin-api cùng origin qua proxy, Origin = chat-web ⇒ thêm vào `JA_ORIGINS` của stack journey
    ...(Array.isArray(base.webServer) ? base.webServer : []).map((w) =>
      w.command.includes("_ja-stack.ts")
        ? { ...w, env: { ...w.env, JA_ORIGINS: `${w.env?.JA_ORIGINS ?? ""},${CHAT}` } }
        : w,
    ),
    {
      command: `bun run --filter @ai/chat-web build && bun run --filter @ai/chat-web preview --port ${CHAT_PORT}`,
      cwd: "../..",
      url: CHAT,
      reuseExistingServer: false,
      timeout: 300_000,
      env: {
        E2E_DIST_DIR: "dist-e2e/cr169-chat",
        HUB_URL: `http://localhost:${3443 + SH}`,
        AUTH_URL: `http://localhost:${3442 + SH}`,
      },
    },
    {
      command: "bun e2e/cr161/_cr161-stack.ts",
      cwd: "../..",
      url: `http://localhost:${READY}`,
      reuseExistingServer: false,
      timeout: 300_000,
      env: { CR161_READY_PORT: String(READY) },
    },
  ],
});
