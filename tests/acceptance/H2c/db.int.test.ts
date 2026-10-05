// HUB-FR-44 · HUB-FR-75 · spec H2c §4 · plan-db §1 · test-plan-int §2.14 A130–A134: migration `0007_h2c_attachments`
// nhìn từ DB test acceptance — cột `hub.attachments` + `position`, `runs.attachment_ids` mặc định `'{}'`,
// `jobs.error_reason='attachment'`; RLS scope `user`/`system`, `agent_runtime` không GRANT; FK message SET NULL; CHECK;
// index. Xanh từ D1 (`3b5bd02`).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import postgres from "postgres";
import {
  AGENT_RT_URL,
  HUB_API_URL,
  insertFixture,
  ownerSql,
  prepareDb,
  R,
  type Sql,
  USERS,
  type UserKey,
} from "../H1/_fixtures";
import { AG, insertConv, insertFlow, insertHubConfig } from "../H1/_hub";
import { attRow, insertAttachmentRow } from "./_h2c";

let sql: Sql;
let hubSql: Sql;
let rtSql: Sql;

beforeAll(async () => {
  await prepareDb();
  sql = ownerSql();
  await insertFixture(sql);
  await insertHubConfig(sql);
  hubSql = postgres(HUB_API_URL, { max: 1, onnotice: () => {} });
  rtSql = postgres(AGENT_RT_URL, { max: 1, onnotice: () => {} });
}, 60_000);
afterAll(async () => {
  await rtSql?.end();
  await hubSql?.end();
  await sql?.end();
});

/** Mã lỗi Postgres + tên ràng buộc (`23514:attachments_size_check`); thành công = "ok". */
const pg = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e: { code?: string; constraint_name?: string }) =>
      e.constraint_name ? `${e.code}:${e.constraint_name}` : (e.code ?? String(e)),
  );

/** Chạy `fn` trong transaction `hub_api` với scope cho trước (như `withHubScope`). */
function asScope<V>(
  scope: { kind: "user"; who: UserKey } | { kind: "system" },
  fn: (tx: postgres.TransactionSql) => Promise<V>,
): Promise<V> {
  return hubSql.begin(async (tx) => {
    if (scope.kind === "user") {
      const u = USERS[scope.who];
      await tx`select set_config('app.scope', 'user', true), set_config('app.tenant_id', ${u.tid}, true),
        set_config('app.user_id', ${u.id}, true)`;
    } else await tx`select set_config('app.scope', 'system', true)`;
    return fn(tx);
  }) as Promise<V>;
}

