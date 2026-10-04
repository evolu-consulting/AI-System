// HUB-FR-01, WRK-FR-01 · hạ tầng test nhóm S (test-plan H1 §2 "Stack", §6 S1–S4): hub-api THẬT (`apps/hub-api/src/server.ts`,
// process con trên máy host) + agent-runtime THẬT (`python -m agent_runtime`, `fake-cli`, trong container Linux qua
// `apps/agent-runtime/scripts/run.ts`) + Postgres/Redis compose, DB `ai_system_h1_test`. Không chứa `it(...)`.
//
// Nối host ↔ container (compose `ai-system_default`, cổng bind 127.0.0.1):
//   hub-api (host)        → Postgres `localhost:<cổng host>`, Redis `localhost:<cổng host>/15` (URL của `_fixtures.ts`)
//   agent-runtime (docker)→ Postgres `postgres:5432`, Redis `redis:6379/15` (tên service, cùng mạng compose)
//   Hub và Runtime không gọi nhau: chỉ qua `hub.jobs` (+ NOTIFY) và Redis `run:<id>`.
// Chạy riêng (bunfig bỏ qua thư mục này):
//   bun --env-file=.env.local test --timeout 120000 tests/acceptance/H1/stack
// Không chạy song song `test:int` TS / `test:int` Python (dùng chung DB `ai_system_h1_test`).
import { resolve } from "node:path";
import { RUN_STREAM_FIELD, runStreamKey } from "@ai/contracts/hub";
import { dockerArgs, IMAGE } from "../../../../apps/agent-runtime/scripts/run";
import { connectDb } from "../../../../apps/hub-api/src/lib/db";
import type { Redis } from "../../../../apps/hub-api/src/lib/redis";
import {
  AGENT_RT_URL,
  HUB_API_URL,
  type Hub,
  insertFixture,
  type Json,
  type Keys,
  makeKeys,
  ownerSql,
  prepareDb,
  REDIS_TEST_URL,
  type Sql,
  sign,
  USERS,
  type UserKey,
  waitFor,
} from "../_fixtures";
import { insertHubConfig, testRedis } from "../_hub";

const REPO = resolve(import.meta.dir, "../../../..");
const SERVER_TS = resolve(REPO, "apps/hub-api/src/server.ts");

// ---------- hub-api: process thật ----------
export type HubProc = Hub & { logs: () => string };

async function freePort(): Promise<number> {
  const s = Bun.serve({ port: 0, fetch: () => new Response("") });
  const port = s.port ?? 0;
  await s.stop(true);
  return port;
}

