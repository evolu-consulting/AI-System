// pm-checklist-e2e · dựng backend THẬT giống `bun run pm:setup` (scripts/dev-up.ps1) trên DB test riêng: reset + migrate (main/hub/gói) →
// hub:seed → admin-api (tiến trình con) → fixture tenant `evolu` + 5 user + gói (hub-dev/fixture.ts) → fixture công ty (quy trình duyệt mẫu CR-113)
// → hub-api CHẠY TRONG TIẾN TRÌNH NÀY (để giữ `remindOnce`, như test CF: đẩy escalate_at về quá khứ + MỘT lượt nhắc thay vì chờ vòng 300 s)
// → 3 HĐ mẫu (`seedCr113Samples`, qua đường thật của hub) → cổng "sẵn sàng": GET / = ok, POST /ctl/remind = một lượt `remindOnce`.
// Chỉ APP_ENV=test + DB `*_test`. Dừng: SIGTERM/SIGINT.
import { resolve } from "node:path";
import { runHubMigrations } from "@ai/db/migrate-hub";
import { runPackMigrations } from "@ai/db/migrate-packs";
import postgres from "postgres";
import { createApp } from "../../apps/hub-api/src/app";
import { loadEnv } from "../../apps/hub-api/src/config/env";
import { envAppDeps } from "../../apps/hub-api/src/config/env-deps";
import { connectDb, pingDb } from "../../apps/hub-api/src/lib/db";
import { importJwtPublicKey } from "../../apps/hub-api/src/lib/jwt";
import { logger } from "../../apps/hub-api/src/lib/logger";
import { createRedis, pingRedis } from "../../apps/hub-api/src/lib/redis";
import { checkHubSecretsKey } from "../../apps/hub-api/src/modules/secrets/secrets.crypto";
import { DEMO_PASSWORD, ensureDemoFixture, ensureDemoPacks } from "../../tools/hub-dev/src/fixture";
import { seedCr113Samples } from "../../tools/scripts/src/seed-cr113-samples";
import { prepareDbWithRetry } from "../x1/_prepare";

const REPO = resolve(import.meta.dir, "../..");
const env = (n: string): string => {
  const v = process.env[n];
  if (!v) throw new Error(`${n} chưa đặt (e2e/pm-checklist/playwright.pm.config.ts truyền xuống)`);
  return v;
};
const API_PORT = Number(env("PM_API_PORT"));
const HUB_PORT = Number(env("PM_HUB_PORT"));
const READY_PORT = Number(env("PM_READY_PORT"));
const API = `http://localhost:${API_PORT}`;
const HUB = `http://localhost:${HUB_PORT}`;
// biome-ignore lint/suspicious/noExplicitAny: JSON của hub (khớp kiểu Call của seed-cr113-samples)
type Json = Record<string, any>;

function hubDbUrl(owner: string): string {
  const u = new URL(owner);
  u.username = "hub_api";
  u.password = "hub_api_dev_pw";
  return u.toString();
}

function guard(url: string): void {
  const db = decodeURIComponent(new URL(url).pathname.slice(1));
  if (process.env.APP_ENV !== "test" || !db.endsWith("_test"))
    throw new Error(`pm-stack: từ chối — cần APP_ENV=test và DB *_test (db=${db})`);
}

const sub = (file: string, extra: Record<string, string> = {}): void => {
  const r = Bun.spawnSync([process.execPath, file], {
    cwd: REPO,
    stdout: "inherit",
    stderr: "inherit",
    env: { ...process.env, ...extra },
  });
  if (r.exitCode !== 0) throw new Error(`${file} lỗi (exit ${r.exitCode})`);
};

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

