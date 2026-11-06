// CR-122 · E2 · FLOW2-FR-12/15 · H2: phần `StepRepo` của node Nếu (dữ kiện app) + node Kết thúc (OutcomeHandler, "Cần xử lý").
// Chạy TRONG tx đã khoá `process_runs` FOR UPDATE; mọi câu lọc `tenant_id`. Câu văn bản cố định (Luật 4c).
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { StepRepo } from "../../application/ports";
import { factsReaderFor, outcomeHandlerFor } from "./flow-ports";

type FlowStepRepo = Required<
  Pick<StepRepo, "readFacts" | "ifDecisions" | "applyOutcome" | "needsAction">
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
      // TODO(CR-122 A1): người quyết bước cuối — node Duyệt ghi `fields.decided_by` vào output (gates/approve-out.ts); join bước chưa
      // đọc nó ⇒ hệ thống (null). App tự đọc người duyệt từ lịch sử nếu cần.
      await h.apply(tx, {
        tenantId,
        runId,
        event: p.event,
        ref: p.recordId,
        outcome,
        actorId: null,
      });
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
  };
}
