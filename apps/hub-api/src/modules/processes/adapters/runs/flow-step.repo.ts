// CR-122 · E2 · FLOW2-FR-12/15 · H2: phần `StepRepo` của node Nếu (dữ kiện app) + node Kết thúc (OutcomeHandler, "Cần xử lý").
// Chạy TRONG tx đã khoá `process_runs` FOR UPDATE; mọi câu lọc `tenant_id`. Câu văn bản cố định (Luật 4c).
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { StepRepo } from "../../application/ports";
import { runEndHook } from "../../runs/run-end-hooks";
import { factsReaderFor, outcomeHandlerFor } from "./flow-ports";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type FlowStepRepo = Required<
  Pick<
    StepRepo,
    "readFacts" | "ifDecisions" | "applyOutcome" | "needsAction" | "missingFact" | "runFailed"
  >
>;

export function flowStepRepo(tx: Tx, tenantId: string): FlowStepRepo {
  return {
    async readFacts(p, keys) {
      const r = factsReaderFor(p.pack, p.event);
      return r ? r.read(tenantId, p.recordId, keys) : null;
    },
    async ifDecisions(runId) {
      // Lần rẽ MỚI NHẤT mỗi node Nếu (chạy lại từ Nếu ⇒ bản ghi sau thắng).
      const rows = await tx.execute<{ stage_idx: number; matched: boolean }>(sql`select distinct on
          ((summary->>'stage_idx')::int) (summary->>'stage_idx')::int as stage_idx,
          (summary->'facts'->>'matched')::boolean as matched
        from hub.audit_log
        where tenant_id = ${tenantId} and entity = 'process_run' and entity_id = ${runId}
          and action = 'branch' and summary ? 'facts'
        order by (summary->>'stage_idx')::int, seq desc`);
      return [...rows].map((r) => ({ stageIdx: Number(r.stage_idx), matched: r.matched === true }));
    },
    async applyOutcome(runId, p, outcome) {
      const h = outcomeHandlerFor(p.pack, p.event);
      if (!h) throw new Error(`OutcomeHandler chưa đăng ký: ${p.pack} · ${p.event}`);
      // CR-122 E3 · người quyết bước cuối = `fields.decided_by` của node Duyệt đã xong gần nhất (gates/approve-out.ts) — 1 câu;
      // không có node Duyệt ⇒ hệ thống (null).
      const [a] = await tx.execute<{
        actor: string | null;
      }>(sql`select o.fields->>'decided_by' as actor
        from hub.stage_runs s
        join hub.process_outputs o on o.id = s.current_output_id and o.tenant_id = s.tenant_id
        where s.process_run_id = ${runId} and s.tenant_id = ${tenantId} and s.status = 'done'
          and jsonb_typeof(o.fields) = 'object' and o.fields ? 'decided_by'
        order by s.stage_idx desc limit 1`);
      const actorId = a?.actor && UUID_RE.test(a.actor) ? a.actor : null;
      await h.apply(tx, { tenantId, runId, event: p.event, ref: p.recordId, outcome, actorId });
    },
    async runFailed(runId, p) {
      const snapshot = { trigger: { event: p.event } };
      await runEndHook(
        tx,
        "failed",
        { id: runId, tenantId, packKey: p.pack, packRecordId: p.recordId, snapshot },
        "failed",
      );
    },
    async needsAction(runId, a) {
      const decision = {
        reason: "facts_changed",
        stage_idx: a.ifIdx,
        options: ["cancel"], // "Chạy lại từ Nếu" = thao tác riêng (`POST /process-runs/:id/rerun-from-if`)
        at: new Date().toISOString(),
      };
      await Promise.all([
        tx.execute(sql`update hub.stage_runs set status = 'needs_decision', updated_at = now()
          where process_run_id = ${runId} and tenant_id = ${tenantId}
            and stage_idx = any(array(select jsonb_array_elements_text(${JSON.stringify(a.finishIdxs)}::jsonb)::int))`),
        tx.execute(sql`update hub.process_runs set status = 'needs_decision', current_stage_idx = ${a.first},
          decision = ${JSON.stringify(decision)}::jsonb, updated_at = now()
          where id = ${runId} and tenant_id = ${tenantId}`),
      ]);
    },
    async missingFact(runId, a) {
      // CR-122 · P18 · Thử lại (`add_attempt`) = xếp lại stage Nếu ⇒ Nếu đọc lại dữ kiện HIỆN TẠI; Huỷ = kết thúc lượt.
      const decision = {
        reason: "missing_fact",
        stage_idx: a.ifIdx,
        missing: a.missing,
        options: ["add_attempt", "cancel"],
        at: new Date().toISOString(),
      };
      await Promise.all([
        tx.execute(sql`update hub.stage_runs set status = 'needs_decision', finished_at = null, updated_at = now()
          where process_run_id = ${runId} and tenant_id = ${tenantId} and stage_idx = ${a.ifIdx}`),
        tx.execute(sql`update hub.process_runs set status = 'needs_decision', current_stage_idx = ${a.ifIdx},
          decision = ${JSON.stringify(decision)}::jsonb, updated_at = now()
          where id = ${runId} and tenant_id = ${tenantId}`),
      ]);
    },
  };
}
