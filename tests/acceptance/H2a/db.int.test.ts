// HUB-FR-95, WRK-FR-06 · D1 (migration `0002_h2a_dify`) · plan-db H2a §1, §2 (P11), §3 · test-plan H2a cases §6 A87–A92:
// CHECK `runs.kind`/`command_id`, `run_steps.workflow_id` ↔ type, `jobs.agent_id` NULL chỉ `workflow.async`, mã lỗi job
// mới (C2), RLS + unique mở `tool_confirmations`, `insertStep` song song (MCP) cấp `seq` liên tục. A87–A91 là ca DB thuần
// (D1 đã có) — có thể xanh trước code hub-api (test-plan §8, ghi §10); A92 đi qua `/mcp` (đỏ tới B8).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import postgres from "postgres";
import {
  HUB_API_URL,
  insertFixture,
  type Keys,
  makeKeys,
  ownerSql,
  prepareDb,
  type Sql,
  USERS,
  type UserKey,
} from "../H1/_fixtures";
import { AG, type HubX, insertHubConfig } from "../H1/_hub";
import {
  type Dify,
  idGen2,
  insertCatalog,
  insertH2aAgents,
  startDify,
  startHubH2a,
  WF,
  WF_KEY,
} from "./_h2a";
import { insertSqlJob, mcp } from "./_runtime2";

let sql: Sql;
let api: Sql;
let k: Keys;
let hub: HubX;
let dify: Dify;
const id = idGen2(5000);

beforeAll(async () => {
  await prepareDb();
  sql = ownerSql();
  await insertFixture(sql);
  await insertHubConfig(sql);
  dify = startDify();
  await insertCatalog(sql, { baseUrl: dify.baseUrl });
  await insertH2aAgents(sql);
  api = postgres(HUB_API_URL, { max: 2, onnotice: () => {} });
  k = await makeKeys();
  hub = await startHubH2a(k);
}, 60_000);
afterAll(async () => {
  await hub?.stop();
  await dify?.close();
  await api?.end();
  await sql?.end();
});

const code = (p: Promise<unknown>): Promise<string> =>
  p.then(
    () => "ok",
    (e: { code?: string; constraint_name?: string }) => `${e.code}:${e.constraint_name ?? ""}`,
  );

/** Hội thoại + flow + 2 tin của `who`; trả id để dựng run/step/job/xác nhận. */
async function convFlow(who: UserKey = "lan") {
  const u = USERS[who];
  const [conv, flow, mu, ma] = [id(), id(), id(), id()];
  await sql`insert into hub.conversations (id, tenant_id, user_id, title, title_norm)
    values (${conv}, ${u.tid}, ${u.id}, 'DB H2a', 'db h2a')`;
  await sql`insert into hub.flows (id, tenant_id, user_id, conversation_id, title, message_count)
    values (${flow}, ${u.tid}, ${u.id}, ${conv}, 'DB H2a', 2)`;
  await sql`insert into hub.messages (id, tenant_id, user_id, conversation_id, flow_id, role, content) values
    (${mu}, ${u.tid}, ${u.id}, ${conv}, ${flow}, 'user', 'x'), (${ma}, ${u.tid}, ${u.id}, ${conv}, ${flow}, 'assistant', '')`;
  return { u, conv, flow, mu, ma };
}
/** INSERT run `finished` với `kind`/`command_id` cho trước (trả promise để đo mã lỗi). */
async function run(kind: string, commandId: string | null, who: UserKey = "lan") {
  const c = await convFlow(who);
  const rid = id();
  const q = sql`insert into hub.runs (id, tenant_id, user_id, conversation_id, flow_id, kind, command_id, status,
      config_version, user_message_id, answer_message_id, finished_at)
    values (${rid}, ${c.u.tid}, ${c.u.id}, ${c.conv}, ${c.flow}, ${kind}, ${commandId}, 'finished', 1, ${c.mu}, ${c.ma},
      now())`;
  return { ...c, rid, q };
}

