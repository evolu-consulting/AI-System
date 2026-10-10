// HUB-BR-25 · HUB-FR-104 · HUB-FR-113 · B1 · S0-02…S0-09 (test-plan-int §1): RLS tenant mọi bảng 0019, notice D12, CHECK,
// policy tin gọi `is_process_trigger`, `process_run_viewer`, GRANT agent_runtime, T4 (user chèn tin `process` ⇒ 42501),
// outbox `process_thread_events`. Probe RLS: role `hub_api` + `SET LOCAL ROLE hub_rw` + GUC (mẫu X2b db.int), luôn ROLLBACK.
// Fixture quy trình chỉ chèn khi `ready` (0019 có) — chưa có ⇒ mọi ca đỏ ở `needSchema` (test-plan §5).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import postgres from "postgres";
import { AGENT_RT_URL, HUB_API_URL, R } from "../../H1/_fixtures";
import { asUser, pgCode } from "../../X2a/_x2a";
import {
  DEF_HD,
  fixId,
  insertDef,
  insertOutput,
  insertRun,
  insertTask,
  type Json,
  PA,
  PA_FIX,
  part,
  type RunFix,
  type Sql,
  setupPa,
  T,
} from "../_support/pa";
import { needSchema } from "../_support/schema";

let sql: Sql;
let db: Sql;
let ready = false;
let runA: RunFix; // A, phòng R, waiting_review
let runB: RunFix; // B, phòng R2
let runD: RunFix; // beta
let taskT = "";
const TEAM = fixId();

beforeAll(async () => {
  ({ sql, ready } = await setupPa());
  db = postgres(HUB_API_URL, { max: 4, onnotice: () => {} });
  if (!ready) return;
  await insertDef(sql, { id: PA_FIX.defHoaDon, tenantId: T.acme });
  await insertDef(sql, { id: PA_FIX.defBeta, tenantId: T.beta });
  runA = await insertRun(sql, {
    def: DEF_HD(PA_FIX.defHoaDon),
    startedBy: PA.A,
    roomId: PA_FIX.room,
    status: "waiting_review",
  });
  runB = await insertRun(sql, {
    def: DEF_HD(PA_FIX.defHoaDon),
    startedBy: PA.B,
    roomId: PA_FIX.roomOther,
  });
  runD = await insertRun(sql, {
    def: DEF_HD(PA_FIX.defBeta),
    startedBy: PA.D,
    status: "waiting_review",
  });
  for (const [r, tid] of [
    [runA, T.acme],
    [runD, T.beta],
  ] as const) {
    const out = await insertOutput(sql, {
      tid,
      runId: r.runId,
      stageRunId: r.stageRunIds[0] as string,
      stageIdx: 0,
    });
    const t = await insertTask(sql, {
      tid,
      runId: r.runId,
      stageRunId: r.stageRunIds[0] as string,
      kind: "review",
      outputId: out,
      userIds: [tid === T.acme ? PA.T.id : PA.D.id],
    });
    if (tid === T.acme) taskT = t;
  }
  await sql`insert into hub.agent_teams (id, key, name) values (${TEAM}, 'qc-team', ${sql.json({ vi: "QC", en: "QC" })})`;
  for (const [r, tid] of [
    [runA, T.acme],
    [runD, T.beta],
  ] as const)
    await sql`insert into hub.team_runs (tenant_id, stage_run_id, process_run_id, attempt, team_id, mode, status)
      values (${tid}, ${r.stageRunIds[0] as string}, ${r.runId}, 1, ${TEAM}, 'sequential', 'running')`;
  const notice = (u: { id: string }, tid = T.acme, run = runA) =>
    sql`insert into hub.process_notices (tenant_id, user_id, kind, process_run_id, payload)
      values (${tid}, ${u.id}, 'review_requested', ${run.runId}, ${sql.json({ process_name: "Hoá đơn thử" })})`;
  await notice(PA.A);
  await notice(PA.T);
}, 60_000);
afterAll(async () => {
  await db?.end();
  await sql?.end();
});

