// HUB-FR-101 · HUB-FR-103 · e2e X2b · dựng backend THẬT như `_x2a-stack.ts` + fixture agent phòng (spec X2b §7) + Runtime giả:
// reset DB test + fixture M1–M3 → migrate Hub → `hub:seed` → agent `hoadon`/`trello` (SQL owner; tên hiển thị = key, profile
// `fake-1`) + quyền: A=`lan` (hoadon, trello) · B=`thu` (chỉ trello) · C=`an` (chỉ hoadon) → admin-api → hub-api (Redis DB 13).
// Cổng "sẵn sàng" phục vụ cả `/rt/<op>` (Runtime giả, `_x2b-runtime.ts`). Không Dify, không `claude-sub`. Dừng: SIGTERM/SIGINT.
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { runHubMigrations } from "@ai/db/migrate-hub";
import postgres from "postgres";
import { createRedis } from "../../apps/hub-api/src/lib/redis";
import { TENANT_ID, USER_ID } from "../../tests/acceptance/M1/_data";
import { prepareDbWithRetry } from "../x1/_prepare";
import { FakeRuntime, handleRt } from "./_x2b-runtime";

const REPO = resolve(import.meta.dir, "../..");
const env = (n: string): string => {
  const v = process.env[n];
  if (!v) throw new Error(`${n} chưa đặt (e2e/chat/playwright.x2b.config.ts truyền xuống)`);
  return v;
};
const num = (k: string, d: number): number => Number(process.env[k] ?? d);
const PORTS = {
  api: num("X2B_API_PORT", 3032),
  hub: num("X2B_HUB_PORT", 4051),
  ready: num("X2B_READY_PORT", 4058),
};
const AGENT_ID = {
  hoadon: "a2bb0000-0000-4000-8000-000000000052",
  trello: "a2bb0000-0000-4000-8000-000000000051",
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
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const [p] = await sql<{ id: string }[]>`select id from hub.model_profiles where key = 'fake-1'`;
    const agent = (id: string, key: string, desc: string) => ({
      id,
      key,
      name: sql.json({
        vi: key === "trello" ? "Trello" : key,
        en: key === "trello" ? "Trello" : key,
      }),
      description: desc,
      runtime: "agentic-cli",
      profile_id: p?.id,
      system_prompt: "",
    });
    await sql`insert into hub.agents ${sql([
      agent(AGENT_ID.hoadon, "hoadon", "Kiểm tra hoá đơn đầu vào."),
      agent(AGENT_ID.trello, "trello", "Tạo và cập nhật thẻ Trello của nhóm."),
    ])} on conflict (key) do nothing`;
    const ids = await sql<{ id: string; key: string }[]>`
      select id, key from hub.agents where key in ('hoadon', 'trello')`;
    const id = (k: string): string => ids.find((r) => r.key === k)?.id ?? "";
    await sql`insert into hub.agent_entitlements ${sql(
      ids.map((r) => ({ agent_id: r.id, tenant_id: TENANT_ID.acme })),
    )} on conflict do nothing`;
    const g = (key: string, user: string) => ({
      agent_id: id(key),
      tenant_id: TENANT_ID.acme,
      subject_type: "user",
      subject_id: user,
    });
    await sql`insert into hub.agent_grants ${sql([
      g("hoadon", USER_ID.lan),
      g("trello", USER_ID.lan),
      g("trello", USER_ID.thu),
      g("hoadon", USER_ID.an),
    ])} on conflict do nothing`;
    await sql`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
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
const origin = env("X2B_CHAT_ORIGIN");
const hubUrl = `http://localhost:${PORTS.hub}`;
// biome-ignore lint/suspicious/noUndeclaredEnvVars: biến e2e tuỳ chọn
const redisUrl = process.env.X2B_REDIS_URL ?? "redis://localhost:6379/13";
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
  REDIS_URL: redisUrl,
  HUB_INSTANCE_ID: "e2e-x2b",
  HUB_CORS_ORIGINS: origin,
  HUB_CONFIG_POLL_S: "2",
  HUB_MAX_CONCURRENT_RUNS: "2",
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
const redis = createRedis(redisUrl);
await redis.connect();
const rt = new FakeRuntime(
  postgres(env("TEST_DATABASE_URL"), { max: 2, onnotice: () => {} }),
  redis,
);
Bun.serve({
  port: PORTS.ready,
  idleTimeout: 30,
  fetch: (req) =>
    new URL(req.url).pathname.startsWith("/rt/") ? handleRt(rt, req) : new Response("ok"),
});
console.log(`[x2b] sẵn sàng: admin-api :${PORTS.api} · hub-api :${PORTS.hub} · rt :${PORTS.ready}`);
