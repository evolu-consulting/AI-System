// HUB-FR-96…102 · e2e X2a · dựng backend THẬT (test-plan X2a §6, spec Q7): reset DB test + fixture M1–M3 (`prepareDbWithRetry`)
// → migrate Hub → `hub:seed` → 48 user acme `qe01…qe48` (mật khẩu PW, cho nhóm 49) → admin-api (auth) → hub-api (Redis DB 14);
// rồi mở cổng báo sẵn sàng. KHÔNG chèn phòng ở đây (bảng phòng có sau B1 — phòng dựng trong ca qua API). Dừng: SIGTERM/SIGINT.
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { runHubMigrations } from "@ai/db/migrate-hub";
import postgres from "postgres";
import { hashPw, PW, TENANT_ID } from "../../tests/acceptance/M1/_data";
import { prepareDbWithRetry } from "../x1/_prepare";
import { QE } from "./_x2a-data";

const REPO = resolve(import.meta.dir, "../..");
const env = (n: string): string => {
  const v = process.env[n];
  if (!v) throw new Error(`${n} chưa đặt (e2e/chat/playwright.x2a.config.ts truyền xuống)`);
  return v;
};
const num = (k: string, d: number): number => Number(process.env[k] ?? d);
const PORTS = {
  api: num("X2A_API_PORT", 3031),
  hub: num("X2A_HUB_PORT", 4050),
  ready: num("X2A_READY_PORT", 4059),
};

async function prepare(): Promise<void> {
  const url = env("TEST_DATABASE_URL");
  prepareDbWithRetry();
  await runHubMigrations({ url, appEnv: "test" });
  execFileSync("bun", ["apps/hub-api/src/modules/seed/seed.ts"], {
    cwd: REPO,
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url },
  });
  const hash = await hashPw(PW);
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const rows = QE.map((q) => ({
      id: q.id,
      tenant_id: TENANT_ID.acme,
      username: q.username,
      email: null,
      password_hash: hash,
      display_name: q.display_name,
      role: "member",
      locale: "vi",
      active: true,
      locked_by_tenant: false,
      must_change_password: false,
    }));
    await sql`insert into admin.users ${sql(rows)} on conflict (id) do nothing`;
  } finally {
    await sql.end();
  }
}

function hubDbUrl(owner: string): string {
  const u = new URL(owner);
  u.username = "hub_api";
  u.password = "hub_api_dev_pw";
  return u.toString();
}

async function healthy(base: string, proc: Bun.Subprocess): Promise<void> {
  const until = Date.now() + 60_000;
  while (Date.now() < until) {
    if (proc.exitCode !== null)
      throw new Error(`${base}: tiến trình thoát (exit ${proc.exitCode})`);
    try {
      if ((await fetch(`${base}/health`, { signal: AbortSignal.timeout(2_000) })).ok) return;
    } catch {
      // chưa nghe cổng
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`${base}/health không sẵn sàng sau 60s`);
}

const spawn = (file: string, extra: Record<string, string>): Bun.Subprocess =>
  Bun.spawn([process.execPath, file], {
    cwd: REPO,
    env: { ...process.env, ...extra },
    stdout: "inherit",
    stderr: "inherit",
  });

await prepare();
const origin = env("X2A_CHAT_ORIGIN");
const hubUrl = `http://localhost:${PORTS.hub}`;
const api = spawn("apps/admin-api/src/server.ts", {
  APP_ENV: "test",
  PORT: String(PORTS.api),
  CORS_ORIGINS: origin,
  ADMIN_API_DATABASE_URL: env("TEST_ADMIN_API_DATABASE_URL"),
  ADMIN_HUB_URL: hubUrl,
});
const hub = spawn("apps/hub-api/src/server.ts", {
  APP_ENV: "test",
  HUB_PORT: String(PORTS.hub),
  HUB_DATABASE_URL: hubDbUrl(env("TEST_DATABASE_URL")),
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: biến e2e tuỳ chọn
  REDIS_URL: process.env.X2A_REDIS_URL ?? "redis://localhost:6379/14",
  HUB_INSTANCE_ID: "e2e-x2a",
  HUB_CORS_ORIGINS: origin,
  HUB_CONFIG_POLL_S: "2",
});
const stop = (): void => {
  hub.kill();
  api.kill();
  process.exit(0);
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
await healthy(`http://localhost:${PORTS.api}`, api);
await healthy(hubUrl, hub);
Bun.serve({ port: PORTS.ready, fetch: () => new Response("ok") });
console.log(`[x2a] sẵn sàng: admin-api :${PORTS.api} · hub-api :${PORTS.hub}`);