async function main(): Promise<void> {
  const url = env("TEST_DATABASE_URL");
  guard(url);
  prepareDbWithRetry();
  await runHubMigrations({ url, appEnv: "test" });
  await runPackMigrations({ url, appEnv: "test" });
  sub("apps/hub-api/src/modules/seed/seed.ts", { DATABASE_URL: url, HUB_SEED_FIXTURES: "1" });

  const api = Bun.spawn([process.execPath, "apps/admin-api/src/server.ts"], {
    cwd: REPO,
    stdout: "inherit",
    stderr: "inherit",
    env: {
      ...process.env,
      APP_ENV: "test",
      PORT: String(API_PORT),
      CORS_ORIGINS: env("PM_ORIGINS"),
      ADMIN_API_DATABASE_URL: env("TEST_ADMIN_API_DATABASE_URL"),
      ADMIN_HUB_URL: HUB,
    },
  });
  const stop = (): void => {
    api.kill();
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  await healthy(API, api);

  await ensureDemoFixture(API);
  await ensureDemoPacks(API);
  sub("apps/hub-api/src/modules/seed/seed.tenant-fixtures.ts", {
    DATABASE_URL: url,
    HUB_SEED_FIXTURES: "1",
  });
  const owner = postgres(url, { max: 2, onnotice: () => {} });
  await owner`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;

  // hub-api trong tiến trình (khuôn apps/hub-api/src/server.ts) để giữ handles.remindOnce
  Object.assign(process.env, {
    HUB_PORT: String(HUB_PORT),
    HUB_DATABASE_URL: hubDbUrl(url),
    REDIS_URL: `redis://localhost:6379/${env("PM_REDIS_DB")}`,
    HUB_INSTANCE_ID: "e2e-pm",
    HUB_CORS_ORIGINS: env("PM_ORIGINS"),
    HUB_CONFIG_POLL_S: "2",
    HUB_MAX_CONCURRENT_RUNS: "4",
  });
  const hubEnv = loadEnv(process.env);
  const fromEnv = envAppDeps(hubEnv, logger);
  const jwtPublicKey = await importJwtPublicKey(hubEnv.JWT_PUBLIC_KEY);
  const db = connectDb(hubEnv.HUB_DATABASE_URL, hubEnv.HUB_DB_POOL_MAX, { spread: true });
  await pingDb(db);
  const redis = createRedis(hubEnv.REDIS_URL);
  await redis.connect();
  await pingRedis(redis);
  const k = checkHubSecretsKey(hubEnv.HUB_SECRETS_KEY, hubEnv.SECRET_MASTER_KEY);
  if (!k.ok) throw new Error(`HUB_SECRETS_KEY: ${k.reason}`);
  let handles: { remindOnce: () => Promise<number> } | null = null;
  const app = createApp({ version: "0.0.0", corsOrigins: hubEnv.HUB_CORS_ORIGINS }, {
    probes: [() => pingDb(db), () => pingRedis(redis)],
    db,
    redis,
    jwtPublicKey,
    ...fromEnv,
    attachments: undefined,
    hubSecretsKey: k.key,
    packs: { knowledgeDsn: hubEnv.HUB_DATABASE_URL },
    onProcessHandles: (h: { remindOnce: () => Promise<number> }) => {
      handles = h;
    },
  } as never);
  Bun.serve({ port: HUB_PORT, fetch: app.fetch, idleTimeout: 30 });
  await healthy(HUB, { exitCode: null } as Bun.Subprocess);

  // 3 HĐ mẫu CR-113 (như seed-cr113-samples CLI), HĐ 3 quá hạn nhưng CHƯA chuyển cấp: lượt nhắc do spec gọi qua /ctl/remind
  const [t] = await owner<{ id: string }[]>`select id from admin.tenants where key = 'evolu'`;
  const [u] = await owner<
    { id: string }[]
  >`select id from admin.users where tenant_id = ${t?.id ?? null} and username = 'thomas.tran'`;
  if (!t || !u) throw new Error("pm-stack: thiếu tenant evolu hoặc thomas.tran");
  const lg = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tenant_key: "evolu", username: "julian.bui", password: DEMO_PASSWORD }),
  });
  const token = String(((await lg.json()) as { access_token: string }).access_token);
  await seedCr113Samples({
    sql: owner,
    tenantId: t.id,
    creatorId: u.id,
    ownerCall: async (method, path, body) => {
      const res = await fetch(`${HUB}${path}`, {
        method,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      return { status: res.status, json: (text ? JSON.parse(text) : {}) as Json };
    },
  });

  Bun.serve({
    port: READY_PORT,
    fetch: async (req) => {
      const p = new URL(req.url).pathname;
      if (p === "/ctl/remind" && req.method === "POST") {
        const n = await (handles as { remindOnce: () => Promise<number> } | null)?.remindOnce();
        return Response.json({ reminded: n ?? -1 });
      }
      return new Response("ok");
    },
  });
  console.log(`[pm] sẵn sàng: admin-api :${API_PORT} · hub-api :${HUB_PORT} · ctl :${READY_PORT}`);
}

await main();
