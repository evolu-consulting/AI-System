// HUB-FR-91 · HUB-FR-62 · HUB-FR-94 · WRK-FR-15 · spec §4 · plan-db §1, §2, §5 · test-plan H2b §5, cases §2 A140–A143:
// migration `0006_h2b_routing` nhìn từ DB test acceptance — CHECK `runs_direct_ck`, `runs_responder_ck`,
// `runs_orch_tenant_ck`, `runs_kind_check`; RLS: transaction `user` của `lan` đếm `running` không thấy run của `hoa` (R16);
// `orchestrator_settings_scope_ck`, `_tenant_uq`, sequence `id ≥ 2`; `jobs.error_reason='refused'`. Xanh từ D1.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import postgres from "postgres";
import {
  HUB_API_URL,
  insertFixture,
  ownerSql,
  prepareDb,
  R,
  type Sql,
  T,
  USERS,
  type UserKey,
} from "../H1/_fixtures";
import { AG, insertConv, insertFlow, insertHubConfig } from "../H1/_hub";

let sql: Sql;
let hubSql: Sql;

beforeAll(async () => {
  await prepareDb();
  sql = ownerSql();
  await insertFixture(sql);
  await insertHubConfig(sql);
  hubSql = postgres(HUB_API_URL, { max: 1, onnotice: () => {} });
}, 60_000);
afterAll(async () => {
  await hubSql?.end();
  await sql?.end();
});

/** Mã lỗi Postgres + tên ràng buộc (`23514:runs_direct_ck`); thành công = "ok". */
const pg = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e: { code?: string; constraint_name?: string }) =>
      e.constraint_name ? `${e.code}:${e.constraint_name}` : (e.code ?? String(e)),
  );

type RunIn = {
  who?: UserKey;
  conv?: string;
  flow?: string;
  kind: string;
  status?: string;
  agent?: string | null;
  orchTenant?: string | null;
  rKey?: string | null;
  rName?: string | null;
};
/** INSERT run (owner; mặc định `finished` để không đụng `runs_flow_running_uq`). */
function insertRun(r: RunIn) {
  const u = USERS[r.who ?? "lan"];
  const st = r.status ?? "finished";
  return sql`insert into hub.runs (tenant_id, user_id, conversation_id, flow_id, kind, command_id, agent_id,
      orchestrator_tenant_id, responder_key, responder_name, status, config_version, user_message_id,
      answer_message_id, finished_at)
    values (${u.tid}, ${u.id}, ${r.conv ?? R.conv}, ${r.flow ?? R.flow}, ${r.kind},
      ${r.kind === "command" ? crypto.randomUUID() : null}, ${r.agent ?? null}, ${r.orchTenant ?? null},
      ${r.rKey ?? null}, ${r.rName ?? null}, ${st}, 1, ${crypto.randomUUID()}, ${crypto.randomUUID()},
      ${st === "running" ? null : new Date()})`;
}
const direct = { kind: "direct", agent: AG.assistant, rKey: "assistant", rName: "Trợ lý" };

