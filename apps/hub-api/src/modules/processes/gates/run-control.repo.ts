// CR-121 · R-1 · ghi của điều khiển lượt chạy: audit (nguồn duy nhất của người làm + lý do + thời điểm cho dòng thời gian) và
// "Chạy lại cả lượt" = MỘT câu CTE (hội thoại nền + flow + run mới `rerun_of` + stage_runs + audit). Mọi câu lọc `tenant_id`.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";

export type ControlOp = "stop" | "rerun_step" | "rerun";
/** `hub.audit_log.action` có sẵn (CHECK): Dừng ⇒ 'cancel'; chạy lại ⇒ 'start'. Phân biệt bằng `summary.op`. */
const ACTION: Record<ControlOp, "cancel" | "start"> = {
  stop: "cancel",
  rerun_step: "start",
  rerun: "start",
};

type Audit = {
  tenantId: string;
  runId: string;
  actorId: string;
  actorRole: "platform_admin" | "tenant_admin" | "member";
  op: ControlOp;
  summary: Record<string, unknown>;
};

/** Một câu: audit (+ Dừng ⇒ `cancelled_by`). */
export async function auditControl(tx: Tx, a: Audit): Promise<void> {
  const summary = JSON.stringify({ op: a.op, ...a.summary });
  const setBy =
    a.op === "stop"
      ? sql`, upd as (update hub.process_runs set cancelled_by = ${a.actorId}::uuid
          where id = ${a.runId}::uuid and tenant_id = ${a.tenantId}::uuid)`
      : sql``;
  await tx.execute(sql`with r as (select left(coalesce(snapshot->>'name', ''), 200) as name from hub.process_runs
      where id = ${a.runId}::uuid and tenant_id = ${a.tenantId}::uuid)${setBy}
    insert into hub.audit_log (tenant_id, actor_id, actor_role, action, entity, entity_id, entity_name, summary)
    select ${a.tenantId}::uuid, ${a.actorId}::uuid, ${a.actorRole}, ${ACTION[a.op]}, 'process_run', ${a.runId}::uuid,
      r.name, ${summary}::jsonb from r`);
}

/** Run đã được chạy lại từ run này (unique một phần `process_runs_rerun_of_uq`). */
export async function rerunOf(tx: Tx, tenantId: string, runId: string): Promise<string | null> {
  const [r] = await tx.execute<{ id: string }>(sql`select id from hub.process_runs
    where rerun_of = ${runId}::uuid and tenant_id = ${tenantId}::uuid`);
  return r?.id ?? null;
}

export type NewRerun = {
  id: string;
  convId: string;
  flowId: string;
  tenantId: string;
  oldId: string;
  /** Bước của từng stage theo snapshot (bước 0 ⇒ queued, còn lại pending — như `insertRun`). */
  steps: readonly number[];
  actorId: string;
  actorRole: Audit["actorRole"];
  summary: Record<string, unknown>;
  now: Date;
};

/**
 * MỘT câu: run mới CÙNG snapshot (định nghĩa đã chụp) + input/inputs/nguồn đã ghim của run cũ, người bắt đầu giữ nguyên (file đầu
 * vào thuộc họ), origin `admin`; hội thoại nền + flow như `insertRun`; audit trên run MỚI. Gọi khi đã khoá run cũ FOR UPDATE và
 * chưa có run chạy lại ⇒ hai lần bấm đồng thời tuần tự hoá (unique `rerun_of` là lưới cuối).
 */
export async function insertRerun(tx: Tx, n: NewRerun): Promise<void> {
  const stages = JSON.stringify(
    n.steps.map((st, i) => ({ i, s: st === 0 ? "queued" : "pending" })),
  );
  const summary = JSON.stringify({ op: "rerun", rerun_of: n.oldId, ...n.summary });
  const at = n.now.toISOString();
  await tx.execute(sql`with
    o as (select * from hub.process_runs where id = ${n.oldId}::uuid and tenant_id = ${n.tenantId}::uuid),
    cv as (insert into hub.conversations (id, tenant_id, user_id, title, title_norm, process_run_id)
      select ${n.convId}::uuid, o.tenant_id, o.started_by, coalesce(o.snapshot->>'name', ''),
        lower(coalesce(o.snapshot->>'name', '')), ${n.id}::uuid from o),
    fl as (insert into hub.flows (id, tenant_id, user_id, conversation_id, title)
      select ${n.flowId}::uuid, o.tenant_id, o.started_by, ${n.convId}::uuid, coalesce(o.snapshot->>'name', '') from o),
    pr as (insert into hub.process_runs (id, tenant_id, process_def_id, def_version, snapshot, started_by, origin_kind,
        input, conversation_id, flow_id, started_at, expires_at, pinned_sources, sources_pinned_at, inputs, is_test, rerun_of)
      select ${n.id}::uuid, o.tenant_id, o.process_def_id, o.def_version, o.snapshot, o.started_by, 'admin', o.input,
        ${n.convId}::uuid, ${n.flowId}::uuid, ${at}::timestamptz,
        case when jsonb_typeof(o.snapshot->'ttl_days') = 'number'
          then ${at}::timestamptz + make_interval(days => (o.snapshot->>'ttl_days')::int) end,
        o.pinned_sources, case when o.pinned_sources is null then null else ${at}::timestamptz end,
        o.inputs, o.is_test, o.id from o returning id, tenant_id),
    st as (insert into hub.stage_runs (tenant_id, process_run_id, stage_idx, status)
      select pr.tenant_id, pr.id, (x->>'i')::int, x->>'s' from pr, jsonb_array_elements(${stages}::jsonb) x)
    insert into hub.audit_log (tenant_id, actor_id, actor_role, action, entity, entity_id, entity_name, summary)
    select pr.tenant_id, ${n.actorId}::uuid, ${n.actorRole}, 'start', 'process_run', pr.id,
      left(coalesce(o.snapshot->>'name', ''), 200), ${summary}::jsonb from pr, o`);
}
