// HUB-FR-95 · migration 0003_h2a_dify_fn (D2, plan H2a §1 P1–P2, plan-db §1.3): hàm SECURITY DEFINER
// `hub.workflow_secret` (Q1 — chỉ hub_ro EXECUTE, không GRANT cột admin.secrets) và `hub.log_dify_usage` (P2).
// Chạy trên DB Hub riêng (HUB_TEST_DATABASE_URL). Bản mã/IV là byte giả, không phải secret thật.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import postgres from "postgres";
import { runMigrations } from "./migrate";
import { runHubMigrations } from "./migrate-hub";
import { resetTestDb, withDatabase } from "./test-db";

const BASE = process.env.HUB_TEST_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
if (!BASE)
  throw new Error("HUB_TEST_DATABASE_URL/TEST_DATABASE_URL chưa đặt — chạy `bun run keys:dev`");
const OWNER = process.env.HUB_TEST_DATABASE_URL ?? withDatabase(BASE, "ai_system_h1_test");
const asRole = (user: string, pw: string) => {
  const u = new URL(OWNER);
  u.username = user;
  u.password = pw;
  return u.toString();
};
const owner = postgres(OWNER, { max: 1, onnotice: () => {} });
const hubApi = postgres(asRole("hub_api", "hub_api_dev_pw"), { max: 1, onnotice: () => {} });

const T1 = "01900000-0000-7000-8000-0000000e2a01";
const U1 = "01900000-0000-7000-8000-0000000e2b01";
const LOG_SIG =
  "hub.log_dify_usage(uuid, uuid, uuid, uuid, uuid, uuid, integer, integer, numeric, integer)";
const SECRET_SIG = "hub.workflow_secret(uuid)";
const wf: Record<"a" | "b", { id: string; secret: string }> = {
  a: { id: "", secret: "" },
  b: { id: "", secret: "" },
};

const code = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e: { code?: string }) => e.code ?? String(e),
  );

/** Chạy `fn` dưới `SET LOCAL ROLE role` của owner, luôn rollback. */
async function asLocalRole<T>(role: string, fn: (tx: postgres.TransactionSql) => Promise<T>) {
  let out: T | undefined;
  let err: unknown;
  await owner
    .begin(async (tx) => {
      await tx.unsafe(`set local role ${role}`);
      try {
        out = await fn(tx);
      } catch (e) {
        err = e;
      }
      throw new Error("rollback");
    })
    .catch(() => {});
  if (err) throw err;
  return out as T;
}

async function seedWorkflow(key: string, name: string, fill: number) {
  const [s] = await owner<
    { id: string }[]
  >`insert into admin.secrets (name, ciphertext, iv, key_version, last4)
    values (${name}, ${Buffer.alloc(40, fill)}, ${Buffer.alloc(12, fill)}, 2, 'gia1') returning id`;
  const secret = s?.id ?? "";
  const [w] = await owner<{ id: string }[]>`insert into admin.workflows
    (key, name, description, app_type, base_url, secret_id)
    values (${key}, ${key}, 'Workflow giả cho test D2 (không gọi Dify).', 'workflow', 'http://localhost:4010/v1',
      ${secret}) returning id`;
  return { id: w?.id ?? "", secret };
}

beforeAll(async () => {
  await resetTestDb(OWNER);
  await runMigrations({ url: OWNER, appEnv: "test" });
  await runHubMigrations({ url: OWNER, appEnv: "test" });
  wf.a = await seedWorkflow("d2-dich", "D2_FAKE_A", 1);
  wf.b = await seedWorkflow("d2-tro-ly", "D2_FAKE_B", 2);
}, 60_000);
afterAll(async () => {
  await hubApi.end();
  await owner.end();
});

