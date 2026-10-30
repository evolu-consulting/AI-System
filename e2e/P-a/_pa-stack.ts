// HUB-FR-104…117 · e2e P-a · dựng backend THẬT (mẫu `e2e/chat/_x2b-stack.ts`; test-plan-e2e §1): reset DB test riêng worktree
// + fixture M1–M3 → migrate Hub (tới bản mới nhất có trên nhánh — 0019 vắng thì dừng ở 0018, stack vẫn lên) → `hub:seed` →
// persona P-a (`_pa-data.ts`: B/X/T/H/S, mật khẩu `PW`) + Group "Kế toán"/"PO"/"Tech lead"/"Chạy hoá đơn" + agent `hd-read`,
// `hd-post` (profile `fake-1`, grant A) → (nếu bảng 0019 có) quy trình `hoa-don-t`, `p-auto` → admin-api → hub-api
// (`HUB_PROCESS_ENGINE`, mặc định `on`; Redis DB `PA_REDIS_DB`) → cổng "sẵn sàng" phục vụ `/rt/*` (`_pa-runtime.ts`).
// Không Dify, không `claude-sub`. Dừng: SIGTERM/SIGINT.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { runHubMigrations } from "@ai/db/migrate-hub";
import postgres from "postgres";
import { createRedis } from "../../apps/hub-api/src/lib/redis";
import { hashPw, PW } from "../../tests/acceptance/M1/_data";
import { prepareDbWithRetry } from "../x1/_prepare";
import { ACME, DEF_AUTO, DEF_HD_T, EXTRA_USERS, PA_E2E, PERSONA } from "./_pa-data";
import { handleRt, PaRuntime } from "./_pa-runtime";

const REPO = resolve(import.meta.dir, "../..");
const env = (n: string): string => {
  const v = process.env[n];
  if (!v) throw new Error(`${n} chưa đặt (e2e/P-a/playwright.pa.config.ts truyền xuống)`);
  return v;
};
const num = (k: string): number => Number(env(k));
const PORTS = { api: num("PA_API_PORT"), hub: num("PA_HUB_PORT"), ready: num("PA_READY_PORT") };

type Sql = postgres.Sql;
const nm = (sql: Sql, vi: string, en = vi) => sql.json({ vi, en });

async function hasPaSchema(sql: Sql): Promise<boolean> {
  const [r] = await sql<{ t: string | null }[]>`select to_regclass('hub.process_runs')::text as t`;
  return !!r?.t;
}

/** Quy trình fixture (chỉ khi 0019 có). Cột theo plan §2 `process_defs`. */
export async function insertDefs(sql: Sql): Promise<void> {
  for (const d of [DEF_HD_T, DEF_AUTO])
    await sql`insert into hub.process_defs (id, tenant_id, key, name, description, input_hint, run_group_ids, stages,
        token_budget, enabled, version)
      values (${d.id}, ${ACME}, ${d.key}, ${d.name}, ${`Quy trình e2e ${d.name}.`}, 'Số hoá đơn',
        ${sql.array([...d.run_group_ids])}::uuid[], ${sql.json(d.stages)}, null, true, 1)
      on conflict do nothing`;
}