/** Chạy `bun apps/hub-api/src/server.ts` với env tường minh; chờ `/health` 200 (≤ 30 s), lỗi → kèm log. */
export async function startHubProc(k: Keys): Promise<HubProc> {
  const port = await freePort();
  let out = "";
  const proc = Bun.spawn([process.execPath, SERVER_TS], {
    cwd: REPO,
    env: {
      ...process.env,
      APP_ENV: "test",
      HUB_PORT: String(port),
      HUB_DATABASE_URL: HUB_API_URL,
      REDIS_URL: REDIS_TEST_URL,
      JWT_PUBLIC_KEY: k.publicPem,
      HUB_INSTANCE_ID: "qc-stack-hub",
      LOG_LEVEL: "info",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const drain = async (s: ReadableStream<Uint8Array>) => {
    for await (const chunk of s) out += new TextDecoder().decode(chunk);
  };
  void drain(proc.stdout);
  void drain(proc.stderr);
  const base = `http://localhost:${port}`;
  const up = await waitFor(
    async () => {
      if (proc.exitCode !== null) return false;
      try {
        return (
          (await fetch(`${base}/health`, { signal: AbortSignal.timeout(2_000) })).status === 200
        );
      } catch {
        return false;
      }
    },
    (ok) => ok || proc.exitCode !== null,
    30_000,
  );
  if (!up) {
    proc.kill();
    throw new Error(
      `hub-api không khởi động được (exit=${proc.exitCode}); log: ${out.slice(-800)}`,
    );
  }
  const db = connectDb(HUB_API_URL, 2);
  const redis = await testRedis();
  return {
    base,
    db,
    redis,
    logs: () => out,
    stop: async () => {
      proc.kill();
      await proc.exited;
      redis.disconnect();
      await db.close();
    },
  };
}

// ---------- agent-runtime: container thật ----------
const docker = (args: string[]) =>
  Bun.spawnSync(["docker", ...args], { env: { ...process.env, MSYS_NO_PATHCONV: "1" } });
const text = (b: Uint8Array) => new TextDecoder().decode(b);

/** URL cho process trong container: cùng user/mật khẩu/DB, host = tên service compose, cổng nội bộ. */
function inNet(url: string, host: string, port: number): string {
  const u = new URL(url);
  u.hostname = host;
  u.port = String(port);
  return u.toString();
}

export type RuntimeBox = { name: string; logs: () => string; kill9: () => void; stop: () => void };

/**
 * Chạy Runtime thật trong container (tên `name`): `scripts/run.ts` `dockerArgs` (mạng compose, venv `ai-system-agent-venv`,
 * mount repo), thêm `--name` + `-e`. `HOME` tạm có `.claude/.credentials.json` mồi (Q-T4). Chờ log `runtime.start`.
 */
export async function startRuntimeBox(name: string, worker: string): Promise<RuntimeBox> {
  docker(["rm", "-f", name]);
  const env: Record<string, string> = {
    APP_ENV: "test",
    AGENT_RT_DATABASE_URL: inNet(AGENT_RT_URL, "postgres", 5432),
    REDIS_URL: inNet(REDIS_TEST_URL, "redis", 6379),
    AGENT_RT_WORKER_ID: worker,
    AGENT_RT_PROVIDERS: "fake-cli",
    HOME: "/tmp/qc-home",
    AGENT_RT_WORK_DIR: "/tmp/qc-work",
    AGENT_RT_LOG_DIR: "/tmp/qc-logs",
    AGENT_RT_CLEANUP_S: "60",
  };
  const cmd = [
    "mkdir -p /tmp/qc-home/.claude /tmp/qc-work /tmp/qc-logs",
    `echo '{"token":"qc-canary"}' > /tmp/qc-home/.claude/.credentials.json`,
    "(uv sync --frozen 2>/dev/null || uv sync) >/dev/null 2>&1",
    "exec /opt/venv/bin/python -m agent_runtime",
  ].join("; ");
  const args = dockerArgs(REPO.split("\\").join("/"), cmd);
  args.splice(
    1,
    0,
    "-d",
    "--name",
    name,
    ...Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]),
  );
  const r = docker(args);
  if (r.exitCode !== 0) throw new Error(`docker run (${IMAGE}) lỗi: ${text(r.stderr)}`);
  const logs = () => {
    const l = docker(["logs", name]);
    return text(l.stdout) + text(l.stderr);
  };
  const up = await waitFor(
    async () => logs(),
    (l) => l.includes("runtime.start") || l.includes("runtime.config_invalid"),
    90_000,
  );
  if (!up.includes("runtime.start")) {
    docker(["rm", "-f", name]);
    throw new Error(`agent-runtime không khởi động được; log: ${up.slice(-800)}`);
  }
  return {
    name,
    logs,
    kill9: () => void docker(["kill", "-s", "KILL", name]),
    stop: () => void docker(["rm", "-f", name]),
  };
}

// ---------- bộ dựng chung ----------
export type Stack = {
  sql: Sql;
  k: Keys;
  hub: HubProc;
  redis: Redis;
  rt: RuntimeBox;
  token: (who: UserKey) => Promise<string>;
  stop: () => Promise<void>;
};

/** DB sạch + fixture + cấu hình Hub như seed, rồi hub-api (process) và Runtime (container). */
export async function bootStack(rtName: string): Promise<Stack> {
  await prepareDb();
  const sql = ownerSql();
  await insertFixture(sql);
  await insertHubConfig(sql);
  const k = await makeKeys();
  const hub = await startHubProc(k);
  const redis = await testRedis();
  let rt: RuntimeBox;
  try {
    rt = await startRuntimeBox(rtName, `${rtName}-1`);
  } catch (e) {
    await hub.stop();
    redis.disconnect();
    await sql.end();
    throw e;
  }
  return {
    sql,
    k,
    hub,
    redis,
    rt,
    token: (who) => sign(k, USERS[who]),
    stop: async () => {
      rt.stop();
      await hub.stop();
      redis.disconnect();
      await sql.end();
    },
  };
}

// ---------- quan sát ----------
/**
 * Gom sự kiện `run:<runId>` (Runtime XADD) ngay khi xuất hiện — Hub xoá key khi run kết thúc nên đọc nền bằng XREAD BLOCK
 * trên kết nối riêng. `stop()` đóng kết nối; `events` là các RunEvent đã parse.
 */
type XReadRes = [string, [string, string[]][]][] | null;

/** Một lượt XREAD BLOCK sau `last`: đẩy sự kiện vào `events`, trả id cuối. */
async function readOnce(r: Redis, runId: string, last: string, events: Json[]): Promise<string> {
  const res = (await r.xread("BLOCK", 500, "STREAMS", runStreamKey(runId), last)) as XReadRes;
  let cur = last;
  for (const [, rows] of res ?? [])
    for (const [id, fields] of rows) {
      cur = id;
      events.push(JSON.parse(fields[fields.indexOf(RUN_STREAM_FIELD) + 1] ?? "null"));
    }
  return cur;
}

export async function collectRunEvents(
  runId: string,
): Promise<{ events: Json[]; stop: () => void }> {
  const r = await testRedis();
  const events: Json[] = [];
  let live = true;
  void (async () => {
    let last = "0-0";
    while (live) last = await readOnce(r, runId, last, events).catch(() => last);
  })();
  return {
    events,
    stop: () => {
      live = false;
      r.disconnect();
    },
  };
}