describe("A130–A134 · migration 0007 [spec §4 · plan-db §1]", () => {
  it("HUB-FR-44 · A130 · hub.attachments đủ cột spec §4 + position; runs.attachment_ids mặc định '{}'; jobs.error_reason='attachment' được nhận [spec §4]", async () => {
    const cols = await sql<
      { column_name: string }[]
    >`select column_name from information_schema.columns
      where table_schema = 'hub' and table_name = 'attachments' order by column_name`;
    expect(cols.map((c) => c.column_name)).toEqual(
      [
        "bound_at",
        "conversation_id",
        "created_at",
        "filename",
        "flow_id",
        "id",
        "job_id",
        "message_id",
        "mime",
        "origin",
        "position",
        "purged_at",
        "safe_name",
        "sha256",
        "size",
        "storage_key",
        "tenant_id",
        "user_id",
      ].sort(),
    );
    const [run] = await sql<{ ids: string[] }[]>`select attachment_ids as ids from hub.runs
      where id = ${R.runDone}`;
    expect(run?.ids).toEqual([]);
    const [d] = await sql<
      { def: string }[]
    >`select column_default as def from information_schema.columns
      where table_schema = 'hub' and table_name = 'runs' and column_name = 'attachment_ids'`;
    expect(d?.def).toContain("'{}'");
    const jobId = await seedJob();
    expect(await pg(sql`update hub.jobs set error_reason = 'attachment' where id = ${jobId}`)).toBe(
      "ok",
    );
    expect(await pg(sql`update hub.jobs set error_reason = 'nope' where id = ${jobId}`)).toBe(
      "23514:jobs_error_reason_check",
    );
  });

  it("HUB-FR-75 · A131 · RLS: scope user lan không thấy/UPDATE hàng hoa/an (0 hàng); system thấy hết; agent_runtime SELECT → 42501 [plan-db §1]", async () => {
    const own = await insertAttachmentRow(sql, { who: "lan" });
    const hoa = await insertAttachmentRow(sql, { who: "hoa" });
    const an = await insertAttachmentRow(sql, { who: "an" });
    const ids = [own.id, hoa.id, an.id];
    const seen = await asScope({ kind: "user", who: "lan" }, async (tx) => {
      const rows = await tx<{ id: string }[]>`select id from hub.attachments
        where id = any(${tx.array(ids, 2950)})`;
      const upd = await tx`update hub.attachments set filename = 'x.pdf'
        where id = any(${tx.array([hoa.id, an.id], 2950)}) returning id`;
      return { rows: rows.map((r) => r.id), upd: upd.length };
    });
    expect(seen).toEqual({ rows: [own.id], upd: 0 });
    const sys = await asScope({ kind: "system" }, (tx) =>
      tx<{ n: number }[]>`select count(*)::int as n from hub.attachments
        where id = any(${tx.array(ids, 2950)})`.then((r) => r[0]?.n),
    );
    expect(sys).toBe(3);
    const none = await asScope({ kind: "user", who: "lan" }, async (tx) => {
      await tx`select set_config('app.scope', 'lạ', true)`;
      return (await tx`select id from hub.attachments`).length;
    });
    expect(none).toBe(0);
    expect(await pg(rtSql`select id from hub.attachments limit 1`)).toBe("42501");
  });

  it("HUB-FR-44 · A132 · xoá message → attachments.message_id NULL, hàng còn [plan-db §1 FK SET NULL]", async () => {
    const conv = await insertConv(sql, "lan", crypto.randomUUID());
    const flow = await insertFlow(sql, "lan", conv, crypto.randomUUID(), {
      msgs: [{ role: "user", content: "có file" }],
    });
    const [m] = await sql<{ id: string }[]>`select id from hub.messages where flow_id = ${flow}`;
    const messageId = m?.id ?? "";
    const a = await insertAttachmentRow(sql, {
      bind: { messageId, conversationId: conv, flowId: flow, position: 0 },
    });
    await sql`delete from hub.messages where id = ${messageId}`;
    const r = await attRow(sql, a.id);
    expect(r).toBeDefined();
    expect(r.message_id).toBeNull();
  });

  it("HUB-FR-44 · A133 · CHECK: size 0 → attachments_size_check; message_id có mà bound_at NULL → attachments_bound_ck (23514) [plan-db §1]", async () => {
    expect(await pg(insertAttachmentRow(sql, { size: 0 }))).toBe("23514:attachments_size_check");
    const conv = await insertConv(sql, "lan", crypto.randomUUID());
    const flow = await insertFlow(sql, "lan", conv, crypto.randomUUID(), {
      msgs: [{ role: "user", content: "x" }],
    });
    const [m] = await sql<{ id: string }[]>`select id from hub.messages where flow_id = ${flow}`;
    const a = await insertAttachmentRow(sql);
    expect(
      await pg(sql`update hub.attachments set message_id = ${m?.id ?? ""}, conversation_id = ${conv},
        flow_id = ${flow}, position = 0 where id = ${a.id}`),
    ).toBe("23514:attachments_bound_ck");
  });

  it("HUB-FR-44 · A134 · index attachments_tenant_live_idx, attachments_unbound_idx, conversations_deleted_idx tồn tại [plan-db §1]", async () => {
    const rows = await sql<{ indexname: string }[]>`select indexname from pg_indexes
      where schemaname = 'hub' and indexname in ('attachments_tenant_live_idx', 'attachments_unbound_idx',
        'conversations_deleted_idx') order by indexname`;
    expect(rows.map((r) => r.indexname)).toEqual([
      "attachments_tenant_live_idx",
      "attachments_unbound_idx",
      "conversations_deleted_idx",
    ]);
  });
});

/** Job tối thiểu (owner) trên run mới của `lan` để thử CHECK `error_reason`. */
async function seedJob(): Promise<string> {
  const L = USERS.lan;
  const [runId, stepId, jobId] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
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