type Who = { id: string; tid: string };
/** Probe dưới hub_rw + GUC, luôn ROLLBACK ⇒ mã PG ("ok" nếu được). */
const probe = (
  who: Who | null,
  fn: (tx: postgres.TransactionSql) => Promise<unknown>,
  scope = "user",
) => pgCode(asUser(db, who, fn, { scope }));
/** Đếm/trả giá trị dưới scope user (ROLLBACK). */
const asU = <V>(who: Who, fn: (tx: postgres.TransactionSql) => Promise<V>) => asUser(db, who, fn);
const n = async (q: Promise<Json[]>) => Number((await q)[0]?.n ?? -1);
const ownerCode = (q: Promise<unknown>) => pgCode(q);

describe("S0-02…S0-07 · RLS + CHECK + GRANT [HUB-BR-25]", () => {
  it("HUB-BR-25 · S0-02 · scope user acme không đọc/sửa hàng beta ở 6 bảng; DELETE process_runs ⇒ lỗi quyền", async () => {
    needSchema(ready);
    for (const t of [
      "process_runs",
      "stage_runs",
      "team_runs",
      "process_outputs",
      "review_tasks",
      "review_task_assignees",
    ]) {
      const cnt = await asU(PA.A, (tx) =>
        n(tx.unsafe(`select count(*)::int as n from hub.${t} where tenant_id = $1`, [T.beta])),
      );
      expect({ t, cnt }).toEqual({ t, cnt: 0 });
    }
    const upd = await asU(
      PA.A,
      async (tx) =>
        (await tx`update hub.process_runs set updated_at = now() where tenant_id = ${T.beta}`)
          .count,
    );
    expect(upd).toBe(0);
    expect(
      await probe(PA.A, (tx) => tx`delete from hub.process_runs where id = ${runA.runId}`),
    ).not.toBe("ok");
  });
  it("HUB-BR-25 · S0-03 · process_notices: T chỉ thấy của mình; UPDATE notice A = 0 hàng; INSERT cho A được; tenant khác lỗi", async () => {
    needSchema(ready);
    const mine = await asU(
      PA.T,
      (tx) => tx<{ user_id: string }[]>`select user_id from hub.process_notices`,
    );
    expect(mine.map((r) => r.user_id)).toEqual([PA.T.id]);
    const upd = await asU(
      PA.T,
      async (tx) =>
        (await tx`update hub.process_notices set read_at = now() where user_id = ${PA.A.id}`).count,
    );
    expect(upd).toBe(0);
    const ins = (tid: string) => (tx: postgres.TransactionSql) =>
      tx`insert into hub.process_notices (tenant_id, user_id, kind, process_run_id, payload)
        values (${tid}, ${PA.A.id}, 'task_closed', ${runA.runId}, ${tx.json({})})`;
    expect(await probe(PA.T, ins(T.acme))).toBe("ok");
    expect(await probe(PA.T, ins(T.beta))).not.toBe("ok");
  });
  it("HUB-FR-104 · S0-04 · CHECK task/assignee/runs + uq task open; audit authorize_real_action/process_run chèn được", async () => {
    needSchema(ready);
    const sr = runA.stageRunIds[1] as string;
    const base = {
      tenant_id: T.acme,
      process_run_id: runA.runId,
      stage_run_id: sr,
      status: "open",
      remind_at: new Date(),
    };
    expect(
      await ownerCode(sql`insert into hub.review_tasks ${sql({ ...base, kind: "review" })}`),
    ).toBe("23514");
    expect(
      await ownerCode(sql`insert into hub.review_tasks ${sql({ ...base, kind: "ask" })}`),
    ).toBe("23514");
    const both = { tenant_id: T.acme, task_id: taskT, via: "initial", depth: 0 };
    expect(
      await ownerCode(
        sql`insert into hub.review_task_assignees ${sql({ ...both, user_id: PA.B.id, group_id: PA_FIX.gKeToan })}`,
      ),
    ).toBe("23514");
    expect(
      await ownerCode(
        sql`insert into hub.review_task_assignees ${sql({ ...both, user_id: null, group_id: null })}`,
      ),
    ).toBe("23514");
    expect(
      await ownerCode(
        sql`update hub.runs set process_run_id = ${runA.runId} where id = ${R.runLive}`,
      ),
    ).toBe("23514");
    const ask = { ...base, kind: "ask", question: "Kỳ nào?" };
    expect(await ownerCode(sql`insert into hub.review_tasks ${sql(ask)}`)).toBe("ok");
    expect(await ownerCode(sql`insert into hub.review_tasks ${sql(ask)}`)).toBe("23505");
    const audit = {
      tenant_id: T.acme,
      actor_id: PA.B.id,
      actor_username: "hoa",
      actor_role: "member",
      action: "authorize_real_action",
      entity: "process_run",
      entity_id: runA.runId,
      entity_name: "Hoá đơn thử",
    };
    expect(await ownerCode(sql`insert into hub.audit_log ${sql(audit)}`)).toBe("ok");
  });
  it("HUB-FR-105 · S0-05 · tin gọi `process_run_id`: run người khác / phòng khác / tenant khác ⇒ policy lỗi; run của chính A ở R ⇒ được", async () => {
    needSchema(ready);
    const send =
      (who: Who, run: RunFix, room = PA_FIX.room) =>
      async (tx: postgres.TransactionSql) => {
        const [q] = await tx`select hub.room_next_seq(${room}) as s`;
        await tx`insert into hub.room_messages ${tx({
          room_id: room,
          tenant_id: who.tid,
          seq: q?.s,
          sender_type: "user",
          sender_id: who.id,
          content: "!hoa-don-t HD-12",
          flow_id: run.flowId,
          placement: "main",
          process_run_id: run.runId,
          created_at: new Date(),
        })}`;
      };
    expect(await probe(PA.B, send(PA.B, runA))).toBe("42501");
    expect(await probe(PA.B, send(PA.B, runB))).toBe("42501");
    expect(await probe(PA.B, send(PA.B, runD))).toBe("42501");
    expect(await probe(PA.A, send(PA.A, runA))).toBe("ok");
  });
  it("HUB-BR-25 · S0-06 · hub.process_run_viewer: A full, X full, T(assignee) task, H/L/D NULL", async () => {
    needSchema(ready);
    const view = (who: Who) =>
      asU(
        who,
        async (tx) =>
          (await tx<{ v: string | null }[]>`select hub.process_run_viewer(${runA.runId}) as v`)[0]
            ?.v ?? null,
      );
    const got = {
      A: await view(PA.A),
      X: await view(PA.X),
      T: await view(PA.T),
      H: await view(PA.H),
      L: await view(PA.L),
      D: await view(PA.D),
    };
    expect(got).toEqual({ A: "full", X: "full", T: "task", H: null, L: null, D: null });
  });
  it("HUB-BR-25 · S0-07 · role agent_runtime không SELECT bảng quy trình", async () => {
    needSchema(ready);
    const rt = postgres(AGENT_RT_URL, { max: 1, onnotice: () => {} });
    try {
      for (const t of ["process_runs", "review_tasks", "process_thread_events"])
        expect(await pgCode(rt.unsafe(`select 1 from hub.${t} limit 1`))).toBe("42501");
    } finally {
      await rt.end();
    }
  });
});

