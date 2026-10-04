// HUB-FR-95 · WRK-FR-06 · migration 0002_h2a_dify phần cột/CHECK/bảng (D1, plan H2a §3, plan-db §1.1–1.2).
// Chạy trên DB Hub riêng (HUB_TEST_DATABASE_URL); hàm D2 có test riêng.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sql as dsql } from "drizzle-orm";
import postgres from "postgres";
import { createDb } from "./client";
import { type HubScope, withHubScope } from "./hub-scope";
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
const db = createDb(asRole("hub_api", "hub_api_dev_pw"), { max: 1 });

const T1 = "01900000-0000-7000-8000-0000000e1a01";
const T2 = "01900000-0000-7000-8000-0000000e1a02";
const U1 = "01900000-0000-7000-8000-0000000e1b01";
const U2 = "01900000-0000-7000-8000-0000000e1b02";
const AG = "01900000-0000-7000-8000-0000000e1c01";
const WF = "01900000-0000-7000-8000-0000000e1d01";
const lan: HubScope = { kind: "user", tenantId: T1, userId: U1 };
type Chain = { conv: string; flow: string; run: string; step: string };
const chains: Record<string, Chain> = {};

async function seedChain(tid: string, uid: string): Promise<Chain> {
  const [c] = await owner<{ id: string }[]>`insert into hub.conversations
    (tenant_id, user_id, title, title_norm) values (${tid}, ${uid}, 'c', 'c') returning id`;
  const conv = c?.id ?? "";
  const [f] = await owner<{ id: string }[]>`insert into hub.flows
    (tenant_id, user_id, conversation_id, title) values (${tid}, ${uid}, ${conv}, 'f') returning id`;
  const flow = f?.id ?? "";
  const [r] = await owner<
    { id: string }[]
  >`insert into hub.runs (tenant_id, user_id, conversation_id,
    flow_id, status, config_version, user_message_id, answer_message_id)
    values (${tid}, ${uid}, ${conv}, ${flow}, 'running', 1, ${crypto.randomUUID()}, ${crypto.randomUUID()})
    returning id`;
  const run = r?.id ?? "";
  const [s] = await owner<{ id: string }[]>`insert into hub.run_steps
    (tenant_id, user_id, run_id, seq, type, label_key, status)
    values (${tid}, ${uid}, ${run}, 1, 'orchestrator', 'k', 'running') returning id`;
  return { conv, flow, run, step: s?.id ?? "" };
}

const code = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e: { code?: string; cause?: { code?: string } }) => e.code ?? e.cause?.code ?? String(e),
  );

beforeAll(async () => {
  await resetTestDb(OWNER);
  await runMigrations({ url: OWNER, appEnv: "test" });
  await runHubMigrations({ url: OWNER, appEnv: "test" });
  await owner`insert into hub.providers (key, kind, vendor) values ('dify', 'api', 'dify')`;
  chains.a = await seedChain(T1, U1);
  chains.b = await seedChain(T2, U2);
}, 60_000);
afterAll(async () => {
  await db.close();
  await owner.end();
});

/** INSERT job tối thiểu; `type`/`agent`/`token` thay theo ca. */
const insertJob = (type: string, agent: string | null, token: Buffer | null = null) => {
  const ch = chains.a as Chain;
  return owner`insert into hub.jobs (tenant_id, user_id, run_id, step_id, conversation_id, agent_id, type,
    provider_key, payload, token_hash)
    values (${T1}, ${U1}, ${ch.run}, ${ch.step}, ${ch.conv}, ${agent}, ${type}, 'dify', '{}'::jsonb, ${token})
    returning queued_at, dispatched_at`;
};

