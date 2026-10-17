// AC-H46 · HUB-FR-144/145 · K3/K7 · fixture hai tenant ĐỐI XỨNG (test-plan-int §6 đầu mục): acme và beta mỗi bên 1 run hẹn
// `retry` + 1 run hẹn `wait_until` + 1 task review tới hạn nhắc lặp + 1 task tới hạn chuyển cấp (Group cùng tenant). Chèn
// SQL owner vào bảng/cột 0036 ⇒ CHỈ gọi sau `needPdSchema(c.pd)` trong chính `it`. Không chứa `it(...)`.
// Persona beta: `PA.D` (an, người bắt đầu + Group duyệt `PD.gBetaKT`), `PA.Db` (tadmin_beta, Group chuyển cấp beta).
import { fixId, insertOutput, insertRun, insertTask } from "../../P-a/_support/pa";
import {
  agentStage,
  type CtxPd,
  DAY,
  G1,
  HOUR,
  insertDefPf1,
  type Json,
  P1,
  PA,
  PD,
  type Sql,
  T,
  waitStage,
} from "./pd";

const x = (n: number) => `a5d20000-0000-4000-8000-${String(n).padStart(12, "0")}`;
/** Id cố định của fixture hai tenant (dải `a5d2…`). */
export const TT = {
  gBetaGD: x(1), // Group beta "Giám đốc" (Db tadmin_beta) — đích chuyển cấp beta
} as const;

type Person = { id: string; tid: string };
export type TimerRef = { runId: string; stageRunId: string; timerId: string };
export type TaskRef = { runId: string; stageRunId: string; taskId: string };
/** Một phía (tenant) của fixture. */
export type Side = {
  tid: string;
  starter: Person;
  reviewGroup: string;
  escGroup: string;
  /** thành viên Group duyệt (nhận nhắc) / Group chuyển cấp (nhận `escalated`). */
  reviewers: string[];
  escalatees: string[];
  retry: TimerRef;
  wait: TimerRef;
  remindTask: TaskRef;
  escTask: TaskRef;
};

let seq = 0;

/** Stage `wait_until` trong snapshot như Hub đã ép khi lưu (plan-contract §3: output `# {name}` + `## Bàn giao`). */
const waitSnapshotStage = (): Json =>
  waitStage({
    key: "cho",
    step: 0,
    from: { kind: "input", key: "han" },
    output: {
      filename: "cho.md",
      template: "# Chờ hạn\n\n## Bàn giao\n",
      required_sections: ["Bàn giao"],
      fields: [],
    },
  });
const STAGES = {
  retry: (): Json[] => [agentStage({ key: "s0", step: 0 }), agentStage({ key: "s1", step: 1 })],
  wait: (): Json[] => [waitSnapshotStage(), agentStage({ key: "xong", step: 1 })],
  review: (group: string): Json[] => [
    agentStage({
      key: "doc",
      step: 0,
      after: { kind: "review", group_id: group, back_to_steps: [] },
    }),
    agentStage({ key: "ghi", step: 1 }),
  ],
};

/** Def riêng mỗi lần gọi (khoá duy nhất theo tenant) + id. */
async function def(sql: Sql, tid: string, kind: string, stages: Json[]) {
  seq += 1;
  const d = { id: fixId(), key: `pd-tt-${kind}-${seq}`, name: `Hai tenant ${kind} ${seq}`, stages };
  await insertDefPf1(sql, d, { tenantId: tid });
  return d;
}

/** Hàng `process_timers` (owner). `kind='wait_until'` ⇒ `timezone` bắt buộc (CHECK 0036). */
export async function insertTimer(
  sql: Sql,
  o: {
    tid: string;
    runId: string;
    stageRunId: string;
    kind: string;
    dueAt: Date;
    timezone?: string | null;
    key?: string;
    firedAt?: Date | null;
    cancelledAt?: Date | null;
  },
): Promise<string> {
  const id = fixId();
  await sql`insert into hub.process_timers ${sql({
    id,
    tenant_id: o.tid,
    process_run_id: o.runId,
    stage_run_id: o.stageRunId,
    kind: o.kind,
    due_at: o.dueAt,
    timezone:
      o.timezone === undefined ? (o.kind === "wait_until" ? "Asia/Ho_Chi_Minh" : null) : o.timezone,
    fired_at: o.firedAt ?? null,
    cancelled_at: o.cancelledAt ?? null,
    idempotency_key: o.key ?? `${o.kind}:${o.stageRunId}:1:1:1`,
  })}`;
  return id;
}