async function prepare(): Promise<void> {
  const url = env("TEST_DATABASE_URL");
  prepareDbWithRetry();
  await runHubMigrations({ url, appEnv: "test" });
  execFileSync("bun", ["apps/hub-api/src/modules/seed/seed.ts"], {
    cwd: REPO,
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url, HUB_SEED_FIXTURES: "1" },
  });
  const hash = await hashPw(PW);
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql`insert into admin.users ${sql(
      EXTRA_USERS.map((u) => ({
        id: u.id,
        tenant_id: ACME,
        username: u.username,
        email: null,
        password_hash: hash,
        display_name: u.name,
        role: "member",
        locale: "vi",
        active: true,
        locked_by_tenant: false,
        must_change_password: false,
      })),
    )} on conflict (id) do nothing`;
    await sql`insert into admin.groups (id, tenant_id, key, name) values
      (${PA_E2E.gKeToan}, ${ACME}, 'pa-ke-toan', ${nm(sql, "Kế toán P-a", "Accounting P-a")}),
      (${PA_E2E.gPO}, ${ACME}, 'po', ${nm(sql, "PO")}),
      (${PA_E2E.gTech}, ${ACME}, 'tech-lead', ${nm(sql, "Tech lead")}),
      (${PA_E2E.gRun}, ${ACME}, 'chay-hoa-don', ${nm(sql, "Chạy hoá đơn", "Invoice runners")})
      on conflict do nothing`;
    const gm = (g: string, u: string) => ({ tenant_id: ACME, group_id: g, user_id: u });
    const { A, B, T } = PERSONA;
    await sql`insert into admin.group_members ${sql([
      gm(PA_E2E.gKeToan, B.id),
      gm(PA_E2E.gKeToan, T.id),
      gm(PA_E2E.gPO, B.id),
      gm(PA_E2E.gTech, B.id),
      gm(PA_E2E.gTech, T.id),
      gm(PA_E2E.gRun, A.id),
      gm(PA_E2E.gRun, B.id),
    ])} on conflict do nothing`;
    const [p] = await sql<{ id: string }[]>`select id from hub.model_profiles where key = 'fake-1'`;
    const agent = (id: string, key: string, vi: string) => ({
      id,
      key,
      name: nm(sql, vi),
      description: `Agent ${vi} dùng cho bộ e2e P-a (fake-cli).`,
      runtime: "agentic-cli",
      profile_id: p?.id,
      system_prompt: "",
    });
    await sql`insert into hub.agents ${sql([
      agent(PA_E2E.agentRead, "hd-read", "Đọc HĐ"),
      agent(PA_E2E.agentPost, "hd-post", "Ghi sổ HĐ"),
    ])} on conflict (key) do nothing`;
    // Agent stage bật cho acme + grant người bắt đầu A (HUB-BR-24: stage chạy bằng quyền A). Kịch bản grant thêm agent seed.
    await sql`insert into hub.agent_entitlements
      select a.id, ${ACME}::uuid from hub.agents a on conflict do nothing`;
    await sql`insert into hub.agent_grants (agent_id, tenant_id, subject_type, subject_id)
      select a.id, ${ACME}::uuid, 'user', ${A.id}::uuid from hub.agents a on conflict do nothing`;
    // E-P15c: Adm "Chạy" từ admin-web ⇒ stage chạy bằng quyền người bắt đầu (binh) ⇒ cũng cần grant agent stage.
    await sql`insert into hub.agent_grants (agent_id, tenant_id, subject_type, subject_id)
      select a.id, ${ACME}::uuid, 'user', ${PERSONA.Adm.id}::uuid from hub.agents a
      where a.id in (${PA_E2E.agentRead}, ${PA_E2E.agentPost}) on conflict do nothing`;
    // CR-103 · e2e fnr-showcase: flow mẫu + Group duyệt (chỉ khi config fnr đặt cờ).
    if (process.env.FNR_SHOWCASE_SEED === "1") {
      const { seedShowcase } = await import("../fnr-showcase/_seed");
      await seedShowcase(sql, ACME, PERSONA.Adm.id);
    }
    if (await hasPaSchema(sql)) await insertDefs(sql);
    else console.warn("[pa] bảng 0019 chưa có — bỏ chèn quy trình fixture (test đỏ ở UI/expect)");
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
  const origins = `${env("PA_CHAT_ORIGIN")},${env("PA_ADMIN_ORIGIN")}`;
  const hubUrl = `http://localhost:${PORTS.hub}`;
  const redisUrl = `redis://localhost:6379/${env("PA_REDIS_DB")}`;
  const api = spawn("apps/admin-api/src/server.ts", {
    APP_ENV: "test",
    PORT: String(PORTS.api),
    CORS_ORIGINS: origins,
    ADMIN_API_DATABASE_URL: env("TEST_ADMIN_API_DATABASE_URL"),
    ADMIN_HUB_URL: hubUrl,
  });
  const attachDir = resolve(REPO, "test-results", "pa-attach");
  mkdirSync(attachDir, { recursive: true });
  const hub = spawn("apps/hub-api/src/server.ts", {
    APP_ENV: "test",
    HUB_PORT: String(PORTS.hub),
    HUB_DATABASE_URL: hubDbUrl(env("TEST_DATABASE_URL")),
    REDIS_URL: redisUrl,
    HUB_INSTANCE_ID: "e2e-pa",
    HUB_CORS_ORIGINS: origins,
    HUB_CONFIG_POLL_S: "2",
    HUB_MAX_CONCURRENT_RUNS: "4",
    HUB_PROCESS_ENGINE: env("HUB_PROCESS_ENGINE"),
    HUB_ATTACH_DRIVER: "local",
    HUB_ATTACH_DIR: attachDir,
    // CR-105 · thư viện quy trình: tool hệ thống của khe (`contracts-route`/`contracts-finalize`) chỉ vào catalog khi cờ engine duyệt HĐ bật
    // ⇒ lưu/xuất bản def thư viện (e2e pf4/process-library) cần. Cổng theo tenant (entitlement) vẫn giữ nguyên cho acme.
    CONTRACTS_APPROVAL_ENGINE: "on",
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
  setInterval(() => void rt.tick(), 150);
  Bun.serve({
    port: PORTS.ready,
    idleTimeout: 30,
    fetch: (req) =>
      new URL(req.url).pathname.startsWith("/rt/") ? handleRt(rt, req) : new Response("ok"),
  });
  console.log(
    `[pa] sẵn sàng: admin-api :${PORTS.api} · hub-api :${PORTS.hub} · rt :${PORTS.ready}`,
  );
}