describe("HUB-FR-95 · 0002_h2a_dify D1 (int)", () => {
  test("lần 2 = {hub: 0, hubDev: 0} (idempotent)", async () => {
    expect(await runHubMigrations({ url: OWNER, appEnv: "test" })).toEqual({ hub: 0, hubDev: 0 });
  });

  test("runs: kind ∈ {orchestrated, command}; command ⇔ command_id", async () => {
    const ch = chains.a as Chain;
    const ins = (kind: string, cmd: string | null) =>
      owner`insert into hub.runs (tenant_id, user_id, conversation_id, flow_id, kind, command_id,
        feature_id, status, config_version, user_message_id, answer_message_id, finished_at)
        values (${T1}, ${U1}, ${ch.conv}, ${ch.flow}, ${kind}, ${cmd}, ${crypto.randomUUID()}, 'finished', 1,
          ${crypto.randomUUID()}, ${crypto.randomUUID()}, now())`;
    expect(await code(ins("command", crypto.randomUUID()))).toBe("ok");
    expect(await code(ins("command", null))).toBe("23514");
    expect(await code(ins("orchestrated", crypto.randomUUID()))).toBe("23514");
    expect(await code(ins("khac", null))).toBe("23514");
  });

  test("run_steps: type + workflow/tool; workflow/tool ⇔ workflow_id", async () => {
    const ch = chains.a as Chain;
    let seq = 10;
    const ins = (type: string, wf: string | null) =>
      owner`insert into hub.run_steps (tenant_id, user_id, run_id, seq, type, workflow_id, label_key, status)
        values (${T1}, ${U1}, ${ch.run}, ${seq++}, ${type}, ${wf}, 'k', 'ok')`;
    expect(await code(ins("workflow", WF))).toBe("ok");
    expect(await code(ins("tool", WF))).toBe("ok");
    expect(await code(ins("delegate", null))).toBe("ok");
    expect(await code(ins("workflow", null))).toBe("23514");
    expect(await code(ins("delegate", WF))).toBe("23514");
    expect(await code(ins("khac", null))).toBe("23514");
  });

  test("jobs: workflow.async không cần agent; loại khác bắt buộc agent; token_hash 32 byte, unique; queued_at mặc định", async () => {
    const [j] = await insertJob("workflow.async", null);
    expect(j?.queued_at).toBeInstanceOf(Date);
    expect(j?.dispatched_at).toBeNull();
    expect(await code(insertJob("agent.cli", null))).toBe("23514");
    expect(await code(insertJob("agent.khac", AG))).toBe("23514");
    const tok = Buffer.alloc(32, 7);
    expect(await code(insertJob("agent.cli", AG, tok))).toBe("ok");
    expect(await code(insertJob("agent.run", AG, tok))).toBe("23505");
    expect(await code(insertJob("agent.run", AG, Buffer.alloc(16, 1)))).toBe("23514");
  });

  test("providers: vendor dify hợp lệ, giá trị lạ vẫn bị chặn", async () => {
    expect(
      await code(
        owner`insert into hub.providers (key, kind, vendor) values ('x-khac', 'api', 'khac')`,
      ),
    ).toBe("23514");
  });

  test("tool_confirmations: CHECK status/decided, unique mở theo (flow, agent, workflow)", async () => {
    const ch = chains.a as Chain;
    const ins = (status: string, decided: string | null, wf = WF) =>
      owner`insert into hub.tool_confirmations (tenant_id, user_id, flow_id, run_id, agent_id, workflow_id,
        status, decided_run_id) values (${T1}, ${U1}, ${ch.flow}, ${ch.run}, ${AG}, ${wf}, ${status}, ${decided})`;
    expect(await code(ins("pending", null))).toBe("ok");
    expect(await code(ins("confirmed", ch.run))).toBe("23505");
    expect(await code(ins("declined", null))).toBe("ok");
    expect(await code(ins("consumed", ch.run))).toBe("ok");
    expect(await code(ins("consumed", null, crypto.randomUUID()))).toBe("23514");
    expect(await code(ins("confirmed", null, crypto.randomUUID()))).toBe("23514");
    expect(await code(ins("khac", null, crypto.randomUUID()))).toBe("23514");
    await owner`delete from hub.tool_confirmations`;
  });

  test("tool_confirmations RLS hub_rw: user chỉ thấy/ghi dòng của mình; system thấy hết; xoá run → cascade", async () => {
    const a = chains.a as Chain;
    const b = chains.b as Chain;
    await owner`insert into hub.tool_confirmations (tenant_id, user_id, flow_id, run_id, agent_id, workflow_id, status)
      values (${T1}, ${U1}, ${a.flow}, ${a.run}, ${AG}, ${WF}, 'pending'),
             (${T2}, ${U2}, ${b.flow}, ${b.run}, ${AG}, ${WF}, 'pending')`;
    const seen = (scope: HubScope) =>
      withHubScope(db, scope, async (tx) => {
        const rows = (await tx.execute(
          dsql`select tenant_id from hub.tool_confirmations order by 1`,
        )) as unknown as { tenant_id: string }[];
        return rows.map((r) => r.tenant_id);
      });
    expect(await seen(lan)).toEqual([T1]);
    expect(await seen({ kind: "system" })).toEqual([T1, T2]);
    const foreign = withHubScope(db, lan, (tx) =>
      tx.execute(dsql`insert into hub.tool_confirmations (tenant_id, user_id, flow_id, run_id, agent_id,
        workflow_id, status) values (${T2}, ${U2}, ${b.flow}, ${b.run}, ${AG}, ${crypto.randomUUID()}, 'pending')`),
    );
    expect(await code(foreign)).toBe("42501");
    await owner`delete from hub.runs where id = ${b.run}`;
    expect(await seen({ kind: "system" })).toEqual([T1]);
  });

  test("GRANT: hub_rw CRUD tool_confirmations, SELECT workflow_flags (không ghi), SELECT/INSERT/UPDATE cli_sessions", async () => {
    const [r] = await owner<Record<string, boolean>[]>`select
      has_table_privilege('hub_rw', 'hub.tool_confirmations', 'SELECT,INSERT,UPDATE,DELETE') as tc,
      has_table_privilege('hub_rw', 'hub.workflow_flags', 'SELECT') as wf_sel,
      has_table_privilege('hub_rw', 'hub.workflow_flags', 'INSERT') as wf_ins,
      has_table_privilege('hub_rw', 'hub.cli_sessions', 'SELECT') as cs_sel,
      has_table_privilege('hub_rw', 'hub.cli_sessions', 'INSERT') as cs_ins,
      has_table_privilege('hub_rw', 'hub.cli_sessions', 'UPDATE') as cs_upd,
      has_table_privilege('hub_rw', 'hub.cli_sessions', 'DELETE') as cs_del,
      has_table_privilege('agent_runtime', 'hub.tool_confirmations', 'SELECT') as rt_tc`;
    expect(r).toEqual({
      tc: true,
      wf_sel: true,
      wf_ins: false,
      cs_sel: true,
      cs_ins: true,
      cs_upd: true,
      cs_del: false,
      rt_tc: false,
    });
  });
});