/** Điều kiện tiên quyết beta (một lần mỗi DB): entitlement + grant `an` cho `hd-read`, Group chuyển cấp beta. */
async function betaPrereqs(sql: Sql): Promise<void> {
  const [g] = await sql<
    { n: number }[]
  >`select count(*)::int as n from admin.groups where id = ${TT.gBetaGD}`;
  if ((g?.n ?? 0) > 0) return;
  await sql`insert into admin.groups (id, tenant_id, key, name)
    values (${TT.gBetaGD}, ${T.beta}, 'giam-doc', ${sql.json({ vi: "Giám đốc", en: "Directors" })})`;
  await sql`insert into admin.group_members (tenant_id, group_id, user_id) values (${T.beta}, ${TT.gBetaGD}, ${PA.Db.id})`;
  await sql`insert into hub.agent_entitlements (agent_id, tenant_id) values (${P1.agRead}, ${T.beta})`;
  await sql`insert into hub.agent_grants (agent_id, tenant_id, subject_type, subject_id)
    values (${P1.agRead}, ${T.beta}, 'user', ${PA.D.id})`;
  await sql`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
}

const sideCfg = (tid: string) =>
  tid === T.acme
    ? {
        starter: PA.A as Person,
        reviewGroup: G1,
        escGroup: PD.gG2,
        reviewers: [PA.B.id, PA.T.id],
        escalatees: [PA.H.id, PA.H2.id],
      }
    : {
        starter: PA.D as Person,
        reviewGroup: PD.gBetaKT,
        escGroup: TT.gBetaGD,
        reviewers: [PA.D.id],
        escalatees: [PA.Db.id],
      };

async function timerRun(
  c: CtxPd,
  tid: string,
  starter: Person,
  kind: "retry" | "wait_until",
  due: Date,
) {
  const sql = c.sql;
  const d =
    kind === "retry"
      ? await def(sql, tid, "retry", STAGES.retry())
      : await def(sql, tid, "wait", STAGES.wait()); // khoá def chỉ [a-z0-9-] (process_defs_key_ck)
  const r = await insertRun(sql, {
    def: d,
    startedBy: starter,
    status: kind === "retry" ? "running" : "waiting_timer",
    stageIdx: 0,
    stageStatus: "waiting_timer",
    startedAt: new Date(c.clk.now().getTime() - HOUR),
  });
  const sr = r.stageRunIds[0] as string;
  if (kind === "retry")
    await sql`update hub.stage_runs set retry_count = 1, retry_attempt = 1, retry_round = 1,
      last_error_code = 'INTERNAL_ERROR', current_run_id = null where id = ${sr}`;
  else
    await sql`update hub.stage_runs set started_at = ${new Date(due.getTime() - DAY)} where id = ${sr}`;
  const timerId = await insertTimer(sql, { tid, runId: r.runId, stageRunId: sr, kind, dueAt: due });
  return { runId: r.runId, stageRunId: sr, timerId };
}

/** Run `waiting_review` + output + task review gán Group `group` (cột 0019; chỉnh cột 0036 do người gọi). */
export async function reviewRun(
  c: CtxPd,
  tid: string,
  starter: Person,
  group: string,
): Promise<TaskRef> {
  const d = await def(c.sql, tid, "review", STAGES.review(group));
  const r = await insertRun(c.sql, { def: d, startedBy: starter, status: "waiting_review" });
  const sr = r.stageRunIds[0] as string;
  const out = await insertOutput(c.sql, { tid, runId: r.runId, stageRunId: sr, stageIdx: 0 });
  const taskId = await insertTask(c.sql, {
    tid,
    runId: r.runId,
    stageRunId: sr,
    kind: "review",
    outputId: out,
    groupId: group,
  });
  return { runId: r.runId, stageRunId: sr, taskId };
}

/** Một phía: 4 hàng tới hạn lúc `due` (retry, wait_until, nhắc lặp, chuyển cấp). */
export async function seedSide(c: CtxPd, tid: string, due: Date): Promise<Side> {
  if (tid === T.beta) await betaPrereqs(c.sql);
  const cfg = sideCfg(tid);
  const retry = await timerRun(c, tid, cfg.starter, "retry", due);
  const wait = await timerRun(c, tid, cfg.starter, "wait_until", due);
  const remindTask = await reviewRun(c, tid, cfg.starter, cfg.reviewGroup);
  await c.sql`update hub.review_tasks set remind_every_h = 4, remind_count = 1,
    reminded_at = ${new Date(due.getTime() - 4 * HOUR)}, remind_at = ${due} where id = ${remindTask.taskId}`;
  const escTask = await reviewRun(c, tid, cfg.starter, cfg.reviewGroup);
  await c.sql`update hub.review_tasks set escalate_at = ${due}, escalate_group_id = ${cfg.escGroup},
    remind_at = ${new Date(c.clk.now().getTime() + 2 * DAY)} where id = ${escTask.taskId}`;
  return { tid, ...cfg, retry, wait, remindTask, escTask };
}

/** Hai phía đối xứng (mặc định cả hai tới hạn 1 phút trước `clk.now()`). */
export async function seedTwoTenant(
  c: CtxPd,
  o: { acmeDue?: Date; betaDue?: Date } = {},
): Promise<{ acme: Side; beta: Side }> {
  const past = new Date(c.clk.now().getTime() - 60_000);
  return {
    acme: await seedSide(c, T.acme, o.acmeDue ?? past),
    beta: await seedSide(c, T.beta, o.betaDue ?? past),
  };
}

/** Dọn hàng tới hạn của ca trước (sweeper/nhắc là toàn cục): huỷ hẹn mở, đẩy nhắc/chuyển cấp ra xa. */
export async function quiesceDue(c: CtxPd): Promise<void> {
  const far = new Date(c.clk.now().getTime() + 30 * DAY);
  await c.sql`update hub.process_timers set cancelled_at = ${c.clk.now()}
    where fired_at is null and cancelled_at is null`;
  await c.sql`update hub.review_tasks set remind_at = ${far}, escalate_at = null, escalate_group_id = null
    where status = 'open'`;
}

/** Ảnh trạng thái một phía (so trước/sau — PD-I61). */
export async function sideState(sql: Sql, s: Side): Promise<Json> {
  const runs = [s.retry.runId, s.wait.runId, s.remindTask.runId, s.escTask.runId];
  const ids = sql.array(runs, 2950);
  const [r] = await sql<Json[]>`select
    (select json_agg(json_build_object('id', id, 'status', status, 'u', updated_at) order by id)
       from hub.process_runs where id = any(${ids})) as runs,
    (select json_agg(json_build_object('id', id, 'status', status) order by id)
       from hub.stage_runs where process_run_id = any(${ids})) as stages,
    (select json_agg(json_build_object('id', id, 'f', fired_at, 'c', cancelled_at) order by id)
       from hub.process_timers where process_run_id = any(${ids})) as timers,
    (select json_agg(json_build_object('id', id, 'rc', remind_count, 'ra', reminded_at, 'ea', escalated_at) order by id)
       from hub.review_tasks where process_run_id = any(${ids})) as tasks,
    (select count(*)::int from hub.process_notices where process_run_id = any(${ids})) as notices,
    (select count(*)::int from hub.review_task_assignees a join hub.review_tasks t on t.id = a.task_id
       where t.process_run_id = any(${ids})) as assignees`;
  return r;
}

/** Đếm hàng lệch `tenant_id` giữa các bảng con và `process_runs` (AC-H46: phải toàn 0). */
export async function tenantMismatches(sql: Sql): Promise<Json> {
  const [r] = await sql<Json[]>`select
    (select count(*)::int from hub.process_timers t join hub.process_runs p on p.id = t.process_run_id
       where t.tenant_id <> p.tenant_id) as timers_run,
    (select count(*)::int from hub.process_timers t join hub.stage_runs s on s.id = t.stage_run_id
       where t.tenant_id <> s.tenant_id) as timers_stage,
    (select count(*)::int from hub.stage_runs s join hub.process_runs p on p.id = s.process_run_id
       where s.tenant_id <> p.tenant_id) as stages,
    (select count(*)::int from hub.process_outputs o join hub.process_runs p on p.id = o.process_run_id
       where o.tenant_id <> p.tenant_id) as outputs,
    (select count(*)::int from hub.runs h join hub.process_runs p on p.id = h.process_run_id
       where h.tenant_id <> p.tenant_id) as hub_runs,
    (select count(*)::int from hub.review_tasks k join hub.process_runs p on p.id = k.process_run_id
       where k.tenant_id <> p.tenant_id) as tasks,
    (select count(*)::int from hub.review_task_assignees a join hub.review_tasks k on k.id = a.task_id
       where a.tenant_id <> k.tenant_id) as assignees,
    (select count(*)::int from hub.process_notices n join hub.process_runs p on p.id = n.process_run_id
       where n.tenant_id <> p.tenant_id) as notices`;
  return r;
}