describe("A140–A143 · migration 0006 [spec §4 · plan-db §1]", () => {
  it("HUB-FR-91 · A140 · runs: direct đủ agent_id + responder → ok; thiếu agent_id → runs_direct_ck; thiếu responder / orchestrated có responder / tên 101 ký tự → runs_responder_ck; tenant ≠ / command có tenant → runs_orch_tenant_ck; kind workflow → runs_kind_check (23514) [spec §4]", async () => {
    expect(await pg(insertRun(direct))).toBe("ok");
    expect(await pg(insertRun({ ...direct, agent: null }))).toBe("23514:runs_direct_ck");
    expect(await pg(insertRun({ ...direct, rKey: null, rName: null }))).toBe(
      "23514:runs_responder_ck",
    );
    expect(await pg(insertRun({ kind: "orchestrated", rKey: "assistant", rName: "Trợ lý" }))).toBe(
      "23514:runs_responder_ck",
    );
    expect(await pg(insertRun({ ...direct, rName: "x".repeat(101) }))).toBe(
      "23514:runs_responder_ck",
    );
    expect(await pg(insertRun({ kind: "orchestrated", orchTenant: T.acme }))).toBe("ok");
    expect(await pg(insertRun({ kind: "orchestrated", orchTenant: T.beta }))).toBe(
      "23514:runs_orch_tenant_ck",
    );
    expect(await pg(insertRun({ kind: "command", orchTenant: T.acme }))).toBe(
      "23514:runs_orch_tenant_ck",
    );
    expect(await pg(insertRun({ kind: "workflow" }))).toBe("23514:runs_kind_check");
  });

  it("HUB-FR-94 · A141 · RLS: transaction user của lan đếm runs running (tenant acme) chỉ thấy run của lan, không thấy run hoa [H2b-R16 · plan-db §2]", async () => {
    const hoaConv = await insertConv(sql, "hoa", crypto.randomUUID());
    const hoaFlow = await insertFlow(sql, "hoa", hoaConv, crypto.randomUUID());
    expect(
      await pg(
        insertRun({
          who: "hoa",
          conv: hoaConv,
          flow: hoaFlow,
          kind: "orchestrated",
          status: "running",
        }),
      ),
    ).toBe("ok");
    const [own] = await sql<{ lan: number; hoa: number }[]>`select
      count(*) filter (where user_id = ${USERS.lan.id})::int as lan,
      count(*) filter (where user_id = ${USERS.hoa.id})::int as hoa
      from hub.runs where tenant_id = ${T.acme} and status = 'running'`;
    expect(own?.hoa).toBe(1);
    const L = USERS.lan;
    const seen = await hubSql.begin(async (tx) => {
      await tx`select set_config('app.scope', 'user', true), set_config('app.tenant_id', ${L.tid}, true),
        set_config('app.user_id', ${L.id}, true)`;
      const [r] = await tx<{ n: number; others: number }[]>`select count(*)::int as n,
          count(*) filter (where user_id <> ${L.id})::int as others
        from hub.runs where tenant_id = ${T.acme} and status = 'running'`;
      return r;
    });
    expect(seen).toEqual({ n: own?.lan ?? -1, others: 0 });
  });

  it("HUB-FR-62 · A142 · orchestrator_settings: hàng tenant không id → id ≥ 2 (sequence); trùng tenant → orchestrator_settings_tenant_uq; id=1 có tenant / id khác 1 không tenant → orchestrator_settings_scope_ck [H2b-R13 · P6]", async () => {
    const [row] = await sql<
      { id: number }[]
    >`insert into hub.orchestrator_settings (tenant_id, agent_id)
      values (${T.acme}, ${AG.orchestrator}) returning id`;
    expect(row?.id).toBeGreaterThanOrEqual(2);
    expect(
      await pg(
        sql`insert into hub.orchestrator_settings (tenant_id, agent_id) values (${T.acme}, ${AG.orchestrator})`,
      ),
    ).toBe("23505:orchestrator_settings_tenant_uq");
    expect(
      await pg(sql`update hub.orchestrator_settings set tenant_id = ${T.beta} where id = 1`),
    ).toBe("23514:orchestrator_settings_scope_ck");
    expect(
      await pg(
        sql`insert into hub.orchestrator_settings (id, agent_id) values (7, ${AG.orchestrator})`,
      ),
    ).toBe("23514:orchestrator_settings_scope_ck");
    const [d] = await sql<{ n: number }[]>`select count(*)::int as n from hub.orchestrator_settings
      where id = 1 and tenant_id is null`;
    expect(d?.n).toBe(1);
    await sql`delete from hub.orchestrator_settings where tenant_id is not null`;
  });

  it("WRK-FR-15 · A143 · jobs.error_reason = 'refused' → ok; 'nope' → 23514 jobs_error_reason_check [H2b-R27]", async () => {
    const [j] = await sql<{ id: string }[]>`select id from hub.jobs limit 1`;
    const jobId = j?.id ?? (await seedJob());
    expect(await pg(sql`update hub.jobs set error_reason = 'refused' where id = ${jobId}`)).toBe(
      "ok",
    );
    expect(await pg(sql`update hub.jobs set error_reason = 'nope' where id = ${jobId}`)).toBe(
      "23514:jobs_error_reason_check",
    );
  });
});

/** Job tối thiểu (owner) trên run/step đang có của `lan` để thử CHECK `error_reason`. */
async function seedJob(): Promise<string> {
  const L = USERS.lan;
  const runId = crypto.randomUUID();
  const stepId = crypto.randomUUID();
  const jobId = crypto.randomUUID();
  await sql`insert into hub.runs (id, tenant_id, user_id, conversation_id, flow_id, status, config_version,
      user_message_id, answer_message_id, finished_at)
    values (${runId}, ${L.tid}, ${L.id}, ${R.conv}, ${R.flow}, 'finished', 1, ${crypto.randomUUID()},
      ${crypto.randomUUID()}, now())`;
  await sql`insert into hub.run_steps (id, tenant_id, user_id, run_id, seq, type, label_key, status)
    values (${stepId}, ${L.tid}, ${L.id}, ${runId}, 1, 'delegate', 'step.delegate', 'failed')`;
  await sql`insert into hub.jobs (id, tenant_id, user_id, run_id, step_id, conversation_id, agent_id, type,
      provider_key, payload, status, finished_at)
    values (${jobId}, ${L.tid}, ${L.id}, ${runId}, ${stepId}, ${R.conv}, ${AG.assistant}, 'agent.cli', 'fake-cli',
      ${sql.json({})}, 'failed', now())`;
  return jobId;
}
