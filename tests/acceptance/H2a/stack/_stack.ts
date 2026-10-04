// HUB-FR-50, HUB-FR-95, WRK-FR-06, WRK-FR-13 · hạ tầng test nhóm S H2a (test-plan H2a §2 "Stack", cases §5 S01–S03):
// hub-api THẬT (process `apps/hub-api/src/server.ts` trên host, env H2a) + agent-runtime THẬT (container Linux qua
// `apps/agent-runtime/scripts/run.ts` `dockerArgs`, `fake-cli` [+ `dify`]) + mock Dify MK (`startDify()` của `_h2a.ts`,
// trong tiến trình test) + Postgres/Redis compose. Không chứa `it(...)`. Không sửa `H1/stack/_stack.ts` (khoá): H1 cố định
// `AGENT_RT_PROVIDERS=fake-cli` và không có env H2a nên viết lại hai hàm khởi động ở đây.
//
// Nối host ↔ container (Docker Desktop / WSL2): Runtime gọi Hub (`/mcp` theo `payload.mcp.url`, credential theo
// `AGENT_RT_HUB_URL`) bằng `host.docker.internal` (`--add-host …:host-gateway`); `HUB_PUBLIC_INTERNAL_URL` =
// `http://host.docker.internal:<cổng>`. TC-4: hub-api chạy TRÊN HOST không được dùng `host.docker.internal` (hosts của
// Windows có thể trỏ IP cũ → timeout) → `base_url` Dify chọn theo bên gọi: workflow có lệnh `mode='async'` (Runtime trong
// container gọi Dify, base_url trả qua credential) → `host.docker.internal`; workflow còn lại (Hub gọi sync) → `localhost`.
// MK nghe 0.0.0.0 (mặc định Bun.serve) nên cả hai đường tới cùng một mock. Giới hạn: một workflow dùng cả sync lẫn async
// trong CÙNG test stack sẽ chỉ đúng một phía (S01–S03 không có ca đó: S01 trello sync, S03 dich chỉ /dich-async).
// Chạy riêng (bunfig bỏ qua thư mục này): `bun run test:h2a:stack` (không song song test:int TS/Python cùng DB).
import { resolve } from "node:path";
import { dockerArgs, IMAGE } from "../../../../apps/agent-runtime/scripts/run";
import { connectDb } from "../../../../apps/hub-api/src/lib/db";
import {
  AGENT_RT_URL,
  HUB_API_URL,
  type Hub,
  insertFixture,
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
} from "../../H1/_fixtures";
import { insertHubConfig, testRedis } from "../../H1/_hub";
import {
  type Dify,
  INTERNAL_TOKEN,
  insertCatalog,
  insertH2aAgents,
  startDify,
  TEST_MASTER_KEY_B64,
} from "../_h2a";

const REPO = resolve(import.meta.dir, "../../../..");
const SERVER_TS = resolve(REPO, "apps/hub-api/src/server.ts");
export const HOST_ALIAS = "host.docker.internal";

export type HubProc = Hub & { logs: () => string; publicUrl: string };

async function freePort(): Promise<number> {
  const s = Bun.serve({ port: 0, fetch: () => new Response("") });
  const port = s.port ?? 0;
  await s.stop(true);
  return port;
}

