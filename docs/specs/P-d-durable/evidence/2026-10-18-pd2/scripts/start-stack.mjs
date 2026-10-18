// Dựng stack e2e P-d bằng tay (giữ sống giữa các lần chạy UAT). Chạy từ gốc repo bằng Node.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

if (existsSync(".env.test-pd_e2e.local")) process.loadEnvFile(".env.test-pd_e2e.local");
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const KEY = Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 7 + 3) & 0xff)).toString("base64");
const B = 5300;
const P = { api: B + 1, hub: B + 2, ready: B + 3, chat: B + 4, admin: B + 5, seeded: B + 6 };
const CHAT = `http://localhost:${P.chat}`;
const ADMIN = `http://localhost:${P.admin}`;
const env = process.env;
const run = (name, cmd, args, extra) => {
  const c = spawn(cmd, args, { env: { ...env, ...extra }, stdio: "inherit", shell: true });
  c.on("exit", (code) => console.log(`[${name}] exit ${code}`));
  return c;
};
run("stack", "bun", ["e2e/P-b2/_pb2-stack.ts"], {
  APP_ENV: "test",
  PA_API_PORT: String(P.api),
  PA_HUB_PORT: String(P.hub),
  PA_READY_PORT: String(P.ready),
  PA_CHAT_ORIGIN: CHAT,
  PA_ADMIN_ORIGIN: ADMIN,
  PA_REDIS_DB: "14",
  HUB_PROCESS_ENGINE: "on",
  HUB_SECRETS_KEY: env.HUB_SECRETS_KEY ?? KEY,
  PB2_SEEDED_PORT: String(P.seeded),
});
const web = (name, filter, port, extra) =>
  run(name, "cmd", ["/c", `bun run --filter @ai/${filter} build && bun run --filter @ai/${filter} preview --port ${port}`], extra);
web("chat", "chat-web", P.chat, { HUB_URL: `http://localhost:${P.hub}`, AUTH_URL: `http://localhost:${P.api}` });
web("admin", "admin-web", P.admin, { ADMIN_API_URL: `http://localhost:${P.api}`, PUBLIC_HUB_URL: `http://localhost:${P.hub}` });
