// CR-125 B1 · S1a · migration 0127_hub_rls_gap: 9 bảng hub có tenant_id bật RLS. Scope user tenant A không đọc/ghi hàng
// tenant B; system thấy hết; agent_runtime thấy hết (worker); admin_rw đọc usage_logs/agent_grants theo scope admin;
// orchestrator_settings: user thấy hàng mặc định (NULL) + của mình, ghi chỉ system; `hub.orchestrator_agent_ids()` trả mọi
// agent điều phối. Hàng chèn bằng owner với `session_replication_role = replica` (bỏ FK) — chỉ để thử RLS (như hub-k1).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sql as dsql } from "drizzle-orm";
import postgres from "postgres";
import { createDb } from "./client";
import { type HubScope, withHubScope } from "./hub-scope";
import { runMigrations } from "./migrate";
import { runHubMigrations } from "./migrate-hub";
import { withScope } from "./scope";
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
const hub = createDb(asRole("hub_api", "hub_api_dev_pw"), { max: 1 });
const admin = createDb(asRole("admin_api", "admin_api_dev_pw"), { max: 1 });
const rt = postgres(asRole("agent_runtime", "agent_runtime_dev_pw"), {
  max: 1,
  onnotice: () => {},
});

const TA = "01900000-0000-7000-8000-00000127aa01";
const TB = "01900000-0000-7000-8000-00000127bb01";
const ix = (t: string, n: number) => `${t.slice(0, -2)}${String(n).padStart(2, "0")}`;
const TABLES = [
  "audit_log",
  "agent_grants",
  "agent_entitlements",
  "tenant_agent_defaults",
  "agent_team_entitlements",
  "orchestrator_settings",
  "jobs",
  "usage_logs",
  "cli_sessions",
] as const;

/** Một hàng mỗi bảng cho tenant `t` (agent/team/conversation giả — FK tắt). */
async function seed(t: string): Promise<void> {
  const agent = ix(t, 10);
  await owner.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    await tx`insert into hub.audit_log (tenant_id, action, entity) values (${t}, 'grant', 'agent_grant')`;
    await tx`insert into hub.agent_grants (agent_id, tenant_id, subject_type, subject_id)
      values (${agent}, ${t}, 'user', ${ix(t, 11)})`;
    await tx`insert into hub.agent_entitlements (agent_id, tenant_id) values (${agent}, ${t})`;
    await tx`insert into hub.tenant_agent_defaults (tenant_id, default_agent_id, on_no_match)
      values (${t}, ${agent}, 'answer')`;
    await tx`insert into hub.agent_team_entitlements (team_id, tenant_id) values (${ix(t, 12)}, ${t})`;
    await tx`insert into hub.orchestrator_settings (tenant_id, agent_id) values (${t}, ${agent})`;
    await tx`insert into hub.jobs (tenant_id, user_id, run_id, step_id, conversation_id, agent_id, type, provider_key,
        payload) values (${t}, ${ix(t, 11)}, ${ix(t, 13)}, ${ix(t, 14)}, ${ix(t, 15)}, ${agent}, 'agent.cli', 'p',
        '{}'::jsonb)`;
    await tx`insert into hub.usage_logs (tenant_id, billing) values (${t}, 'api')`;
    await tx`insert into hub.cli_sessions (conversation_id, agent_id, provider_key, tenant_id, session_id)
      values (${ix(t, 15)}, ${agent}, 'p', ${t}, 's')`;
  });
}

const code = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e: { code?: string; cause?: { code?: string } }) => e.code ?? e.cause?.code ?? String(e),
  );

type Seen = Record<string, (string | null)[]>;
const tenantsOf = async (
  q: (t: string) => Promise<{ tenant_id: string | null }[]>,
  tables: readonly string[],
) => {
  const out: Seen = {};
  for (const t of tables) out[t] = (await q(t)).map((r) => r.tenant_id);
  return out;
};
const hubSees = (scope: HubScope) =>
  withHubScope(hub, scope, (tx) =>
    tenantsOf(
      async (t) =>
        (await tx.execute(
          dsql.raw(`select tenant_id from hub.${t} order by tenant_id nulls first`),
        )) as unknown as { tenant_id: string | null }[],
      TABLES,
    ),
  );
const each = (v: (string | null)[], orch: (string | null)[] = v) =>
  Object.fromEntries(TABLES.map((t) => [t, t === "orchestrator_settings" ? orch : v]));

beforeAll(async () => {
  await resetTestDb(OWNER);
  await runMigrations({ url: OWNER, appEnv: "test" });
  await runHubMigrations({ url: OWNER, appEnv: "test" });
  // Hàng mặc định (id=1, tenant NULL) có thể đã có từ seed migration; bảo đảm có đúng một.
  const [d] =
    await owner`select count(*)::int as n from hub.orchestrator_settings where tenant_id is null`;
  if (!d?.n)
    await owner.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`insert into hub.orchestrator_settings (id, agent_id) values (1, ${ix(TA, 90)})`;
    });
  await seed(TA);
  await seed(TB);
});
afterAll(async () => {
  await hub.close();
  await admin.close();
  await rt.end();
  await owner.end();
});