describe("HUB-FR-95 · 0003_h2a_dify_fn D2 (int)", () => {
  test("lần 2 = {hub: 0, hubDev: 0} (idempotent)", async () => {
    expect(await runHubMigrations({ url: OWNER, appEnv: "test" })).toEqual({ hub: 0, hubDev: 0 });
  });

  test("Q1: hub_ro vẫn không có quyền nào trên admin.secrets (bảng/cột) → 42501", async () => {
    const [p] = await owner<{ t: boolean; c: boolean }[]>`select
      has_table_privilege('hub_ro', 'admin.secrets', 'SELECT') as t,
      has_any_column_privilege('hub_ro', 'admin.secrets', 'SELECT') as c`;
    expect(p).toEqual({ t: false, c: false });
    expect(await code(asLocalRole("hub_ro", (tx) => tx`select id from admin.secrets`))).toBe(
      "42501",
    );
    expect(await code(hubApi`select id from admin.secrets`)).toBe("42501");
  });

  test("P1: hub_ro gọi workflow_secret → đúng 1 dòng, 4 cột, đúng secret gắn workflow; uuid lạ → 0 dòng", async () => {
    const rows = await asLocalRole(
      "hub_ro",
      (tx) => tx`select * from hub.workflow_secret(${wf.a.id})`,
    );
    expect(rows.length).toBe(1);
    expect(rows.columns.map((c) => c.name)).toEqual([
      "secret_id",
      "ciphertext",
      "iv",
      "key_version",
    ]);
    const r = rows[0] as { secret_id: string; ciphertext: Buffer; iv: Buffer; key_version: number };
    expect(r.secret_id).toBe(wf.a.secret);
    expect(Buffer.from(r.ciphertext).equals(Buffer.alloc(40, 1))).toBe(true);
    expect(Buffer.from(r.iv).equals(Buffer.alloc(12, 1))).toBe(true);
    expect(r.key_version).toBe(2);
    const none = await asLocalRole(
      "hub_ro",
      (tx) => tx`select * from hub.workflow_secret(${crypto.randomUUID()})`,
    );
    expect(none.length).toBe(0);
  });

  test("P1: hub_api (thành viên hub_ro) gọi được trong transaction thường; workflow khác → secret khác", async () => {
    const [r] = await hubApi<{ secret_id: string }[]>`
      select secret_id from hub.workflow_secret(${wf.b.id})`;
    expect(r?.secret_id).toBe(wf.b.secret);
  });

  test("P1: EXECUTE workflow_secret chỉ hub_ro (+ thành viên); PUBLIC/agent_runtime/admin_rw/hub_rw = false", async () => {
    const [p] = await owner<Record<string, boolean>[]>`select
      has_function_privilege('hub_ro', ${SECRET_SIG}, 'EXECUTE') as ro,
      has_function_privilege('hub_api', ${SECRET_SIG}, 'EXECUTE') as api,
      has_function_privilege('public', ${SECRET_SIG}, 'EXECUTE') as pub,
      has_function_privilege('agent_runtime', ${SECRET_SIG}, 'EXECUTE') as rt,
      has_function_privilege('admin_rw', ${SECRET_SIG}, 'EXECUTE') as arw,
      has_function_privilege('hub_rw', ${SECRET_SIG}, 'EXECUTE') as hrw`;
    expect(p).toEqual({ ro: true, api: true, pub: false, rt: false, arw: false, hrw: false });
    const rt = postgres(asRole("agent_runtime", "agent_runtime_dev_pw"), { max: 1 });
    try {
      expect(await code(rt`select * from hub.workflow_secret(${wf.a.id})`)).toBe("42501");
    } finally {
      await rt.end();
    }
  });

  test("SECURITY DEFINER + search_path cố định cho cả hai hàm; ACL không có PUBLIC", async () => {
    const rows = await owner<
      { proname: string; sec: boolean; cfg: string[] | null; pub: boolean }[]
    >`
      select p.proname, p.prosecdef as sec, p.proconfig as cfg,
        exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0) as pub
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'hub' and p.proname in ('workflow_secret', 'log_dify_usage') order by 1`;
    expect([...rows]).toEqual([
      {
        proname: "log_dify_usage",
        sec: true,
        cfg: ["search_path=pg_catalog, pg_temp"],
        pub: false,
      },
      {
        proname: "workflow_secret",
        sec: true,
        cfg: ["search_path=pg_catalog, pg_temp"],
        pub: false,
      },
    ]);
  });

  test("P2: hub_api không INSERT usage_logs (A51) nhưng gọi log_dify_usage được → billing/provider dify, model null, số âm → 0", async () => {
    const [p] = await owner<Record<string, boolean>[]>`select
      has_table_privilege('hub_api', 'hub.usage_logs', 'INSERT') as ins,
      has_function_privilege('hub_api', ${LOG_SIG}, 'EXECUTE') as api,
      has_function_privilege('hub_rw', ${LOG_SIG}, 'EXECUTE') as rw,
      has_function_privilege('public', ${LOG_SIG}, 'EXECUTE') as pub,
      has_function_privilege('agent_runtime', ${LOG_SIG}, 'EXECUTE') as rt,
      has_function_privilege('hub_ro', ${LOG_SIG}, 'EXECUTE') as ro,
      has_function_privilege('admin_rw', ${LOG_SIG}, 'EXECUTE') as arw`;
    expect(p).toEqual({
      ins: false,
      api: true,
      rw: true,
      pub: false,
      rt: false,
      ro: false,
      arw: false,
    });
    expect(
      await code(hubApi`insert into hub.usage_logs (tenant_id, billing) values (${T1}, 'dify')`),
    ).toBe("42501");
    const run = crypto.randomUUID();
    await hubApi`select hub.log_dify_usage(${T1}, ${run}, ${crypto.randomUUID()}, ${U1}, ${crypto.randomUUID()},
      ${crypto.randomUUID()}, ${120}, ${-5}, ${"0.0123"}, ${850})`;
    const [u] =
      await owner`select tenant_id, user_id, provider_key, model, billing, input_tokens, output_tokens,
      cost_usd::text as cost, billable_usd, overage, latency_ms from hub.usage_logs where run_id = ${run}`;
    expect(u).toEqual({
      tenant_id: T1,
      user_id: U1,
      provider_key: "dify",
      model: null,
      billing: "dify",
      input_tokens: 120,
      output_tokens: 0,
      cost: "0.012300",
      billable_usd: null,
      overage: false,
      latency_ms: 850,
    });
  });
});
