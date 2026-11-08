// CR-125 · «Quy trình con» — câu SQL dùng chung cho pha chạy (launch) và pha chốt (`finishWait`). Mọi câu lọc `tenant_id`. Câu cố định,
// không phụ thuộc số bước (Luật 4c): đọc lượt con theo unique `process_runs_parent_stage_uq`, độ sâu bằng CTE theo `parent_run_id` (≤ 10).
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";

export type ChildRow = { id: string; status: string };

/** Lượt con của ĐÚNG lần chạy stage (attempt, round) — unique ⇒ ≤ 1 hàng. */
export async function childOfStage(
  tx: Tx,
  tenantId: string,
  s: { id: string; attempt: number; round: number },
): Promise<ChildRow | null> {
  const [r] = await tx.execute<ChildRow>(sql`select id, status from hub.process_runs
    where tenant_id = ${tenantId} and parent_stage_run_id = ${s.id}
      and parent_attempt = ${Number(s.attempt)} and parent_round = ${Number(s.round)}`);
  return r ?? null;
}

/** Số lượt tổ tiên của lượt `runId` (lượt gốc = 0). */
export async function ancestorDepth(tx: Tx, tenantId: string, runId: string): Promise<number> {
  const [r] = await tx.execute<{ n: number }>(sql`with recursive up(id, parent, n) as (
      select id, parent_run_id, 0 from hub.process_runs where id = ${runId} and tenant_id = ${tenantId}
      union all
      select p.id, p.parent_run_id, up.n + 1 from hub.process_runs p join up on p.id = up.parent
       where p.tenant_id = ${tenantId} and up.n < 10)
    select coalesce(max(n), 0)::int as n from up`);
  return Number(r?.n ?? 0);
}

/** Chu kỳ hẹn canh: lưới an toàn khi đường nhanh (trigger 0129) không chạy (lượt con bị xoá, hẹn đang bị vòng khác giữ…). */
export const SUBPROCESS_WATCH_MS = 10 * 60_000;

/**
 * MỘT câu: stage cha có hẹn canh mở ⇒ (dueNow) kéo về `now`; chưa có ⇒ ghi hẹn canh `sub:<stage>:<attempt>:<round>:<n>` tới hạn sau
 * `SUBPROCESS_WATCH_MS` (hoặc ngay). Gọi khi run cha ĐÃ khoá (launcher / `finishWait`) ⇒ không hai hẹn canh mở cho một stage.
 */
export async function armWatch(
  tx: Tx,
  tenantId: string,
  w: {
    runId: string;
    stage: { id: string; attempt: number; round: number };
    now: Date;
    dueNow: boolean;
  },
): Promise<void> {
  const due = new Date(w.now.getTime() + (w.dueNow ? 0 : SUBPROCESS_WATCH_MS)).toISOString();
  const base = `sub:${w.stage.id}:${Number(w.stage.attempt)}:${Number(w.stage.round)}:`;
  await tx.execute(sql`with open as (
      select id from hub.process_timers where tenant_id = ${tenantId} and stage_run_id = ${w.stage.id}
        and kind = 'wait_until' and fired_at is null and cancelled_at is null and idempotency_key like 'sub:%'
      for update),
    up as (update hub.process_timers set due_at = least(due_at, ${due}::timestamptz)
      where ${w.dueNow} and id in (select id from open) returning 1)
    insert into hub.process_timers (tenant_id, process_run_id, stage_run_id, kind, due_at, timezone, idempotency_key)
    select ${tenantId}, ${w.runId}, ${w.stage.id}, 'wait_until', ${due}::timestamptz, 'UTC',
      ${base} || (select count(*) + 1 from hub.process_timers
        where tenant_id = ${tenantId} and stage_run_id = ${w.stage.id} and idempotency_key like 'sub:%')::text
    where not exists (select 1 from open)
    on conflict (idempotency_key) do nothing`);
}

/** Ghi liên kết cha vào lượt con vừa tạo (cùng tx tạo lượt). */
export async function linkChild(
  tx: Tx,
  tenantId: string,
  childId: string,
  p: { runId: string; stageRunId: string; attempt: number; round: number },
): Promise<void> {
  await tx.execute(sql`update hub.process_runs set parent_run_id = ${p.runId},
      parent_stage_run_id = ${p.stageRunId}, parent_attempt = ${Number(p.attempt)},
      parent_round = ${Number(p.round)}
    where id = ${childId} and tenant_id = ${tenantId}`);
}

export type ChildResult = {
  id: string;
  status: string;
  end_outcome: string | null;
  last_decision: string | null;
  fields: Record<string, unknown> | null;
};

/**
 * Kết quả lượt con MỚI NHẤT của stage cha (attempt, round hiện tại): trạng thái, `outcome` của node Kết thúc đã chạy (stage `done` có
 * `outcome` trong snapshot), quyết định Duyệt cuối, field output hiện hành gộp theo thứ tự bước (bước sau thắng). MỘT câu.
 */
export async function childResult(
  tx: Tx,
  tenantId: string,
  stage: { id: string; attempt: number; round: number },
): Promise<ChildResult | null> {
  const [r] = await tx.execute<ChildResult>(sql`select c.id, c.status,
      (select c.snapshot->'stages'->(s.stage_idx::int)->>'outcome' from hub.stage_runs s
        where s.process_run_id = c.id and s.tenant_id = c.tenant_id and s.status = 'done'
          and c.snapshot->'stages'->(s.stage_idx::int) ? 'outcome'
        order by s.stage_idx desc limit 1) as end_outcome,
      (select o.fields->>'decision' from hub.stage_runs s
         join hub.process_outputs o on o.id = s.current_output_id and o.tenant_id = s.tenant_id
        where s.process_run_id = c.id and s.tenant_id = c.tenant_id and o.fields ? 'decision'
        order by s.stage_idx desc limit 1) as last_decision,
      (select jsonb_object_agg(f.key, f.value order by f.idx) from (
          select s.stage_idx as idx, e.key, e.value from hub.stage_runs s
            join hub.process_outputs o on o.id = s.current_output_id and o.tenant_id = s.tenant_id
            cross join lateral jsonb_each(case when jsonb_typeof(o.fields) = 'object' then o.fields else '{}'::jsonb end) e
           where s.process_run_id = c.id and s.tenant_id = c.tenant_id) f) as fields
    from hub.process_runs c
    where c.tenant_id = ${tenantId} and c.parent_stage_run_id = ${stage.id}
      and c.parent_attempt = ${Number(stage.attempt)} and c.parent_round = ${Number(stage.round)}`);
  return r ?? null;
}

/** Huỷ: lượt con còn chạy của lượt `runId` (khoá theo thứ tự id — cha đã khoá trước ⇒ cha → con). */
export async function liveChildren(tx: Tx, tenantId: string, runId: string): Promise<string[]> {
  const rows = await tx.execute<{ id: string }>(sql`select id from hub.process_runs
    where tenant_id = ${tenantId} and parent_run_id = ${runId}
      and status not in ('done', 'cancelled', 'failed', 'expired')
    order by id for update`);
  return rows.map((r) => r.id);
}