describe("A87–A89 · CHECK cột mới runs / run_steps / jobs [HUB-FR-95 · D1]", () => {
  it("A87 · runs: kind ∈ {orchestrated, command}; (kind='command') = (command_id IS NOT NULL) [D1 · H2a-R08]", async () => {
    expect(await code((await run("command", WF.dich)).q)).toBe("ok");
    expect(await code((await run("orchestrated", null)).q)).toBe("ok");
    expect(await code((await run("command", null)).q)).toBe("23514:runs_command_ck");
    expect(await code((await run("orchestrated", WF.dich)).q)).toBe("23514:runs_command_ck");
    expect(await code((await run("workflow", null)).q)).toBe("23514:runs_kind_check");
  });

  it("A88 · run_steps: type + workflow/tool; (type IN (workflow, tool)) = (workflow_id IS NOT NULL) [D1]", async () => {
    const r = await run("command", WF.dich);
    await r.q;
    let seq = 0;
    const step = (type: string, wf: string | null) =>
      sql`insert into hub.run_steps (tenant_id, user_id, run_id, seq, type, workflow_id, label_key, status)
        values (${r.u.tid}, ${r.u.id}, ${r.rid}, ${++seq}, ${type}, ${wf}, 'step.x', 'ok')`;
    expect(await code(step("workflow", WF.dich))).toBe("ok");
    expect(await code(step("tool", WF.checkInvoice))).toBe("ok");
    expect(await code(step("delegate", null))).toBe("ok");
    expect(await code(step("workflow", null))).toBe("23514:run_steps_workflow_ck");
    expect(await code(step("delegate", WF.dich))).toBe("23514:run_steps_workflow_ck");
    expect(await code(step("dify", null))).toBe("23514:run_steps_type_check");
  });

  it("A89 · jobs: agent_id NULL chỉ khi type='workflow.async'; token_hash đúng 32 byte; provider vendor dify [D1 · P9]", async () => {
    const r = await run("command", WF.dich);
    await r.q;
    const job = (type: string, agent: string | null, hash: Buffer | null = null) =>
      sql`insert into hub.jobs (tenant_id, user_id, run_id, step_id, conversation_id, agent_id, type, provider_key,
          payload, token_hash)
        values (${r.u.tid}, ${r.u.id}, ${r.rid}, ${id()}, ${r.conv}, ${agent}, ${type},
          ${type === "workflow.async" ? "dify" : "fake-cli"}, '{}'::jsonb, ${hash})`;
    expect(await code(job("workflow.async", null))).toBe("ok");
    expect(await code(job("agent.cli", AG.hoadon))).toBe("ok");
    expect(await code(job("agent.cli", null))).toBe("23514:jobs_agent_ck");
    expect(await code(job("workflow.async", null, Buffer.alloc(31, 1)))).toBe(
      "23514:jobs_token_hash_ck",
    );
    const [p] = await sql<
      { vendor: string }[]
    >`select vendor from hub.providers where key = 'dify'`;
    expect(p?.vendor).toBe("dify");
  });

  it("A89b · jobs.error_code NOT_CONFIGURED + error_reason credential/upstream (HUB_JOB_ERROR_CODES, JOB_FAIL_REASONS của C2) được CHECK chấp nhận [HUB-FR-89 · plan §2.2 · plan-errors §2]", async () => {
    const r = await run("command", WF.dich);
    await r.q;
    const failed = (errCode: string, reason: string) =>
      sql`insert into hub.jobs (tenant_id, user_id, run_id, step_id, conversation_id, agent_id, type, provider_key,
          payload, status, finished_at, error_code, error_reason, error_message)
        values (${r.u.tid}, ${r.u.id}, ${r.rid}, ${id()}, ${r.conv}, null, 'workflow.async', 'dify', '{}'::jsonb,
          'failed', now(), ${errCode}, ${reason}, 'lỗi thử')`;
    expect(await code(failed("NOT_CONFIGURED", "credential"))).toBe("ok");
    expect(await code(failed("NOT_CONFIGURED", "upstream"))).toBe("ok");
    expect(await code(failed("UPSTREAM_ERROR", "upstream"))).toBe("ok");
  });
});