describe("S0-08…S0-09 · tin `process` + outbox [plan-thread §3, T4]", () => {
  const procMsg = (o: Json = {}): Json => ({
    id: fixId(),
    room_id: PA_FIX.room,
    tenant_id: T.acme,
    sender_type: "process",
    sender_id: PA_FIX.defHoaDon,
    content: "Hoá đơn thử · bắt đầu",
    flow_id: runA.flowId,
    placement: "main",
    process_run_id: runA.runId,
    process_kind: "block",
    process_meta: part.block(runA.runId),
    created_at: new Date(),
    ...o,
  });
  const lastSeq = async () =>
    Number((await sql`select last_seq from hub.rooms where id = ${PA_FIX.room}`)[0]?.last_seq);

  it("HUB-FR-113 · S0-08 · user A chèn tin sender `process` / gọi room_post_process_message ⇒ 42501; 0 tin, last_seq giữ", async () => {
    needSchema(ready);
    const before = await lastSeq();
    const ev = fixId();
    await sql`insert into hub.process_thread_events (id, tenant_id, process_run_id, room_id, kind, placement, meta, content)
      values (${ev}, ${T.acme}, ${runA.runId}, ${PA_FIX.room}, 'block', 'main', ${sql.json(part.block(runA.runId))}, 'Khối')`;
    const row = procMsg();
    const ins = await probe(PA.A, async (tx) => {
      const [q] = await tx`select hub.room_next_seq(${PA_FIX.room}) as s`;
      await tx`insert into hub.room_messages ${tx({ ...row, process_meta: tx.json(row.process_meta), seq: q?.s })}`;
    });
    expect(ins).toBe("42501");
    expect(await probe(PA.A, (tx) => tx`select * from hub.room_post_process_message(${ev})`)).toBe(
      "42501",
    );
    expect(await lastSeq()).toBe(before);
    const [m] =
      await sql`select count(*)::int as n from hub.room_messages where sender_type = 'process'`;
    expect(m?.n).toBe(0);
    await sql`delete from hub.process_thread_events where id = ${ev}`;
  });
  it("HUB-FR-113 · S0-09 · process_thread_events: INSERT T, SELECT/UPDATE chỉ system; CHECK kind/content; process_ck; uq block", async () => {
    needSchema(ready);
    const ev =
      (tid: string, o: Json = {}) =>
      (tx: postgres.TransactionSql) =>
        tx`insert into hub.process_thread_events ${tx({
          tenant_id: tid,
          process_run_id: runA.runId,
          room_id: PA_FIX.room,
          kind: "output",
          placement: "flow",
          meta: tx.json(part.output(runA.runId)),
          content: "Kết quả",
          ...o,
        })}`;
    expect(await probe(PA.A, ev(T.acme))).toBe("ok");
    expect(await probe(PA.A, ev(T.beta))).not.toBe("ok");
    await ev(T.acme)(sql as unknown as postgres.TransactionSql);
    expect(
      await asU(PA.A, (tx) => n(tx`select count(*)::int as n from hub.process_thread_events`)),
    ).toBe(0);
    expect(
      await asU(
        PA.A,
        async (tx) => (await tx`update hub.process_thread_events set posted_at = now()`).count,
      ),
    ).toBe(0);
    expect(
      await ownerCode(ev(T.acme, { kind: "mystery" })(sql as unknown as postgres.TransactionSql)),
    ).toBe("23514");
    expect(
      await ownerCode(
        ev(T.acme, { content: "x".repeat(501) })(sql as unknown as postgres.TransactionSql),
      ),
    ).toBe("23514");
    let ownSeq = 9_000;
    const own = (o: Json) => {
      const r = procMsg(o);
      const meta = r.process_meta ? sql.json(r.process_meta) : null;
      return ownerCode(
        sql`insert into hub.room_messages ${sql({ ...r, seq: ownSeq++, process_meta: meta })}`,
      );
    };
    expect(await own({ process_meta: null })).toBe("23514");
    expect(await own({ run_id: R.runLive })).toBe("23514");
    expect(await own({})).toBe("ok");
    expect(await own({})).toBe("23505");
  });
});