describe("CR-125 B1 · RLS 9 bảng hub (0127, int)", () => {
  test("CR-125 B1 · scope user tenant A chỉ thấy hàng A (orchestrator: + mặc định), system thấy cả hai", async () => {
    expect(await hubSees({ kind: "user", tenantId: TA, userId: ix(TA, 11) })).toEqual(
      each([TA], [null, TA]),
    );
    expect(await hubSees({ kind: "user", tenantId: TB, userId: ix(TB, 11) })).toEqual(
      each([TB], [null, TB]),
    );
    expect(await hubSees({ kind: "system" })).toEqual(each([TA, TB], [null, TA, TB]));
  });

  test("CR-125 B1 · không scope ⇒ 0 hàng (orchestrator: chỉ hàng mặc định)", async () => {
    const seen = await tenantsOf(
      async (t) =>
        (await hub.db.execute(dsql.raw(`select tenant_id from hub.${t}`))) as unknown as {
          tenant_id: string | null;
        }[],
      TABLES,
    );
    expect(seen).toEqual(each([], [null]));
  });

  test("CR-125 B1 · user A ghi hàng tenant B ⇒ 42501, sửa hàng B ⇒ 0 hàng, orchestrator chỉ system ghi", async () => {
    const a: HubScope = { kind: "user", tenantId: TA, userId: ix(TA, 11) };
    const ins = withHubScope(hub, a, (tx) =>
      tx.execute(
        dsql`insert into hub.audit_log (tenant_id, action, entity) values (${TB}, 'grant', 'agent_grant')`,
      ),
    );
    expect(await code(ins)).toBe("42501");
    const upd = await withHubScope(hub, a, (tx) =>
      tx.execute(dsql`update hub.jobs set priority = 1 where tenant_id = ${TB} returning id`),
    );
    expect([...upd]).toHaveLength(0);
    const orch = withHubScope(hub, a, (tx) =>
      tx.execute(dsql`update hub.orchestrator_settings set max_steps = 6 where tenant_id = ${TA}`),
    );
    expect(await code(orch)).toBe("ok"); // USING system ⇒ 0 hàng, không lỗi
    const [n] =
      await owner`select max_steps from hub.orchestrator_settings where tenant_id = ${TA}`;
    expect(n?.max_steps).toBe(5);
    const own = withHubScope(hub, a, (tx) =>
      tx.execute(
        dsql`insert into hub.audit_log (tenant_id, action, entity) values (${TA}, 'grant', 'agent_grant')`,
      ),
    );
    expect(await code(own)).toBe("ok");
  });

  test("CR-125 B1 · hub.orchestrator_agent_ids() (DEFINER) trả agent điều phối mọi tenant cho scope user", async () => {
    const ids = await withHubScope(
      hub,
      { kind: "user", tenantId: TA, userId: ix(TA, 11) },
      async (tx) =>
        (
          (await tx.execute(
            dsql`select id from hub.orchestrator_agent_ids() id order by 1`,
          )) as unknown as {
            id: string;
          }[]
        ).map((r) => r.id),
    );
    expect(ids).toEqual(expect.arrayContaining([ix(TA, 10), ix(TB, 10)]));
  });

  test("CR-125 B1 · agent_runtime thấy mọi tenant (jobs, usage_logs, cli_sessions)", async () => {
    for (const t of ["jobs", "usage_logs", "cli_sessions"]) {
      const rows = await rt.unsafe(`select tenant_id from hub.${t} order by 1`);
      expect(rows.map((r) => r.tenant_id)).toEqual([TA, TB]);
    }
  });

  test("CR-125 B1 · admin_rw: tenant A chỉ thấy A, platform thấy hết, không scope 0 (usage_logs, agent_grants)", async () => {
    const q = (tx: { execute: typeof admin.db.execute }, t: string) =>
      tx.execute(dsql.raw(`select tenant_id from hub.${t} order by 1`)) as unknown as Promise<
        { tenant_id: string }[]
      >;
    const both = ["usage_logs", "agent_grants"] as const;
    const ten = await withScope(admin, { kind: "tenant", tenantId: TA }, (tx) =>
      tenantsOf((t) => q(tx, t), both),
    );
    expect(ten).toEqual({ usage_logs: [TA], agent_grants: [TA] });
    const plat = await withScope(admin, { kind: "platform" }, (tx) =>
      tenantsOf((t) => q(tx, t), both),
    );
    expect(plat).toEqual({ usage_logs: [TA, TB], agent_grants: [TA, TB] });
    const none = await tenantsOf((t) => q(admin.db, t), both);
    expect(none).toEqual({ usage_logs: [], agent_grants: [] });
  });
});