describe("A90–A91 · tool_confirmations: RLS + unique mở [HUB-FR-95 · HUB-BR-20 · D1]", () => {
  /** Dòng xác nhận của run vừa dựng (owner). */
  async function confirmation(who: UserKey, status: string, flow?: string) {
    const r = await run("orchestrated", null, who);
    await r.q;
    const f = flow ?? r.flow;
    const decided = status === "confirmed" || status === "consumed" ? r.rid : null;
    const q = sql`insert into hub.tool_confirmations (tenant_id, user_id, flow_id, run_id, agent_id, workflow_id,
        status, decided_run_id)
      values (${r.u.tid}, ${r.u.id}, ${f}, ${r.rid}, ${AG2_TRELLO}, ${WF.trello}, ${status}, ${decided})
      returning id`;
    return { ...r, flowId: f, q };
  }
  const AG2_TRELLO = "a2a00000-0000-4000-8000-000000000051";
  /** Chạy `fn` trên role hub_api với scope `user` của `who`. */
  const asUser = <V>(who: UserKey, fn: (tx: postgres.TransactionSql) => Promise<V>) =>
    api.begin(async (tx) => {
      await tx`select set_config('app.scope', 'user', true), set_config('app.tenant_id', ${USERS[who].tid}, true),
        set_config('app.user_id', ${USERS[who].id}, true)`;
      return fn(tx);
    });

  it("A90 · RLS: hub_api scope user tenant beta thấy 0 dòng của acme; ghi chéo tenant → 42501; scope đúng thấy dòng của mình [D1 · HUB-BR-14]", async () => {
    const c = await confirmation("lan", "pending");
    const [row] = await c.q;
    const beta = await asUser(
      "an",
      (tx) => tx`select id from hub.tool_confirmations where id = ${row?.id ?? null}`,
    );
    expect(beta.length).toBe(0);
    const mine = await asUser(
      "lan",
      (tx) => tx`select id from hub.tool_confirmations where id = ${row?.id ?? null}`,
    );
    expect(mine.length).toBe(1);
    const cross = asUser(
      "an",
      (
        tx,
      ) => tx`insert into hub.tool_confirmations (tenant_id, user_id, flow_id, run_id, agent_id, workflow_id, status)
        values (${USERS.lan.tid}, ${USERS.lan.id}, ${c.flowId}, ${c.rid}, ${AG2_TRELLO}, ${WF.checkInvoice}, 'pending')`,
    );
    expect((await code(cross)).split(":")[0]).toBe("42501");
    const upd = await asUser(
      "an",
      (tx) =>
        tx`update hub.tool_confirmations set status = 'declined' where id = ${row?.id ?? null} returning id`,
    );
    expect(upd.length).toBe(0);
  });

  it("A91 · unique mở (flow, agent, workflow) khi status ∈ {pending, confirmed}: pending trùng → 23505; sau consumed được pending mới [D1 · H2a-R22]", async () => {
    const first = await confirmation("lan", "pending");
    const [row] = await first.q;
    const dup = await confirmation("lan", "pending", first.flowId);
    expect(await code(dup.q)).toBe("23505:tool_confirmations_open_uq");
    const conf = await confirmation("lan", "confirmed", first.flowId);
    expect(await code(conf.q)).toBe("23505:tool_confirmations_open_uq");
    await sql`update hub.tool_confirmations set status = 'consumed', decided_run_id = ${first.rid},
      decided_at = now(), consumed_at = now() where id = ${row?.id ?? null}`;
    const again = await confirmation("lan", "pending", first.flowId);
    expect(await code(again.q)).toBe("ok");
    const bad = await confirmation("lan", "pending");
    await bad.q;
    expect(
      await code(sql`update hub.tool_confirmations set status = 'confirmed', decided_run_id = null
        where flow_id = ${bad.flowId}`),
    ).toBe("23514:tool_confirmations_decided_ck");
  });
});

describe("A92 · insertStep song song cấp seq liên tục (P11) [HUB-FR-50 · WRK-FR-06]", () => {
  it("A92 · 5 tools/call song song trên cùng run (MCP) → 5 bước tool, seq của run = 1..6 liên tục không trùng [P11]", async () => {
    const j = await insertSqlJob(sql, id, {
      type: "agent.cli",
      agentId: AG.hoadon,
      agentKey: "hoadon",
      tools: [WF_KEY.checkInvoice],
      mcpUrl: `${hub.base}/mcp`,
    });
    const res = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        mcp(hub, j.token, "tools/call", { name: WF_KEY.checkInvoice, arguments: { x: `HD-${i}` } }),
      ),
    );
    expect(res.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    const steps = await sql<{ seq: number; type: string }[]>`select seq, type from hub.run_steps
      where run_id = ${j.runId} order by seq`;
    expect(steps.filter((s) => s.type === "tool").length).toBe(5);
    expect(steps.map((s) => s.seq)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
