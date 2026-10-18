// HUB-FR-147 · AC-H45 · PD2-R13/R14 · P-d2 T19 (plan-d2 §7–§9): phần ghi rẽ nhánh của `StepRepo` — mỗi hàm MỘT câu văn bản
// cố định, mảng qua MỘT tham số JSON (Luật 4c: số câu không phụ thuộc số bước bị nhảy). Chạy trong tx đã khoá run
// (thứ tự khoá plan-d2 §8: run → `stage_runs` bị nhảy → `process_timers` của chúng). Mọi câu lọc `tenant_id`.
import type { RoomProcessPart } from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { BranchEvent, StepRepo } from "../../application/ports";
import { THREAD_LOCALE } from "../../core/thread";
import { threadContent } from "../../core/thread.rules";
import { timerRepo } from "../timers/timers.repo";

type BranchWrites = Pick<StepRepo, "currentFields" | "skipStages" | "cancelTimers" | "branchEvent">;
type Fields = Record<string, string | number>;

const isFields = (v: unknown): v is Fields =>
  typeof v === "object" && v !== null && !Array.isArray(v);

async function currentFields(tx: Tx, tenantId: string, runId: string, stageIdx: number) {
  const [r] = await tx.execute<{ fields: unknown }>(sql`select o.fields from hub.stage_runs s
        join hub.process_outputs o on o.id = s.current_output_id and o.tenant_id = s.tenant_id
        where s.process_run_id = ${runId} and s.tenant_id = ${tenantId} and s.stage_idx = ${stageIdx}`);
  return isFields(r?.fields) ? r.fields : null;
}

async function skipStages(tx: Tx, tenantId: string, runId: string, idxs: readonly number[]) {
  // Q-D2-3 · chỉ stage chưa chạy (`pending`/`queued`) ⇒ `skipped`; mảng rỗng vẫn MỘT câu (số câu cố định).
  const rows = await tx.execute<{ id: string }>(sql`update hub.stage_runs
        set status = 'skipped', finished_at = now(), updated_at = now()
        where process_run_id = ${runId} and tenant_id = ${tenantId}
          and stage_idx = any(array(select jsonb_array_elements_text(${JSON.stringify(idxs)}::jsonb)::int))
          and status in ('pending', 'queued')
        returning id`);
  return [...rows].map((r) => r.id);
}

async function branchEvent(tx: Tx, tenantId: string, runId: string, e: BranchEvent) {
  const meta = {
    kind: "branch",
    process_run_id: runId,
    stage_idx: e.stageIdx,
    to_step: e.toStep,
    rule: e.rule,
  } satisfies RoomProcessPart;
  const content = threadContent(meta, THREAD_LOCALE, { process: "" });
  const summary = {
    run_id: runId,
    stage_idx: e.stageIdx,
    from_step: e.fromStep,
    to_step: e.toStep,
    rule: e.rule,
  };
  // PD2-R14 · audit actor hệ thống (actor_id NULL) + sự kiện thread (chỉ run bắt đầu từ phòng) — MỘT câu.
  await tx.execute(sql`with a as (
          insert into hub.audit_log (tenant_id, actor_id, actor_role, action, entity, entity_id, entity_name, summary)
          select r.tenant_id, null, null, 'branch', 'process_run', r.id,
            left(coalesce(r.snapshot->>'name', ''), 200), ${JSON.stringify(summary)}::jsonb
          from hub.process_runs r where r.id = ${runId} and r.tenant_id = ${tenantId}
          returning 1)
        insert into hub.process_thread_events
          (id, tenant_id, process_run_id, room_id, kind, placement, meta, content, created_at)
        select gen_random_uuid(), r.tenant_id, r.id, r.origin_room_id, 'branch', 'flow',
          ${JSON.stringify(meta)}::jsonb, ${content}, clock_timestamp()
        from hub.process_runs r
        where r.id = ${runId} and r.tenant_id = ${tenantId}
          and r.origin_kind = 'room' and r.origin_room_id is not null`);
}

export function branchWrites(tx: Tx, tenantId: string): BranchWrites {
  return {
    currentFields: (runId, stageIdx) => currentFields(tx, tenantId, runId, stageIdx),
    skipStages: (runId, idxs) => skipStages(tx, tenantId, runId, idxs),
    async cancelTimers(runId, stageRunIds, now) {
      await timerRepo(tx, tenantId).cancelForRun(runId, stageRunIds, now);
    },
    branchEvent: (runId, e) => branchEvent(tx, tenantId, runId, e),
  };
}
