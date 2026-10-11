// HUB-FR-120…124 · ADM-FR-68/69 · e2e P-b · dựng backend THẬT (mẫu `e2e/P-a/_pa-stack.ts`): reset DB test riêng + fixture M1–M3 →
// migrate Hub (tới 0021) → `hub:seed` → agent `hd-read`/`hd-post` (profile `fake-1`; grant `lan`, `binh`) → admin-api → hub-api
// (`HUB_PROCESS_ENGINE=on`) → cổng "sẵn sàng" phục vụ `/rt/*` (Runtime giả P-a cho stage) + vòng lặp `source.resolve` giả
// (`_pb-runtime.ts`). Nguồn + quy trình dựng bằng API trong ca (`_pb-support.seedPb`). Không Dify, không git thật. SIGTERM/SIGINT dừng.
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { runHubMigrations } from "@ai/db/migrate-hub";
import postgres from "postgres";
import { createRedis } from "../../apps/hub-api/src/lib/redis";
import { handleRt, PaRuntime } from "../P-a/_pa-runtime";
import { prepareDbWithRetry } from "../x1/_prepare";
import { ACME, AGENT, PERSONA } from "./_pb-data";
import { PbSourceRuntime } from "./_pb-runtime";

const REPO = resolve(import.meta.dir, "../..");
const env = (n: string): string => {
  const v = process.env[n];
  if (!v) throw new Error(`${n} chưa đặt (e2e/P-b/playwright.pb.config.ts truyền xuống)`);
  return v;
};
const num = (k: string): number => Number(env(k));
const PORTS = { api: num("PB_API_PORT"), hub: num("PB_HUB_PORT"), ready: num("PB_READY_PORT") };

async function prepare(): Promise<void> {
  const url = env("TEST_DATABASE_URL");
  prepareDbWithRetry();
  await runHubMigrations({ url, appEnv: "test" });
  const seed = Bun.spawnSync([process.execPath, "apps/hub-api/src/modules/seed/seed.ts"], {
    cwd: REPO,
    stdout: "inherit",
    stderr: "inherit",
    env: { ...process.env, DATABASE_URL: url },
  });
  if (seed.exitCode !== 0) throw new Error("hub seed lỗi");
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const [p] = await sql<{ id: string }[]>`select id from hub.model_profiles where key = 'fake-1'`;
    const agent = (id: string, key: string, vi: string) => ({
      id,
      key,
      name: sql.json({ vi, en: vi }),
      description: `Agent ${vi} dùng cho bộ e2e P-b (fake-cli).`,
      runtime: "agentic-cli",
      profile_id: p?.id,
      system_prompt: "",
    });
    await sql`insert into hub.agents ${sql([
      agent(AGENT.read, "hd-read", "Đọc HĐ"),
      agent(AGENT.post, "hd-post", "Ghi sổ HĐ"),
    ])} on conflict (key) do nothing`;
    await sql`insert into hub.agent_entitlements
      select a.id, ${ACME}::uuid from hub.agents a on conflict do nothing`;
    for (const who of [PERSONA.A, PERSONA.Adm])
      await sql`insert into hub.agent_grants (agent_id, tenant_id, subject_type, subject_id)
        select a.id, ${ACME}::uuid, 'user', ${who.id}::uuid from hub.agents a
        where a.id in (${AGENT.read}, ${AGENT.post}) on conflict do nothing`;
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

if (import.meta.main) {
  await prepare();
  const origins = `${env("PB_CHAT_ORIGIN")},${env("PB_ADMIN_ORIGIN")}`;
  const hubUrl = `http://localhost:${PORTS.hub}`;
  const redisUrl = `redis://localhost:6379/${env("PB_REDIS_DB")}`;
  const api = spawn("apps/admin-api/src/server.ts", {
    APP_ENV: "test",
    PORT: String(PORTS.api),
    CORS_ORIGINS: origins,
    ADMIN_API_DATABASE_URL: env("TEST_ADMIN_API_DATABASE_URL"),
    ADMIN_HUB_URL: hubUrl,
  });
  const attachDir = resolve(REPO, "test-results", "pb-attach");
  mkdirSync(attachDir, { recursive: true });
  const hub = spawn("apps/hub-api/src/server.ts", {
    APP_ENV: "test",
    HUB_PORT: String(PORTS.hub),
    HUB_DATABASE_URL: hubDbUrl(env("TEST_DATABASE_URL")),
    REDIS_URL: redisUrl,
    HUB_INSTANCE_ID: "e2e-pb",
    HUB_CORS_ORIGINS: origins,
    HUB_CONFIG_POLL_S: "2",
    HUB_MAX_CONCURRENT_RUNS: "4",
    HUB_PROCESS_ENGINE: "on",
    HUB_SOURCE_CHECK_TIMEOUT_MS: "20000",
    HUB_ATTACH_DRIVER: "local",
    HUB_ATTACH_DIR: attachDir,
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
  const rt = new PaRuntime(
    postgres(env("TEST_DATABASE_URL"), { max: 2, onnotice: () => {} }),
    redis,
  );
  const src = new PbSourceRuntime(
    postgres(env("TEST_DATABASE_URL"), { max: 2, onnotice: () => {} }),
    hubUrl,
  );
  setInterval(() => void rt.tick(), 150);
  setInterval(() => void src.tick(), 150);
  Bun.serve({
    port: PORTS.ready,
    idleTimeout: 30,
    fetch: (req) =>
      new URL(req.url).pathname.startsWith("/rt/") ? handleRt(rt, req) : new Response("ok"),
  });
  console.log(
    `[pb] sẵn sàng: admin-api :${PORTS.api} · hub-api :${PORTS.hub} · rt :${PORTS.ready}`,
  );
}