async function healthy(base: string, proc: Bun.Subprocess): Promise<boolean> {
  return waitFor(
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
}

/** hub-api thật + env H2a (master key test, token nội bộ, URL nội bộ container thấy được). */
export async function startHubProcH2a(k: Keys): Promise<HubProc> {
  const port = await freePort();
  const publicUrl = `http://${HOST_ALIAS}:${port}`;
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
      HUB_INSTANCE_ID: "qc-stack-h2a",
      LOG_LEVEL: "info",
      SECRET_MASTER_KEY: TEST_MASTER_KEY_B64,
      HUB_INTERNAL_TOKEN: INTERNAL_TOKEN,
      HUB_PUBLIC_INTERNAL_URL: publicUrl,
      HUB_DIFY_TIMEOUT_MAX_S: "300",
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
  if (!(await healthy(base, proc))) {
    proc.kill();
    throw new Error(
      `hub-api không khởi động được (exit=${proc.exitCode}); log: ${out.slice(-800)}`,
    );
  }
  const db = connectDb(HUB_API_URL, 2);
  const redis = await testRedis();
  return {
    base,
    publicUrl,
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

// ---------- agent-runtime: container ----------
const docker = (args: string[]) =>
  Bun.spawnSync(["docker", ...args], { env: { ...process.env, MSYS_NO_PATHCONV: "1" } });
const text = (b: Uint8Array) => new TextDecoder().decode(b);

function inNet(url: string, host: string, port: number): string {
  const u = new URL(url);
  u.hostname = host;
  u.port = String(port);
  return u.toString();
}

export type RuntimeBox = {
  name: string;
  logs: () => string;
  exec: (cmd: string) => string;
  kill9: () => void;
  stop: () => void;
};
export type RuntimeOpts = { providers: string; hubUrl: string; env?: Record<string, string> };

/** Runtime thật (`name` container, `worker`); chờ log `runtime.start`, `runtime.config_invalid` → ném kèm log. */
export async function startRuntimeH2a(
  name: string,
  worker: string,
  o: RuntimeOpts,
): Promise<RuntimeBox> {
  docker(["rm", "-f", name]);
  const env: Record<string, string> = {
    APP_ENV: "test",
    AGENT_RT_DATABASE_URL: inNet(AGENT_RT_URL, "postgres", 5432),
    REDIS_URL: inNet(REDIS_TEST_URL, "redis", 6379),
    AGENT_RT_WORKER_ID: worker,
    AGENT_RT_PROVIDERS: o.providers,
    AGENT_RT_HUB_URL: o.hubUrl,
    AGENT_RT_DIFY_BACKOFF_S: "0.2,0.8",
    HOME: "/tmp/qc-home",
    AGENT_RT_WORK_DIR: "/tmp/qc-work",
    AGENT_RT_LOG_DIR: "/tmp/qc-logs",
    AGENT_RT_CLEANUP_S: "60",
    ...o.env,
  };
  const cmd = [
    "mkdir -p /tmp/qc-home/.claude /tmp/qc-work /tmp/qc-logs",
    `echo '{"token":"qc-canary"}' > /tmp/qc-home/.claude/.credentials.json`,
    "(uv sync --frozen 2>/dev/null || uv sync) >/dev/null 2>&1",
    "exec /opt/venv/bin/python -m agent_runtime",
  ].join("; ");
  // Bỏ `--rm`: container thoát sớm (config_invalid) vẫn giữ log để báo lỗi; `stop()` xoá.
  const args = dockerArgs(REPO.split("\\").join("/"), cmd).filter((a) => a !== "--rm");
  const envArgs = Object.entries(env).flatMap(([key, v]) => ["-e", `${key}=${v}`]);
  args.splice(1, 0, "-d", "--name", name, "--add-host", `${HOST_ALIAS}:host-gateway`, ...envArgs);
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
    throw new Error(`agent-runtime (${o.providers}) không khởi động được; log: ${up.slice(-800)}`);
  }
  return {
    name,
    logs,
    exec: (c) => text(docker(["exec", name, "sh", "-c", c]).stdout),
    kill9: () => void docker(["kill", "-s", "KILL", name]),
    stop: () => void docker(["rm", "-f", name]),
  };
}

// ---------- bộ dựng chung ----------
export type StackH2a = {
  sql: Sql;
  k: Keys;
  hub: HubProc;
  dify: Dify;
  token: (who: UserKey) => Promise<string>;
  runtime: (worker: string, providers: string, env?: Record<string, string>) => Promise<RuntimeBox>;
  boxes: RuntimeBox[];
  stop: () => Promise<void>;
};

/** DB sạch + fixture H1 + catalog/agent H2a (cases §7; `base_url` MK theo bên gọi — TC-4, đầu file) + hub-api. */
export async function bootStackH2a(rtName: string): Promise<StackH2a> {
  await prepareDb();
  const sql = ownerSql();
  await insertFixture(sql);
  await insertHubConfig(sql);
  const dify = startDify();
  await insertCatalog(sql, { baseUrl: dify.baseUrl, extras: true });
  await sql`update admin.workflows set base_url = ${dify.baseUrl.replace("localhost", HOST_ALIAS)}
    where id in (select workflow_id from admin.commands where mode = 'async')`;
  await insertH2aAgents(sql);
  const k = await makeKeys();
  const hub = await startHubProcH2a(k);
  const boxes: RuntimeBox[] = [];
  return {
    sql,
    k,
    hub,
    dify,
    boxes,
    token: (who) => sign(k, USERS[who]),
    runtime: async (worker, providers, env) => {
      const box = await startRuntimeH2a(rtName, worker, { providers, hubUrl: hub.publicUrl, env });
      boxes.push(box);
      return box;
    },
    stop: async () => {
      for (const b of boxes) b.stop();
      await hub.stop();
      await dify.close();
      await sql.end();
    },
  };
}
